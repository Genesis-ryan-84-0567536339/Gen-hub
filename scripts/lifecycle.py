"""Unattended updates and explicit cleanup for this installation only."""
import json
import os
import pathlib
import re
import shutil
import subprocess
import tempfile
import urllib.parse
import urllib.request
import urllib.error
import time
import datetime
import email.utils
from runtime import ROOT, CONF, DATA, DOCKER, atomic, run, compose

REPO = 'Genesis-ryan-84-0567536339/Gen-hub'
API = 'https://api.github.com/repos/' + REPO
UNIT_DIR = pathlib.Path('/etc/systemd/system')
WRAPPER = pathlib.Path('/usr/local/bin/gen-hub')


def github(path):
    backoff = CONF / 'github-backoff.json'
    try:
        retry_at = json.loads(backoff.read_text()).get('retry_at', 0)
        if isinstance(retry_at, (int, float)) and retry_at > time.time():
            raise RuntimeError('Giới hạn GitHub API tạm thời; thử lại từ ' + datetime.datetime.fromtimestamp(retry_at, datetime.timezone.utc).isoformat())
    except (OSError, ValueError):
        pass
    headers = {'User-Agent': 'Gen-hub-updater', 'Accept': 'application/vnd.github+json'}
    token = os.environ.get('GENHUB_GITHUB_TOKEN', '').strip()
    if not token and (CONF / 'update.env').is_file():
        for line in (CONF / 'update.env').read_text().splitlines():
            if line.startswith('GENHUB_GITHUB_TOKEN='):
                token = line.partition('=')[2].strip()
    if token:
        headers['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(API + path, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        h = error.headers
        if error.code == 429 or (error.code == 403 and (h.get('x-ratelimit-remaining') == '0' or h.get('retry-after'))):
            retry_at = time.time() + 60
            try:
                retry_at = max(retry_at, float(h.get('x-ratelimit-reset', 0)))
                retry = h.get('retry-after', '')
                if retry:
                    retry_at = max(retry_at, time.time() + int(retry) if retry.isdigit() else email.utils.parsedate_to_datetime(retry).timestamp())
            except (ValueError, TypeError, OverflowError):
                pass
            atomic(backoff, json.dumps({'retry_at': retry_at}))
            raise RuntimeError('Giới hạn GitHub API tạm thời; thử lại từ ' + datetime.datetime.fromtimestamp(retry_at, datetime.timezone.utc).isoformat() + '. Auto-update sẽ kiểm tra lại ở chu kỳ kế tiếp.') from None
        raise RuntimeError(f'GitHub API trả HTTP {error.code}; kiểm tra token/quyền hoặc kết nối.') from None


def eligible_revision(state, automatic=False):
    sha = github('/commits/main')['sha']
    if not re.fullmatch('[0-9a-f]{40}', sha):
        raise RuntimeError('Revision GitHub không hợp lệ.')
    if sha == state.get('revision'):
        print('✓ Đang dùng bản mới nhất của Gen-hub/main.'); return None
    if automatic and sha == state.get('failed_update_revision'):
        print('Bản này đã cập nhật lỗi trước đó; giữ runtime đang dùng, chờ commit mới hoặc update thủ công.'); return None
    runs = github('/actions/workflows/ci.yml/runs?' + urllib.parse.urlencode({'head_sha': sha, 'event': 'push', 'per_page': 20}))['workflow_runs']
    matches = [r for r in runs if r.get('head_sha') == sha and r.get('head_branch') == 'main' and r.get('event') == 'push']
    if not matches or matches[0].get('conclusion') != 'success' or matches[0].get('status') != 'completed':
        print('Bản main mới chưa qua CI; giữ bản hiện tại và kiểm tra lại sau.'); return None
    return sha


def update(state, automatic=False):
    if automatic and (not state.get('completed') or not state.get('auto_update', True)):
        print('Tự cập nhật đang tắt hoặc chưa cài hoàn tất.'); return
    sha = eligible_revision(state, automatic)
    if not sha:
        return
    try:
        with tempfile.TemporaryDirectory() as temp:
            script = pathlib.Path(temp) / 'install.sh'
            url = f'https://raw.githubusercontent.com/{REPO}/{sha}/install.sh'
            with urllib.request.urlopen(url, timeout=30) as response:
                script.write_bytes(response.read())
            run(['bash', str(script), '--revision', sha, *(['--auto'] if automatic else [])])
    except Exception:
        current = json.loads((CONF / 'install.json').read_text())
        # The installer marks a revision only after runtime activation fails.
        # Download/DNS/lock failures are transient and must remain retryable.
        current['update_error'] = 'Cập nhật chưa hoàn tất; xem journalctl -u gen-hub-update.'
        atomic(CONF / 'install.json', json.dumps(current, indent=2))
        raise


def configure_updates(state):
    atomic(UNIT_DIR / 'gen-hub-update.service', f'''[Unit]
Description=Gen-hub verified repository update
After=network-online.target docker.service
Wants=network-online.target
[Service]
Type=oneshot
EnvironmentFile=-{CONF}/update.env
ExecStart={WRAPPER} update --auto
TimeoutStartSec=20min
UMask=0077
''', 0o644)
    atomic(UNIT_DIR / 'gen-hub-update.timer', '''[Unit]
Description=Check Gen-hub/main every hour
[Timer]
OnCalendar=hourly
RandomizedDelaySec=10min
Persistent=true
[Install]
WantedBy=timers.target
''', 0o644)
    run(['systemctl', 'daemon-reload'])
    enabled = state.get('auto_update', True)
    run(['systemctl', 'enable' if enabled else 'disable', '--now', 'gen-hub-update.timer'])
    print('Tự cập nhật: ' + ('bật, kiểm tra mỗi giờ (lệch tối đa 10 phút).' if enabled else 'đã tắt.'))


def stop_updates():
    if (UNIT_DIR / 'gen-hub-update.timer').exists():
        run(['systemctl', 'disable', '--now', 'gen-hub-update.timer'])


def check_storage(state):
    import sqlite3
    db = DATA / 'hub.db'; key = DATA / 'master.key'
    if not db.exists() or not key.exists():
        raise RuntimeError('Thiếu database hoặc master.key. Khôi phục backup; doctor không tạo dữ liệu/khóa thay thế.')
    if len(key.read_bytes()) != 32:
        raise RuntimeError('master.key không hợp lệ. Cần khôi phục khóa gốc từ backup.')
    with sqlite3.connect(f'file:{db}?mode=ro', uri=True) as connection:
        if connection.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
            raise RuntimeError('Database lỗi integrity. Cần khôi phục backup; không tự sửa/xóa bản ghi.')
        if connection.execute('PRAGMA user_version').fetchone()[0] != 1:
            raise RuntimeError('Schema chưa được hỗ trợ bởi công cụ quản trị hiện tại.')


def repair(state, cloudflare=False):
    from docker_setup import ensure_docker
    from install import check_ports, prepare_images, setup_tunnel, public_test
    from runtime import manifest, caddy_config, verify_local, admin
    check_storage(state)
    from gitea import check_volumes, require_bootstrap
    if state.get('gitea_enabled', True):
        check_volumes(state, required=True)
        if not state.get('gitea_bootstrapped'):
            from gitea import PENDING
            raise RuntimeError(PENDING)
    release = ROOT / 'releases' / state['revision']
    if not (release / 'Dockerfile').exists():
        raise RuntimeError('Thiếu source của revision đang cài. Chạy lại install.sh để phục hồi source.')
    ensure_docker(); check_ports(state, [])
    # Repair only files owned by this application, and never follow symlinks.
    for path in [DATA, *[DATA / name for name in ['hub.db', 'hub.db-wal', 'hub.db-shm', 'master.key']]]:
        if path.is_symlink():
            raise RuntimeError('Từ chối tự sửa dữ liệu dạng symlink: ' + str(path))
        if path.exists():
            os.chown(path, state['uid'], state['gid']); path.chmod(0o700 if path.is_dir() else 0o600)
    for name in ['gen-hub-caddy', 'gen-hub-caddy-config']:
        path = DATA.parent / name
        if path.is_symlink():
            raise RuntimeError('Từ chối sửa thư mục chứng chỉ dạng symlink.')
        path.mkdir(exist_ok=True, mode=0o700); os.chown(path, state['uid'], state['gid'])
    if state['mode'] == 'personal':
        if cloudflare:
            setup_tunnel(state, lambda: atomic(CONF / 'install.json', json.dumps(state, indent=2)))
        token = CONF / 'tunnel.token'
        if not token.exists() or not token.stat().st_size:
            raise RuntimeError('Thiếu token tunnel. Chạy sudo gen-hub doctor --fix --cloudflare để cấp lại bằng API token.')
        os.chown(token, state['uid'], state['gid']); token.chmod(0o600)
        if shutil.which('selinuxenabled') and subprocess.run(['selinuxenabled']).returncode == 0:
            run(['chcon', '-t', 'container_file_t', str(token)])
    import time
    snapshots = ROOT / 'backups' / ('doctor-config-' + str(time.time_ns()))
    snapshots.mkdir(parents=True, mode=0o700)
    for name in ['compose.json', 'Caddyfile', 'install.json']:
        if (CONF / name).exists():
            shutil.copy2(CONF / name, snapshots / name)
    # Reconstruct known app-owned config from the persisted installation, not arbitrary health output.
    path = CONF / 'compose.json'
    atomic(CONF / 'Caddyfile', caddy_config(state), 0o644)
    atomic(path, json.dumps(manifest(state, release, CONF, DATA), indent=2))
    prepare_images(path)
    compose(path, 'up', '-d', '--wait', '--wait-timeout', '150', '--remove-orphans', '--no-build', '--force-recreate')
    verify_local(path, state); public_test(state)
    if state.get('gitea_enabled', True):
        require_bootstrap(state, path)
    if admin(path, 'owner-exists').stdout.strip() != 'yes':
        raise RuntimeError('Thiếu owner; hoàn tất TUI cài đặt. Doctor không tự tạo tài khoản.')
    configure_updates(state)
    state['last_error'] = None
    atomic(CONF / 'install.json', json.dumps(state, indent=2))
    print('✓ Đã sửa cấu hình/quyền file, tạo lại container và kiểm tra kết nối. Giữ nguyên database, khóa và owner.')


def cloudflare_cleanup(state):
    from install import cf
    token = input('Cloudflare API token để xóa tunnel/DNS của bản cài này: ').strip()
    endpoint = '/accounts/' + state['account_id'] + '/cfd_tunnel/' + state['tunnel_id']
    tunnel = cf(token, endpoint)
    if tunnel.get('name') != 'gen-hub-' + state['installation_id'][:16]:
        raise RuntimeError('Tunnel không khớp tên installation; từ chối xóa.')
    config = cf(token, endpoint + '/configurations').get('config', {})
    if any(rule.get('hostname') not in [None, state['domain']] for rule in config.get('ingress', [])):
        raise RuntimeError('Tunnel đang phục vụ hostname khác; từ chối xóa.')
    records_path = '/zones/' + state['zone_id'] + '/dns_records'
    records = cf(token, records_path + '?' + urllib.parse.urlencode({'name': state['domain']}))
    target = state['tunnel_id'] + '.cfargotunnel.com'
    if any(r.get('type') != 'CNAME' or r.get('content') != target for r in records):
        raise RuntimeError('DNS đã đổi sang tài nguyên khác; từ chối xóa.')
    cf(token, endpoint + '/connections', method='DELETE')
    cf(token, endpoint, method='DELETE')
    for record in records:
        cf(token, records_path + '/' + record['id'], method='DELETE')
    print('✓ Đã xóa tunnel và DNS đúng installation trên Cloudflare.')


def purge(state, remove_cloudflare=False):
    from install import check_ports
    # Exact confirmation is enforced by CLI before entering this function.
    check_ports({**state, 'mode': 'personal'}, [])  # Ownership only, no port probes.
    from gitea import check_volumes
    owned_gitea = check_volumes(state)
    stop_updates()
    compose(CONF / 'compose.json', 'down', '--remove-orphans')
    if remove_cloudflare and state.get('tunnel_id'):
        cloudflare_cleanup(state)  # Any API failure keeps local state so cleanup can be retried.
    for volume in owned_gitea:
        run([*DOCKER, 'volume', 'rm', volume])
    images = run([*DOCKER, 'images', '--format', '{{.Repository}}:{{.Tag}}', '--filter', 'label=org.opencontainers.image.source=https://github.com/' + REPO], capture_output=True).stdout.split()
    for image in {ref for ref in images if ref.startswith('gen-hub:')}:
        subprocess.run([*DOCKER, 'image', 'rm', image], stdout=subprocess.DEVNULL)  # No force: shared/in-use images survive.
    for name in ['gen-hub-update.service', 'gen-hub-update.timer', 'gen-hub.service', 'gen-hub-caddy.service', 'gen-hub-tunnel.service']:
        path = UNIT_DIR / name
        if path.exists():
            contents = path.read_text()
            if '/opt/gen-hub/' in contents or '/usr/local/bin/gen-hub' in contents or name == 'gen-hub-update.timer':
                if name in ['gen-hub.service', 'gen-hub-caddy.service', 'gen-hub-tunnel.service']:
                    run(['systemctl', 'disable', '--now', name])
                path.unlink()
    run(['systemctl', 'daemon-reload'])
    for path in [DATA, DATA.parent / 'gen-hub-caddy', DATA.parent / 'gen-hub-caddy-config', ROOT, CONF]:
        if path.is_symlink():
            raise RuntimeError('Từ chối xóa thư mục gốc dạng symlink: ' + str(path))
    # Paths above are fixed constants, never accepted from CLI/state.
    for path in [DATA, DATA.parent / 'gen-hub-caddy', DATA.parent / 'gen-hub-caddy-config', ROOT, CONF]:
        if path.exists():
            shutil.rmtree(path)
    WRAPPER.unlink(missing_ok=True)
    if state.get('created_service_user'):
        import pwd
        try:
            account = pwd.getpwnam('genhub')
            if account.pw_uid == state['uid'] and account.pw_dir == str(DATA):
                run(['userdel', 'genhub'])
        except KeyError:
            pass
    print('✓ Đã xóa Gen-hub khỏi máy: container/network, dữ liệu/khóa, cấu hình, source và backup nội bộ.')
    print('Giữ Docker, image nền dùng chung và backup do bạn lưu ở nơi khác. ' + ('Đã xử lý Cloudflare.' if remove_cloudflare else 'Tunnel/DNS Cloudflare vẫn được giữ.'))
