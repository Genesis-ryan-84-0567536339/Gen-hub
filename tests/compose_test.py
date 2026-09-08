import copy
import importlib.util
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'scripts'))
import runtime
import install as installer

SOURCE = pathlib.Path(__file__).resolve().parents[1]

class ComposeTest(unittest.TestCase):
    def state(self, mode='personal'):
        return {'mode': mode, 'domain': 'hub.example.com', 'installation_id': 'correct',
                'uid': 991, 'gid': 991, 'revision': 'a' * 40}

    def test_personal_has_no_host_ports_or_privileged_socket(self):
        data = runtime.manifest(self.state(), SOURCE)
        for service in data['services'].values():
            self.assertNotIn('ports', service)
            self.assertNotIn('privileged', service)
            self.assertNotIn('network_mode', service)
            self.assertNotIn('docker.sock', json.dumps(service))
        self.assertNotIn('TUNNEL_TOKEN', json.dumps(data))
        self.assertIn('--token-file', data['services']['tunnel']['command'])

    def test_vps_only_exposes_caddy(self):
        data = runtime.manifest(self.state('vps'), SOURCE)
        self.assertNotIn('tunnel', data['services'])
        self.assertEqual(data['services']['caddy']['ports'], ['80:80', '443:443'])
        self.assertNotIn('ports', data['services']['hub'])
        self.assertIn('header_up Host hub.example.com', runtime.caddy_config(self.state('vps')))
        self.assertIn('reverse_proxy hub:3080', runtime.caddy_config(self.state()))

    def test_rejects_conflicting_aaaa_record(self):
        answers = [(None, None, None, None, ('203.0.113.1', 443)), (None, None, None, None, ('2001:db8::1', 443))]
        with patch.object(installer.socket, 'getaddrinfo', return_value=answers):
            self.assertFalse(installer.check_dns('hub.example.com', '203.0.113.1'))

    def test_failed_https_never_creates_owner_and_restores_previous_runtime(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp); conf = root / 'conf'; conf.mkdir()
            old = {**self.state('vps'), 'engine': 'compose', 'completed': True}
            state = copy.deepcopy(old)
            previous = runtime.manifest(old, SOURCE, conf, root / 'data')
            (conf / 'compose.json').write_text(json.dumps(previous))
            (conf / 'Caddyfile').write_text('old config')
            candidate = root / 'candidate.json'; candidate.write_text(json.dumps(previous))
            release = root / ('b' * 40)
            # No host changes or real credentials in failure-path test.
            original_atomic = runtime.atomic
            def write(path, value, mode=0o600):
                if str(path).startswith('/usr/local/'):
                    return
                original_atomic(path, value, mode)
            with patch.object(installer, 'ROOT', root), patch.object(installer, 'CONF', conf), patch.object(installer, 'DATA', root / 'data'), patch.object(installer, 'atomic', side_effect=write), patch.object(installer, 'compose') as compose, patch.object(installer, 'verify_local'), patch.object(installer, 'public_test', side_effect=RuntimeError('wrong installation')), patch.object(installer, 'ensure_owner') as owner:
                with self.assertRaisesRegex(RuntimeError, 'wrong installation'):
                    installer.activate(state, old, release, candidate, lambda: None, [])
                owner.assert_not_called()
                self.assertEqual(json.loads((conf / 'compose.json').read_text()), previous)
                self.assertEqual((conf / 'Caddyfile').read_text(), 'old config')
                self.assertEqual(state, {**old, 'failed_update_revision': release.name})
                self.assertEqual(compose.call_count, 2)

    def test_tunnel_resume_uses_internal_route_and_secret_file(self):
        with tempfile.TemporaryDirectory() as temp:
            state = {**self.state(), 'tunnel_id': 'known'}
            calls = []
            def cloudflare(token, path, data=None, method=None):
                calls.append((path, data, method))
                if path.startswith('/zones?'):
                    return [{'id': 'zone', 'account': {'id': 'account'}}]
                if 'dns_records?' in path:
                    return [{'type': 'CNAME', 'content': 'known.cfargotunnel.com'}]
                if path.endswith('/token'):
                    return 'synthetic-runtime-token'
                return {'id': 'known'}
            with patch.object(installer, 'CONF', pathlib.Path(temp)), patch.object(installer, 'cf', side_effect=cloudflare), patch.object(installer, 'ask', return_value='example.com'), patch.object(installer.getpass, 'getpass', return_value='synthetic-admin-token'), patch.object(installer.os, 'chown'):
                installer.setup_tunnel(state, lambda: None)
            route = next(data for path, data, method in calls if path.endswith('/configurations'))
            self.assertEqual(route['config']['ingress'][0]['service'], 'http://caddy:8080')
            self.assertFalse(any(method == 'POST' for _, _, method in calls))
            token = pathlib.Path(temp) / 'tunnel.token'
            self.assertEqual(token.stat().st_mode & 0o777, 0o600)
            self.assertNotIn('synthetic-admin-token', token.read_text())

    def test_reinstall_preserves_owner_without_prompt(self):
        with patch.object(installer, 'admin', return_value=subprocess.CompletedProcess([], 0, stdout='yes')), patch.object(installer, 'ask') as ask, patch.object(installer.getpass, 'getpass') as password:
            installer.ensure_owner(pathlib.Path('/test/compose.json'))
            ask.assert_not_called(); password.assert_not_called()

if __name__ == '__main__':
    unittest.main()
