import copy
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'scripts'))
import kho
import runtime
import manage

SOURCE = pathlib.Path(__file__).resolve().parents[1]


def result(stdout=''):
    return subprocess.CompletedProcess([], 0, stdout=stdout)


class KhoTest(unittest.TestCase):
    def state(self):
        return {'mode': 'vps', 'domain': 'hub.example.com', 'installation_id': 'owned',
                'uid': 991, 'gid': 991, 'revision': 'a' * 40, 'engine': 'compose',
                'gitea_enabled': True, 'kho_enabled': True}

    def test_manifest_and_caddy_include_kho_when_enabled(self):
        for mode in ['vps', 'personal']:
            state = {**self.state(), 'mode': mode}
            config = runtime.manifest(state, SOURCE)
            service = config['services']['kho']
            self.assertEqual(service['volumes'], ['kho-data:/baserow/data'])
            self.assertTrue(service['image'].startswith('baserow/baserow:2.3.4@sha256:'))
            self.assertEqual(service['environment']['BASEROW_PUBLIC_URL'], 'https://kho.hub.example.com')
            self.assertEqual(service['environment']['DISABLE_VOLUME_CHECK'], 'no')
            self.assertEqual(service['mem_limit'], '2g')
            self.assertEqual(service['pids_limit'], 256)
            self.assertFalse(service['read_only'])
            self.assertEqual(service['cap_drop'], ['ALL'])
            self.assertEqual(service['cap_add'], ['CHOWN', 'DAC_OVERRIDE', 'FOWNER', 'SETUID', 'SETGID', 'KILL', 'NET_BIND_SERVICE'])
            self.assertEqual(service['healthcheck']['start_period'], '240s')
            self.assertEqual(service['environment']['BASEROW_EXTRA_PUBLIC_URLS'], 'http://127.0.0.1,http://localhost,http://kho')
            for forbidden in ['ports', 'secrets', 'env_file', 'privileged']:
                self.assertNotIn(forbidden, service)
            for forbidden in ['master.key', 'update.env', 'docker.sock', '/var/lib/gen-hub']:
                self.assertNotIn(forbidden, json.dumps(service))
            self.assertIn('kho-data', config['volumes'])
            self.assertEqual(config['volumes']['kho-data']['name'], 'gen-hub-owned-kho-data')
            self.assertEqual(config['volumes']['kho-data']['labels']['io.gen-hub.installation-id'], 'owned')
            
            caddy = runtime.caddy_config(state)
            self.assertIn('kho.hub.example.com', caddy)
            self.assertIn('reverse_proxy kho:80', caddy)
            self.assertIn('redir /kho /kho/ 308', caddy)

    def test_manifest_and_caddy_omit_kho_when_disabled(self):
        for mode in ['vps', 'personal']:
            state = {**self.state(), 'mode': mode, 'kho_enabled': False}
            config = runtime.manifest(state, SOURCE)
            self.assertNotIn('kho', config['services'])
            self.assertNotIn('kho-data', config['volumes'])
            caddy = runtime.caddy_config(state)
            self.assertNotIn('kho.hub.example.com', caddy)
            self.assertNotIn('reverse_proxy kho:80', caddy)

    def test_check_volumes_validates_label(self):
        state = {'installation_id': 'inst1'}
        vol_name = 'gen-hub-inst1-kho-data'
        # Volume missing and required -> raises
        with patch('kho.run', return_value=result('other-vol\n')):
            with self.assertRaisesRegex(RuntimeError, 'Thiếu volume Kho'):
                kho.check_volumes(state, required=True)

        # Volume belongs to another installation -> raises
        inspect_alien = json.dumps([{'Name': vol_name, 'Labels': {'io.gen-hub.installation-id': 'other'}}])
        with patch('kho.run', side_effect=[result(vol_name + '\n'), result(inspect_alien)]):
            with self.assertRaisesRegex(RuntimeError, 'Volume Kho không thuộc installation'):
                kho.check_volumes(state, required=True)

        # Volume belongs to this installation -> succeeds
        inspect_ok = json.dumps([{'Name': vol_name, 'Labels': {'io.gen-hub.installation-id': 'inst1'}}])
        with patch('kho.run', side_effect=[result(vol_name + '\n'), result(inspect_ok)]):
            owned = kho.check_volumes(state, required=True)
            self.assertEqual(owned, [vol_name])

    def test_kho_snapshot_cold_backup(self):
        with tempfile.TemporaryDirectory() as temp:
            compose_path = pathlib.Path(temp) / 'compose.json'
            compose_path.write_text(json.dumps({
                'services': {'kho': {'image': 'baserow-image'}},
                'x-gen-hub': {'installation_id': 'inst1'}
            }))
            with patch('kho.check_volumes', return_value=['gen-hub-inst1-kho-data']), \
                 patch('kho.compose', return_value=result('running-container-id')), \
                 patch('kho.run', return_value=result()):
                with kho.snapshot(compose_path) as archive:
                    self.assertIsNotNone(archive)
                    self.assertTrue(pathlib.Path(archive).name.endswith('kho.tar'))

    def test_kho_disable_and_purge(self):
        with tempfile.TemporaryDirectory() as temp:
            conf = pathlib.Path(temp)
            install_json = conf / 'install.json'
            compose_json = conf / 'compose.json'
            caddy_file = conf / 'Caddyfile'
            state = {**self.state(), 'kho_enabled': True}
            install_json.write_text(json.dumps(state))
            compose_json.write_text(json.dumps({
                'services': {'hub': {}, 'kho': {}},
                'volumes': {'kho-data': {}},
                'x-gen-hub': {'installation_id': 'owned'}
            }))
            caddy_file.write_text('old caddy')

            with patch('kho.CONF', conf), \
                 patch('kho.ROOT', conf), \
                 patch('runtime.backup'), \
                 patch('kho.compose'), \
                 patch('kho.run'), \
                 patch('kho.check_volumes', return_value=['gen-hub-owned-kho-data']):
                kho.disable(state, purge=True)
                self.assertFalse(state['kho_enabled'])
                cfg = json.loads(compose_json.read_text())
                self.assertNotIn('kho', cfg['services'])

    def test_kho_enable_failure_restores_state(self):
        with tempfile.TemporaryDirectory() as temp:
            conf = pathlib.Path(temp)
            install_json = conf / 'install.json'
            compose_json = conf / 'compose.json'
            caddy_file = conf / 'Caddyfile'
            state = {**self.state(), 'kho_enabled': False}
            install_json.write_text(json.dumps(state, indent=2))
            compose_json.write_text(json.dumps({
                'services': {'hub': {}, 'caddy': {}},
                'x-gen-hub': {'installation_id': 'owned'}
            }))
            caddy_file.write_text('initial caddy')
            release_dir = conf / 'releases' / state['revision'] / 'deploy'
            release_dir.mkdir(parents=True)
            (release_dir / 'images.json').write_text((SOURCE / 'deploy/images.json').read_text())

            with patch('kho.CONF', conf), \
                 patch('kho.ROOT', conf), \
                 patch('runtime.CONF', conf), \
                 patch('runtime.DATA', conf), \
                 patch('runtime.backup'), \
                 patch('kho.run', return_value=result()), \
                 patch('runtime.admin', return_value=result('yes\n')), \
                 patch('kho.compose', side_effect=[result(), RuntimeError('compose up failed'), result(), result(), result()]):
                with self.assertRaisesRegex(RuntimeError, 'compose up failed'):
                    kho.enable(state)

            self.assertFalse(state['kho_enabled'])
            saved_state = json.loads(install_json.read_text())
            self.assertFalse(saved_state['kho_enabled'])
            saved_compose = json.loads(compose_json.read_text())
            self.assertNotIn('kho', saved_compose['services'])
            self.assertEqual(caddy_file.read_text(), 'initial caddy')

    def test_kho_verify_script_checks_text_response(self):
        with tempfile.TemporaryDirectory() as temp:
            conf = pathlib.Path(temp)
            compose_json = conf / 'compose.json'
            compose_json.write_text(json.dumps({
                'services': {'kho': {'environment': {'BASEROW_PUBLIC_URL': 'https://kho.genos.top'}}},
                'x-gen-hub': {'installation_id': 'owned'}
            }))
            with patch('kho.check_volumes', return_value=['kho-data']), \
                 patch('kho.compose') as mock_compose:
                kho.verify(compose_json)
                self.assertEqual(mock_compose.call_count, 3)
                node_call_args = mock_compose.call_args_list[1][0]
                self.assertIn('node', node_call_args)
                script = node_call_args[-1]
                self.assertIn("fetch('http://kho:80/api/_health/'", script)
                self.assertIn("const t=(await r.text()).trim()", script)
                self.assertIn("t!=='OK'&&t!=='pass'", script)

                caddy_call_args = mock_compose.call_args_list[2][0]
                self.assertIn('node', caddy_call_args)
                caddy_script = caddy_call_args[-1]
                self.assertIn("node:http", caddy_script)
                self.assertIn("http://caddy:8080/api/_health/", caddy_script)
                self.assertIn("Host:'kho.genos.top'", caddy_script)
                self.assertIn("t!=='OK'&&t!=='pass'", caddy_script)

    def test_kho_enable_uses_timeout_300(self):
        with tempfile.TemporaryDirectory() as temp:
            conf = pathlib.Path(temp)
            install_json = conf / 'install.json'
            compose_json = conf / 'compose.json'
            caddy_file = conf / 'Caddyfile'
            state = {**self.state(), 'kho_enabled': False}
            install_json.write_text(json.dumps(state, indent=2))
            compose_json.write_text(json.dumps({
                'services': {'hub': {}, 'caddy': {}},
                'x-gen-hub': {'installation_id': 'owned'}
            }))
            caddy_file.write_text('initial caddy')
            release_dir = conf / 'releases' / state['revision'] / 'deploy'
            release_dir.mkdir(parents=True)
            (release_dir / 'images.json').write_text((SOURCE / 'deploy/images.json').read_text())

            with patch('kho.CONF', conf), \
                 patch('kho.ROOT', conf), \
                 patch('runtime.CONF', conf), \
                 patch('runtime.DATA', conf), \
                 patch('runtime.backup'), \
                 patch('kho.run', return_value=result()), \
                 patch('runtime.admin', return_value=result('yes\n')), \
                 patch('kho.verify'), \
                 patch('kho.compose') as mock_compose:
                kho.enable(state)
                up_calls = [call[0] for call in mock_compose.call_args_list if 'up' in call[0]]
                self.assertTrue(len(up_calls) > 0)
                up_call = up_calls[0]
                self.assertIn('--wait-timeout', up_call)
                timeout_idx = up_call.index('--wait-timeout')
                self.assertEqual(up_call[timeout_idx + 1], '300')

    def test_kho_schema_manage_passes_output_and_url(self):
        state = {**self.state(), 'domain': 'mykho.example.com'}
        captured_argv = []
        def fake_main():
            captured_argv.extend(sys.argv)

        mock_mod = type('MockMod', (), {'main': fake_main})
        with patch('importlib.util.spec_from_file_location'), \
             patch('importlib.util.module_from_spec', return_value=mock_mod), \
             tempfile.TemporaryDirectory() as temp_dir:
            data_path = pathlib.Path(temp_dir)
            with patch('os.geteuid', return_value=0), \
                 patch('runtime.DATA', data_path), \
                 patch('manage.CONF', data_path), \
                 patch('manage.DATA', data_path), \
                 patch('manage.ROOT', data_path), \
                 patch('sys.argv', ['manage.py', 'kho-schema']):
                (data_path / 'install.json').write_text(json.dumps(state))
                manage.main()

            self.assertIn('--output', captured_argv)
            out_idx = captured_argv.index('--output')
            self.assertEqual(captured_argv[out_idx + 1], str(data_path / 'kho_table_ids.json'))
            self.assertIn('--url', captured_argv)
            url_idx = captured_argv.index('--url')
            self.assertEqual(captured_argv[url_idx + 1], 'https://kho.mykho.example.com')

    def test_custom_kho_domain_caddy_and_manifest(self):
        state = {**self.state(), 'domain': 'hub.genos.top', 'kho_domain': 'kho.genos.top'}
        # 1. Manifest has correct BASEROW_PUBLIC_URL
        config = runtime.manifest(state, SOURCE)
        service = config['services']['kho']
        self.assertEqual(service['environment']['BASEROW_PUBLIC_URL'], 'https://kho.genos.top')

        # 2. VPS Caddy has kho.genos.top block and redirect
        caddy_vps = runtime.caddy_config({**state, 'mode': 'vps'})
        self.assertIn('kho.genos.top {', caddy_vps)
        self.assertIn('redir https://kho.genos.top{uri} 308', caddy_vps)

        # 3. Personal (tunnel) Caddy has @kho host kho.genos.top
        caddy_tunnel = runtime.caddy_config({**state, 'mode': 'personal'})
        self.assertIn('@kho host kho.genos.top', caddy_tunnel)
        self.assertIn('handle @kho {', caddy_tunnel)
        self.assertIn('redir https://kho.genos.top{uri} 308', caddy_tunnel)

        # 4. public_host helper returns custom domain
        self.assertEqual(kho.public_host(state), 'kho.genos.top')

    def test_custom_kho_domain_ingress_in_setup_tunnel(self):
        import install
        state = {
            'mode': 'personal',
            'domain': 'hub.genos.top',
            'zone_name': 'genos.top',
            'zone_id': 'zone123',
            'account_id': 'acc123',
            'tunnel_id': 'tun123',
            'installation_id': 'inst123',
            'uid': 1000,
            'gid': 1000,
            'kho_enabled': True,
            'kho_domain': 'kho.genos.top'
        }
        cf_calls = []
        def fake_cf(token, path, data=None, method=None):
            cf_calls.append((path, data, method))
            if path.startswith('/zones?'):
                return [{'id': 'zone123', 'account': {'id': 'acc123'}}]
            if 'dns_records?' in path:
                return [{'type': 'CNAME', 'name': 'hub.genos.top', 'content': 'tun123.cfargotunnel.com'}]
            if path.endswith('/token'):
                return 'fake-token'
            return {}

        with patch('builtins.input', return_value='fake-api-token'), \
             patch.object(install, 'ask', return_value='genos.top'), \
             patch.object(install, 'cf', side_effect=fake_cf), \
             patch.object(install, 'atomic'), \
             patch('os.chown'):
            install.setup_tunnel(state, lambda: None)

        put_configs = [c for c in cf_calls if c[2] == 'PUT' and '/configurations' in c[0]]
        self.assertEqual(len(put_configs), 1)
        ingress = put_configs[0][1]['config']['ingress']
        self.assertEqual(ingress, [
            {'hostname': 'hub.genos.top', 'service': 'http://caddy:8080'},
            {'hostname': 'kho.genos.top', 'service': 'http://caddy:8080'},
            {'service': 'http_status:404'}
        ])

    def test_kho_enable_with_domain_flag(self):
        with tempfile.TemporaryDirectory() as temp:
            conf = pathlib.Path(temp)
            install_json = conf / 'install.json'
            compose_json = conf / 'compose.json'
            caddy_file = conf / 'Caddyfile'
            state = {**self.state(), 'domain': 'hub.genos.top', 'kho_enabled': False}
            install_json.write_text(json.dumps(state, indent=2))
            compose_json.write_text(json.dumps({
                'services': {'hub': {}, 'caddy': {}},
                'x-gen-hub': {'installation_id': 'owned'}
            }))
            caddy_file.write_text('initial caddy')
            release_dir = conf / 'releases' / state['revision'] / 'deploy'
            release_dir.mkdir(parents=True)
            (release_dir / 'images.json').write_text((SOURCE / 'deploy/images.json').read_text())

            with patch('kho.CONF', conf), \
                 patch('kho.ROOT', conf), \
                 patch('runtime.CONF', conf), \
                 patch('runtime.DATA', conf), \
                 patch('runtime.backup'), \
                 patch('kho.run', return_value=result()), \
                 patch('runtime.admin', return_value=result('yes\n')), \
                 patch('kho.verify'), \
                 patch('kho.compose'):
                kho.enable(state, domain='kho.genos.top')

            self.assertTrue(state['kho_enabled'])
            self.assertEqual(state['kho_domain'], 'kho.genos.top')
            saved_state = json.loads(install_json.read_text())
            self.assertEqual(saved_state['kho_domain'], 'kho.genos.top')

    def test_public_test_checks_kho_https(self):
        import install
        state = {
            'domain': 'hub.genos.top',
            'installation_id': 'owned',
            'gitea_enabled': False,
            'kho_enabled': True,
            'kho_domain': 'kho.genos.top'
        }
        urls_called = []
        def fake_fetch(url, *args, **kwargs):
            urls_called.append(url)
            if '/healthz' in url:
                return b'{"ok": true, "installationId": "owned"}'
            if '/api/_health/' in url:
                return b'OK\n'
            return b''

        with patch.object(install, 'fetch', side_effect=fake_fetch):
            install.public_test(state)

        self.assertIn('https://hub.genos.top/healthz', urls_called)
        self.assertIn('https://kho.genos.top/api/_health/', urls_called)

    def test_public_test_skips_kho_when_kho_domain_not_set(self):
        import install
        state = {
            'domain': 'hub.genos.top',
            'installation_id': 'owned',
            'gitea_enabled': False,
            'kho_enabled': True
        }
        urls_called = []
        def fake_fetch(url, *args, **kwargs):
            urls_called.append(url)
            return b'{"ok": true, "installationId": "owned"}'

        with patch.object(install, 'fetch', side_effect=fake_fetch):
            install.public_test(state)

        self.assertEqual(urls_called, ['https://hub.genos.top/healthz'])


if __name__ == '__main__':
    unittest.main()
