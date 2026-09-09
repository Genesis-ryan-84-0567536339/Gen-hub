import { openStore, passwordHash, id } from './store.mjs';
const store = openStore(process.env.DATA_DIR || './var'),
  cmd = process.argv[2];
try {
  if (cmd === 'owner-exists') {
    process.stdout.write(store.get('owner', 'main') ? 'yes' : 'no');
  } else if (cmd === 'create-owner' || cmd === 'reset-password') {
    let data = '';
    for await (const chunk of process.stdin) {
      data += chunk;
      if (data.length > 8192) throw Error('Input too large');
    }
    const b = JSON.parse(data);
    if (typeof b.password !== 'string' || b.password.length < 12 || b.password.length > 256)
      throw Error('Mật khẩu cần 12–256 ký tự');
    if (cmd === 'create-owner' && store.get('owner', 'main')) throw Error('Owner đã tồn tại');
    const username = b.username || store.get('owner', 'main')?.username;
    if (!/^[\p{L}\p{N}_.@-]{3,80}$/u.test(username || '')) throw Error('Tên owner không hợp lệ');
    store.put('owner', 'main', {
      username,
      password: passwordHash(b.password),
      created: new Date().toISOString()
    });
    for (const s of store.list('session')) store.del('session', s.id);
    console.log('Owner đã được lưu.');
  } else if (cmd === 'backup') {
    const path = process.argv[3];
    if (!path) throw Error('Thiếu đường dẫn');
    store.db.exec("VACUUM INTO '" + path.replaceAll("'", "''") + "'");
    console.log('Đã sao lưu cơ sở dữ liệu; cần giữ master.key cùng bản sao lưu.');
  } else throw Error('Lệnh: owner-exists, create-owner, reset-password, backup');
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  store.close();
}
