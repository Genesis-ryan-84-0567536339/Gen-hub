"""Repo-scoped Gitea runner using a separate, resource-bounded rootless Docker.

Only the explicit root CLI calls bootstrap/lifecycle. Importing this module has
no effects. Tests replace run(), API and filesystem roots; never run host setup.
"""
import contextlib
import getpass
import hashlib
import json
import os
import pathlib
import pwd
import re
import shutil
import stat
import subprocess
import urllib.error
import urllib.request
from runtime import atomic, run

USER = 'genhub-ci'
HOME = pathlib.Path('/var/lib/genhub-ci')
CONFIG = pathlib.Path('/etc/genhub-ci')
UNITS = pathlib.Path('/etc/systemd/system')
USER_UNITS = pathlib.Path('/etc/systemd/user')
BIN = pathlib.Path('/usr/local/lib/genhub-ci/gitea-runner')
MOUNT = 'var-lib-genhub\\x2dci-work.mount'
RUNNER = 'genhub-ci-runner.service'
DOCKER = 'genhub-ci-docker.service'
REPO = re.compile(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+')
IMAGE = re.compile(r'[a-z0-9][a-z0-9./:_-]+@sha256:[0-9a-f]{64}')
SUBID_FILES = [pathlib.Path('/etc/subuid'), pathlib.Path('/etc/subgid')]
CGROUP_ROOT = pathlib.Path('/sys/fs/cgroup/user.slice')


def checked_dir(path, mode=0o700):
    from deploy_registry import trusted
    # Intermediate root-owned directories must remain traversable by the CI UID
    # even when the administrator's shell has umask 077.
    if not path.parent.exists():
        checked_dir(path.parent, 0o755)
    if not path.exists():
        path.mkdir(mode=mode)
        path.chmod(mode)
    trusted(path, directory=True)


def read_state():
    if not (CONFIG / 'state.json').exists():
        return None
    from deploy_registry import trusted
    return json.loads(trusted(CONFIG / 'state.json').read_text())


def save(state):
    atomic(CONFIG / 'state.json', json.dumps(state, indent=2) + '\n')


def api(state, suffix, method='GET', body=None):
    """Only a fixed installation origin/repo; never follow credential-bearing redirects."""
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    from deploy_registry import trusted
    token = trusted(CONFIG / 'api-token').read_text().strip()
    url = state['instance'] + '/api/v1/repos/' + state['repo'] + suffix
    request = urllib.request.Request(url, method=method, headers={
        'Authorization': 'token ' + token, 'Accept': 'application/json', 'Content-Type': 'application/json'},
        data=json.dumps(body).encode() if body is not None else b'' if method == 'POST' else None)
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=15) as response:
            data = response.read(1024 * 1024)
            return json.loads(data) if data else None
    except urllib.error.HTTPError as error:
        if method == 'DELETE' and error.code == 404:
            return None  # Idempotent retry after remote deletion succeeded.
        raise RuntimeError(f'Gitea CI API HTTP {error.code}; giữ trạng thái để thử lại.') from None
    except (urllib.error.URLError, ValueError):
        raise RuntimeError('Không truy cập được Gitea CI API; giữ trạng thái để thử lại.') from None


def as_user(state, args, **kwargs):
    # env -i discards Docker contexts, update/Cloudflare tokens and the root HOME.
    return run(['runuser', '-u', USER, '--', 'env', '-i', 'PATH=/usr/local/bin:/usr/bin:/bin',
                'HOME=' + str(HOME), 'XDG_RUNTIME_DIR=/run/user/' + str(state['uid']),
                'DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/' + str(state['uid']) + '/bus',
                'DOCKER_HOST=unix:///run/user/' + str(state['uid']) + '/docker.sock',
                *args], **kwargs)


def userctl(state, *args, **kwargs):
    return as_user(state, ['systemctl', '--user', *args], **kwargs)


def job_directory(state, path):
    path.mkdir(exist_ok=True, mode=0o700)
    # A workspace is writable by CI. Chown an opened directory, never a path
    # that could be swapped to a symlink between lstat and chown.
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fchown(fd, state['uid'], state['gid'])
        os.fchmod(fd, 0o700)
    finally:
        os.close(fd)


def runner_config(image):
    if not isinstance(image, str) or not IMAGE.fullmatch(image):
        raise RuntimeError('CI image phải pin @sha256, không nhận options hoặc host label.')
    # JSON is valid YAML; no interpolated YAML or workflow-controlled config.
    return {
        'log': {'level': 'warn'},
        'runner': {'file': str(HOME / '.runner'), 'capacity': 1, 'timeout': '20m',
                   'shutdown_timeout': '21m', 'env_file': '', 'envs': {},
                   'labels': ['genhub-ci:docker://' + image]},
        'cache': {'enabled': False},
        'container': {'network': '', 'privileged': False, 'valid_volumes': [],
                      'docker_host': '-', 'require_docker': True,
                      'options': '--cpus=2 --memory=2g --memory-swap=2g --pids-limit=256 '
                                 '--cap-drop=ALL --security-opt=no-new-privileges',
                      'force_pull': True},
        'host': {'workdir_parent': str(HOME / 'work/host-disabled')},
    }


def units(uid, gid):
    """Limits on the whole UID include services/sidecars and cannot be raised by jobs."""
    return {
        UNITS / f'user-{uid}.slice.d/50-genhub-ci.conf': '''[Slice]
CPUQuota=200%
MemoryMax=6G
MemorySwapMax=0
TasksMax=512
''',
        UNITS / MOUNT: f'''[Unit]
Description=Gen-hub CI bounded ephemeral workspace (images and job volumes)
Before=user@{uid}.service
[Mount]
What=tmpfs
Where={HOME}/work
Type=tmpfs
Options=rw,nosuid,nodev,size=4G,mode=0700,uid={uid},gid={gid}
[Install]
WantedBy=multi-user.target
''',
        UNITS / f'user@{uid}.service.d/50-genhub-ci.conf': f'''[Unit]
Requires={MOUNT}
After={MOUNT}
[Service]
ProtectSystem=strict
ProtectHome=yes
ProtectProc=invisible
ReadWritePaths={HOME}/work /run/user/{uid}
InaccessiblePaths=-/var/lib/gen-hub -/etc/gen-hub -/etc/gen-hub-deploy -/etc/genhub-ci/api-token -/etc/genhub-ci/state.json -/etc/cloudflared -/root -/opt -/run/docker.sock -/run/containerd
TemporaryFileSystem=/tmp:rw,nosuid,nodev,size=128M /var/tmp:rw,nosuid,nodev,size=128M
# Rootless Docker needs newuidmap/newgidmap; do not set NoNewPrivileges here.
Delegate=yes
''',
        USER_UNITS / DOCKER: f'''[Unit]
Description=Gen-hub CI private rootless Docker (never runtime Docker)
ConditionUser={USER}
[Service]
Type=notify
NotifyAccess=all
Environment=PATH=/usr/local/bin:/usr/bin:/bin
Environment=DOCKERD_ROOTLESS_ROOTLESSKIT_NET=slirp4netns
Environment=DOCKERD_ROOTLESS_ROOTLESSKIT_FLAGS=--disable-host-loopback
ExecStart=/usr/bin/dockerd-rootless.sh --host=unix://%t/docker.sock --data-root={HOME}/work/docker --exec-root=%t/docker --storage-driver=vfs --log-driver=local --log-opt=max-size=5m --log-opt=max-file=2
Restart=on-failure
RestartSec=5
TimeoutStopSec=90
KillMode=mixed
Delegate=yes
LimitNOFILE=65536
[Install]
WantedBy=default.target
''',
        USER_UNITS / RUNNER: f'''[Unit]
Description=Gen-hub repository CI runner
ConditionUser={USER}
Requires={DOCKER}
After={DOCKER}
[Service]
Environment=HOME={HOME}
Environment=DOCKER_HOST=unix://%t/docker.sock
Environment=TMPDIR={HOME}/work/tmp
Environment=XDG_CACHE_HOME={HOME}/work/cache
WorkingDirectory={HOME}/work
ExecStart={BIN} daemon --config {CONFIG}/runner.json
Restart=on-failure
RestartSec=10
# SIGTERM stops fetching, then waits for active jobs up to shutdown_timeout.
KillSignal=SIGTERM
KillMode=mixed
TimeoutStopSec=22min
UMask=0077
NoNewPrivileges=true
[Install]
WantedBy=default.target
''',
    }


def verify_account(state):
    account = pwd.getpwnam(USER)
    if account.pw_uid != state['uid'] or account.pw_gid != state['gid'] or account.pw_dir != str(HOME) or account.pw_shell != '/usr/sbin/nologin':
        raise RuntimeError('User CI không khớp installation; từ chối tiếp tục.')
    if account.pw_uid == 0 or set(os.getgrouplist(USER, account.pw_gid)) != {account.pw_gid}:
        raise RuntimeError('User CI có supplementary group; từ chối sudo/docker/runtime access.')
    # sudo exit 0 means there IS an allowed command, including NOPASSWD rules.
    if shutil.which('sudo'):
        if not shutil.which('visudo'):
            raise RuntimeError('Không xác minh được cú pháp sudo policy (thiếu visudo).')
        run(['visudo', '-c'], capture_output=True)
        result = subprocess.run(['sudo', '-n', '-l', '-U', USER], text=True, capture_output=True)
        if result.returncode != 1:
            raise RuntimeError('User CI có quyền sudo hoặc không xác minh được sudo policy.')


def allocate_subids():
    paths = SUBID_FILES
    ranges = []
    contents = []
    own = []
    for path in paths:
        text = path.read_text() if path.exists() else ''
        contents.append(text)
        found = []
        for line in text.splitlines():
            if not line.strip():
                continue
            name, start, count = line.split(':')
            if name == USER:
                found.append((int(start), int(count)))
            else:
                ranges.append((int(start), int(start) + int(count)))
        if len(found) > 1:
            raise RuntimeError('Subordinate ID CI không duy nhất.')
        own.append(found[0] if found else None)
    # Resume an interrupted pair of writes using the already reserved range.
    reserved = next((entry for entry in own if entry), None)
    start, count = reserved or (231072, 65536)
    if reserved:
        if count != 65536 or any(entry and entry != reserved for entry in own) or any(
                start < end and start + count > begin for begin, end in ranges):
            raise RuntimeError('Subordinate ID CI chồng lấn hoặc bị đổi.')
    else:
        # Also avoid real local accounts when choosing a fresh subordinate range.
        ranges += [(account.pw_uid, account.pw_uid + 1) for account in pwd.getpwall()]
        while any(start < end and start + count > begin for begin, end in ranges):
            start += count
    for path, text, entry in zip(paths, contents, own):
        if entry is None:
            atomic(path, text.rstrip('\n') + '\n' + f'{USER}:{start}:{count}\n', 0o644)


def prerequisite_check():
    if not pathlib.Path('/sys/fs/cgroup/cgroup.controllers').exists():
        raise RuntimeError('CI yêu cầu cgroup v2; không fallback sang Docker runtime.')
    for binary in ['dockerd-rootless.sh', 'rootlesskit', 'slirp4netns', 'newuidmap', 'newgidmap', 'dbus-daemon']:
        if not shutil.which(binary):
            raise RuntimeError('Thiếu prerequisite CI: ' + binary + '. Owner cài rootless Docker prerequisites trước.')
    if not pathlib.Path('/usr/bin/dockerd-rootless.sh').is_file():
        raise RuntimeError('Cần dockerd-rootless.sh tại /usr/bin (package Docker chính thức).')


def bootstrap(installation, repo, binary, digest, image, token):
    from deploy_registry import trusted, REGISTRY
    if os.geteuid() != 0:
        raise RuntimeError('Bootstrap CI chỉ qua owner CLI root.')
    if not isinstance(repo, str) or not REPO.fullmatch(repo) or any(x in ['.', '..'] for x in repo.split('/')):
        raise RuntimeError('Repo cần owner/name cố định.')
    config = runner_config(image)
    source = trusted(binary)
    if not re.fullmatch('[0-9a-f]{64}', digest) or hashlib.sha256(source.read_bytes()).hexdigest() != digest:
        raise RuntimeError('Digest runner binary không khớp.')
    if not token or '\n' in token or '\r' in token:
        raise RuntimeError('Gitea API token không hợp lệ.')
    if not installation.get('gitea_bootstrapped'):
        raise RuntimeError('Cần bootstrap Gitea trước CI.')
    prerequisite_check()
    state = read_state()
    if not state and (CONFIG.exists() or HOME.exists() or BIN.parent.exists() or any(
            p.exists() for p in [UNITS / MOUNT, USER_UNITS / DOCKER, USER_UNITS / RUNNER])):
        raise RuntimeError('Đường dẫn CI có sẵn ngoài installation; không chiếm dụng.')
    checked_dir(CONFIG, 0o755)
    if state:
        if state['installation_id'] != installation['installation_id'] or state['repo'] != repo or state['binary_sha256'] != digest or state['image'] != image:
            raise RuntimeError('CI đã có cấu hình khác; không tự đổi repo/runtime.')
        verify_account(state)
    else:
        try:
            pwd.getpwnam(USER)
        except KeyError:
            pass
        else:
            raise RuntimeError('User genhub-ci có sẵn ngoài installation; không chiếm dụng.')
        if HOME.exists() or BIN.exists():
            raise RuntimeError('Storage/binary CI có sẵn ngoài installation; không chiếm dụng.')
        run(['useradd', '--system', '--user-group', '--no-create-home', '--home-dir', str(HOME),
             '--shell', '/usr/sbin/nologin', USER])
        account = pwd.getpwnam(USER)
        state = {'installation_id': installation['installation_id'], 'repo': repo,
                 'instance': 'https://' + installation['domain'] + '/gitea',
                 'uid': account.pw_uid, 'gid': account.pw_gid, 'binary_sha256': digest,
                 'image': image, 'registered': False, 'phase': 'account-created'}
        save(state)  # Keep ownership record even if a later gate fails.
    verify_account(state)
    allocate_subids()
    checked_dir(HOME, 0o755)
    if not os.path.ismount(HOME / 'work'):
        checked_dir(HOME / 'work')
    checked_dir(BIN.parent, 0o755)
    checked_dir(REGISTRY, 0o755)
    # Root-owned files stay outside job-writable storage. No mutable binary download.
    if not BIN.exists():
        shutil.copyfile(source, BIN)
        BIN.chmod(0o755)
    if hashlib.sha256(trusted(BIN).read_bytes()).hexdigest() != digest:
        raise RuntimeError('Installed runner digest khác cấu hình.')
    version = as_user(state, [str(BIN), '--version'], capture_output=True, timeout=10).stdout.strip()
    if not re.search(r'\bversion v?3\.[0-9]+\.[0-9]+\b', version):
        raise RuntimeError('Bootstrap này yêu cầu Gitea Runner 3.x; không tự dùng act_runner cũ.')
    state['runner_version'] = version
    if state.get('registered'):
        stop(installation)
    atomic(CONFIG / 'api-token', token)
    repository = api(state, '')
    if repository.get('full_name', '').lower() != repo.lower() or not repository.get('permissions', {}).get('admin'):
        raise RuntimeError('CI cần API credential quyền admin đúng repo để đăng ký/deregister.')
    state['repo_id'] = repository['id']
    save(state)
    atomic(CONFIG / 'runner.json', json.dumps(config, indent=2), 0o644)
    for path, content in units(state['uid'], state['gid']).items():
        if path.exists() and trusted(path).read_text() != content:
            raise RuntimeError('Unit CI đã khác cấu hình được quản lý; cần owner kiểm tra: ' + str(path))
        atomic(path, content, 0o644)
    run(['systemctl', 'daemon-reload'])
    run(['systemctl', 'enable', '--now', MOUNT])
    for name in ['tmp', 'cache']:
        job_directory(state, HOME / 'work' / name)
    run(['loginctl', 'enable-linger', USER])
    run(['systemctl', 'start', f'user@{state["uid"]}.service'])
    userctl(state, 'daemon-reload')
    install_user_links()
    userctl(state, 'start', DOCKER)
    info = json.loads(as_user(state, ['docker', 'info', '--format', '{{json .}}'], capture_output=True).stdout)
    if not any('rootless' in x for x in info.get('SecurityOptions', [])) or info.get('CgroupVersion') != '2' or info.get('CgroupDriver') != 'systemd':
        raise RuntimeError('CI Docker phải rootless + systemd cgroup v2; không fallback.')
    verify_runtime(state)
    enable_actions(installation)
    api(state, '', 'PATCH', {'has_actions': True})
    register_runner(state)
    userctl(state, 'start', RUNNER)
    state['phase'] = 'ready'
    save(state)
    print('✓ CI đã đăng ký theo repo ' + repo + '; cần chạy workflow nghiệm thu cách ly.')


def enable_actions(installation):
    from runtime import CONF, compose
    path = CONF / 'compose.json'
    config = json.loads(path.read_text())
    config['services']['gitea']['environment']['GITEA__actions__ENABLED'] = 'true'
    atomic(path, json.dumps(config, indent=2))
    compose(path, 'up', '-d', '--no-build', '--wait', '--wait-timeout', '150', 'gitea')
    installation['gitea_actions_enabled'] = True
    atomic(CONF / 'install.json', json.dumps(installation, indent=2))


def install_user_links():
    # Enabling as genhub-ci would need a writable ~/.config, allowing replacement
    # of trusted services. Root owns the entire per-user unit search path instead.
    wants = HOME / '.config/systemd/user/default.target.wants'
    checked_dir(wants, 0o755)
    for name in [DOCKER, RUNNER]:
        link = wants / name
        if link.is_symlink():
            if os.readlink(link) != str(USER_UNITS / name):
                raise RuntimeError('User unit link không thuộc CI.')
        elif link.exists():
            raise RuntimeError('User unit link bị thay thế.')
        else:
            link.symlink_to(USER_UNITS / name)


def register_runner(state):
    registration = HOME / '.runner'
    if not state.get('registered'):
        # Interactive registration consumes the token from stdin, never argv/env/journal.
        # Use a temporary writable registration file, then move it under root ownership.
        temp = HOME / 'work/registration'
        job_directory(state, temp)
        config = runner_config(state['image'])
        config['runner']['file'] = str(temp / '.runner')
        atomic(CONFIG / 'register.json', json.dumps(config), 0o644)
        if registration.exists():
            from deploy_registry import trusted
            info = json.loads(trusted(registration).read_text())
        elif (temp / '.runner').exists():
            info = read_registration(temp)
        else:
            if state.get('runner_id'):
                api(state, '/actions/runners/' + str(state['runner_id']), 'DELETE')
            token = api(state, '/actions/runners/registration-token', 'POST')['token']
            answers = '\n'.join([state['instance'], token, 'genhub-ci-' + state['installation_id'],
                                 config['runner']['labels'][0], ''])
            try:
                as_user(state, [str(BIN), 'register', '--config', str(CONFIG / 'register.json')],
                        input=answers, capture_output=True, timeout=60, cwd=temp)
            except subprocess.SubprocessError:
                raise RuntimeError('Đăng ký runner thất bại; output credential không đưa vào log.') from None
            info = read_registration(temp)
        if type(info.get('id')) is not int or info['id'] < 1 or info.get('address', '').rstrip('/') != state['instance']:
            raise RuntimeError('Registration result không hợp lệ.')
        state['runner_id'] = info['id']
        save(state)
        remote = api(state, '/actions/runners/' + str(info['id']))
        if remote.get('id') != info['id']:
            raise RuntimeError('Runner không thuộc repo đã chọn.')
        atomic(registration, json.dumps(info), 0o640)
        os.chown(registration, 0, state['gid'])
        # Cleanup as CI, never root-unlink through a CI-writable parent.
        as_user(state, ['rm', '-f', '--', str(temp / '.runner')], capture_output=True)
        (CONFIG / 'register.json').unlink(missing_ok=True)
        state['registered'] = True
        save(state)


def read_registration(directory):
    # Pin the directory fd: neither symlinked parents nor a symlink/hardlink leaf
    # can trick privileged bootstrap into copying an unrelated host secret.
    parent = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        fd = os.open('.runner', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        with os.fdopen(fd) as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > 16384:
                raise RuntimeError('Registration file không hợp lệ.')
            return json.loads(stream.read(16385))
    finally:
        os.close(parent)


def status(installation, doctor=False):
    state = read_state()
    if not state:
        print('CI: chưa bootstrap; không có runner nhận job.')
        return
    if state['installation_id'] != installation['installation_id']:
        raise RuntimeError('CI thuộc installation khác.')
    verify_account(state)
    print('CI repo: ' + state['repo'] + '; bootstrap: ' + state['phase'])
    if not state.get('registered'):
        print('CI: chưa đăng ký / đã deregister.')
        if doctor:
            raise RuntimeError('CI cần hoàn tất bootstrap.')
        return
    remote = api(state, '/actions/runners/' + str(state['runner_id']))
    # Do not infer idle from unreachable/stale runner state.
    print('CI runner ID: ' + str(state['runner_id']) + '; trạng thái Gitea: ' + str(remote.get('status', 'unknown')))
    online = remote.get('status') in ['idle', 'active'] and not remote.get('disabled')
    active = []
    for page in range(1, 101):
        tasks = api(state, f'/actions/jobs?status=in_progress&limit=100&page={page}')
        rows = tasks['jobs']
        active.extend(str(task['id']) for task in rows if task.get('runner_id') == state['runner_id'])
        if len(rows) < 100:
            break
    else:
        raise RuntimeError('Danh sách job vượt giới hạn; trạng thái job chưa xác định.')
    if not online:
        print('CI job hiện tại: chưa xác định (runner offline/disabled hoặc trạng thái lạ).')
    elif not active and remote.get('busy'):
        print('CI job hiện tại: đang bận, Gitea chưa trả ID job (trạng thái có thể đang chuyển).')
    else:
        print('CI job hiện tại: ' + (', '.join(active) if active else 'idle theo Gitea'))
    result = userctl(state, 'is-active', RUNNER, capture_output=True)
    if doctor and (result.stdout.strip() != 'active' or not online):
        raise RuntimeError('CI runner không sẵn sàng.')
    if doctor:
        verify_runtime(state)


def verify_runtime(state):
    """Check effective limits, not only the generated systemd configuration."""
    from deploy_registry import trusted
    if hashlib.sha256(trusted(BIN).read_bytes()).hexdigest() != state['binary_sha256']:
        raise RuntimeError('Runner binary đã đổi.')
    if json.loads(trusted(CONFIG / 'runner.json').read_text()) != runner_config(state['image']):
        raise RuntimeError('Runner config đã đổi.')
    for path, content in units(state['uid'], state['gid']).items():
        if trusted(path).read_text() != content:
            raise RuntimeError('Unit CI đã đổi: ' + str(path))
    info = json.loads(as_user(state, ['docker', 'info', '--format', '{{json .}}'], capture_output=True).stdout)
    if not any('rootless' in x for x in info.get('SecurityOptions', [])) or info.get('CgroupVersion') != '2' or info.get('CgroupDriver') != 'systemd':
        raise RuntimeError('CI Docker không còn rootless/cgroup v2.')
    mount = json.loads(run(['findmnt', '--json', '--mountpoint', str(HOME / 'work'),
                          '--output', 'TARGET,FSTYPE,OPTIONS'], capture_output=True).stdout)['filesystems'][0]
    options = set(mount['options'].split(','))
    # findmnt normally renders the kernel's tmpfs size in KiB.
    if mount['target'] != str(HOME / 'work') or mount['fstype'] != 'tmpfs' or not {'nosuid', 'nodev'} <= options or not any(
            item in options for item in ['size=4194304k', 'size=4G', 'size=4294967296']):
        raise RuntimeError('Workspace CI không có hard limit tmpfs 4 GiB.')
    group = CGROUP_ROOT / f'user-{state["uid"]}.slice'
    cpu = (group / 'cpu.max').read_text().split()
    if cpu[0] == 'max' or int(cpu[0]) > 2 * int(cpu[1]):
        raise RuntimeError('CI thiếu giới hạn CPU thực tế.')
    for name, maximum in [('memory.max', 6 * 1024**3), ('memory.swap.max', 0), ('pids.max', 512)]:
        value = (group / name).read_text().strip()
        if value == 'max' or int(value) > maximum:
            raise RuntimeError('CI thiếu giới hạn cgroup thực tế: ' + name)
    print('✓ CI binary/config, rootless Docker, tmpfs và giới hạn cgroup thực tế khớp.')


def stop(installation):
    state = read_state()
    if not state:
        return None
    if state['installation_id'] != installation['installation_id']:
        raise RuntimeError('CI thuộc installation khác.')
    verify_account(state)
    if not state.get('registered'):
        return state
    print('CI: ngừng nhận job mới; chờ job hiện tại tối đa 21 phút, sau đó hủy.')
    userctl(state, 'stop', RUNNER)
    return state


@contextlib.contextmanager
def drained(installation):
    state = stop(installation)
    # A failed Hub restart leaves CI stopped until the owner checks health.
    yield
    if state and state.get('registered'):
        userctl(state, 'start', RUNNER)


def uninstall(installation, purge=False):
    state = stop(installation)
    if not state:
        return
    if state.get('runner_id'):
        api(state, '/actions/runners/' + str(state['runner_id']), 'DELETE')
        state['registered'] = False
        state.pop('runner_id', None)
        state['phase'] = 'deregistered'
        save(state)
    # API failure above stops cleanup: retain credentials and state for retry.
    try:
        run(['systemctl', 'is-active', '--quiet', f'user@{state["uid"]}.service'], capture_output=True)
    except subprocess.CalledProcessError as error:
        if error.returncode not in [3, 4]:
            raise
    else:
        userctl(state, 'stop', RUNNER, DOCKER)
    for name in [DOCKER, RUNNER]:
        (HOME / '.config/systemd/user/default.target.wants' / name).unlink(missing_ok=True)
    (HOME / '.runner').unlink(missing_ok=True)
    run(['loginctl', 'disable-linger', USER])
    run(['systemctl', 'stop', f'user@{state["uid"]}.service'])
    run(['systemctl', 'disable', '--now', MOUNT])
    if purge:
        from deploy_registry import trusted
        for path in [HOME, CONFIG, BIN.parent]:
            trusted(path, directory=True)
        if os.path.ismount(HOME / 'work'):
            raise RuntimeError('Workspace CI vẫn mount; không purge.')
        for path in units(state['uid'], state['gid']):
            path.unlink(missing_ok=True)
        for path in [HOME, CONFIG, BIN.parent]:
            shutil.rmtree(path)
        run(['userdel', USER])
        run(['systemctl', 'daemon-reload'])
        # Action registry is owner-managed; never purge registered deploy scripts here.


def cli(installation, args):
    import argparse
    parser = argparse.ArgumentParser(prog='gen-hub ci-bootstrap')
    parser.add_argument('--repo', required=True)
    parser.add_argument('--runner-binary', required=True)
    parser.add_argument('--runner-sha256', required=True)
    parser.add_argument('--job-image', required=True)
    options = parser.parse_args(args)
    bootstrap(installation, options.repo, options.runner_binary, options.runner_sha256,
              options.job_image, getpass.getpass('Gitea API token admin đúng repo (không ghi log): '))
