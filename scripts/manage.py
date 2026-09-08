#!/usr/bin/env python3
"""Small host-side CLI; all application commands execute inside Compose containers."""
import copy
import getpass
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import time
import urllib.request
from runtime import ROOT, CONF, DATA, atomic, compose, admin, verify_local, backup, run


def main():
    if os.geteuid() != 0:
        raise RuntimeError('Dùng sudo gen-hub <lệnh>.')
    command = sys.argv[1] if len(sys.argv) > 1 else 'help'
    state = json.loads((CONF / 'install.json').read_text())
    path = CONF / 'compose.json'
    if command == 'status':
        print('Đăng nhập: https://' + state['domain'] + '\nMCP: https://' + state['domain'] + '/mcp')
        print('Revision: ' + state.get('revision', 'đang cài') + '\nBước: ' + state.get('step', ''))
        if state.get('last_error'):
            print('Lỗi gần nhất: ' + state['last_error'])
        compose(path, 'ps', '--all'); return
    if command == 'logs':
        compose(path, 'logs', '--tail', '100'); return
    if command == 'doctor':
        from install import public_test
        verify_local(path, state); public_test(state)
        print('Owner: ' + admin(path, 'owner-exists').stdout.strip()); return
    if command not in ['restart', 'reset-password', 'backup', 'update', 'rollback', 'uninstall']:
        print('Lệnh: status | logs | doctor | restart | reset-password | backup [tệp.tar.gz] | update | rollback | uninstall'); return
    # update delegates to the installer's lock. Other mutations must not race an install.
    if command == 'update':
        with tempfile.TemporaryDirectory() as temp:
            installer = pathlib.Path(temp) / 'install.sh'
            with urllib.request.urlopen('https://raw.githubusercontent.com/Genesis-ryan-84-0567536339/Gen-hub/main/install.sh', timeout=30) as response:
                installer.write_bytes(response.read())
            run(['bash', str(installer)])
        return
    import fcntl
    lock = open(CONF / 'install.lock', 'w')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    if command == 'restart':
        compose(path, 'restart')
        compose(path, 'up', '-d', '--wait', '--wait-timeout', '150', '--no-build')
        verify_local(path, state); return
    if command == 'reset-password':
        password = getpass.getpass('Mật khẩu owner mới (12–256 ký tự): ')
        if password != getpass.getpass('Nhập lại mật khẩu: '):
            raise RuntimeError('Mật khẩu không khớp.')
        admin(path, 'reset-password', {'password': password})
        print('✓ Mật khẩu đã đổi; các phiên owner cũ đã bị thu hồi.'); return
    if command == 'backup':
        target = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else '/root/gen-hub-backup-' + time.strftime('%Y%m%d-%H%M%S') + '.tar.gz').resolve()
        backup(path, target); return
    if command == 'rollback':
        previous = CONF / 'previous-compose.json'
        if not previous.exists():
            raise RuntimeError('Chưa có bản Compose trước để quay lại.')
        if input('Quay lại runtime trước, giữ database hiện tại? Nhập ROLLBACK: ') != 'ROLLBACK':
            return
        from install import public_test
        target = ROOT / 'backups' / ('before-rollback-' + str(time.time_ns()) + '.tar.gz')
        target.parent.mkdir(exist_ok=True, mode=0o700)
        backup(path, target)
        current = path.read_text()
        current_caddy = (CONF / 'Caddyfile').read_text()
        previous_state = json.loads((CONF / 'previous-install.json').read_text())
        # Only schema v1 is currently supported. Never silently downgrade a future database schema.
        import sqlite3
        with sqlite3.connect(f'file:{DATA}/hub.db?mode=ro', uri=True) as db:
            if db.execute('PRAGMA user_version').fetchone()[0] != 1:
                raise RuntimeError('Schema database không tương thích rollback tự động.')
        try:
            atomic(path, previous.read_text())
            atomic(CONF / 'Caddyfile', (CONF / 'previous-Caddyfile').read_text(), 0o644)
            compose(path, 'up', '-d', '--wait', '--wait-timeout', '150', '--remove-orphans', '--no-build', '--force-recreate')
            verify_local(path, previous_state); public_test(previous_state)
        except BaseException:
            atomic(path, current); atomic(CONF / 'Caddyfile', current_caddy, 0o644)
            compose(path, 'up', '-d', '--wait', '--wait-timeout', '150', '--remove-orphans', '--no-build', '--force-recreate')
            raise
        atomic(previous, current)
        atomic(CONF / 'previous-Caddyfile', current_caddy, 0o644)
        atomic(CONF / 'previous-install.json', json.dumps(state, indent=2))
        atomic(CONF / 'install.json', json.dumps(previous_state, indent=2))
        release = ROOT / 'releases' / previous_state['revision']
        link = ROOT / 'current.new'
        link.unlink(missing_ok=True); link.symlink_to(release); os.replace(link, ROOT / 'current')
        atomic('/usr/local/bin/gen-hub', f'#!/usr/bin/env bash\nexec python3 {release}/scripts/manage.py "$@"\n', 0o755)
        print('✓ Đã quay lại runtime trước và kiểm tra HTTPS.'); return
    if command == 'uninstall':
        if input('Gỡ container Gen-hub, giữ dữ liệu/cấu hình/backup? Nhập UNINSTALL: ') != 'UNINSTALL':
            return
        compose(path, 'down', '--remove-orphans')  # Never --volumes or system prune.
        state.update(completed=False, step='Đã gỡ container; giữ dữ liệu để cài lại')
        atomic(CONF / 'install.json', json.dumps(state, indent=2))
        print('Đã gỡ container và network Gen-hub. Giữ dữ liệu, cấu hình, images, source và backup; giữ Docker và tunnel/DNS Cloudflare.'); return

if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, subprocess.CalledProcessError) as error:
        print('Lệnh thất bại. Xem sudo gen-hub status / logs.' if isinstance(error, subprocess.CalledProcessError) else str(error), file=sys.stderr)
        sys.exit(1)
