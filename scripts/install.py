#!/usr/bin/env python3
"""Linux TUI installer. State in /etc/gen-hub/install.json; passwords never in argv."""
import argparse, getpass, hashlib, ipaddress, json, os, pathlib, platform, pwd, re, shutil, socket, subprocess, sys, tarfile, tempfile, time, urllib.request, urllib.error, urllib.parse, secrets
ROOT=pathlib.Path('/opt/gen-hub'); CONF=pathlib.Path('/etc/gen-hub'); DATA=pathlib.Path('/var/lib/gen-hub')
def run(args, **kwargs):
    return subprocess.run(args, check=True, text=True, **kwargs)
def ask(prompt, default=''):
    value=input(prompt+(f' [{default}]' if default else '')+': ').strip()
    return value or default
def atomic(path, value, mode=0o600):
    path=pathlib.Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix(path.suffix+'.tmp');tmp.write_text(value);tmp.chmod(mode);os.replace(tmp,path)
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

def checksum_download(url,expected,target):
    data=fetch(url)
    if hashlib.sha256(data).hexdigest()!=expected.removeprefix('sha256:'):raise RuntimeError('Checksum bản tải không khớp; dừng cài đặt.')
    target.write_bytes(data);return target

def install_node():
    node=ROOT/'bin/node'
    if node.exists() and run([str(node),'--version'],capture_output=True).stdout.startswith('v24.'):return node
    arch={'x86_64':'x64','aarch64':'arm64'}.get(platform.machine())
    if not arch:raise RuntimeError('Hỗ trợ Linux x86_64 và aarch64.')
    checks=fetch('https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt').decode()
    line=next((l for l in checks.splitlines() if re.search(r'node-v24\.[0-9]+\.[0-9]+-linux-'+arch+r'\.tar\.xz$',l)),None)
    if not line:raise RuntimeError('Không tìm thấy Node 24 LTS phù hợp.')
    digest,name=line.split()
    with tempfile.TemporaryDirectory() as t:
        tmp=pathlib.Path(t);archive=checksum_download('https://nodejs.org/dist/latest-v24.x/'+name,digest,tmp/name)
        with tarfile.open(archive) as tar:
            member=next(m for m in tar.getmembers() if m.name.endswith('/bin/node'))
            with tar.extractfile(member) as f:(node.parent/'node.new').write_bytes(f.read())
    (node.parent/'node.new').chmod(0o755);os.replace(node.parent/'node.new',node);return node

def install_release(repo,pattern,binary,archive_member=None):
    target=ROOT/'bin'/binary
    if target.exists():return target
    release=json.loads(fetch('https://api.github.com/repos/'+repo+'/releases/latest'))
    assets=release['assets'];asset=next((a for a in assets if re.fullmatch(pattern,a['name'])),None)
    if not asset:raise RuntimeError('Không tìm được binary '+binary)
    expected=asset.get('digest')
    if not expected:
        checks_asset=next((a for a in assets if 'checksum' in a['name'].lower() and a['name'].endswith('.txt')),None)
        if not checks_asset:raise RuntimeError('Bản phát hành thiếu checksum: '+binary)
        checks=fetch(checks_asset['browser_download_url']).decode()
        line=next((l for l in checks.splitlines() if l.split()[-1].lstrip('*')==asset['name']),None)
        if not line:raise RuntimeError('Không tìm thấy checksum của '+binary)
        expected=line.split()[0]
    with tempfile.TemporaryDirectory() as t:
        path=checksum_download(asset['browser_download_url'],expected,pathlib.Path(t)/asset['name'])
        if archive_member:
            with tarfile.open(path) as tar:
                with tar.extractfile(archive_member) as f:target.with_suffix('.new').write_bytes(f.read())
        else:shutil.copyfile(path,target.with_suffix('.new'))
    target.with_suffix('.new').chmod(0o755);os.replace(target.with_suffix('.new'),target);return target

def unit(name,contents):atomic('/etc/systemd/system/'+name+'.service',contents,0o644)
def system_env(state):
    return f'DATA_DIR={DATA}\nHOST=127.0.0.1\nPORT=3080\nPUBLIC_URL=https://{state["domain"]}\nINSTALLATION_ID={state["installation_id"]}\n'
def install_units(state):
    atomic(CONF/'hub.env',system_env(state))
    unit('gen-hub',f'''[Unit]
Description=Gen-hub MCP gateway
After=network-online.target
Wants=network-online.target
[Service]
User=genhub
Group=genhub
EnvironmentFile={CONF}/hub.env
ExecStart={ROOT}/bin/node {ROOT}/current/server/main.mjs
WorkingDirectory={ROOT}/current
Restart=on-failure
RestartSec=3
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths={DATA}
[Install]
WantedBy=multi-user.target
''')
    upstream=f'''reverse_proxy 127.0.0.1:3080 {{
    header_up Host {state['domain']}
    flush_interval -1
  }}'''
    config=f'''{{
  admin off
}}
{state['domain']} {{
  {upstream}
}}
''' if state['mode']=='vps' else f'''{{
  admin off
  auto_https off
}}
http://127.0.0.1:8080 {{
  {upstream}
}}
'''
    atomic(CONF/'Caddyfile',config,0o644)
    run([str(ROOT/'bin/caddy'),'validate','--config',str(CONF/'Caddyfile'),'--adapter','caddyfile'],stdout=subprocess.DEVNULL)
    unit('gen-hub-caddy',f'''[Unit]
Description=Gen-hub reverse proxy
After=network-online.target gen-hub.service
Wants=network-online.target
[Service]
User=genhub
Group=genhub
Environment=XDG_DATA_HOME=/var/lib/gen-hub-caddy
Environment=XDG_CONFIG_HOME=/var/lib/gen-hub-caddy
ExecStart={ROOT}/bin/caddy run --config {CONF}/Caddyfile --adapter caddyfile
Restart=on-failure
RestartSec=3
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/gen-hub-caddy
[Install]
WantedBy=multi-user.target
''')
    if state['mode']=='personal':
        unit('gen-hub-tunnel',f'''[Unit]
Description=Gen-hub Cloudflare Tunnel
After=network-online.target gen-hub-caddy.service
Wants=network-online.target
[Service]
User=genhub
Group=genhub
LoadCredential=tunnel-token:{CONF}/tunnel.token
ExecStart={ROOT}/bin/cloudflared tunnel --no-autoupdate run --token-file %d/tunnel-token
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
[Install]
WantedBy=multi-user.target
''')
    run(['systemctl','daemon-reload'])
    for name in ['gen-hub','gen-hub-caddy']+(['gen-hub-tunnel'] if state['mode']=='personal' else []):
        run(['systemctl','enable',name]);run(['systemctl','restart',name])

def check_dns(domain, expected):
    found={r[4][0] for r in socket.getaddrinfo(domain,443,type=socket.SOCK_STREAM)}
    return expected in found

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
    cf(token,endpoint+'/configurations',{'config':{'ingress':[{'hostname':state['domain'],'service':'http://127.0.0.1:8080'},{'service':'http_status:404'}]}},'PUT')
    target=state['tunnel_id']+'.cfargotunnel.com'
    records=cf(token,'/zones/'+state['zone_id']+'/dns_records?'+urllib.parse.urlencode({'name':state['domain']}))
    if records:
        if len(records)!=1 or records[0]['type']!='CNAME' or records[0]['content']!=target:
            raise RuntimeError('Hostname có bản ghi khác. Hãy chọn hostname chưa dùng hoặc sửa DNS thủ công; bộ cài không ghi đè.')
    else:cf(token,'/zones/'+state['zone_id']+'/dns_records',{'type':'CNAME','name':state['domain'],'content':target,'proxied':True},'POST')
    runtime_token=cf(token,endpoint+'/token')
    atomic(CONF/'tunnel.token',runtime_token+'\n');token=None
    print('✓ Đã thiết lập tunnel và DNS. API token quản trị không được lưu trên đĩa.')

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
    raise RuntimeError('HTTPS chưa tới đúng Hub. Xem gen-hub status và journalctl -u gen-hub-caddy -u gen-hub-tunnel. Chạy lại bộ cài để kiểm tra tiếp.')

def owner_command(node,command,secret=None):
    env={**os.environ,'DATA_DIR':str(DATA)}
    return run(['runuser','-u','genhub','--',str(node),str(ROOT/'current/server/admin.mjs'),command],env=env,input=json.dumps(secret) if secret else None,capture_output=True)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--source',required=True);parser.add_argument('--revision',required=True);args=parser.parse_args()
    if os.geteuid()!=0:raise RuntimeError('Chạy bộ cài bằng sudo.')
    if sys.version_info < (3,10):raise RuntimeError('Cần Python 3.10 trở lên.')
    if platform.system()!='Linux' or not pathlib.Path('/run/systemd/system').exists():raise RuntimeError('Cần Linux với systemd.')
    if platform.machine() not in ['x86_64','aarch64']:raise RuntimeError('Chỉ hỗ trợ Linux x86_64 / aarch64.')
    if not re.fullmatch('[0-9a-f]{40}',args.revision):raise RuntimeError('Revision không hợp lệ.')
    if shutil.disk_usage('/opt').free<1024**3:raise RuntimeError('Cần tối thiểu 1 GiB trống ở /opt.')
    CONF.mkdir(exist_ok=True,mode=0o700);CONF.chmod(0o700)
    # Single installer, including retries after interruption.
    import fcntl
    lock=open(CONF/'install.lock','w');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    path=CONF/'install.json';state=json.loads(path.read_text()) if path.exists() else {'installation_id':secrets.token_hex(24)}
    def save():atomic(path,json.dumps(state,indent=2))
    print('\nGEN-HUB · Cài đặt Linux\n')
    if not state.get('mode'):
        desktop=bool(os.environ.get('DISPLAY') or os.environ.get('WAYLAND_DISPLAY') or pathlib.Path('/usr/share/xsessions').exists())
        print('Gợi ý môi trường: '+('máy cá nhân' if desktop else 'VPS/server')+' — hãy xác nhận theo mục đích sử dụng.')
        mode=ask('Chọn 1 = VPS/server, 2 = máy cá nhân','2' if desktop else '1')
        if mode not in ['1','2']:raise RuntimeError('Lựa chọn không hợp lệ.')
        state['mode']='vps' if mode=='1' else 'personal';save()
    print('Chế độ: '+state['mode'])
    if not state.get('domain'):state['domain']=normalize_domain(ask('Hostname Gen-hub (ví dụ hub.example.com)'));save()
    if state['mode']=='vps' and not state.get('ip'):
        try:suggest=fetch('https://api.ipify.org').decode().strip();ipaddress.ip_address(suggest)
        except Exception:suggest=''
        addr=ask('IP public của VPS',suggest)
        if not ipaddress.ip_address(addr).is_global:raise RuntimeError('VPS cần IP public hợp lệ.')
        state['ip']=addr;save()
    if state['mode']=='vps':wait_vps_dns(state)
    # Do not commandeer unrelated services listening on required ports.
    for port in ([80,443] if state['mode']=='vps' else [8080])+[3080]:
        sock=socket.socket()
        try:sock.bind(('127.0.0.1',port))
        except OSError:
            service='gen-hub' if port==3080 else 'gen-hub-caddy'
            unit_path=pathlib.Path('/etc/systemd/system/'+service+'.service')
            owned=state.get('revision') and unit_path.exists() and str(ROOT)+'/bin/' in unit_path.read_text()
            if not owned or subprocess.run(['systemctl','is-active','--quiet',service]).returncode!=0:
                raise RuntimeError(f'Cổng {port} đang được ứng dụng khác sử dụng.')
        finally:sock.close()
    (ROOT/'bin').mkdir(parents=True,exist_ok=True)
    print('Chuẩn bị Node.js 24 và Caddy…')
    node=install_node();arch='amd64' if platform.machine()=='x86_64' else 'arm64'
    install_release('caddyserver/caddy',r'caddy_[0-9.]+_linux_'+arch+r'\.tar\.gz','caddy','caddy')
    if state['mode']=='personal':
        install_release('cloudflare/cloudflared',r'cloudflared-linux-'+arch,'cloudflared');setup_tunnel(state,save)
    try:user=pwd.getpwnam('genhub')
    except KeyError:
        run(['useradd','--system','--home-dir',str(DATA),'--shell','/usr/sbin/nologin','genhub']);user=pwd.getpwnam('genhub')
    for directory in [DATA,pathlib.Path('/var/lib/gen-hub-caddy')]:directory.mkdir(exist_ok=True,mode=0o700);os.chown(directory,user.pw_uid,user.pw_gid)
    # Root owns code; service account can write only data. Secrets remain outside source.
    release=ROOT/'releases'/args.revision
    if not release.exists():
        staging=release.with_name(release.name+'.staging')
        if staging.exists():shutil.rmtree(staging)
        shutil.copytree(args.source,staging,ignore=shutil.ignore_patterns('.git','var','node_modules','__pycache__'))
        for root,dirs,files in os.walk(staging):
            os.chmod(root,0o755)
            for name in files:os.chmod(pathlib.Path(root)/name,0o755 if name.endswith('.sh') else 0o644)
        os.replace(staging,release)
    previous=os.readlink(ROOT/'current') if (ROOT/'current').is_symlink() else None
    link=ROOT/'current.new';link.unlink(missing_ok=True);link.symlink_to(release);os.replace(link,ROOT/'current')
    state['revision']=args.revision
    if previous and previous!=str(release):state['previous_revision']=previous
    save()
    # Non-secret Caddy config readable by service; secret files remain root-only.
    CONF.chmod(0o711)
    install_units(state);state['services_installed']=True;save()
    atomic('/usr/local/bin/gen-hub',f'#!/usr/bin/env bash\nexec python3 {ROOT}/current/scripts/manage.py "$@"\n',0o755)
    public_test(state)
    if owner_command(node,'owner-exists').stdout.strip()!='yes':
        print('\nTạo owner cho Gen-hub:')
        username=ask('Tên đăng nhập owner')
        while True:
            password=getpass.getpass('Mật khẩu (ít nhất 12 ký tự): ');repeat=getpass.getpass('Nhập lại mật khẩu: ')
            if password==repeat and 12<=len(password)<=256:break
            print('Mật khẩu chưa khớp hoặc độ dài không hợp lệ.')
        try:owner_command(node,'create-owner',{'username':username,'password':password})
        except subprocess.CalledProcessError as e:raise RuntimeError(e.stderr.strip()) from None
        password=repeat=None
    state['completed']=True;save()
    print('\n✓ Gen-hub đã sẵn sàng.\nĐăng nhập: https://'+state['domain']+'\nMCP tổng: https://'+state['domain']+'/mcp\nAgent cần xác thực và quyền do owner cấp.\nLệnh quản trị: sudo gen-hub status')
if __name__=='__main__':
    try:main()
    except KeyboardInterrupt:print('\nĐã dừng. Chạy lại cùng lệnh cài để tiếp tục.');sys.exit(130)
    except Exception as e:
        if isinstance(e,subprocess.CalledProcessError):print('Cài đặt dừng: một lệnh hệ thống thất bại. Kiểm tra thông báo phía trên.',file=sys.stderr)
        else:print('Cài đặt dừng: '+str(e),file=sys.stderr)
        sys.exit(1)
