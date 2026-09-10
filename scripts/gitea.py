"""Mandatory Gitea storage/bootstrap; no feature flag or optional install branch."""
import contextlib
import copy
import json
import pathlib
import subprocess
import shutil
import tempfile
from runtime import DOCKER, compose, run

ADMIN = 'genhub-admin'
PENDING = 'Gitea chưa bootstrap. Bắt buộc chạy sudo gen-hub gitea-enable trong TUI.'


def volumes(state):
    return {key: {'name': 'gen-hub-' + state['installation_id'] + '-' + key,
                  'labels': {'io.gen-hub.installation-id': state['installation_id']}}
            for key in ['gitea-data', 'gitea-config']}


def service(state, images, common):
    return {
        **copy.deepcopy(common), 'image': state.get('gitea_image', images['gitea']),
        'user': '1000:1000', 'pids_limit': 256, 'mem_limit': '1g',
        'stop_grace_period': '60s', 'tmpfs': ['/tmp:size=256m,mode=1777'],
        'volumes': ['gitea-data:/var/lib/gitea', 'gitea-config:/etc/gitea'],
        'environment': {
            'GITEA__database__DB_TYPE': 'sqlite3',
            'GITEA__database__PATH': '/var/lib/gitea/data/gitea.db',
            'GITEA__server__ROOT_URL': 'https://' + state['domain'] + '/gitea/',
            'GITEA__server__DOMAIN': state['domain'],
            'GITEA__server__HTTP_PORT': '3000', 'GITEA__server__DISABLE_SSH': 'true',
            'GITEA__server__LFS_START_SERVER': 'true',
            'GITEA__security__INSTALL_LOCK': 'true',
            'GITEA__service__DISABLE_REGISTRATION': 'true',
            'GITEA__service__REQUIRE_SIGNIN_VIEW': 'true',
            'GITEA__actions__ENABLED': 'false', 'GITEA__packages__ENABLED': 'false',
            'GITEA__session__COOKIE_NAME': 'genhub_gitea',
            'GITEA__session__COOKIE_SECURE': 'true',
            'GITEA__log__MODE': 'console', 'GITEA__log__LEVEL': 'Warn',
        },
        'healthcheck': {'test': ['CMD', 'wget', '-q', '--spider', 'http://127.0.0.1:3000/api/healthz'],
                        'interval': '5s', 'timeout': '5s', 'retries': 24, 'start_period': '30s'},
    }


def configured(path):
    return 'gitea' in json.loads(pathlib.Path(path).read_text())['services']


def verify(path):
    if not configured(path):
        raise RuntimeError(PENDING)
    config = json.loads(pathlib.Path(path).read_text())
    check_volumes({'installation_id': config['x-gen-hub']['installation_id']}, required=True)
    # Health endpoint checks database connectivity. File checks detect lost/replaced storage.
    compose(path, 'exec', '-T', 'gitea', 'sh', '-ec',
            'test -s /etc/gitea/app.ini; test -s /var/lib/gitea/data/gitea.db; '
            'test -w /var/lib/gitea; du -sh /var/lib/gitea /etc/gitea')
    compose(path, 'exec', '-T', 'hub', 'node', '--input-type=module', '-e',
            "const r=await fetch('http://gitea:3000/api/healthz',{signal:AbortSignal.timeout(5000)});"
            "const b=await r.json();if(!r.ok||b.status!=='pass')process.exit(1)")


def require_bootstrap(state, path):
    if not state.get('gitea_bootstrapped'):
        raise RuntimeError(PENDING)
    result = compose(path, 'exec', '-T', 'gitea', 'gitea', 'admin', 'user', 'list', '--admin', capture_output=True)
    if not any(len(row.split()) > 1 and row.split()[1] == ADMIN for row in result.stdout.splitlines()):
        raise RuntimeError('Thiếu admin Gitea nội bộ; khôi phục database Gitea từ backup.')


def bootstrap(path, state, save, unattended=False):
    if state.get('gitea_bootstrapped'):
        require_bootstrap(state, path)
        return
    if unattended:
        # Existing installations receive the new CLI via update, then must finish at a terminal.
        print(PENDING)
        return
    verify(path)
    result = compose(path, 'exec', '-T', 'gitea', 'gitea', 'admin', 'user', 'list', '--admin', capture_output=True)
    exists = any(len(row.split()) > 1 and row.split()[1] == ADMIN for row in result.stdout.splitlines())
    if not exists:
        # Open the controlling TTY before creating credentials. Redirection/journald never gets the password.
        with open('/dev/tty', 'w') as terminal:
            password = compose(path, 'exec', '-T', 'hub', 'node', '--input-type=module', '-e',
                               "import {secret} from './server/store.mjs';process.stdout.write(secret())",
                               capture_output=True).stdout.strip()
            if len(password) < 24:
                raise RuntimeError('Không sinh được mật khẩu Gitea an toàn.')
            try:
                compose(path, 'exec', '-T', 'gitea', 'sh', '-ec',
                        'read -r password; exec gitea admin user create --username genhub-admin '
                        '--email genhub-admin@localhost.invalid --admin --must-change-password '
                        '--password "$password"', input=password + '\n', capture_output=True)
            except subprocess.CalledProcessError:
                raise RuntimeError('Không tạo được admin Gitea; chạy lại bootstrap để kiểm tra.') from None
            terminal.write('\nGitea: https://' + state['domain'] + '/gitea/\nAdmin nội bộ: ' + ADMIN +
                           '\nMật khẩu (chỉ hiển thị lần này, hãy lưu ngay): ' + password + '\n')
            terminal.flush()
            password = None
    state['gitea_bootstrapped'] = True
    save()
    require_bootstrap(state, path)


def check_volumes(state, required=False):
    """Inspect before mount/remove so Docker cannot silently create or delete foreign data."""
    existing = set(run([*DOCKER, 'volume', 'ls', '--format', '{{.Name}}'], capture_output=True).stdout.split())
    owned = []
    for definition in volumes(state).values():
        name = definition['name']
        if name not in existing:
            if required:
                raise RuntimeError('Thiếu volume Gitea: ' + name + '. Khôi phục backup; không tạo storage thay thế.')
            continue
        info = json.loads(run([*DOCKER, 'volume', 'inspect', name], capture_output=True).stdout)[0]
        if (info.get('Labels') or {}).get('io.gen-hub.installation-id') != state['installation_id']:
            raise RuntimeError('Volume Gitea không thuộc installation: ' + name)
        owned.append(name)
    return owned


def guard_transition(current, candidate):
    """Gitea schema migrations require a separate, explicit upgrade/restore procedure."""
    old = current['services'].get('gitea')
    new = candidate['services'].get('gitea')
    if old and (not new or old['image'] != new['image'] or old['volumes'] != new['volumes'] or
                current.get('volumes') != candidate.get('volumes')):
        raise RuntimeError('Không tự đổi image/storage hoặc hạ schema Gitea. Giữ phiên bản hiện tại; khôi phục backup cần quy trình riêng.')


@contextlib.contextmanager
def snapshot(path):
    config = json.loads(pathlib.Path(path).read_text())
    if 'gitea' not in config['services']:
        yield None  # Pre-Gitea installation backup for its one-time migration.
        return
    state = {'installation_id': config['x-gen-hub']['installation_id']}
    check_volumes(state, required=True)
    running = bool(compose(path, 'ps', '--status', 'running', '-q', 'gitea', capture_output=True).stdout.strip())
    with tempfile.TemporaryDirectory() as temp:
        archive = pathlib.Path(temp) / 'gitea.tar'
        try:
            if running:
                print('Tạm dừng Gitea để sao lưu nhất quán database/git/LFS/attachments/config/keys…')
                compose(path, 'stop', 'gitea')
            mounts = []
            for key, destination in [('gitea-data', '/var/lib/gitea'), ('gitea-config', '/etc/gitea')]:
                mounts += ['--mount', 'type=volume,src=' + volumes(state)[key]['name'] + ',dst=' + destination + ',readonly']
            with archive.open('wb') as output:
                run([*DOCKER, 'run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
                     '--security-opt', 'no-new-privileges:true', '--user', '1000:1000', *mounts,
                     '--entrypoint', 'tar', config['services']['gitea']['image'],
                     '-C', '/', '-cf', '-', 'var/lib/gitea', 'etc/gitea'], stdout=output)
            # Check the cold SQLite database before accepting the archive.
            import tarfile, sqlite3
            with tarfile.open(archive) as tar:
                db = pathlib.Path(temp) / 'gitea.db'
                with tar.extractfile('var/lib/gitea/data/gitea.db') as source, db.open('wb') as dest:
                    shutil.copyfileobj(source, dest)
                # Preserve WAL if the process was stopped uncleanly.
                for suffix in ['-wal', '-shm']:
                    name = 'var/lib/gitea/data/gitea.db' + suffix
                    if name in tar.getnames():
                        with tar.extractfile(name) as source, pathlib.Path(str(db) + suffix).open('wb') as dest:
                            shutil.copyfileobj(source, dest)
                with sqlite3.connect(db) as connection:
                    if connection.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                        raise RuntimeError('Database Gitea lỗi integrity; backup chưa được chấp nhận.')
            yield archive
        finally:
            if running:
                compose(path, 'up', '-d', '--wait', '--wait-timeout', '150', '--no-build', 'gitea')


def enable(state):
    """Finish the mandatory bootstrap on an installation whose owner already exists."""
    from runtime import ROOT, CONF, DATA, atomic, manifest, caddy_config, admin, backup
    from install import check_ports, public_test
    path = CONF / 'compose.json'
    if state.get('engine') != 'compose':
        raise RuntimeError('Chạy bộ cài Compose hiện tại trước khi bootstrap Gitea.')
    if admin(path, 'owner-exists').stdout.strip() != 'yes':
        raise RuntimeError('Thiếu owner; hoàn tất TUI cài mới để tạo owner và Gitea cùng nhau.')
    check_ports({**state, 'mode': 'personal'}, [])
    check_volumes(state, required=bool(state.get('gitea_bootstrapped')))
    save = lambda: atomic(CONF / 'install.json', json.dumps(state, indent=2))
    if state.get('gitea_bootstrapped'):
        verify(path); public_test(state); require_bootstrap(state, path)
        print('✓ Gitea đã bootstrap; giữ tài khoản và dữ liệu hiện tại.')
        return
    before, before_caddy = path.read_text(), (CONF / 'Caddyfile').read_text()
    config = json.loads(before)
    if 'gitea' not in config['services']:
        release = ROOT / 'releases' / state['revision']
        candidate = manifest(state, release, CONF, DATA)
        config['services']['gitea'] = candidate['services']['gitea']
        config['volumes'] = candidate['volumes']
    image = config['services']['gitea']['image']
    run([*DOCKER, 'pull', image])
    state['gitea_image'] = image
    # Save the immutable image before first boot, including interrupted bootstrap retries.
    save()
    import time
    target = ROOT / 'backups' / ('before-gitea-' + str(time.time_ns()) + '.tar.gz')
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    backup(path, target)
    try:
        atomic(path, json.dumps(config, indent=2))
        atomic(CONF / 'Caddyfile', caddy_config(state), 0o644)
        compose(path, 'config', '--quiet')
        compose(path, 'up', '-d', '--wait', '--wait-timeout', '150', '--no-build', '--force-recreate', 'gitea', 'caddy')
        verify(path); public_test(state)
        bootstrap(path, state, save)
    except BaseException:
        # Keep Gitea storage for retry; restore Hub routing without touching its owner/database.
        atomic(path, before)
        atomic(CONF / 'Caddyfile', before_caddy, 0o644)
        compose(path, 'up', '-d', '--wait', '--wait-timeout', '150', '--no-build', '--force-recreate', 'caddy')
        raise
    print('✓ Bootstrap Gitea bắt buộc đã hoàn tất: https://' + state['domain'] + '/gitea/')
