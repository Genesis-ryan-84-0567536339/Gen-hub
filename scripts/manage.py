#!/usr/bin/env python3
import getpass,json,os,pathlib,subprocess,sys,tarfile,tempfile,time,shutil,urllib.request
ROOT=pathlib.Path('/opt/gen-hub');CONF=pathlib.Path('/etc/gen-hub');DATA=pathlib.Path('/var/lib/gen-hub')
def run(args,**kw):return subprocess.run(args,check=True,text=True,**kw)
def main():
 if os.geteuid()!=0:raise RuntimeError('Dùng sudo gen-hub <lệnh>.')
 cmd=sys.argv[1] if len(sys.argv)>1 else 'help'
 state=json.loads((CONF/'install.json').read_text())
 services=['gen-hub','gen-hub-caddy']+(['gen-hub-tunnel'] if state['mode']=='personal' else [])
 if cmd=='status':
  print('Đăng nhập: https://'+state['domain']+'\nMCP: https://'+state['domain']+'/mcp\nRevision: '+state.get('revision',''))
  subprocess.run(['systemctl','--no-pager','status',*services]);return
 if cmd=='logs':run(['journalctl','--no-pager','-n','100',*sum((['-u',s] for s in services),[])]);return
 if cmd=='restart':run(['systemctl','restart',*services]);return
 if cmd=='reset-password':
  password=getpass.getpass('Mật khẩu owner mới (12–256 ký tự): ')
  if password!=getpass.getpass('Nhập lại mật khẩu: '):raise RuntimeError('Mật khẩu không khớp.')
  run(['runuser','-u','genhub','--',str(ROOT/'bin/node'),str(ROOT/'current/server/admin.mjs'),'reset-password'],input=json.dumps({'password':password}),env={**os.environ,'DATA_DIR':str(DATA)});return
 if cmd=='backup':
  target=pathlib.Path(sys.argv[2] if len(sys.argv)>2 else '/root/gen-hub-backup-'+time.strftime('%Y%m%d-%H%M%S')+'.tar.gz').resolve()
  if target.exists():raise RuntimeError('Tệp đích đã tồn tại.')
  os.umask(0o077)
  with tempfile.TemporaryDirectory(dir=DATA) as temp:
   path=pathlib.Path(temp)/'hub.db'
   run([str(ROOT/'bin/node'),str(ROOT/'current/server/admin.mjs'),'backup',str(path)],env={**os.environ,'DATA_DIR':str(DATA)})
   with tarfile.open(target,'w:gz') as tar:
    tar.add(path,arcname='data/hub.db');tar.add(DATA/'master.key',arcname='data/master.key');tar.add(CONF,arcname='config',filter=lambda t:None if t.name.endswith('install.lock') else t)
  target.chmod(0o600);print('Bản sao lưu chứa dữ liệu và khóa giải mã: '+str(target));return
 if cmd=='update':
  if input('Cập nhật từ Gen-hub/main? Nhập UPDATE: ')!='UPDATE':return
  with tempfile.TemporaryDirectory() as temp:
   path=pathlib.Path(temp)/'install.sh'
   with urllib.request.urlopen('https://raw.githubusercontent.com/Genesis-ryan-84-0567536339/Gen-hub/main/install.sh',timeout=30) as r:path.write_bytes(r.read())
   run(['bash',str(path)])
  return
 if cmd=='rollback':
  previous=state.get('previous_revision')
  if not previous or not pathlib.Path(previous).is_relative_to(ROOT/'releases') or not pathlib.Path(previous).exists():raise RuntimeError('Không có phiên bản trước để quay lại.')
  if input('Quay lại phiên bản trước (không đổi database)? Nhập ROLLBACK: ')!='ROLLBACK':return
  link=ROOT/'current.new';link.unlink(missing_ok=True);link.symlink_to(previous);os.replace(link,ROOT/'current');run(['systemctl','restart','gen-hub']);state['revision']=pathlib.Path(previous).name;(CONF/'install.json').write_text(json.dumps(state,indent=2));return
 if cmd=='uninstall':
  if input('Gỡ dịch vụ Gen-hub, giữ dữ liệu và cấu hình để khôi phục? Nhập UNINSTALL: ')!='UNINSTALL':return
  for service in services:
   subprocess.run(['systemctl','disable','--now',service]);pathlib.Path('/etc/systemd/system/'+service+'.service').unlink(missing_ok=True)
  run(['systemctl','daemon-reload']);shutil.rmtree(ROOT);pathlib.Path('/usr/local/bin/gen-hub').unlink(missing_ok=True)
  print('Đã gỡ dịch vụ. Giữ /var/lib/gen-hub và /etc/gen-hub. Tunnel/DNS Cloudflare vẫn được giữ; có thể xóa thủ công trên Cloudflare.');return
 print('Lệnh: status | logs | restart | reset-password | backup [tệp.tar.gz] | update | rollback | uninstall')
if __name__=='__main__':
 try:main()
 except (RuntimeError,OSError,subprocess.CalledProcessError) as e:print(str(e),file=sys.stderr);sys.exit(1)
