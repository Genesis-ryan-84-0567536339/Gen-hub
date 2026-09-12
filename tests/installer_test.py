import importlib.util,pathlib,tempfile,unittest,json,subprocess
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('installer',pathlib.Path(__file__).resolve().parents[1]/'scripts/install.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class InstallerTest(unittest.TestCase):
 def test_domains(self):
  self.assertEqual(m.normalize_domain('Hub.Example.com.'),'hub.example.com')
  for d in ['https://x.com','x.com/a','x.com\n} admin','localhost','-x.example.com','x.com:443']:
   with self.assertRaises(ValueError):m.normalize_domain(d)
 def test_dns_gate_retries(self):
  state={'domain':'hub.example.com','ip':'203.0.113.1'}
  with patch.object(m,'ask',return_value='test'),patch.object(m,'check_dns',side_effect=[False,True]) as check:
   m.wait_vps_dns(state);self.assertEqual(check.call_count,2)
 def test_https_requires_own_installation(self):
  with patch.object(m,'fetch',side_effect=[b'{"ok":true,"installationId":"wrong"}',b'{"ok":true,"installationId":"correct"}',b'{"status":"pass"}']) as f,patch.object(m.time,'sleep'):
   m.public_test({'domain':'hub.example.com','installation_id':'correct'});self.assertEqual(f.call_count,3)
 def test_https_skips_gitea_check_when_disabled(self):
  # Regression: public_test() unconditionally re-checked /gitea/api/healthz over
  # the public domain, which 404s once gitea-disable removes that Caddy route —
  # broke every subsequent update/restart/doctor after disabling Gitea.
  with patch.object(m,'fetch',return_value=b'{"ok":true,"installationId":"correct"}') as f,patch.object(m.time,'sleep'):
   m.public_test({'domain':'hub.example.com','installation_id':'correct','gitea_enabled':False})
   self.assertEqual(f.call_count,1)
 def test_atomic_secrets(self):
  with tempfile.TemporaryDirectory() as tmp:
   path=pathlib.Path(tmp)/'secret';m.atomic(path,'value');self.assertEqual(path.stat().st_mode&0o777,0o600);self.assertEqual(path.read_text(),'value')
 def test_resume_tunnel_does_not_create_or_overwrite_dns(self):
  state={'domain':'hub.example.com','installation_id':'abc','tunnel_id':'known'};calls=[]
  def cf(token,path,data=None,method=None):
   calls.append((path,method))
   if path.startswith('/zones?'):return [{'id':'zone','account':{'id':'account'}}]
   if 'dns_records?' in path:return [{'type':'A','content':'1.2.3.4'}]
   if path.endswith('/known'):return {'id':'known'}
   return {}
  with patch('builtins.input',return_value='secret'),patch.object(m,'ask',return_value='example.com'),patch.object(m,'cf',side_effect=cf):
   with self.assertRaisesRegex(RuntimeError,'bản ghi khác'):m.setup_tunnel(state,lambda:None)
  self.assertFalse(any(method=='POST' for _,method in calls))
if __name__=='__main__':unittest.main()
