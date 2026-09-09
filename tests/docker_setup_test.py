"""Engine detection regression tests; never install packages or change host services."""
import io
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'scripts'))
import docker_setup as setup

DOCKER_INFO = {'OSType': 'linux', 'DockerRootDir': '/var/lib/docker'}
PODMAN_INFO = {'host': {'os': 'linux'}, 'store': {}, 'version': {'Version': '5.6.0'}}


class DockerSetupTest(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.info_results = [json.dumps(DOCKER_INFO)]
        self.version = 'Docker version 28.0.0, build test'
        self.version_stderr = ''
        self.compose_available = True
        for target, options in [
            ('shutil.which', {'return_value': '/usr/bin/docker'}),
            ('subprocess.run', {'side_effect': self.command}),
            ('run', {'side_effect': self.command}),
            ('shutil.disk_usage', {'return_value': SimpleNamespace(free=3 * 1024**3)}),
            ('urllib.request.urlopen', {'side_effect': AssertionError('Unexpected network request')}),
            ('atomic', {})
        ]:
            mock = patch('docker_setup.' + target, **options)
            mock.start()
            self.addCleanup(mock.stop)

    def command(self, args, **kwargs):
        self.calls.append(args)
        code, stdout, stderr = 0, '', ''
        if args == ['docker', '--version']:
            stdout, stderr = self.version, self.version_stderr
        elif args == [*setup.DOCKER, 'info', '--format', '{{json .}}']:
            value = self.info_results.pop(0) if len(self.info_results) > 1 else self.info_results[0]
            code, stdout = (1, '') if value is None else (0, value)
        elif args == [*setup.DOCKER, 'compose', 'version']:
            code = 0 if self.compose_available else 1
        elif args == [*setup.DOCKER, 'compose', 'version', '--short']:
            stdout = '2.33.1'
        elif args[0] not in ('systemctl', 'dnf'):
            raise AssertionError(f'Unexpected command: {args}')
        return subprocess.CompletedProcess(args, code, stdout, stderr)

    def assert_no_host_changes(self):
        self.assertFalse(any(c[0] in ('systemctl', 'dnf', 'apt-get') for c in self.calls))
        setup.atomic.assert_not_called()
        setup.urllib.request.urlopen.assert_not_called()

    def test_podman_cli_rejected_before_compose_or_service_even_without_daemon(self):
        self.info_results = [None]
        for output, warning in [('podman version 5.6.0', ''), ('Docker version compat', 'Emulate Docker CLI using podman.')]:
            with self.subTest(output=output):
                self.version, self.version_stderr = output, warning
                self.calls.clear()
                with self.assertRaisesRegex(RuntimeError, 'sudo dnf remove podman-docker'):
                    setup.ensure_docker()
                self.assertEqual(self.calls, [['docker', '--version']])
                self.assert_no_host_changes()

    def test_podman_symlink_rejected_without_executing_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            shim = pathlib.Path(tmp) / 'docker'
            shim.symlink_to(pathlib.Path(tmp) / 'podman')
            with patch.object(setup.shutil, 'which', return_value=str(shim)):
                with self.assertRaisesRegex(RuntimeError, 'Phát hiện Podman'):
                    setup.ensure_docker()
            self.assertEqual(self.calls, [])
            self.assert_no_host_changes()

    def test_podman_info_rejected_even_with_docker_version_and_compose_installed(self):
        self.info_results = [json.dumps(PODMAN_INFO)]
        for compose_available in (True, False):
            with self.subTest(compose_available=compose_available):
                self.compose_available = compose_available
                self.calls.clear()
                with self.assertRaisesRegex(RuntimeError, 'chưa hỗ trợ Podman'):
                    setup.ensure_docker()
                self.assert_no_host_changes()
                self.assertFalse(any('compose' in c for c in self.calls))

    def test_real_docker_works_when_podman_is_also_installed(self):
        with patch.object(setup.shutil, 'which', side_effect=lambda name: '/usr/bin/' + name):
            setup.ensure_docker()
        self.assertIn(['systemctl', 'enable', 'docker'], self.calls)
        self.assertNotIn(['systemctl', 'start', 'docker'], self.calls)
        self.assertFalse(any(c[0] in ('dnf', 'apt-get') for c in self.calls))

    def test_stopped_docker_is_started_and_validated(self):
        self.info_results = [None, json.dumps(DOCKER_INFO)]
        setup.ensure_docker()
        self.assertIn(['systemctl', 'start', 'docker'], self.calls)
        self.assertLess(self.calls.index(['systemctl', 'start', 'docker']),
                        self.calls.index(['systemctl', 'enable', 'docker']))

    def test_invalid_info_rejected_before_host_changes(self):
        for result in ('not json', '[]', '{"OSType":"windows"}'):
            with self.subTest(result=result):
                self.info_results = [result]
                self.calls.clear()
                with self.assertRaises(RuntimeError):
                    setup.ensure_docker()
                self.assert_no_host_changes()

    def test_service_starts_but_engine_still_unavailable(self):
        self.info_results = [None]
        with self.assertRaisesRegex(RuntimeError, 'chưa phản hồi'):
            setup.ensure_docker()
        self.assertNotIn(['systemctl', 'enable', 'docker'], self.calls)

    def test_fedora_without_docker_installs_full_engine_and_compose(self):
        with patch.object(setup.shutil, 'which', side_effect=[None, '/usr/bin/docker']), \
             patch.object(setup.pathlib.Path, 'read_text', return_value='ID=fedora\n'), \
             patch.object(setup.pathlib.Path, 'glob', return_value=[]), \
             patch.object(setup.urllib.request, 'urlopen', return_value=io.BytesIO(b'[docker-ce-stable]\n')):
            setup.ensure_docker()
        self.assertIn(['dnf', 'install', '-y', 'docker-ce', 'docker-ce-cli', 'containerd.io',
                       'docker-buildx-plugin', 'docker-compose-plugin'], self.calls)
        self.assertFalse(any('remove' in c or '--allowerasing' in c for c in self.calls))
        self.assertIn(['systemctl', 'enable', 'docker'], self.calls)


if __name__ == '__main__':
    unittest.main()
