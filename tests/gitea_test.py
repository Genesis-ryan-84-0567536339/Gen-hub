import contextlib
import copy
import io
import json
import pathlib
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch, mock_open
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'scripts'))
import gitea
import runtime
import install
import manage
import lifecycle

SOURCE = pathlib.Path(__file__).resolve().parents[1]


def result(stdout=''):
    return subprocess.CompletedProcess([], 0, stdout=stdout)


class GiteaTest(unittest.TestCase):
    def state(self):
        return {'mode': 'vps', 'domain': 'hub.example.com', 'installation_id': 'owned',
                'uid': 991, 'gid': 991, 'revision': 'a' * 40, 'engine': 'compose'}

    def test_every_manifest_has_isolated_gitea_without_opt_in(self):
        for mode in ['vps', 'personal']:
            state = {**self.state(), 'mode': mode}
            config = runtime.manifest(state, SOURCE)
            service = config['services']['gitea']
            self.assertEqual(service['volumes'], ['gitea-data:/var/lib/gitea', 'gitea-config:/etc/gitea'])
            self.assertTrue(service['image'].startswith('docker.gitea.com/gitea:1.27.3-rootless@sha256:'))
            self.assertEqual(service['environment']['GITEA__server__ROOT_URL'], 'https://hub.example.com/gitea/')
            self.assertEqual(service['environment']['GITEA__security__INSTALL_LOCK'], 'true')
            self.assertEqual(service['environment']['GITEA__service__DISABLE_REGISTRATION'], 'true')
            self.assertEqual(service['environment']['GITEA__session__SESSION_LIFE_TIME'], '2592000')
            self.assertEqual(service['environment']['GITEA__oauth2_client__ENABLE_AUTO_REGISTRATION'], 'true')
            self.assertEqual(service['environment']['GITEA__oauth2_client__ACCOUNT_LINKING'], 'disabled')
            self.assertEqual(service['environment']['GITEA__oauth2_client__USERNAME'], 'preferred_username')
            for forbidden in ['ports', 'secrets', 'env_file', 'privileged']:
                self.assertNotIn(forbidden, service)
            for forbidden in ['master.key', 'update.env', 'docker.sock', '/var/lib/gen-hub']:
                self.assertNotIn(forbidden, json.dumps(service))
            self.assertEqual(set(config['volumes']), {'gitea-data', 'gitea-config'})
            caddy = runtime.caddy_config(state)
            self.assertIn('handle_path /gitea/*', caddy)
            self.assertIn('header_up X-Forwarded-Proto https', caddy)
            self.assertIn('reverse_proxy hub:3080', caddy)
            self.assertIn('redir /gitea /gitea/ 308', caddy)

    def test_bootstrap_uses_store_secret_stdin_and_only_controlling_tty(self):
        state = self.state()
        credential = 'synthetic_test_' + 'x' * 24
        calls = []
        def compose(*args, **kwargs):
            calls.append((args, kwargs))
            if 'list' in args:
                return result('ID Username\n1 genhub-admin' if state.get('gitea_bootstrapped') else 'ID Username')
            if '-e' in args:
                return result(credential)
            return result()
        output = io.StringIO()
        terminal = mock_open()
        with patch.object(gitea, 'verify'), patch.object(gitea, 'compose', side_effect=compose), patch('builtins.open', terminal), contextlib.redirect_stdout(output):
            gitea.bootstrap('/compose', state, lambda: None)
        self.assertTrue(state['gitea_bootstrapped'])
        terminal.assert_called_once_with('/dev/tty', 'w')
        self.assertEqual(sum(credential in c.args[0] for c in terminal().write.call_args_list), 1)
        self.assertNotIn(credential, output.getvalue())
        self.assertTrue(any("secret()" in str(args) for args, _ in calls))
        creation = next((args, kw) for args, kw in calls if 'sh' in args)
        self.assertNotIn(credential, str(creation[0]))
        self.assertEqual(creation[1]['input'], credential + '\n')
        self.assertTrue(creation[1]['capture_output'])

    def test_resume_after_creation_never_rotates_or_displays_password(self):
        state = self.state()
        with patch.object(gitea, 'verify'), patch.object(gitea, 'compose', return_value=result('ID Username\n1 genhub-admin')), patch('builtins.open') as terminal:
            gitea.bootstrap('/compose', state, lambda: None)
            gitea.bootstrap('/compose', state, lambda: None)
        terminal.assert_not_called()
        self.assertTrue(state['gitea_bootstrapped'])

    def test_sync_sso_provisions_and_updates_oauth_auth_source(self):
        state = self.state()
        oidc_payload = json.dumps({
            'client_id': 'genhub-gitea',
            'client_secret': 'test-secret-value-123',
            'discovery_url': 'https://hub.example.com/oidc/owner/.well-known/openid-configuration'
        })
        calls = []
        def compose_add(*args, **kwargs):
            calls.append(args)
            if 'auth' in args and 'list' in args:
                return result('ID Name Type Enabled\n')
            return result()
        with patch('runtime.admin', return_value=result(oidc_payload)), patch.object(gitea, 'compose', side_effect=compose_add):
            gitea.sync_sso('/compose', state, required=True)
        add_call = next(c for c in calls if 'add-oauth' in c)
        self.assertIn('--key', add_call)
        self.assertIn('genhub-gitea', add_call)
        self.assertIn('test-secret-value-123', add_call)
        self.assertIn('https://hub.example.com/oidc/owner/.well-known/openid-configuration', add_call)
        self.assertIn('--admin-group', add_call)
        self.assertIn('genhub-owner', add_call)

        update_calls = []
        def compose_update(*args, **kwargs):
            update_calls.append(args)
            if 'auth' in args and 'list' in args:
                return result('ID\tName\tType\tEnabled\n42\tgenhub-owner\tOAuth2\ttrue\n')
            return result()
        with patch('runtime.admin', return_value=result(oidc_payload)), patch.object(gitea, 'compose', side_effect=compose_update):
            gitea.sync_sso('/compose', state, required=True)
        up_call = next(c for c in update_calls if 'update-oauth' in c)
        self.assertIn('--id', up_call)
        self.assertIn('42', up_call)
        self.assertIn('test-secret-value-123', up_call)

    def test_noninteractive_legacy_update_reports_required_bootstrap_without_credentials(self):
        state = self.state()
        with patch.object(gitea, 'compose') as compose, patch('builtins.open') as terminal, contextlib.redirect_stdout(io.StringIO()) as output:
            gitea.bootstrap('/compose', state, lambda: None, unattended=True)
        self.assertIn('Bắt buộc', output.getvalue())
        self.assertNotIn('gitea_bootstrapped', state)
        compose.assert_not_called(); terminal.assert_not_called()

    def test_no_tty_never_creates_admin(self):
        with patch.object(gitea, 'verify'), patch.object(gitea, 'compose', return_value=result('ID Username')) as compose, patch('builtins.open', side_effect=OSError('no tty')):
            with self.assertRaises(OSError):
                gitea.bootstrap('/compose', self.state(), lambda: None)
        self.assertEqual(compose.call_count, 1)

    def test_missing_and_foreign_volumes_cannot_be_recreated_or_purged(self):
        with patch.object(gitea, 'run', return_value=result('')):
            with self.assertRaisesRegex(RuntimeError, 'Thiếu volume'):
                gitea.check_volumes(self.state(), required=True)
        with patch.object(gitea, 'run', side_effect=[result('gen-hub-owned-gitea-data'), result('[{"Labels":{"io.gen-hub.installation-id":"foreign"}}]')]):
            with self.assertRaisesRegex(RuntimeError, 'không thuộc'):
                gitea.check_volumes(self.state())

    def test_update_pins_gitea_independently_and_rollback_rejects_downgrade_or_removal(self):
        current = runtime.manifest(self.state(), SOURCE)
        next_state = {**self.state(), 'revision': 'b' * 40, 'gitea_image': current['services']['gitea']['image']}
        candidate = runtime.manifest(next_state, SOURCE)
        gitea.guard_transition(current, candidate)
        for edit in ['remove', 'image', 'volume']:
            bad = copy.deepcopy(candidate)
            if edit == 'remove': del bad['services']['gitea']
            elif edit == 'image': bad['services']['gitea']['image'] = 'gitea:old'
            else: bad['volumes']['gitea-data']['name'] = 'foreign'
            with self.assertRaisesRegex(RuntimeError, 'hạ schema'):
                gitea.guard_transition(current, bad)

    def test_cold_backup_includes_git_db_config_and_resumes_after_failure(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp); path = root / 'compose.json'
            path.write_text(json.dumps(runtime.manifest(self.state(), SOURCE)))
            db = root / 'gitea.db'
            with sqlite3.connect(db) as connection:
                connection.execute('CREATE TABLE sample (id INTEGER)')
                connection.execute('INSERT INTO sample VALUES (23)')
            config = root / 'app.ini'; config.write_text('INSTALL_LOCK=true')
            repo = root / 'HEAD'; repo.write_text('ref: refs/heads/main')
            def write_archive(args, **kwargs):
                self.assertIn('--network', args); self.assertIn('readonly', ' '.join(args))
                with tarfile.open(fileobj=kwargs['stdout'], mode='w') as archive:
                    archive.add(db, arcname='var/lib/gitea/data/gitea.db')
                    archive.add(repo, arcname='var/lib/gitea/git/repositories/owner/repo.git/HEAD')
                    archive.add(config, arcname='etc/gitea/app.ini')
            with patch.object(gitea, 'check_volumes'), patch.object(gitea, 'compose', return_value=result('container')) as compose, patch.object(gitea, 'run', side_effect=write_archive):
                with gitea.snapshot(path) as snapshot:
                    with tarfile.open(snapshot) as archive:
                        self.assertIn('etc/gitea/app.ini', archive.getnames())
                        self.assertIn('var/lib/gitea/git/repositories/owner/repo.git/HEAD', archive.getnames())
                    self.assertIn('stop', compose.call_args.args)
                self.assertIn('up', compose.call_args.args)
            with patch.object(gitea, 'check_volumes'), patch.object(gitea, 'compose', return_value=result('container')) as compose, patch.object(gitea, 'run', side_effect=RuntimeError('archive failure')):
                with self.assertRaisesRegex(RuntimeError, 'archive failure'):
                    with gitea.snapshot(path): pass
                self.assertIn('up', compose.call_args.args)

    def test_fresh_tui_always_bootstraps_gitea_before_completion(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp); conf = root / 'conf'; conf.mkdir()
            state = self.state(); candidate = root / 'compose.json'
            candidate.write_text(json.dumps(runtime.manifest(state, SOURCE, conf, root / 'data')))
            steps = []
            original = runtime.atomic
            def atomic(path, value, mode=0o600):
                if not str(path).startswith('/usr/local/'):
                    original(path, value, mode)
            def bootstrap(path, value, save, unattended):
                self.assertFalse(value.get('completed', False))
                steps.append('gitea'); value['gitea_bootstrapped'] = True
            with patch.object(install, 'ROOT', root), patch.object(install, 'CONF', conf), patch.object(install, 'DATA', root / 'data'), patch.object(install, 'atomic', side_effect=atomic), patch.object(install, 'compose'), patch.object(install, 'verify_local'), patch.object(install, 'public_test'), patch.object(install, 'fetch', return_value=b'{"initialized":true,"installationId":"owned"}'), patch.object(install, 'ensure_owner', side_effect=lambda *a: steps.append('owner')), patch.object(gitea, 'check_volumes'), patch.object(gitea, 'bootstrap', side_effect=bootstrap), patch.object(install, 'ask') as ask:
                install.activate(state, {}, root / ('b' * 40), candidate, lambda: None, [])
            self.assertEqual(steps, ['owner', 'gitea'])
            self.assertTrue(state['completed']); self.assertTrue(state['gitea_bootstrapped'])
            ask.assert_not_called()

    def test_failing_gitea_gate_never_marks_fresh_install_complete(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp); conf = root / 'conf'; conf.mkdir()
            state = self.state(); candidate = root / 'compose.json'
            candidate.write_text(json.dumps(runtime.manifest(state, SOURCE, conf, root / 'data')))
            original = runtime.atomic
            def atomic(path, value, mode=0o600):
                if not str(path).startswith('/usr/local/'): original(path, value, mode)
            with patch.object(install, 'ROOT', root), patch.object(install, 'CONF', conf), patch.object(install, 'DATA', root / 'data'), patch.object(install, 'atomic', side_effect=atomic), patch.object(install, 'compose'), patch.object(install, 'verify_local'), patch.object(install, 'public_test'), patch.object(install, 'ensure_owner'), patch.object(gitea, 'check_volumes'), patch.object(gitea, 'bootstrap', side_effect=RuntimeError('Gitea failed')):
                with self.assertRaisesRegex(RuntimeError, 'Gitea failed'):
                    install.activate(state, {}, root / ('b' * 40), candidate, lambda: None, [])
            self.assertFalse(state.get('completed', False))

    def test_existing_owner_bootstrap_preserves_hub_and_is_idempotent(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp); conf = root / 'conf'; conf.mkdir()
            state = {**self.state(), 'completed': True}
            config = runtime.manifest(state, SOURCE, conf, root / 'data')
            del config['services']['gitea']; del config['volumes']
            original_hub = copy.deepcopy(config['services']['hub'])
            path = conf / 'compose.json'; path.write_text(json.dumps(config))
            (conf / 'Caddyfile').write_text('old Hub route')
            release = root / 'releases' / state['revision']; release.parent.mkdir()
            release.symlink_to(SOURCE)
            def bootstrap(path, state, save): state['gitea_bootstrapped'] = True; save()
            with patch.object(runtime, 'ROOT', root), patch.object(runtime, 'CONF', conf), patch.object(runtime, 'DATA', root / 'data'), patch.object(runtime, 'admin', return_value=result('yes')) as owner, patch.object(runtime, 'backup'), patch.object(install, 'check_ports'), patch.object(install, 'public_test'), patch.object(gitea, 'check_volumes'), patch.object(gitea, 'run'), patch.object(gitea, 'compose') as compose, patch.object(gitea, 'verify'), patch.object(gitea, 'bootstrap', side_effect=bootstrap) as bootstrap_call, patch.object(gitea, 'require_bootstrap'):
                gitea.enable(state)
                gitea.enable(state)
            installed = json.loads(path.read_text())
            self.assertEqual(installed['services']['hub'], original_hub)
            self.assertIn('gitea', installed['services'])
            bootstrap_call.assert_called_once()
            self.assertEqual(sum('up' in call.args for call in compose.call_args_list), 1)
            self.assertTrue(all(call.args[1] in ['owner-exists', 'gitea-oidc'] for call in owner.call_args_list))

    def test_restart_and_uninstall_include_gitea_without_deleting_volumes(self):
        for command in ['restart', 'uninstall']:
            with tempfile.TemporaryDirectory() as temp:
                conf = pathlib.Path(temp)
                (conf / 'install.json').write_text(json.dumps({**self.state(), 'gitea_bootstrapped': True}))
                with patch.object(manage, 'CONF', conf), patch.object(manage.os, 'geteuid', return_value=0), patch.object(sys, 'argv', ['gen-hub', command]), patch('builtins.input', return_value='UNINSTALL'), patch.object(manage, 'compose') as compose, patch.object(manage, 'verify_local'), patch.object(gitea, 'check_volumes'), patch.object(gitea, 'require_bootstrap'), patch.object(lifecycle, 'stop_updates'):
                    manage.main()
                args = [call.args for call in compose.call_args_list]
                self.assertTrue(any((command if command == 'restart' else 'down') in a for a in args))
                self.assertFalse(any('--volumes' in a for a in args))
                # No service filter: the operation applies to all Compose services including Gitea.
                self.assertFalse(any('hub' in a for a in args))

    def test_purge_removes_only_owned_gitea_volumes_and_preserves_neighbors(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            for name in ['data', 'conf', 'software', 'neighbor']:
                (root / name).mkdir()
            (root / 'neighbor/keep').write_text('safe')
            names = ['gen-hub-owned-gitea-data', 'gen-hub-owned-gitea-config']
            with patch.object(lifecycle, 'ROOT', root / 'software'), patch.object(lifecycle, 'CONF', root / 'conf'), patch.object(lifecycle, 'DATA', root / 'data'), patch.object(lifecycle, 'UNIT_DIR', root / 'units'), patch.object(lifecycle, 'WRAPPER', root / 'wrapper'), patch.object(lifecycle, 'run', return_value=result()) as run, patch.object(lifecycle, 'compose'), patch.object(lifecycle, 'stop_updates'), patch.object(install, 'check_ports'), patch.object(gitea, 'check_volumes', return_value=names):
                lifecycle.purge(self.state())
            removed = [call.args[0][-1] for call in run.call_args_list if 'volume' in call.args[0]]
            self.assertEqual(removed, names)
            self.assertEqual((root / 'neighbor/keep').read_text(), 'safe')

    def test_doctor_reports_required_bootstrap_on_existing_install(self):
        with tempfile.TemporaryDirectory() as temp:
            conf = pathlib.Path(temp)
            (conf / 'install.json').write_text(json.dumps(self.state()))
            with patch.object(manage, 'CONF', conf), patch.object(manage.os, 'geteuid', return_value=0), patch.object(sys, 'argv', ['gen-hub', 'doctor']), patch.object(manage, 'verify_local'), patch.object(manage, 'admin', return_value=result('yes')), patch.object(lifecycle, 'check_storage'), patch.object(install, 'public_test'):
                with self.assertRaisesRegex(RuntimeError, 'Bắt buộc'):
                    manage.main()


if __name__ == '__main__':
    unittest.main()
