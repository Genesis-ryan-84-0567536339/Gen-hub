#!/usr/bin/env python3
"""Guided Linux installer: every gate must pass before creating the owner."""
import argparse, copy, getpass, ipaddress, json, os, pathlib, platform, pwd, re
import secrets, shutil, socket, sqlite3, subprocess, sys, tarfile, tempfile, time
import urllib.request, urllib.error, urllib.parse
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from runtime import ROOT, CONF, DATA, DOCKER, run, atomic, compose, manifest, caddy_config, admin, verify_local, backup
from docker_setup import ensure_docker

def ask(prompt, default=''):
    value = input(prompt + (f' [{default}]' if default else '') + ': ').strip()
    return value or default

def fetch(url, headers=None, data=None, method=None):
    payload=json.dumps(data).encode() if data is not None else None
    req=urllib.request.Request(url,data=payload,headers={'User-Agent':'Gen-hub-installer/0.1',**({'Content-Type':'application/json'} if payload else {}),**(headers or {})},method=method)
    try:
        with urllib.request.urlopen(req,timeout=30) as r:return r.read()
    except urllib.error.HTTPError as e:
        # Do not expose response headers or credential-bearing URLs.
        raise RuntimeError(f'Dịch vụ trả HTTP {e.code}. Kiểm tra quyền token hoặc cấu hình.') from None
def cf(token,path,data=None,method=None):
    result=json.loads(fetch('https://api.cloudflare.com/client/v4'+path,{'Authorization':'Bearer '+token},data,method))
    if not result.get('success'):raise RuntimeError('Cloudflare từ chối yêu cầu. Kiểm tra quyền và phạm vi domain/account.')
    return result['result']
def normalize_domain(value):
    if '://' in value or '/' in value or ':' in value:raise ValueError('Nhập hostname, không có https:// hoặc đường dẫn.')
    domain=value.rstrip('.').lower().encode('idna').decode()
    if len(domain)>253 or not re.fullmatch(r'(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}',domain):raise ValueError('Domain không hợp lệ.')
    return domain

def check_dns(domain, expected):
    found={r[4][0] for r in socket.getaddrinfo(domain,443,type=socket.SOCK_STREAM)}
    return found == {str(ipaddress.ip_address(expected))}

def wait_vps_dns(state):
    print('\nTạo DNS tại nhà cung cấp domain:')
    print('  Loại: '+('AAAA' if ':' in state['ip'] else 'A'))
    print('  Tên: '+state['domain']+'\n  Giá trị: '+state['ip'])
    print('  Tắt proxy Cloudflare (DNS only) trong bước kiểm tra này. Mở TCP 80/443 trên firewall VPS và nhà cung cấp.')
    while True:
        if ask('Đã thiết lập DNS xong? Nhập test để kiểm tra','test')!='test':continue
        try:
            if check_dns(state['domain'],state['ip']):print('✓ DNS đã trỏ đúng IP.');return
        except OSError:pass
        print('DNS chưa trỏ đúng IP. Chờ cập nhật hoặc sửa bản ghi rồi thử lại. Ctrl+C để dừng và tiếp tục sau.')

def setup_tunnel(state,save):
    print('\nCloudflare API token cần Account → Cloudflare Tunnel → Edit; Zone → DNS → Edit; Zone → Zone → Read.')
    print('Giới hạn quyền đúng account/domain. Domain gốc phải đang dùng DNS Cloudflare và ở trạng thái Active.')
    token=getpass.getpass('Cloudflare API token (ẩn): ').strip()
    if not token:raise RuntimeError('Thiếu API token.')
    root=normalize_domain(ask('Domain gốc trên Cloudflare',state.get('zone_name','')))
    if state['domain']!=root and not state['domain'].endswith('.'+root):raise RuntimeError('Hostname phải thuộc domain gốc.')
    zones=cf(token,'/zones?'+urllib.parse.urlencode({'name':root,'status':'active'}))
    if len(zones)!=1:raise RuntimeError('Không tìm thấy đúng một zone Active; kiểm tra DNS và phạm vi token.')
    zone=zones[0];state.update(zone_id=zone['id'],account_id=zone['account']['id'],zone_name=root);save()
    endpoint='/accounts/'+state['account_id']+'/cfd_tunnel'
    if state.get('tunnel_id'):
        existing=cf(token,endpoint+'/'+state['tunnel_id'])
        if existing.get('deleted_at'):raise RuntimeError('Tunnel đã bị xóa. Cần khôi phục cấu hình trước khi tiếp tục.')
    else:
        name='gen-hub-'+state['installation_id'][:16]
        existing=cf(token,endpoint+'?'+urllib.parse.urlencode({'name':name,'is_deleted':'false'}))
        if len(existing)>1:raise RuntimeError('Có nhiều tunnel cùng tên; không tự chọn để tránh ghi nhầm.')
        tunnel=existing[0] if existing else cf(token,endpoint,{'name':name,'config_src':'cloudflare'},'POST')
        state['tunnel_id']=tunnel['id'];save()
    endpoint+='/'+state['tunnel_id']
    target=state['tunnel_id']+'.cfargotunnel.com'
    records=cf(token,'/zones/'+state['zone_id']+'/dns_records?'+urllib.parse.urlencode({'name':state['domain']}))
    if records:
        if len(records)!=1 or records[0]['type']!='CNAME' or records[0]['content']!=target:
            raise RuntimeError('Hostname có bản ghi khác. Hãy chọn hostname chưa dùng hoặc sửa DNS thủ công; bộ cài không ghi đè.')
    else:cf(token,'/zones/'+state['zone_id']+'/dns_records',{'type':'CNAME','name':state['domain'],'content':target,'proxied':True},'POST')
    previous_config = cf(token, endpoint+'/configurations').get('config') if state.get('services_installed') and state.get('engine') != 'compose' else None
    cf(token,endpoint+'/configurations',{'config':{'ingress':[{'hostname':state['domain'],'service':'http://caddy:8080'},{'service':'http_status:404'}]}},'PUT')
    runtime_token=cf(token,endpoint+'/token')
    atomic(CONF/'tunnel.token',runtime_token+'\n');os.chown(CONF/'tunnel.token',state['uid'],state['gid'])
    print('✓ Đã thiết lập tunnel và DNS. API token quản trị không được lưu trên đĩa.')
    return (lambda: cf(token, endpoint+'/configurations', {'config': previous_config}, 'PUT')) if previous_config else None

def public_test(state):
    print('\nKiểm tra HTTPS từ domain về đúng bản cài…')
    for i in range(18):
        try:
            result=json.loads(fetch('https://'+state['domain']+'/healthz'))
            if result.get('ok') and result.get('installationId')==state['installation_id']:
                print('✓ HTTPS hợp lệ, domain đã tới đúng Gen-hub.');return
        except (OSError,ValueError,RuntimeError):pass
        if i%3==0:print('Đang chờ DNS/HTTPS/tunnel…')
        time.sleep(5)
    raise RuntimeError('HTTPS chưa tới đúng Hub. Xem sudo gen-hub status và sudo gen-hub logs. Chạy lại bộ cài để kiểm tra tiếp.')

def checkpoint(state, save, name, action):
    print('\n→ ' + name)
    state['step'] = name
    state['last_error'] = None
    save()
    result = action()
    print('✓ ' + name)
    return result


def copy_release(source, revision):
    release = ROOT / 'releases' / revision
    if not release.exists():
        release.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=release.parent) as temp:
            staging = pathlib.Path(temp) / 'source'
            shutil.copytree(source, staging, ignore=shutil.ignore_patterns('.git', 'var', 'node_modules', '__pycache__'))
            for root, dirs, files in os.walk(staging):
                os.chmod(root, 0o755)
                for name in files:
                    os.chmod(pathlib.Path(root) / name, 0o755 if name.endswith('.sh') else 0o644)
            os.replace(staging, release)
    return release


def legacy_services(state):
    if state.get('engine') == 'compose' or not state.get('services_installed'):
        return []
    services = ['gen-hub', 'gen-hub-caddy'] + (['gen-hub-tunnel'] if state['mode'] == 'personal' else [])
    for service in services:
        path = pathlib.Path('/etc/systemd/system') / (service + '.service')
        if not path.exists() or str(ROOT) + '/bin/' not in path.read_text():
            raise RuntimeError('Không xác minh được service cũ thuộc Gen-hub: ' + service)
    return services


def check_ports(state, legacy):
    ids = run([*DOCKER, 'ps', '-aq', '--filter', 'label=com.docker.compose.project=gen-hub'], capture_output=True).stdout.split()
    for cid in ids:
        info = json.loads(run([*DOCKER, 'inspect', cid], capture_output=True).stdout)[0]
        if info.get('Config', {}).get('Labels', {}).get('io.gen-hub.installation-id') != state['installation_id']:
            raise RuntimeError('Compose project gen-hub đã được installation khác sử dụng.')
    if state['mode'] != 'vps':
        return  # No published host ports at all in personal mode.
    own = set()
    if (CONF / 'compose.json').exists():
        config = json.loads((CONF / 'compose.json').read_text())
        if config.get('x-gen-hub', {}).get('installation_id') != state['installation_id']:
            raise RuntimeError('Compose hiện có thuộc installation khác.')
        ids = compose(CONF / 'compose.json', 'ps', '-q', 'caddy', capture_output=True).stdout.split()
        for cid in ids:
            info = json.loads(run([*DOCKER, 'inspect', cid], capture_output=True).stdout)[0]
            for bindings in (info.get('NetworkSettings', {}).get('Ports') or {}).values():
                own.update(int(b['HostPort']) for b in bindings or [])
    if 'gen-hub-caddy' in legacy and subprocess.run(['systemctl', 'is-active', '--quiet', 'gen-hub-caddy']).returncode == 0:
        own.update([80, 443])
    for port in [80, 443]:
        if port in own:
            continue
        for family, address in [(socket.AF_INET, '0.0.0.0'), (socket.AF_INET6, '::')]:
            with socket.socket(family) as sock:
                if family == socket.AF_INET6:
                    sock.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
                try:
                    sock.bind((address, port))
                except OSError as error:
                    if error.errno in (97, 99):  # IPv6 disabled on this host.
                        continue
                    raise RuntimeError(f'Cổng {port} đang được ứng dụng khác sử dụng.') from None


def prepare_images(path):
    config = json.loads(path.read_text())
    for service in ['caddy', 'tunnel']:
        if service not in config['services']:
            continue
        ref = config['services'][service]['image']
        run([*DOCKER, 'pull', ref])
        digests = json.loads(run([*DOCKER, 'image', 'inspect', ref, '--format', '{{json .RepoDigests}}'], capture_output=True).stdout)
        if not digests:
            raise RuntimeError('Image thiếu digest: ' + service)
        config['services'][service]['image'] = digests[0]
    atomic(path, json.dumps(config, indent=2))
    compose(path, 'config', '--quiet')
    compose(path, 'build', '--pull', 'hub')
    mount = config['services']['caddy']['volumes'][0]
    run([*DOCKER, 'run', '--rm', '--network', 'none', '-v', mount, config['services']['caddy']['image'], 'caddy', 'validate', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'])


def ensure_owner(path):
    if admin(path, 'owner-exists').stdout.strip() == 'yes':
        print('✓ Giữ nguyên tài khoản owner đã có.')
        return
    while True:
        username = ask('Tên đăng nhập owner (3–80 chữ/số, _, ., @, -)')
        if 3 <= len(username) <= 80 and all(c.isalnum() or c in '_.@-' for c in username):
            break
        print('Tên đăng nhập chưa hợp lệ.')
    while True:
        password = getpass.getpass('Mật khẩu (12–256 ký tự, nhập ẩn): ')
        repeat = getpass.getpass('Nhập lại mật khẩu: ')
        if password == repeat and 12 <= len(password) <= 256:
            break
        print('Mật khẩu chưa khớp hoặc độ dài không hợp lệ.')
    admin(path, 'create-owner', {'username': username, 'password': password})
    password = repeat = None
    if admin(path, 'owner-exists').stdout.strip() != 'yes':
        raise RuntimeError('Chưa xác minh được tài khoản owner sau khi tạo.')


def legacy_backup(target):
    # Call only after stopping the old services. Python SQLite backup includes committed WAL.
    with tempfile.TemporaryDirectory() as temp:
        snapshot = pathlib.Path(temp) / 'hub.db'
        with sqlite3.connect(DATA / 'hub.db') as source, sqlite3.connect(snapshot) as dest:
            source.backup(dest)
        fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'wb') as stream, tarfile.open(fileobj=stream, mode='w:gz') as archive:
            archive.add(snapshot, arcname='data/hub.db')
            archive.add(DATA / 'master.key', arcname='data/master.key')
            archive.add(CONF, arcname='config', filter=lambda info: None if info.name.endswith('.lock') else info)


def activate(state, old, release, candidate, save, legacy, restore_tunnel=None):
    path = CONF / 'compose.json'
    previous = path.read_text() if path.exists() else None
    previous_caddy = (CONF / 'Caddyfile').read_text() if (CONF / 'Caddyfile').exists() else None
    old_wrapper = pathlib.Path('/usr/local/bin/gen-hub')
    wrapper_text = old_wrapper.read_text() if old_wrapper.exists() else None
    target = CONF / ('backup-before-' + str(time.time_ns()) + '.tar.gz')
    # Put backups outside CONF to avoid recursively adding earlier backup archives.
    target = ROOT / 'backups' / target.name
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if previous and (DATA / 'hub.db').exists():
        running = compose(path, 'ps', '--status', 'running', '-q', 'hub', capture_output=True).stdout.strip()
        if running:
            backup(path, target)
        else:
            legacy_backup(target)
    if legacy:
        run(['systemctl', 'stop', *legacy])
    try:
        if legacy:
            legacy_backup(target)
        atomic(CONF / 'Caddyfile', caddy_config(state), 0o644)
        config = json.loads(candidate.read_text())
        config['services']['caddy']['volumes'][0] = f'{CONF}/Caddyfile:/etc/caddy/Caddyfile:ro,Z'
        atomic(path, json.dumps(config, indent=2))
        state.update(engine='compose', pending_revision=release.name)
        save()
        atomic(old_wrapper, f'#!/usr/bin/env bash\nexec python3 {release}/scripts/manage.py "$@"\n', 0o755)
        compose(path, 'up', '-d', '--wait', '--wait-timeout', '150', '--remove-orphans', '--no-build', '--force-recreate')
        checkpoint(state, save, 'Kiểm tra container, SQLite và kết nối nội bộ', lambda: verify_local(path, state))
        checkpoint(state, save, 'Kiểm tra HTTPS qua domain', lambda: public_test(state))
        checkpoint(state, save, 'Tạo hoặc xác minh owner', lambda: ensure_owner(path))
        # Ensure the owner is visible through the public route, not merely in the CLI process.
        status = json.loads(fetch('https://' + state['domain'] + '/healthz'))
        if not status.get('initialized') or status.get('installationId') != state['installation_id']:
            raise RuntimeError('Owner chưa sẵn sàng qua domain.')
    except BaseException:
        if restore_tunnel:
            try:
                restore_tunnel()
            except Exception:
                print('Không khôi phục được route Cloudflare; cần kiểm tra token/kết nối. Tiếp tục khôi phục runtime local.', file=sys.stderr)
        if previous:
            atomic(path, previous)
            if previous_caddy:
                atomic(CONF / 'Caddyfile', previous_caddy, 0o644)
            compose(path, 'up', '-d', '--wait', '--wait-timeout', '150', '--remove-orphans', '--no-build', '--force-recreate')
        elif legacy:
            compose(path, 'down', '--remove-orphans')
            path.unlink(missing_ok=True)
            if previous_caddy:
                atomic(CONF / 'Caddyfile', previous_caddy, 0o644)
            run(['systemctl', 'start', *legacy])
        if previous or legacy:
            state.clear(); state.update(old); save()
            if wrapper_text:
                atomic(old_wrapper, wrapper_text, 0o755)
            print('Đã khôi phục runtime trước. Backup: ' + str(target))
        raise
    if previous and old.get('completed') and old.get('revision') and old['revision'] != release.name:
        atomic(CONF / 'previous-compose.json', previous)
        atomic(CONF / 'previous-Caddyfile', previous_caddy or '', 0o644)
        atomic(CONF / 'previous-install.json', json.dumps(old, indent=2))
    if legacy:
        run(['systemctl', 'disable', *legacy])
        state['migrated_from_systemd'] = True
    link = ROOT / 'current.new'
    link.unlink(missing_ok=True); link.symlink_to(release); os.replace(link, ROOT / 'current')
    state.update(revision=release.name, engine='compose', completed=True, services_installed=True,
                 step='Hoàn tất', pending_revision=None, last_error=None)
    save()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True)
    parser.add_argument('--revision', required=True)
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise RuntimeError('Chạy bộ cài bằng sudo.')
    if sys.version_info < (3, 10):
        raise RuntimeError('Cần Python 3.10 trở lên.')
    if platform.system() != 'Linux' or not pathlib.Path('/run/systemd/system').exists():
        raise RuntimeError('Cần Linux với systemd để quản lý Docker.')
    if platform.machine() not in ['x86_64', 'aarch64']:
        raise RuntimeError('Chỉ hỗ trợ Linux x86_64 / aarch64.')
    if not re.fullmatch('[0-9a-f]{40}', args.revision):
        raise RuntimeError('Revision không hợp lệ.')
    CONF.mkdir(exist_ok=True, mode=0o700); CONF.chmod(0o700)
    import fcntl
    lock = open(CONF / 'install.lock', 'w')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    path = CONF / 'install.json'
    state = json.loads(path.read_text()) if path.exists() else {'installation_id': secrets.token_hex(24)}
    old = copy.deepcopy(state)
    def save():
        atomic(path, json.dumps(state, indent=2))
    try:
        print('\nGEN-HUB · Cài đặt Docker Compose\n')
        if not state.get('mode'):
            desktop = bool(os.environ.get('DISPLAY') or os.environ.get('WAYLAND_DISPLAY') or pathlib.Path('/usr/share/xsessions').exists() or pathlib.Path('/usr/share/wayland-sessions').exists())
            print('Gợi ý: ' + ('máy cá nhân' if desktop else 'VPS/server'))
            mode = ask('1 = VPS/server, 2 = máy cá nhân', '2' if desktop else '1')
            if mode not in ['1', '2']:
                raise RuntimeError('Lựa chọn không hợp lệ.')
            state['mode'] = 'vps' if mode == '1' else 'personal'; save()
        if not state.get('domain'):
            state['domain'] = normalize_domain(ask('Hostname Gen-hub (ví dụ hub.example.com)')); save()
        if state['mode'] == 'vps':
            if not state.get('ip'):
                try:
                    suggest = fetch('https://api.ipify.org').decode().strip(); ipaddress.ip_address(suggest)
                except Exception:
                    suggest = ''
                address = ask('IP public của VPS', suggest)
                if not ipaddress.ip_address(address).is_global:
                    raise RuntimeError('VPS cần IP public hợp lệ.')
                state['ip'] = address; save()
            checkpoint(state, save, 'Kiểm tra DNS (cả A và AAAA)', lambda: wait_vps_dns(state))
        checkpoint(state, save, 'Chuẩn bị và kiểm tra Docker', ensure_docker)
        legacy = legacy_services(state)
        checkpoint(state, save, 'Kiểm tra cổng không bị chiếm', lambda: check_ports(state, legacy))
        try:
            user = pwd.getpwnam('genhub')
        except KeyError:
            run(['useradd', '--system', '--home-dir', str(DATA), '--shell', '/usr/sbin/nologin', 'genhub'])
            user = pwd.getpwnam('genhub')
        state.update(uid=user.pw_uid, gid=user.pw_gid)
        DATA.mkdir(exist_ok=True, mode=0o700); os.chown(DATA, user.pw_uid, user.pw_gid)
        for name in ['gen-hub-caddy', 'gen-hub-caddy-config']:
            directory = DATA.parent / name
            directory.mkdir(exist_ok=True, mode=0o700)
            os.chown(directory, user.pw_uid, user.pw_gid)
        release = copy_release(args.source, args.revision)
        candidate_state = {**state, 'revision': args.revision}
        staging = CONF / 'candidate'
        staging.mkdir(exist_ok=True, mode=0o700)
        atomic(staging / 'Caddyfile', caddy_config(state), 0o644)
        config = manifest(candidate_state, release, CONF, DATA)
        config['services']['caddy']['volumes'][0] = f'{staging}/Caddyfile:/etc/caddy/Caddyfile:ro,Z'
        if state['mode'] == 'personal' and not (CONF / 'tunnel.token').exists():
            atomic(CONF / 'tunnel.token', '')
        candidate = staging / 'compose.json'
        atomic(candidate, json.dumps(config, indent=2))
        checkpoint(state, save, 'Tải images, build Gen-hub và xác thực Caddy', lambda: prepare_images(candidate))
        restore_tunnel = None
        if state['mode'] == 'personal':
            # Reuse runtime token/config on subsequent Compose installs; no repeated admin-token prompt.
            if old.get('engine') != 'compose' or not (CONF / 'tunnel.token').stat().st_size or not state.get('tunnel_id'):
                restore_tunnel = checkpoint(state, save, 'Thiết lập Cloudflare Tunnel và DNS', lambda: setup_tunnel(state, save))
        if state['mode'] == 'personal':
            os.chown(CONF / 'tunnel.token', state['uid'], state['gid'])
            if shutil.which('selinuxenabled') and subprocess.run(['selinuxenabled']).returncode == 0:
                run(['chcon', '-t', 'container_file_t', str(CONF / 'tunnel.token')])
        activate(state, old, release, candidate, save, legacy, restore_tunnel)
        print('\n✓ Gen-hub đã sẵn sàng.\nĐăng nhập: https://' + state['domain'] + '\nMCP tổng: https://' + state['domain'] + '/mcp\nKiểm tra lại: sudo gen-hub doctor')
    except Exception as error:
        state['last_error'] = 'Lệnh hệ thống thất bại' if isinstance(error, subprocess.CalledProcessError) else str(error)
        save()
        raise

if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('\nĐã dừng. Chạy lại cùng lệnh cài để tiếp tục.'); sys.exit(130)
    except Exception as error:
        message = 'Một lệnh hệ thống thất bại. Xem thông báo phía trên.' if isinstance(error, subprocess.CalledProcessError) else str(error)
        print('Cài đặt dừng: ' + message + '\nChạy lại cùng lệnh cài; không cần tạo lại owner hoặc tunnel.', file=sys.stderr)
        sys.exit(1)
