"""Owner-installed deploy actions. No workflow-writable paths or shell templates."""
import hashlib
import json
import os
import pathlib
import re
import stat
from runtime import atomic

REGISTRY = pathlib.Path('/etc/gen-hub-deploy/actions')
ACTION_ID = re.compile(r'[a-z][a-z0-9-]{0,63}')


def trusted(path, directory=False):
    """Check every ancestor, not just the leaf (reject symlinks and writable parents)."""
    path = pathlib.Path(path)
    if not path.is_absolute():
        raise RuntimeError('Action cần đường dẫn tuyệt đối.')
    for item in [*reversed(path.parents), path]:
        info = item.lstat()
        if stat.S_ISLNK(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise RuntimeError('Action/path phải root-owned, không symlink hoặc group/world-writable.')
    info = path.stat()
    if not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)):
        raise RuntimeError('Sai loại file action.')
    return path


def validate(value):
    keys = {'actionId', 'version', 'repo', 'environments', 'executable', 'sha256', 'timeoutSeconds'}
    if not isinstance(value, dict) or set(value) != keys:
        raise RuntimeError('Schema action không hợp lệ.')
    if not isinstance(value['actionId'], str) or not ACTION_ID.fullmatch(value['actionId']):
        raise RuntimeError('actionId không hợp lệ.')
    if not isinstance(value['version'], str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,64}', value['version']):
        raise RuntimeError('version không hợp lệ.')
    if type(value['repo']) is not int or value['repo'] < 1:
        raise RuntimeError('repo phải là ID Gitea dương.')
    envs = value['environments']
    if not isinstance(envs, list) or not envs or len(envs) > 16 or any(
            not isinstance(e, str) or not ACTION_ID.fullmatch(e) for e in envs):
        raise RuntimeError('environment không hợp lệ.')
    if type(value['timeoutSeconds']) is not int or not 1 <= value['timeoutSeconds'] <= 900:
        raise RuntimeError('Timeout action phải từ 1 đến 900 giây.')
    if not isinstance(value['sha256'], str) or not re.fullmatch('[0-9a-f]{64}', value['sha256']):
        raise RuntimeError('Digest action không hợp lệ.')
    if not isinstance(value['executable'], str) or not re.fullmatch(r'/[A-Za-z0-9_./-]+', value['executable']):
        raise RuntimeError('Đường dẫn executable không hợp lệ.')
    if '..' in pathlib.PurePath(value['executable']).parts:
        raise RuntimeError('Không chấp nhận traversal.')
    return value


def load(action_id):
    if not isinstance(action_id, str) or not ACTION_ID.fullmatch(action_id):
        raise RuntimeError('actionId không hợp lệ.')
    entry = trusted(REGISTRY / (action_id + '.json'))
    value = validate(json.loads(entry.read_text()))
    executable = trusted(value['executable'])
    if value['actionId'] != action_id or not executable.stat().st_mode & 0o111:
        raise RuntimeError('Action không khớp hoặc không thực thi được.')
    if hashlib.sha256(executable.read_bytes()).hexdigest() != value['sha256']:
        raise RuntimeError('Action đã đổi; owner cần đăng ký version/digest mới.')
    return value


def register(source):
    if os.geteuid() != 0:
        raise RuntimeError('Chỉ owner qua CLI root được đăng ký action.')
    value = validate(json.loads(trusted(source).read_text()))
    executable = trusted(value['executable'])
    if not executable.stat().st_mode & 0o111 or hashlib.sha256(executable.read_bytes()).hexdigest() != value['sha256']:
        raise RuntimeError('Executable/digest action không khớp.')
    REGISTRY.mkdir(parents=True, exist_ok=True, mode=0o755)
    trusted(REGISTRY, directory=True)
    previous = REGISTRY / (value['actionId'] + '.json')
    if previous.exists():
        old = json.loads(trusted(previous).read_text())
        if old != value and old['version'] == value['version']:
            raise RuntimeError('Thay action phải tăng version.')
    atomic(previous, json.dumps(value, indent=2) + '\n', 0o644)
    return value
