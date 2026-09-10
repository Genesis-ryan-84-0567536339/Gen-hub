#!/usr/bin/env python3
"""Small host-side CLI; all application commands execute inside Compose containers."""
import copy
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import time
import re
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
        if state.get('updated_at'):
            print('Cập nhật lúc: ' + state['updated_at'])
        if state.get('last_error'):
            print('Lỗi gần nhất: ' + state['last_error'])
        from gitea import PENDING
        print('Gitea: https://' + state['domain'] + '/gitea/' if state.get('gitea_bootstrapped') else PENDING)
        compose(path, 'ps', '--all'); return
    if command == 'logs':
        compose(path, 'logs', '--tail', '100'); return
    if command == 'doctor' and '--fix' not in sys.argv:
        from install import public_test
        from lifecycle import check_storage
        check_storage(state); verify_local(path, state); public_test(state)
        if admin(path, 'owner-exists').stdout.strip() != 'yes':
            raise RuntimeError('Thiếu owner; cần hoàn tất TUI.')
        from gitea import require_bootstrap
        require_bootstrap(state, path)
        print('✓ Owner và Gitea sẵn sàng.'); return
    if command not in ['gitea-enable', 'restart', 'reset-password', 'backup', 'update', 'rollback', 'uninstall', 'doctor', 'auto-update', 'github-token', 'migrate-ids']:
        print('Lệnh: gitea-enable (bootstrap bắt buộc cho máy cũ) | status | logs | doctor [--fix] [--cloudflare] | restart | reset-password | backup [tệp.tar.gz] | update | github-token | auto-update on/off | rollback | uninstall [--purge] [--cloudflare] | migrate-ids'); return
    if command == 'update':
        from lifecycle import update
        update(state, automatic='--auto' in sys.argv); return
    import fcntl
    lock = open(CONF / 'install.lock', 'w')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    if command == 'gitea-enable':
        from gitea import enable
        enable(state)
        return
    if command == 'github-token':
        try:
            from runtime import manifest
            token = input('GitHub token riêng cho kiểm tra cập nhật (để trống để gỡ): ').strip()
            if token and not re.fullmatch(r'[A-Za-z0-9_.-]{1,1024}', token):
                raise RuntimeError('Định dạng token không hợp lệ.')
            env = CONF / 'update.env'
            previous_token = env.read_text() if env.exists() else None
            previous_compose = path.read_text()
            try:
                if token:
                    atomic(env, 'GENHUB_GITHUB_TOKEN=' + token + '\n')
                else:
                    env.unlink(missing_ok=True)
                release = ROOT / 'releases' / state['revision']
                atomic(path, json.dumps(manifest(state, release, CONF, DATA), indent=2))
                compose(path, 'up', '-d', '--no-build', '--force-recreate', '--wait', '--wait-timeout', '150', 'hub')
                verify_local(path, state)
            except BaseException:
                if previous_token is None:
                    env.unlink(missing_ok=True)
                else:
                    atomic(env, previous_token)
                atomic(path, previous_compose)
                compose(path, 'up', '-d', '--no-build', '--force-recreate', '--wait', '--wait-timeout', '150', 'hub')
                raise
            # CLI reads the same file; app recreation replaces its environment/cache.
            (CONF / 'github-backoff.json').unlink(missing_ok=True)
            print('✓ Đã lưu token cập nhật.' if token else '✓ Đã gỡ token cập nhật.')
            return
        finally:
            lock.close()
    if command == 'auto-update':
        from lifecycle import configure_updates
        choice = sys.argv[2] if len(sys.argv) > 2 else ''
        if choice not in ['on', 'off']:
            raise RuntimeError('Dùng sudo gen-hub auto-update on hoặc off.')
        state['auto_update'] = choice == 'on'
        configure_updates(state)
        atomic(CONF / 'install.json', json.dumps(state, indent=2)); return
    if command == 'doctor':
        from lifecycle import repair
        repair(state, cloudflare='--cloudflare' in sys.argv); return
    if command == 'restart':
        from gitea import check_volumes, require_bootstrap
        check_volumes(state, required=True)
        compose(path, 'restart')
        compose(path, 'up', '-d', '--wait', '--wait-timeout', '150', '--no-build')
        verify_local(path, state); require_bootstrap(state, path); return
    if command == 'reset-password':
        password = input('Mật khẩu owner mới (12–256 ký tự): ')
        if password != input('Nhập lại mật khẩu: '):
            raise RuntimeError('Mật khẩu không khớp.')
        admin(path, 'reset-password', {'password': password})
        print('✓ Mật khẩu đã đổi; các phiên owner cũ đã bị thu hồi.'); return
    if command == 'migrate-ids':
        res = admin(path, 'migrate-ids')
        if res.stdout:
            sys.stdout.write(res.stdout)
        if res.stderr:
            sys.stderr.write(res.stderr)
        if res.returncode != 0:
            sys.exit(res.returncode)
        return
    if command == 'backup':
        target = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else '/root/gen-hub-backup-' + time.strftime('%Y%m%d-%H%M%S') + '.tar.gz').resolve()
        backup(path, target); return
    if command == 'rollback':
        previous = CONF / 'previous-compose.json'
        if not previous.exists():
            raise RuntimeError('Chưa có bản Compose trước để quay lại.')
        from gitea import guard_transition
        guard_transition(json.loads(path.read_text()), json.loads(previous.read_text()))
        if input('Quay lại runtime trước, giữ database hiện tại? Nhập ROLLBACK: ') != 'ROLLBACK':
            return
        from install import public_test
        target = ROOT / 'backups' / ('before-rollback-' + str(time.time_ns()) + '.tar.gz')
        target.parent.mkdir(exist_ok=True, mode=0o700)
        backup(path, target)
        current = path.read_text()
        current_caddy = (CONF / 'Caddyfile').read_text()
        previous_state = json.loads((CONF / 'previous-install.json').read_text())
        previous_state['auto_update'] = False
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
        from lifecycle import configure_updates
        configure_updates(previous_state)
        print('✓ Đã quay lại runtime trước và kiểm tra HTTPS. Auto-update tạm tắt để giữ bản này.'); return
    if command == 'uninstall':
        from lifecycle import purge, stop_updates
        if '--purge' in sys.argv:
            print('Sẽ xóa vĩnh viễn Gen-hub, Gitea (repo, database, LFS, attachments, config/keys), credentials, chứng chỉ và backup nội bộ trên máy.')
            if '--cloudflare' in sys.argv:
                print('Đồng thời xóa tunnel và DNS Cloudflare cho ' + state['domain'] + '.')
            if input('Nhập DELETE ' + state['domain'] + ' để xác nhận: ') != 'DELETE ' + state['domain']:
                print('Đã hủy gỡ sạch.'); return
            purge(state, remove_cloudflare='--cloudflare' in sys.argv); return
        if '--cloudflare' in sys.argv:
            raise RuntimeError('--cloudflare cần đi cùng uninstall --purge.')
        if input('Gỡ container Gen-hub và Gitea, giữ dữ liệu/cấu hình/backup? Nhập UNINSTALL: ') != 'UNINSTALL':
            return
        stop_updates()
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
