import io
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
from unittest.mock import patch
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'scripts'))
import lifecycle
import runtime
import manage

class GithubUpdateTest(unittest.TestCase):
    def test_cli_uses_optional_file_token_and_persists_rate_backoff(self):
        with tempfile.TemporaryDirectory() as temp:
            conf = pathlib.Path(temp)
            (conf / 'update.env').write_text('GENHUB_GITHUB_TOKEN=synthetic-update-key\n')
            reset = int(time.time()) + 3600
            failure = urllib.error.HTTPError('https://api.github.com', 403, 'rate limited',
                {'x-ratelimit-remaining': '0', 'x-ratelimit-reset': str(reset)}, None)
            with patch.object(lifecycle, 'CONF', conf), patch.dict(os.environ, {'GENHUB_GITHUB_TOKEN': ''}), patch.object(lifecycle.urllib.request, 'urlopen', side_effect=failure) as fetch:
                with self.assertRaisesRegex(RuntimeError, 'Giới hạn GitHub API tạm thời'):
                    lifecycle.github('/commits/main')
                self.assertEqual(fetch.call_args.args[0].get_header('Authorization'), 'Bearer synthetic-update-key')
                self.assertEqual(json.loads((conf / 'github-backoff.json').read_text())['retry_at'], reset)
                with self.assertRaisesRegex(RuntimeError, 'thử lại từ'):
                    lifecycle.github('/commits/main')
                self.assertEqual(fetch.call_count, 1)

    def test_permission_error_is_not_reported_as_rate_limit(self):
        with tempfile.TemporaryDirectory() as temp:
            with patch.object(lifecycle, 'CONF', pathlib.Path(temp)), patch.object(lifecycle.urllib.request, 'urlopen', side_effect=urllib.error.HTTPError('https://api.github.com', 403, 'Forbidden', {}, None)):
                with self.assertRaisesRegex(RuntimeError, 'HTTP 403'):
                    lifecycle.github('/commits/main')
                self.assertFalse((pathlib.Path(temp) / 'github-backoff.json').exists())

    def test_compose_uses_file_reference_and_never_embeds_update_token(self):
        with tempfile.TemporaryDirectory() as temp:
            conf = pathlib.Path(temp)
            state = {'mode': 'vps', 'domain': 'hub.example.com', 'installation_id': 'test', 'uid': 991, 'gid': 991, 'revision': 'a'*40}
            source = pathlib.Path(__file__).resolve().parents[1]
            self.assertNotIn('env_file', runtime.manifest(state, source, conf)['services']['hub'])
            (conf / 'update.env').write_text('GENHUB_GITHUB_TOKEN=synthetic-update-key\n')
            result = runtime.manifest(state, source, conf)
            self.assertEqual(result['services']['hub']['env_file'], [str(conf / 'update.env')])
            self.assertNotIn('synthetic-update-key', json.dumps(result))

    def test_token_configuration_rolls_back_file_and_compose_if_recreation_fails(self):
        with tempfile.TemporaryDirectory() as temp:
            conf = pathlib.Path(temp)
            (conf / 'install.json').write_text(json.dumps({'revision': 'a'*40}))
            (conf / 'compose.json').write_text('{"old": true}')
            (conf / 'update.env').write_text('GENHUB_GITHUB_TOKEN=old-key\n')
            failure = subprocess.CalledProcessError(1, ['docker'])
            with patch.object(manage, 'CONF', conf), patch.object(manage.os, 'geteuid', return_value=0), patch.object(sys, 'argv', ['gen-hub', 'github-token']), patch('builtins.input', return_value='new-key'), patch.object(runtime, 'manifest', return_value={'new': True}), patch.object(manage, 'compose', side_effect=[failure, None]), patch.object(manage, 'verify_local'):
                with self.assertRaises(subprocess.CalledProcessError):
                    manage.main()
            self.assertEqual((conf / 'update.env').read_text(), 'GENHUB_GITHUB_TOKEN=old-key\n')
            self.assertEqual(json.loads((conf / 'compose.json').read_text()), {'old': True})
            self.assertEqual((conf / 'update.env').stat().st_mode & 0o777, 0o600)

if __name__ == '__main__':
    unittest.main()
