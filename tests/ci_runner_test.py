"""All host commands are intercepted. No sudo/systemctl/Docker runs on this host."""
import contextlib
import hashlib
import io
import json
import os
import pathlib
import stat
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'scripts'))
import ci_runner as ci
import deploy_registry as registry
import runtime

IMAGE = 'docker.io/library/node:24-bookworm@sha256:' + 'a' * 64
VERIFY_RUNTIME = ci.verify_runtime


class CITest(unittest.TestCase):
    def setUp(self):
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        self.root = pathlib.Path(self.stack.enter_context(tempfile.TemporaryDirectory()))
        for name, value in {'HOME': self.root / 'home', 'CONFIG': self.root / 'conf',
                            'UNITS': self.root / 'system', 'USER_UNITS': self.root / 'user',
                            'BIN': self.root / 'bin/gitea-runner'}.items():
            self.stack.enter_context(patch.object(ci, name, value))
        self.stack.enter_context(patch.object(registry, 'REGISTRY', self.root / 'actions'))
        # Virtual root ownership only inside this test's temporary filesystem.
        self.stack.enter_context(patch.object(registry, 'trusted', side_effect=self.trusted))
        self.stack.enter_context(patch.object(ci.os, 'geteuid', return_value=0))
        self.stack.enter_context(patch.object(ci.os, 'chown'))
        self.stack.enter_context(patch.object(ci.os, 'fchown'))
        self.stack.enter_context(patch.object(ci.os, 'getgrouplist', return_value=[902]))
        self.stack.enter_context(patch.object(ci.shutil, 'which', return_value=None))
        self.commands = []
        self.run = self.stack.enter_context(patch.object(ci, 'run', side_effect=self.command))
        # Fail closed if a newly added code path bypasses run(). Explicit sudo policy mock below.
        self.raw = self.stack.enter_context(patch.object(ci.subprocess, 'run', side_effect=AssertionError('Unmocked host command')))
        self.stack.enter_context(patch.object(ci, 'prerequisite_check'))
        self.stack.enter_context(patch.object(ci, 'allocate_subids'))
        self.stack.enter_context(patch.object(ci, 'enable_actions'))
        self.stack.enter_context(patch.object(ci, 'verify_runtime'))
        self.account = types.SimpleNamespace(pw_uid=901, pw_gid=902, pw_dir=str(ci.HOME), pw_shell='/usr/sbin/nologin')
        self.has_account = False
        self.stack.enter_context(patch.object(ci.pwd, 'getpwnam', side_effect=self.get_account))
        self.calls = []
        self.api = self.stack.enter_context(patch.object(ci, 'api', side_effect=self.remote))
        self.source = self.root / 'runner'
        self.source.write_bytes(b'fixture executable')
        self.digest = hashlib.sha256(self.source.read_bytes()).hexdigest()
        self.install = {'domain': 'hub.example.com', 'installation_id': 'test-install', 'gitea_bootstrapped': True}

    def trusted(self, path, directory=False):
        path = pathlib.Path(path)
        self.assertTrue(path.is_relative_to(self.root), 'Test attempted to access real host trust path')
        if path.is_symlink():
            raise RuntimeError('symlink')
        return path

    def get_account(self, user):
        self.assertEqual(user, 'genhub-ci')
        if not self.has_account:
            raise KeyError(user)
        return self.account

    def command(self, args, **kwargs):
        self.commands.append((args, kwargs))
        if args[0] == 'useradd':
            self.has_account = True
        output = ''
        if '--version' in args:
            output = 'gitea-runner version 3.0.0\n'
        if 'info' in args:
            output = json.dumps({'SecurityOptions': ['name=rootless'], 'CgroupVersion': '2', 'CgroupDriver': 'systemd'})
        if 'is-active' in args:
            output = 'active\n'
        if args[0] == 'findmnt':
            output = json.dumps({'filesystems': [{'target': str(ci.HOME / 'work'), 'fstype': 'tmpfs', 'options': 'rw,nosuid,nodev,size=4194304k'}]})
        if 'register' in args:
            config = json.loads((ci.CONFIG / 'register.json').read_text())
            pathlib.Path(config['runner']['file']).write_text(json.dumps({
                'id': 42, 'address': 'https://hub.example.com/gitea', 'token': 'synthetic-runner-secret'}))
        if 'rm' in args:
            pathlib.Path(args[-1]).unlink(missing_ok=True)
        return subprocess.CompletedProcess(args, 0, stdout=output, stderr='')

    def remote(self, state, suffix, method='GET', body=None):
        self.calls.append((suffix, method))
        if not suffix:
            return {'id': 17, 'full_name': 'owner/repo', 'permissions': {'admin': True}}
        if suffix == '/actions/runners/registration-token':
            self.assertEqual(method, 'POST')
            return {'token': 'synthetic-registration-secret'}
        if suffix.startswith('/actions/jobs'):
            return {'jobs': [{'id': 7, 'runner_id': 42, 'status': 'in_progress'}, {'id': 8, 'runner_id': 99, 'status': 'in_progress'}]}
        return {'id': 42, 'status': 'active', 'busy': True}

    def bootstrap(self, **overrides):
        kwargs = dict(installation=self.install, repo='owner/repo', binary=str(self.source),
                      digest=self.digest, image=IMAGE, token='synthetic-api-secret')
        kwargs.update(overrides)
        ci.bootstrap(**kwargs)

    def test_bootstrap_is_repo_scoped_rootless_and_secret_stdin_only(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.bootstrap()
        state = ci.read_state()
        self.assertTrue(state['registered'])
        self.assertEqual(state['repo_id'], 17)
        registration = next((a, kw) for a, kw in self.commands if 'register' in a)
        self.assertIn('synthetic-registration-secret', registration[1]['input'])
        for args, _ in self.commands:
            self.assertNotIn('synthetic-', str(args))
            self.assertNotIn('unix:///var/run/docker.sock', str(args))
        self.assertNotIn('synthetic-', output.getvalue())
        self.assertEqual((ci.CONFIG / 'api-token').stat().st_mode & 0o777, 0o600)
        self.assertEqual((ci.HOME / '.runner').stat().st_mode & 0o777, 0o640)
        self.assertFalse((ci.HOME / 'work/registration/.runner').exists())
        self.assertIn(('/actions/runners/42', 'GET'), self.calls)

    def test_resume_does_not_create_duplicate_runner(self):
        self.bootstrap()
        self.bootstrap()
        self.assertEqual(sum('register' in a for a, _ in self.commands), 1)

    def test_resume_after_registration_saved_but_state_write_interrupted(self):
        self.bootstrap()
        state = ci.read_state()
        state['registered'] = False
        ci.save(state)
        self.bootstrap()
        self.assertTrue(ci.read_state()['registered'])
        self.assertEqual(sum('register' in a for a, _ in self.commands), 1)

    def test_effective_limit_gate_rejects_drift_not_just_missing_config(self):
        self.bootstrap()
        group = self.root / 'cgroup/user-901.slice'
        group.mkdir(parents=True)
        limits = {'cpu.max': '200000 100000', 'memory.max': str(6*1024**3), 'memory.swap.max': '0', 'pids.max': '512'}
        for name, value in limits.items():
            (group / name).write_text(value)
        with patch.object(ci, 'CGROUP_ROOT', group.parent):
            VERIFY_RUNTIME(ci.read_state())
            for name in limits:
                (group / name).write_text('max 100000' if name == 'cpu.max' else 'max')
                with self.subTest(name=name), self.assertRaisesRegex(RuntimeError, 'giới hạn'):
                    VERIFY_RUNTIME(ci.read_state())
                (group / name).write_text(limits[name])
            runner_config = ci.CONFIG / 'runner.json'
            config = json.loads(runner_config.read_text())
            config['container']['docker_host'] = '/var/run/docker.sock'
            runner_config.write_text(json.dumps(config))
            with self.assertRaisesRegex(RuntimeError, 'config đã đổi'):
                VERIFY_RUNTIME(ci.read_state())

    def test_unknown_runner_status_is_not_reported_healthy(self):
        self.bootstrap()
        original = self.remote
        def unknown(state, suffix, method='GET', body=None):
            data = original(state, suffix, method, body)
            if suffix == '/actions/runners/42':
                data['status'] = 'unknown'
            return data
        self.api.side_effect = unknown
        with self.assertRaisesRegex(RuntimeError, 'không sẵn sàng'):
            ci.status(self.install, doctor=True)

    def test_registration_and_workspace_symlinks_never_chown_or_copy_host_files(self):
        self.bootstrap()
        protected = self.root / 'protected'
        protected.mkdir()
        (protected / '.runner').write_text('{"secret":"must-not-copy"}')
        link = ci.HOME / 'work/evil'
        link.symlink_to(protected, target_is_directory=True)
        with self.assertRaises(OSError):
            ci.job_directory(ci.read_state(), link)
        with self.assertRaises(OSError):
            ci.read_registration(link)
        directory = ci.HOME / 'work/registration'
        (directory / '.runner').symlink_to(protected / '.runner')
        with self.assertRaises(OSError):
            ci.read_registration(directory)
        self.assertEqual((protected / '.runner').read_text(), '{"secret":"must-not-copy"}')

    def test_old_runner_binary_is_rejected(self):
        original = self.command
        def old(args, **kwargs):
            result = original(args, **kwargs)
            if '--version' in args:
                result.stdout = 'act_runner version v0.2.13'
            return result
        self.run.side_effect = old
        with self.assertRaisesRegex(RuntimeError, 'Runner 3.x'):
            self.bootstrap()
        self.assertFalse(any(ci.RUNNER in a for a, _ in self.commands))

    def test_existing_foreign_account_is_not_adopted(self):
        self.has_account = True
        with self.assertRaisesRegex(RuntimeError, 'có sẵn'):
            self.bootstrap()
        self.run.assert_not_called()

    def test_rejects_mutable_images_shell_options_and_host_labels_before_host_commands(self):
        for image in ['node:24', 'host', IMAGE + ' --privileged', '../node@sha256:' + 'a'*64]:
            with self.subTest(image=image), self.assertRaises(RuntimeError):
                self.bootstrap(image=image)
        self.run.assert_not_called()

    def test_rejects_wrong_binary_digest_and_repo_traversal(self):
        for opts in [{'digest': 'f'*64}, {'repo': 'owner/..'}, {'repo': 'owner/repo;id'}, {'repo': 'owner/repo\n'}]:
            with self.subTest(opts=opts), self.assertRaises(RuntimeError):
                self.bootstrap(**opts)
        self.run.assert_not_called()

    def test_supplementary_group_blocks_runner_before_start(self):
        self.bootstrap()
        self.commands.clear()
        with patch.object(ci.os, 'getgrouplist', return_value=[902, 999]), self.assertRaisesRegex(RuntimeError, 'supplementary'):
            self.bootstrap()
        self.assertEqual(self.commands, [])

    def test_sudo_policy_is_verified_and_any_grant_fails_closed(self):
        self.bootstrap()
        with patch.object(ci.shutil, 'which', return_value='/usr/bin/sudo'):
            for code in [0, 2]:
                self.raw.side_effect = None
                self.raw.return_value = subprocess.CompletedProcess([], code, stdout='synthetic-policy')
                with self.assertRaisesRegex(RuntimeError, 'sudo'):
                    ci.verify_account(ci.read_state())
            self.raw.return_value = subprocess.CompletedProcess([], 1)
            ci.verify_account(ci.read_state())
        self.assertEqual(self.raw.call_args.args[0], ['sudo', '-n', '-l', '-U', 'genhub-ci'])

    def test_total_limits_cover_sidecars_and_daemon_not_just_main_container(self):
        config = ci.runner_config(IMAGE)
        self.assertEqual(config['container']['docker_host'], '-')
        self.assertEqual(config['container']['valid_volumes'], [])
        self.assertFalse(config['container']['privileged'])
        self.assertTrue(all(':docker://' in label for label in config['runner']['labels']))
        self.assertEqual(config['runner']['timeout'], '20m')
        definitions = ci.units(901, 902)
        slice_config = definitions[ci.UNITS / 'user-901.slice.d/50-genhub-ci.conf']
        for limit in ['CPUQuota=200%', 'MemoryMax=6G', 'MemorySwapMax=0', 'TasksMax=512']:
            self.assertIn(limit, slice_config)
        self.assertIn('size=4G,mode=0700,uid=901,gid=902', definitions[ci.UNITS / ci.MOUNT])
        manager = definitions[ci.UNITS / 'user@901.service.d/50-genhub-ci.conf']
        for secret in ['/var/lib/gen-hub', '/etc/gen-hub', '/etc/cloudflared', '/run/docker.sock', '/etc/gen-hub-deploy']:
            self.assertIn('-' + secret, manager)
        self.assertIn('ProtectSystem=strict', manager)
        self.assertIn('--disable-host-loopback', definitions[ci.USER_UNITS / ci.DOCKER])

    def test_rootful_or_unbounded_daemon_never_starts_runner(self):
        original = self.command
        def rootful(args, **kwargs):
            if 'info' in args:
                return subprocess.CompletedProcess(args, 0, stdout=json.dumps({'SecurityOptions': [], 'CgroupVersion': '1'}))
            return original(args, **kwargs)
        self.run.side_effect = rootful
        with self.assertRaisesRegex(RuntimeError, 'rootless'):
            self.bootstrap()
        self.assertFalse(any(ci.RUNNER in a for a, _ in self.commands))
        self.assertFalse(ci.read_state()['registered'])

    def test_status_shows_only_current_runner_job_and_no_tokens(self):
        self.bootstrap()
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            ci.status(self.install, doctor=True)
        self.assertIn('CI job hiện tại: 7', output.getvalue())
        self.assertNotIn('8', output.getvalue())
        self.assertNotIn('synthetic-', output.getvalue())

    def test_restart_drains_before_hub_effect_and_restarts_only_after_health(self):
        self.bootstrap()
        self.commands.clear()
        with ci.drained(self.install):
            self.assertEqual(self.commands[-1][0][-2:], ['stop', ci.RUNNER])
            self.commands.append((['simulated-hub-restart-health'], {}))
        self.assertEqual(self.commands[-1][0][-2:], ['start', ci.RUNNER])
        with self.assertRaisesRegex(RuntimeError, 'health'):
            with ci.drained(self.install):
                raise RuntimeError('health failed')
        self.assertEqual(self.commands[-1][0][-2:], ['stop', ci.RUNNER])

    def test_uninstall_deregisters_before_stopping_docker_and_preserves_state(self):
        self.bootstrap()
        self.commands.clear()
        ci.uninstall(self.install)
        self.assertIn(('/actions/runners/42', 'DELETE'), self.calls)
        self.assertFalse(ci.read_state()['registered'])
        self.assertTrue(ci.CONFIG.exists())
        self.assertFalse((ci.HOME / '.runner').exists())
        self.assertEqual(self.commands[0][0][-2:], ['stop', ci.RUNNER])
        self.assertTrue(any(a[-3:] == ['stop', ci.RUNNER, ci.DOCKER] for a, _ in self.commands))

    def test_failed_deregister_keeps_credentials_and_never_removes_storage(self):
        self.bootstrap()
        original = self.remote
        def fail(state, suffix, method='GET'):
            if method == 'DELETE':
                raise RuntimeError('remote offline')
            return original(state, suffix, method)
        self.api.side_effect = fail
        self.commands.clear()
        with self.assertRaisesRegex(RuntimeError, 'offline'):
            ci.uninstall(self.install, purge=True)
        self.assertTrue((ci.HOME / '.runner').exists())
        self.assertTrue(ci.read_state()['registered'])
        self.assertFalse(any('userdel' in a for a, _ in self.commands))

    def test_purge_does_not_touch_action_registry_or_foreign_install(self):
        self.bootstrap()
        sentinel = registry.REGISTRY / 'owner-action.json'
        sentinel.write_text('keep')
        with self.assertRaisesRegex(RuntimeError, 'installation khác'):
            ci.uninstall({'installation_id': 'foreign'}, purge=True)
        ci.uninstall(self.install, purge=True)
        self.assertTrue(sentinel.exists())
        self.assertFalse(ci.HOME.exists())
        self.assertFalse(ci.CONFIG.exists())
        self.assertTrue(any(a == ['userdel', 'genhub-ci'] for a, _ in self.commands))


class RegistryTest(unittest.TestCase):
    def action(self):
        return {'actionId': 'web', 'version': '1', 'repo': 17, 'environments': ['staging'],
                'executable': '/usr/local/lib/gen-hub-actions/web', 'sha256': 'a'*64, 'timeoutSeconds': 60}

    def test_strict_schema_rejects_shell_argv_unknown_fields_and_traversal(self):
        registry.validate(self.action())
        for change in [{'argv': ['bash', '-c', 'id']}, {'command': 'id'}, {'actionId': '../web'},
                       {'repo': True}, {'executable': '/tmp/../root/web'}, {'timeoutSeconds': 901},
                       {'environments': ['prod;id']}, {'sha256': 'latest'}]:
            with self.subTest(change=change), self.assertRaises(RuntimeError):
                registry.validate({**self.action(), **change})

    def test_trust_checks_all_ancestors_and_rejects_symlink_nonroot_or_writable(self):
        path = pathlib.Path('/etc/actions/web')
        def safe(p):
            return types.SimpleNamespace(st_mode=(stat.S_IFREG if p == path else stat.S_IFDIR) | 0o755, st_uid=0)
        for mode, uid in [(stat.S_IFLNK | 0o755, 0), (stat.S_IFDIR | 0o777, 0), (stat.S_IFDIR | 0o755, 1000)]:
            def info(p):
                return types.SimpleNamespace(st_mode=mode, st_uid=uid) if p == pathlib.Path('/etc') else safe(p)
            with patch.object(pathlib.Path, 'lstat', info), self.assertRaisesRegex(RuntimeError, 'root-owned'):
                registry.trusted(path)

    def test_register_and_load_bind_version_to_actual_script_digest(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            script = root / 'web'
            script.write_text('#!/bin/sh\nexit 0\n')
            script.chmod(0o755)
            value = {**self.action(), 'executable': str(script), 'sha256': hashlib.sha256(script.read_bytes()).hexdigest()}
            source = root / 'source.json'
            source.write_text(json.dumps(value))
            with patch.object(registry, 'REGISTRY', root / 'actions'), patch.object(registry.os, 'geteuid', return_value=0), patch.object(registry, 'trusted', side_effect=lambda p, **kw: pathlib.Path(p)):
                registry.register(source)
                self.assertEqual(registry.load('web'), value)
                script.write_text('#!/bin/sh\nexit 1\n')
                with self.assertRaisesRegex(RuntimeError, 'đã đổi'):
                    registry.load('web')
                value['sha256'] = hashlib.sha256(script.read_bytes()).hexdigest()
                source.write_text(json.dumps(value))
                with self.assertRaisesRegex(RuntimeError, 'version'):
                    registry.register(source)
                value['version'] = '2'
                source.write_text(json.dumps(value))
                registry.register(source)
                self.assertEqual(registry.load('web')['version'], '2')


class TransportAndSubidTest(unittest.TestCase):
    def test_api_fixed_repo_post_no_redirects_and_error_redaction(self):
        import urllib.error
        state = {'instance': 'https://hub.example.com/gitea', 'repo': 'owner/repo'}
        response = contextlib.nullcontext(io.BytesIO(b'{"token":"synthetic"}'))
        opener = types.SimpleNamespace(open=lambda *args, **kw: response)
        with tempfile.TemporaryDirectory() as temp:
            config = pathlib.Path(temp)
            (config / 'api-token').write_text('synthetic-api-secret')
            with patch.object(ci, 'CONFIG', config), patch.object(registry, 'trusted', side_effect=lambda p: pathlib.Path(p)), patch.object(ci.urllib.request, 'build_opener', return_value=opener) as build:
                seen = []
                def receive(request, **kwargs):
                    seen.append(request)
                    return response
                opener.open = receive
                self.assertEqual(ci.api(state, '/actions/runners/registration-token', 'POST'), {'token': 'synthetic'})
                self.assertEqual(seen[0].full_url, 'https://hub.example.com/gitea/api/v1/repos/owner/repo/actions/runners/registration-token')
                self.assertEqual(seen[0].get_method(), 'POST')
                self.assertEqual(seen[0].headers['Authorization'], 'token synthetic-api-secret')
                self.assertIsNone(build.call_args.args[0].redirect_request(None))
                def fail(*args, **kwargs):
                    raise urllib.error.HTTPError('https://synthetic-secret', 403, 'synthetic-api-secret', {}, None)
                opener.open = fail
                with self.assertRaises(RuntimeError) as error:
                    ci.api(state, '/actions/runners/42', 'DELETE')
                self.assertNotIn('synthetic', str(error.exception))
                self.assertIn('403', str(error.exception))

    def test_subids_resume_half_written_pair_without_overlapping_neighbors(self):
        with tempfile.TemporaryDirectory() as temp:
            paths = [pathlib.Path(temp) / name for name in ['subuid', 'subgid']]
            paths[0].write_text('neighbor:231072:65536\ngenhub-ci:296608:65536\n')
            paths[1].write_text('neighbor:231072:65536\n')
            with patch.object(ci, 'SUBID_FILES', paths):
                ci.allocate_subids()
                ci.allocate_subids()
                for path in paths:
                    self.assertEqual(path.read_text().count('genhub-ci:'), 1)
                    self.assertIn('genhub-ci:296608:65536', path.read_text())
                paths[1].write_text(paths[1].read_text() + 'other:300000:65536\n')
                with self.assertRaisesRegex(RuntimeError, 'chồng lấn'):
                    ci.allocate_subids()


if __name__ == '__main__':
    unittest.main()
