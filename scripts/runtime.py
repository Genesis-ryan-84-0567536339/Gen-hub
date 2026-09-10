"""Docker Compose runtime shared by installer, administration and real-container CI."""
import copy
import json
import os
import pathlib
import subprocess
import tarfile
import tempfile
import time

ROOT = pathlib.Path('/opt/gen-hub')
CONF = pathlib.Path('/etc/gen-hub')
DATA = pathlib.Path('/var/lib/gen-hub')
DOCKER = ['docker', '--host', 'unix:///var/run/docker.sock']


def run(args, **kwargs):
    return subprocess.run(args, check=True, text=True, **kwargs)


def atomic(path, value, mode=0o600):
    path = pathlib.Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=path.name + '.', dir=path.parent)
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, 'w') as stream:
            stream.write(value)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        pathlib.Path(name).unlink(missing_ok=True)


def compose(path, *args, **kwargs):
    # Explicit local socket/project/file: never inherit a user's remote Docker context.
    return run([*DOCKER, 'compose', '--project-name', 'gen-hub', '-f', str(path), *args], **kwargs)


def caddy_config(state):
    upstream = f'''reverse_proxy hub:3080 {{
    header_up Host {state['domain']}
    flush_interval -1
  }}'''
    if state['mode'] == 'vps':
        return f'{{\n  admin off\n}}\n{state["domain"]} {{\n  {upstream}\n}}\n'
    return f'{{\n  admin off\n  auto_https off\n}}\nhttp://:8080 {{\n  {upstream}\n}}\n'


def manifest(state, release, conf=CONF, data=DATA):
    release, conf, data = map(pathlib.Path, (release, conf, data))
    images = json.loads((release / 'deploy/images.json').read_text())
    common = {
        'restart': 'unless-stopped', 'read_only': True,
        'security_opt': ['no-new-privileges:true'], 'cap_drop': ['ALL'],
        'logging': {'driver': 'json-file', 'options': {'max-size': '10m', 'max-file': '3'}},
        'networks': ['hub'], 'labels': {'io.gen-hub.installation-id': state['installation_id']},
    }
    hub = {
        **copy.deepcopy(common), 'image': 'gen-hub:' + state['revision'],
        'build': {'context': str(release), 'args': {'NODE_IMAGE': images['node']}},
        'user': f"{state['uid']}:{state['gid']}",
        'environment': {'HOST': '0.0.0.0', 'PORT': '3080', 'DATA_DIR': '/data',
                        'PUBLIC_URL': 'https://' + state['domain'], 'INSTALLATION_ID': state['installation_id'],
                        'GENHUB_REVISION': state.get('revision', ''),
                        'GENHUB_UPDATED_AT': str(state.get('updated_at', ''))},
        'volumes': [f'{data}:/data:Z'], 'tmpfs': ['/tmp:size=16m,mode=1777'],
        'init': True, 'pids_limit': 128, 'mem_limit': '512m', 'stop_grace_period': '30s',
        'healthcheck': {'test': ['CMD', 'node', 'server/healthcheck.mjs'],
                        'interval': '5s', 'timeout': '5s', 'retries': 12, 'start_period': '10s'},
    }
    # Optional root-owned file, shared with the host updater; never embed its token in Compose JSON.
    if (conf / 'update.env').is_file():
        hub['env_file'] = [str(conf / 'update.env')]
    caddy = {
        **copy.deepcopy(common), 'image': images['caddy'],
        'user': f"{state['uid']}:{state['gid']}",
        'cap_add': ['NET_BIND_SERVICE'], 'pids_limit': 128, 'mem_limit': '256m',
        'volumes': [f'{conf}/Caddyfile:/etc/caddy/Caddyfile:ro,Z',
                    f'{data.parent}/gen-hub-caddy:/data:Z', f'{data.parent}/gen-hub-caddy-config:/config:Z'],
        'depends_on': {'hub': {'condition': 'service_healthy'}},
    }
    services = {'hub': hub, 'caddy': caddy}
    if state['mode'] == 'vps':
        caddy['ports'] = ['80:80', '443:443']
    else:
        services['tunnel'] = {
            **copy.deepcopy(common), 'image': images['cloudflared'],
            'user': f"{state['uid']}:{state['gid']}", 'pids_limit': 128, 'mem_limit': '256m',
            'command': ['tunnel', '--no-autoupdate', '--metrics', '0.0.0.0:2000',
                        'run', '--token-file', '/run/secrets/tunnel_token'],
            'secrets': ['tunnel_token'], 'depends_on': {'caddy': {'condition': 'service_started'}},
        }
    result = {'services': services, 'networks': {'hub': {}},
              'x-gen-hub': {'installation_id': state['installation_id'], 'schema': 1}}
    if state['mode'] == 'personal':
        result['secrets'] = {'tunnel_token': {'file': str(conf / 'tunnel.token')}}
    return result


def admin(path, command, secret=None, extra=None):
    return compose(path, 'exec', '-T', 'hub', 'node', 'server/admin.mjs', command, *(extra or []),
                   input=json.dumps(secret) if secret is not None else None, capture_output=True)


def verify_local(path, state):
    compose(path, 'exec', '-T', 'hub', 'node', 'server/doctor.mjs')
    # The same network path used by cloudflared, without publishing a host port.
    if state['mode'] == 'personal':
        script = "const r=await fetch('http://caddy:8080/healthz');const b=await r.json();if(!r.ok||b.installationId!==process.env.INSTALLATION_ID)process.exit(1)"
        compose(path, 'exec', '-T', 'hub', 'node', '--input-type=module', '-e', script)
        script = "const r=await fetch('http://tunnel:2000/ready',{signal:AbortSignal.timeout(5000)});if(!r.ok)process.exit(1)"
        for attempt in range(12):
            try:
                compose(path, 'exec', '-T', 'hub', 'node', '--input-type=module', '-e', script,
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                break
            except subprocess.CalledProcessError:
                if attempt == 11:
                    raise RuntimeError('Tunnel chưa kết nối Cloudflare. Kiểm tra token và outbound TCP/UDP 7844.') from None
                time.sleep(5)
    print('✓ Container và lưu trữ đã sẵn sàng.')


def backup(path, target, conf=CONF, data=DATA):
    """Consistent live SQLite snapshot plus key/config; never copy live WAL files."""
    target, conf, data = map(pathlib.Path, (target, conf, data))
    if target.exists():
        raise RuntimeError('Tệp backup đã tồn tại.')
    snapshot = 'backup-' + str(time.time_ns()) + '.db'
    try:
        admin(path, 'backup', extra=['/data/' + snapshot])
        fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'wb') as stream, tarfile.open(fileobj=stream, mode='w:gz') as archive:
            archive.add(data / snapshot, arcname='data/hub.db')
            archive.add(data / 'master.key', arcname='data/master.key')
            archive.add(conf, arcname='config', filter=lambda info: None if info.name.endswith('.lock') else info)
        print('✓ Backup dữ liệu, khóa và cấu hình: ' + str(target))
    finally:
        (data / snapshot).unlink(missing_ok=True)
