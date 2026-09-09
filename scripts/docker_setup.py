"""Install official Docker packages without removing conflicting host software."""
import json
import pathlib
import re
import shutil
import subprocess
import urllib.request
from runtime import DOCKER, run, atomic


PODMAN_HELP = (
    'Phát hiện Podman hoặc podman-docker đang cung cấp lệnh/socket docker. '
    'Gen-hub hiện cần Docker Engine Linux + Compose v2, chưa hỗ trợ Podman.\n'
    'Trên Fedora: kiểm tra `rpm -q podman-docker`; nếu đã cài, chạy '
    '`sudo dnf remove podman-docker` và xem danh sách thay đổi trước khi xác nhận. '
    'Sau đó chạy lại install.sh để tự cài Docker Engine + Compose.\n'
    'Nếu docker là alias/wrapper/symlink tự tạo hoặc /var/run/docker.sock trỏ tới Podman, '
    'hãy xử lý cấu hình đó trước. Không cần xóa dữ liệu Podman. '
    'Xem README.md mục Fedora / Podman.'
)


def reject_podman_cli(executable):
    # Detect the shim even when its daemon/socket is unavailable.
    if pathlib.Path(executable).resolve().name in ('podman', 'podman-remote'):
        raise RuntimeError(PODMAN_HELP)
    version = subprocess.run(['docker', '--version'], capture_output=True, text=True)
    if re.search(r'\bpodman\b', version.stdout + version.stderr, re.IGNORECASE):
        raise RuntimeError(PODMAN_HELP)


def probe_info():
    result = subprocess.run([*DOCKER, 'info', '--format', '{{json .}}'],
                            capture_output=True, text=True)
    if result.returncode:
        return None
    try:
        info = json.loads(result.stdout)
    except ValueError as exc:
        raise RuntimeError('Không đọc được JSON từ Docker Engine local.') from exc
    if not isinstance(info, dict):
        raise RuntimeError('Docker info phải trả về một JSON object.')
    if 'host' in info and ('store' in info or 'version' in info):
        raise RuntimeError(PODMAN_HELP)
    if info.get('OSType') != 'linux':
        raise RuntimeError('Cần Docker Engine Linux trên máy cài đặt (OSType=linux).')
    return info


def ensure_docker():
    executable = shutil.which('docker')
    present = bool(executable)
    info = None
    if present:
        reject_podman_cli(executable)
        # Validate before package installation or touching docker.service.
        info = probe_info()
    compose_ok = present and subprocess.run([*DOCKER, 'compose', 'version'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
    if not present or not compose_ok:
        os_info = {}
        for line in pathlib.Path('/etc/os-release').read_text().splitlines():
            if '=' in line:
                key, value = line.split('=', 1)
                os_info[key] = value.strip('"')
        distro = os_info.get('ID')
        packages = ['docker-buildx-plugin', 'docker-compose-plugin']
        if not present:
            packages = ['docker-ce', 'docker-ce-cli', 'containerd.io'] + packages
        if distro in ('ubuntu', 'debian'):
            codename = os_info.get('VERSION_CODENAME', '')
            if not re.fullmatch('[a-z]+', codename):
                raise RuntimeError('Không xác định được phiên bản Linux để cài Docker.')
            run(['apt-get', 'update'])
            run(['apt-get', 'install', '-y', 'ca-certificates', 'curl'])
            key = pathlib.Path('/etc/apt/keyrings/gen-hub-docker.asc')
            with urllib.request.urlopen(f'https://download.docker.com/linux/{distro}/gpg', timeout=30) as response:
                atomic(key, response.read().decode(), 0o644)
            arch = run(['dpkg', '--print-architecture'], capture_output=True).stdout.strip()
            source = f'Types: deb\nURIs: https://download.docker.com/linux/{distro}\nSuites: {codename}\nComponents: stable\nArchitectures: {arch}\nSigned-By: {key}\n'
            # Reuse an official repository already configured by the administrator.
            configured = any('download.docker.com/linux/' + distro in p.read_text(errors='ignore') for p in pathlib.Path('/etc/apt/sources.list.d').glob('*') if p.is_file())
            if not configured:
                atomic('/etc/apt/sources.list.d/gen-hub-docker.sources', source, 0o644)
            run(['apt-get', 'update'])
            run(['apt-get', 'install', '-y', *packages])
        elif distro == 'fedora':
            with urllib.request.urlopen('https://download.docker.com/linux/fedora/docker-ce.repo', timeout=30) as response:
                repo = response.read().decode()
            configured = any('download.docker.com/linux/fedora' in p.read_text(errors='ignore') for p in pathlib.Path('/etc/yum.repos.d').glob('*.repo'))
            if not configured:
                atomic('/etc/yum.repos.d/gen-hub-docker.repo', repo, 0o644)
            run(['dnf', 'install', '-y', *packages])
        else:
            raise RuntimeError('Tự cài Docker hỗ trợ Ubuntu/Debian/Fedora. Hãy cài Docker Engine + Compose trước trên distro này.')
        reject_podman_cli(shutil.which('docker') or 'docker')
        info = probe_info()
    if info is None:
        run(['systemctl', 'start', 'docker'])
        info = probe_info()
        if info is None:
            raise RuntimeError('Docker Engine chưa phản hồi tại /var/run/docker.sock; kiểm tra `sudo journalctl -u docker`.')
    run(['systemctl', 'enable', 'docker'], stdout=subprocess.DEVNULL)
    version = run([*DOCKER, 'compose', 'version', '--short'], capture_output=True).stdout.strip()
    numbers = re.search(r'(\d+)\.(\d+)', version)
    if not numbers or tuple(map(int, numbers.groups())) < (2, 20):
        raise RuntimeError('Cần Docker Compose >=2.20. Hãy cập nhật plugin Docker Compose.')
    root = pathlib.Path(info.get('DockerRootDir', '/var/lib/docker'))
    if shutil.disk_usage(root).free < 2 * 1024**3:
        raise RuntimeError('Cần ít nhất 2 GiB trống tại nơi Docker lưu images.')
    print('✓ Docker Engine và Compose ' + version + ' hoạt động.')
