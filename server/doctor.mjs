import { openStore, id } from './store.mjs';
const store = openStore(process.env.DATA_DIR || '/data');
try {
  if (store.db.prepare('PRAGMA quick_check').get().quick_check !== 'ok')
    throw Error('SQLite integrity failed');
  // Verify existing ciphertext before writing any probe: a different 32-byte key is still the wrong key.
  for (const mcp of store.list('mcp')) if (mcp.secret) store.unseal(mcp.secret);
  store.logs(1);
  const probe = id();
  store.put('doctor', probe, { secret: store.seal({ value: probe }) });
  if (store.unseal(store.get('doctor', probe).secret).value !== probe)
    throw Error('Credential encryption failed');
  store.del('doctor', probe);
  console.log('✓ SQLite đọc/ghi và mã hóa hoạt động.');
} finally {
  store.close();
}
