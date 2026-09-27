"""Kho Ryan (Baserow) storage, bootstrap and lifecycle.
Follows the Gitea lifecycle precedent: container managed via Compose,
named volume with installation label, Caddy reverse proxy, snapshot backup,
and explicit kho-enable / kho-disable commands.
"""
import contextlib
import copy
import json
import os
import pathlib
import subprocess
import tempfile
from runtime import DOCKER, compose, run

ROOT = pathlib.Path('/opt/gen-hub')
CONF = pathlib.Path('/etc/gen-hub')

PENDING = 'Kho chưa được kích hoạt. Chạy sudo gen-hub kho-enable để kích hoạt.'


def volumes(state):
    return {
        'kho-data': {
            'name': 'gen-hub-' + state['installation_id'] + '-kho-data',
            'labels': {'io.gen-hub.installation-id': state['installation_id']}
        }
    }


def service(state, images, common):
    domain = state['domain']
    kho_domain = f"kho.{domain}"
    return {
        **copy.deepcopy(common),
        'image': state.get('kho_image', images['baserow']),
        'read_only': False,
        'cap_drop': ['ALL'],
        'cap_add': ['CHOWN', 'DAC_OVERRIDE', 'FOWNER', 'SETUID', 'SETGID', 'KILL', 'NET_BIND_SERVICE'],
        'pids_limit': 256,
        'mem_limit': '2g',
        'stop_grace_period': '60s',
        'tmpfs': ['/tmp:size=256m,mode=1777'],
        'volumes': ['kho-data:/baserow/data'],
        'environment': {
            'BASEROW_PUBLIC_URL': f'https://{kho_domain}',
            'BASEROW_EXTRA_PUBLIC_URLS': 'http://127.0.0.1,http://localhost,http://kho',
            'WEB_FRONTEND_SSL': 'false',
            'BASEROW_CADDY_ADDRESSES': 'http://',
            'DISABLE_VOLUME_CHECK': 'no',
        },
        'healthcheck': {
            'test': ['CMD', 'curl', '-f', 'http://127.0.0.1:80/api/_health/'],
            'interval': '5s',
            'timeout': '5s',
            'retries': 30,
            'start_period': '240s'
        },
    }


def configured(path):
    return 'kho' in json.loads(pathlib.Path(path).read_text())['services']


def check_volumes(state, required=False):
    existing = set(run([*DOCKER, 'volume', 'ls', '--format', '{{.Name}}'], capture_output=True).stdout.split())
    owned = []
    for definition in volumes(state).values():
        name = definition['name']
        if name not in existing:
            if required:
                raise RuntimeError('Thiếu volume Kho: ' + name + '. Khôi phục backup; không tạo storage thay thế.')
            continue
        info = json.loads(run([*DOCKER, 'volume', 'inspect', name], capture_output=True).stdout)[0]
        if (info.get('Labels') or {}).get('io.gen-hub.installation-id') != state['installation_id']:
            raise RuntimeError('Volume Kho không thuộc installation: ' + name)
        owned.append(name)
    return owned


def verify(path):
    if not configured(path):
        raise RuntimeError(PENDING)
    config = json.loads(pathlib.Path(path).read_text())
    check_volumes({'installation_id': config['x-gen-hub']['installation_id']}, required=True)
    compose(path, 'exec', '-T', 'kho', 'sh', '-ec',
            'test -d /baserow/data; test -w /baserow/data; du -sh /baserow/data')
    compose(path, 'exec', '-T', 'hub', 'node', '--input-type=module', '-e',
            "const r=await fetch('http://kho:80/api/_health/',{signal:AbortSignal.timeout(5000)});"
            "const t=(await r.text()).trim();if(!r.ok||(t!=='OK'&&t!=='pass'))process.exit(1)")


@contextlib.contextmanager
def snapshot(path):
    config = json.loads(pathlib.Path(path).read_text())
    if 'kho' not in config['services']:
        yield None
        return
    state = {'installation_id': config['x-gen-hub']['installation_id']}
    check_volumes(state, required=True)
    running = bool(compose(path, 'ps', '--status', 'running', '-q', 'kho', capture_output=True).stdout.strip())
    with tempfile.TemporaryDirectory() as temp:
        archive = pathlib.Path(temp) / 'kho.tar'
        try:
            if running:
                print('Tạm dừng Kho để sao lưu nhất quán database/storage/config…')
                compose(path, 'stop', 'kho')
            mount = ['--mount', 'type=volume,src=' + volumes(state)['kho-data']['name'] + ',dst=/baserow/data,readonly']
            with archive.open('wb') as output:
                run([*DOCKER, 'run', '--rm', '--network', 'none', '--read-only',
                     '--security-opt', 'no-new-privileges:true', *mount,
                     '--entrypoint', 'tar', config['services']['kho']['image'],
                     '-C', '/', '-cf', '-', 'baserow/data'], stdout=output)
            yield archive
        finally:
            if running:
                compose(path, 'up', '-d', '--wait', '--wait-timeout', '300', '--no-build', 'kho')


def enable(state):
    """Enable and bootstrap Kho (Baserow) for this installation."""
    from runtime import DATA, atomic, manifest, caddy_config, admin, backup
    path = CONF / 'compose.json'
    if state.get('engine') != 'compose':
        raise RuntimeError('Chạy bộ cài Compose hiện tại trước khi kích hoạt Kho.')
    if admin(path, 'owner-exists').stdout.strip() != 'yes':
        raise RuntimeError('Thiếu owner; hoàn tất TUI cài mới trước.')
    
    save = lambda: atomic(CONF / 'install.json', json.dumps(state, indent=2))
    state['kho_enabled'] = True
    before, before_caddy = path.read_text(), (CONF / 'Caddyfile').read_text()
    config = json.loads(before)
    release = ROOT / 'releases' / state.get('revision', '')
    candidate = manifest(state, release, CONF, DATA)
    config['services']['kho'] = candidate['services']['kho']
    config.setdefault('volumes', {})['kho-data'] = candidate['volumes']['kho-data']
    
    image = config['services']['kho']['image']
    run([*DOCKER, 'pull', image])
    state['kho_image'] = image
    save()

    import time
    target = ROOT / 'backups' / ('before-kho-' + str(time.time_ns()) + '.tar.gz')
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    backup(path, target)

    try:
        atomic(path, json.dumps(config, indent=2))
        atomic(CONF / 'Caddyfile', caddy_config(state), 0o644)
        compose(path, 'config', '--quiet')
        compose(path, 'up', '-d', '--wait', '--wait-timeout', '300', '--no-build', '--force-recreate', 'kho', 'caddy')
        verify(path)
    except BaseException:
        state['kho_enabled'] = False
        save()
        with contextlib.suppress(Exception):
            compose(path, 'stop', 'kho')
            compose(path, 'rm', '-f', 'kho')
        atomic(path, before)
        atomic(CONF / 'Caddyfile', before_caddy, 0o644)
        compose(path, 'up', '-d', '--wait', '--wait-timeout', '150', '--no-build', '--force-recreate', 'caddy')
        raise
    domain = state['domain']
    print(f'✓ Kích hoạt Kho Ryan thành công: https://kho.{domain} (hoặc https://{domain}/kho/)')


def disable(state, purge=False):
    """Disable Kho: stop container, remove route, optionally purge volume."""
    from runtime import atomic, caddy_config, backup
    path = CONF / 'compose.json'
    save = lambda: atomic(CONF / 'install.json', json.dumps(state, indent=2))
    config = json.loads(path.read_text())
    if 'kho' in config['services']:
        import time
        target = ROOT / 'backups' / ('before-kho-disable-' + str(time.time_ns()) + '.tar.gz')
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        backup(path, target)
        compose(path, 'stop', 'kho')
        compose(path, 'rm', '-f', 'kho')
        del config['services']['kho']
        if purge and 'kho-data' in config.get('volumes', {}):
            del config['volumes']['kho-data']
        atomic(path, json.dumps(config, indent=2))
    state['kho_enabled'] = False
    save()
    atomic(CONF / 'Caddyfile', caddy_config(state), 0o644)
    compose(path, 'up', '-d', '--wait', '--wait-timeout', '150', '--no-build', '--force-recreate', 'caddy')
    if purge:
        for name in check_volumes(state):
            run([*DOCKER, 'volume', 'rm', name])
    print('✓ Đã tắt Kho.' + (' Đã xóa dữ liệu Kho.' if purge else ' Dữ liệu vẫn giữ nguyên; bật lại bằng sudo gen-hub kho-enable.'))
