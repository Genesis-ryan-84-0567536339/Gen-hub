"""Install official Docker packages without removing conflicting host software."""
import json
import pathlib
import re
import shutil
import subprocess
import urllib.request
from runtime import DOCKER, run, atomic


def ensure_docker():
    present = bool(shutil.which('docker'))
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
    if subprocess.run([*DOCKER, 'info'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
        run(['systemctl', 'start', 'docker'])
    run(['systemctl', 'enable', 'docker'], stdout=subprocess.DEVNULL)
    info = json.loads(run([*DOCKER, 'info', '--format', '{{json .}}'], capture_output=True).stdout)
    if info.get('OSType') != 'linux':
        raise RuntimeError('Cần Docker Engine Linux trên máy cài đặt.')
    version = run([*DOCKER, 'compose', 'version', '--short'], capture_output=True).stdout.strip()
    numbers = re.search(r'(\d+)\.(\d+)', version)
    if not numbers or tuple(map(int, numbers.groups())) < (2, 20):
        raise RuntimeError('Cần Docker Compose >=2.20. Hãy cập nhật plugin Docker Compose.')
    root = pathlib.Path(info.get('DockerRootDir', '/var/lib/docker'))
    if shutil.disk_usage(root).free < 2 * 1024**3:
        raise RuntimeError('Cần ít nhất 2 GiB trống tại nơi Docker lưu images.')
    print('✓ Docker Engine và Compose ' + version + ' hoạt động.')
