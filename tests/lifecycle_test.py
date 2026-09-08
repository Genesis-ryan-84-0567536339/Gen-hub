import json
import pathlib
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'scripts'))
import lifecycle as lc
import install as installer

class LifecycleTest(unittest.TestCase):
    def test_update_only_after_exact_main_push_ci_success(self):
        sha = 'b' * 40
        for run in [None, {'head_sha': sha, 'head_branch': 'main', 'event': 'push', 'status': 'completed', 'conclusion': 'failure'}, {'head_sha': 'c'*40, 'head_branch': 'main', 'event': 'push', 'status': 'completed', 'conclusion': 'success'}, {'head_sha': sha, 'head_branch': 'main', 'event': 'pull_request', 'status': 'completed', 'conclusion': 'success'}]:
            with patch.object(lc, 'github', side_effect=[{'sha': sha}, {'workflow_runs': [run] if run else []}]):
                self.assertIsNone(lc.eligible_revision({'revision': 'a'*40}, True))
        good = {'head_sha': sha, 'head_branch': 'main', 'event': 'push', 'status': 'completed', 'conclusion': 'success'}
        with patch.object(lc, 'github', side_effect=[{'sha': sha}, {'workflow_runs': [good]}]):
            self.assertEqual(lc.eligible_revision({'revision': 'a'*40}, True), sha)

    def test_same_or_failed_revision_does_not_reinstall_automatically(self):
        for state in [{'revision': 'b'*40}, {'revision': 'a'*40, 'failed_update_revision': 'b'*40}]:
            with patch.object(lc, 'github', return_value={'sha': 'b'*40}) as fetch:
                self.assertIsNone(lc.eligible_revision(state, True)); self.assertEqual(fetch.call_count, 1)

    def test_transient_download_failure_is_not_marked_as_bad_revision(self):
        with tempfile.TemporaryDirectory() as temp:
            conf = pathlib.Path(temp)
            state = {'completed': True, 'auto_update': True, 'revision': 'a'*40}
            (conf/'install.json').write_text(json.dumps(state))
            with patch.object(lc, 'CONF', conf), patch.object(lc, 'eligible_revision', return_value='b'*40), patch.object(lc.urllib.request, 'urlopen', side_effect=OSError('temporary network failure')):
                with self.assertRaises(OSError):
                    lc.update(state, True)
            self.assertNotIn('failed_update_revision', json.loads((conf/'install.json').read_text()))

    def test_auto_update_disabled_never_fetches_or_executes(self):
        with patch.object(lc, 'github') as fetch, patch.object(lc, 'run') as run:
            lc.update({'completed': True, 'auto_update': False}, True)
            fetch.assert_not_called(); run.assert_not_called()

    def test_unattended_install_never_prompts_for_owner(self):
        with patch.object(installer, 'admin', return_value=subprocess.CompletedProcess([], 0, stdout='no')), patch.object(installer, 'ask') as ask:
            with self.assertRaisesRegex(RuntimeError, 'không tạo owner'):
                installer.ensure_owner('/test', unattended=True)
            ask.assert_not_called()

    def test_missing_key_cannot_be_repaired_by_creating_another(self):
        with tempfile.TemporaryDirectory() as temp:
            data = pathlib.Path(temp); (data/'hub.db').write_bytes(b'not empty')
            with patch.object(lc, 'DATA', data), patch.object(lc, 'run') as run:
                with self.assertRaisesRegex(RuntimeError, 'master.key'):
                    lc.repair({'revision': 'a'*40})
                self.assertFalse((data/'master.key').exists()); run.assert_not_called()

    def test_cloudflare_cleanup_refuses_resources_reused_by_other_hostnames(self):
        import install
        state = {'account_id':'account','tunnel_id':'tunnel','zone_id':'zone','domain':'hub.example.com','installation_id':'abc'}
        with patch.object(install.getpass,'getpass',return_value='synthetic'), patch.object(install,'cf',side_effect=[{'name':'gen-hub-abc'},{'config':{'ingress':[{'hostname':'other.example.com'}]}}]) as cf:
            with self.assertRaisesRegex(RuntimeError,'hostname khác'):
                lc.cloudflare_cleanup(state)
            self.assertFalse(any(call.kwargs.get('method') == 'DELETE' for call in cf.call_args_list))

if __name__ == '__main__':
    unittest.main()
