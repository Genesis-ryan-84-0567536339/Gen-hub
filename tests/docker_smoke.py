#!/usr/bin/env python3
"""Real Docker/Caddy/TLS/persistence acceptance on an isolated GitHub-hosted runner.
Cloudflare is validated as an image/config, never connected with fake credentials.
"""
import hashlib
import http.cookiejar
import json
import os
import pathlib
import secrets
import ssl
import sys
import tarfile
import tempfile
import urllib.error
import urllib.request
from unittest.mock import patch, mock_open
import contextlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'scripts'))
import runtime as rt
import install as installer
import lifecycle
import gitea
import base64
import subprocess
from docker_setup import ensure_docker

SOURCE = pathlib.Path(__file__).resolve().parents[1]


def main():
    # Exercise the same engine preflight as install.sh against the runner's real
    # Docker daemon and systemd, not only mocked docker info fixtures.
    ensure_docker()
    with tempfile.TemporaryDirectory(prefix='gen-hub-docker-') as temp:
        root = pathlib.Path(temp)
        conf = root / 'config'; conf.mkdir()
        data = root / 'gen-hub'; data.mkdir(mode=0o700)
        state = {'mode': 'vps', 'domain': 'localhost:18443', 'revision': 'ci',
                 'uid': 1001, 'gid': 1001, 'installation_id': secrets.token_hex(24)}
        os.chown(data, state['uid'], state['gid'])
        for name in ['gen-hub-caddy', 'gen-hub-caddy-config']:
            directory = data.parent / name
            directory.mkdir(mode=0o700)
            os.chown(directory, state['uid'], state['gid'])
        config = rt.manifest(state, SOURCE, conf, data)
        config['services']['caddy']['ports'] = ['127.0.0.1:18443:443']
        # Only the issuer/listen address differ from public VPS config; never disable TLS verification.
        caddyfile = rt.caddy_config(state).replace('localhost:18443 {', 'https://localhost {\n  tls internal')
        rt.atomic(conf / 'Caddyfile', caddyfile, 0o644)
        path = conf / 'compose.json'; rt.atomic(path, json.dumps(config))
        try:
            installer.prepare_images(path)
            rt.compose(path, 'up', '-d', '--wait', '--wait-timeout', '150', '--no-build')
            rt.compose(path, 'cp', 'caddy:/data/caddy/pki/authorities/local/root.crt', str(root / 'root.crt'))
            context = ssl.create_default_context(cafile=str(root / 'root.crt'))
            cookiejar = http.cookiejar.CookieJar()
            client = urllib.request.build_opener(urllib.request.HTTPSHandler(context=context), urllib.request.HTTPCookieProcessor(cookiejar))
            origin = 'https://' + state['domain']
            csrf = ''
            def request(route, method='GET', payload=None, headers=None):
                req = urllib.request.Request(origin + route, method=method,
                    data=json.dumps(payload).encode() if payload is not None else None,
                    headers={'Origin': origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, **(headers or {})})
                try:
                    response = client.open(req, timeout=15)
                except urllib.error.HTTPError as error:
                    response = error
                with response:
                    return response.status, json.load(response)
            status, health = request('/healthz')
            assert status == 200 and health['installationId'] == state['installation_id'] and not health['initialized']
            assert request('/api/state')[0] == 503, 'Owner bootstrap must remain locked'
            rt.verify_local(path, state)
            rt.admin(path, 'create-owner', {'username': 'ci-owner', 'password': 'CI-only-test-password-123'})
            state['gitea_image'] = json.loads(path.read_text())['services']['gitea']['image']
            terminal = mock_open()
            with patch('builtins.open', terminal):
                gitea.bootstrap(path, state, lambda: None)
            credential_text = ''.join(call.args[0] for call in terminal().write.call_args_list)
            gitea_password = credential_text.split('hãy lưu ngay): ')[1].strip()
            # Only this disposable test account bypasses the first-login password change.
            rt.compose(path, 'exec', '-T', 'gitea', 'sh', '-ec',
                'read -r password; exec gitea admin user change-password --username genhub-admin '
                '--password "$password" --must-change-password=false', input=gitea_password + '\n', capture_output=True)
            gitea_auth = {'Authorization': 'Basic ' + base64.b64encode(('genhub-admin:' + gitea_password).encode()).decode()}
            assert request('/gitea/api/healthz')[1]['status'] == 'pass'
            status, repo = request('/gitea/api/v1/user/repos', 'POST', {'name': 'lifecycle', 'private': True, 'auto_init': True}, gitea_auth)
            assert status == 201, repo
            assert repo['clone_url'] == origin + '/gitea/genhub-admin/lifecycle.git'
            status, issue = request('/gitea/api/v1/repos/genhub-admin/lifecycle/issues', 'POST', {'title': 'persist Gitea issue'}, gitea_auth)
            assert status == 201, issue
            repo_route = '/gitea/api/v1/repos/genhub-admin/lifecycle'
            git_env = {**os.environ, 'GIT_SSL_CAINFO': str(root / 'root.crt'), 'GIT_TERMINAL_PROMPT': '0',
                       'GIT_CONFIG_COUNT': '1', 'GIT_CONFIG_KEY_0': 'http.extraHeader',
                       'GIT_CONFIG_VALUE_0': 'Authorization: ' + gitea_auth['Authorization']}
            checkout = root / 'git-checkout'
            subprocess.run(['git', 'clone', repo['clone_url'], str(checkout)], env=git_env, check=True, capture_output=True)
            (checkout / 'lifecycle.txt').write_text('persist through backup and restore\n')
            subprocess.run(['git', '-C', str(checkout), 'add', 'lifecycle.txt'], check=True, capture_output=True)
            subprocess.run(['git', '-C', str(checkout), '-c', 'user.name=CI', '-c', 'user.email=ci@localhost.invalid',
                            'commit', '-m', 'Exercise Git HTTPS storage'], check=True, capture_output=True)
            subprocess.run(['git', '-C', str(checkout), 'push'], env=git_env, check=True, capture_output=True)

            logs = rt.compose(path, 'logs', 'gitea', capture_output=True).stdout
            assert gitea_password not in logs

            status, login = request('/api/login', 'POST', {'username': 'ci-owner', 'password': 'CI-only-test-password-123'})
            assert status == 200
            csrf = login['csrf']
            assert request('/api/state')[0] == 200
            assert request('/api/settings', 'PATCH', {'name': 'persist-after-recreate'})[0] == 200
            status, agent = request('/api/agents', 'POST', {'name': 'Docker acceptance', 'permissions': []})
            assert status == 201
            token = agent['token']
            rpc = {'jsonrpc': '2.0', 'id': 1, 'method': 'tools/list', 'params': {}}
            headers = {'Authorization': 'Bearer ' + token, 'Accept': 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18'}
            status, result = request('/mcp', 'POST', rpc, headers)
            assert status == 200 and result['result']['tools'] == []
            key_before = hashlib.sha256((data / 'master.key').read_bytes()).hexdigest()
            # Remove/recreate every container and network, keep only bind-mounted persistent data.
            rt.compose(path, 'down')
            rt.compose(path, 'up', '-d', '--wait', '--wait-timeout', '150', '--no-build')
            assert rt.admin(path, 'owner-exists').stdout.strip() == 'yes'
            assert request(repo_route, headers=gitea_auth)[0] == 200
            assert request(repo_route + '/issues/1', headers=gitea_auth)[1]['title'] == 'persist Gitea issue'
            assert hashlib.sha256((data / 'master.key').read_bytes()).hexdigest() == key_before
            status, persisted = request('/api/state')
            assert status == 200 and persisted['settings']['name'] == 'persist-after-recreate', 'Session/settings must persist'
            assert request('/mcp', 'POST', rpc, headers)[0] == 200, 'Agent token must persist'
            rt.backup(path, root / 'backup.tar.gz', conf, data)
            with tarfile.open(root / 'backup.tar.gz') as archive:
                assert {'data/hub.db', 'data/master.key', 'gitea/volumes.tar'}.issubset(set(archive.getnames()))
                gitea_snapshot = root / 'gitea-volumes.tar'
                gitea_snapshot.write_bytes(archive.extractfile('gitea/volumes.tar').read())
            # Restore the complete cold archive into the same disposable volumes, then authenticate/read git/issues.
            rt.compose(path, 'stop', 'gitea')
            rt.compose(path, 'run', '--rm', '--no-deps', '-T', '--entrypoint', 'sh', 'gitea', '-ec',
                       'find /var/lib/gitea /etc/gitea -mindepth 1 -maxdepth 1 -exec rm -rf {} +')
            with gitea_snapshot.open('rb') as snapshot_input:
                rt.compose(path, 'run', '--rm', '--no-deps', '-T', '--entrypoint', 'tar', 'gitea', '-C', '/', '-xf', '-', stdin=snapshot_input)
            rt.compose(path, 'up', '-d', '--wait', '--wait-timeout', '150', '--no-build', 'gitea')
            assert request(repo_route, headers=gitea_auth)[0] == 200
            assert request(repo_route + '/contents/README.md', headers=gitea_auth)[0] == 200
            assert request(repo_route + '/contents/lifecycle.txt', headers=gitea_auth)[0] == 200
            assert request(repo_route + '/issues/1', headers=gitea_auth)[1]['title'] == 'persist Gitea issue'

            assert (root / 'backup.tar.gz').stat().st_mode & 0o777 == 0o600
            # Doctor must reconstruct broken configuration with real containers and retain the original data/key.
            install_root = root / 'software'
            releases = install_root / 'releases'; releases.mkdir(parents=True)
            (releases / 'ci').symlink_to(SOURCE, target_is_directory=True)
            rt.atomic(conf / 'install.json', json.dumps(state))
            rt.atomic(path, 'broken compose')
            rt.atomic(conf / 'Caddyfile', 'broken caddy')
            real_manifest, real_caddy = rt.manifest, rt.caddy_config
            def test_manifest(*args, **kwargs):
                result = real_manifest(*args, **kwargs)
                result['services']['caddy']['ports'] = ['127.0.0.1:18443:443']
                return result
            def test_caddy(value):
                return real_caddy(value).replace('localhost:18443 {', 'https://localhost {\n  tls internal')
            def public_probe(value):
                code, body = request('/healthz')
                assert code == 200 and body['installationId'] == value['installation_id']
                assert request('/gitea/api/healthz')[1]['status'] == 'pass'
            with patch.object(lifecycle, 'ROOT', install_root), patch.object(lifecycle, 'CONF', conf), patch.object(lifecycle, 'DATA', data), patch.object(lifecycle, 'configure_updates'), patch.object(rt, 'manifest', side_effect=test_manifest), patch.object(rt, 'caddy_config', side_effect=test_caddy), patch.object(installer, 'public_test', side_effect=public_probe):
                lifecycle.repair(state)
            assert request('/api/state')[0] == 200
            assert hashlib.sha256((data / 'master.key').read_bytes()).hexdigest() == key_before
            rt.compose(path, 'down')
            # Personal mode uses private Caddy HTTP; no host ports in the shipped manifest.
            state['mode'] = 'personal'
            config = rt.manifest(state, SOURCE, conf, data)
            assert all('ports' not in service for service in config['services'].values())
            rt.atomic(conf / 'tunnel.token', 'synthetic-placeholder-not-used\n')
            rt.atomic(conf / 'Caddyfile', rt.caddy_config(state), 0o644)
            rt.atomic(path, json.dumps(config))
            rt.compose(path, 'config', '--quiet')
            rt.compose(path, 'up', '-d', '--wait', '--wait-timeout', '150', '--no-build', 'hub', 'caddy')
            script = "const r=await fetch('http://caddy:8080/healthz');const b=await r.json();if(!r.ok||!b.initialized||b.installationId!==process.env.INSTALLATION_ID)process.exit(1)"
            rt.compose(path, 'exec', '-T', 'hub', 'node', '--input-type=module', '-e', script)
            image = config['services']['tunnel']['image']
            rt.run([*rt.DOCKER, 'pull', image])
            help_text = rt.run([*rt.DOCKER, 'run', '--rm', '--network', 'none', image, 'tunnel', 'run', '--help'], capture_output=True).stdout
            assert '--token-file' in help_text
            # Purge is exercised only against this test's isolated paths/project; preserve a neighboring sentinel.
            neighbor = root / 'other-app'; neighbor.mkdir()
            (neighbor / 'keep').write_text('untouched')
            with patch.object(lifecycle, 'ROOT', install_root), patch.object(lifecycle, 'CONF', conf), patch.object(lifecycle, 'DATA', data), patch.object(lifecycle, 'UNIT_DIR', root / 'units'), patch.object(lifecycle, 'WRAPPER', root / 'wrapper'):
                lifecycle.purge(state)
            assert not gitea.check_volumes(state)
            assert not data.exists() and not conf.exists() and not install_root.exists()
            assert (neighbor / 'keep').read_text() == 'untouched'
            # Verify that the real systemd timer enables and invokes its configured command.
            # Substitute /usr/bin/true so this test cannot update the runner from main.
            try:
                with patch.object(lifecycle, 'WRAPPER', pathlib.Path('/usr/bin/true')):
                    lifecycle.configure_updates({'auto_update': True})
                rt.run(['systemctl', 'is-enabled', '--quiet', 'gen-hub-update.timer'])
                rt.run(['systemctl', 'start', 'gen-hub-update.service'])
                result = rt.run(['systemctl', 'show', 'gen-hub-update.service', '--property=Result', '--value'], capture_output=True).stdout.strip()
                assert result == 'success'
            finally:
                lifecycle.stop_updates()
                for name in ['gen-hub-update.service', 'gen-hub-update.timer']:
                    (lifecycle.UNIT_DIR / name).unlink(missing_ok=True)
                rt.run(['systemctl', 'daemon-reload'])
            print('PASS: update timer, doctor repair, scoped purge, real containers, Caddy TLS, owner login, MCP auth, recreation persistence, backup, private personal route and cloudflared binary.')
        finally:
            if path.exists():
                rt.compose(path, 'logs', '--tail', '30')
                rt.compose(path, 'down', '--remove-orphans', '--volumes')

if __name__ == '__main__':
    main()
