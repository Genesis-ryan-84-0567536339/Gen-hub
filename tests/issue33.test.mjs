import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
import { openStore } from '../server/store.mjs';

const rpc = (x, token, method, params = {}, admin = false) =>
  x.call(
    admin ? '/mcp/admin' : '/mcp',
    'POST',
    { jsonrpc: '2.0', id: 1, method, params },
    { Cookie: '', 'X-CSRF-Token': '', Authorization: 'Bearer ' + token }
  );
const invoke = (x, token, name, args = {}, admin = false) =>
  rpc(x, token, 'tools/call', { name, arguments: args }, admin);
const output = r => JSON.parse(r.data.result.content[0].text);

test('Issue #33: vault secret notes field persists, trims, validates, and exposes via list/state without encryption', async t => {
  const x = await fixture(t);
  const create = body =>
    x.call('/api/vault', 'POST', { name: 'DB Secret', secret: 'super-secret-123', ...body });

  // 1. Secret without notes defaults to empty string
  const s1 = (await create({})).data;
  assert.equal(s1.notes, '');
  assert(!('secret' in s1));

  // 2. Secret with notes trims whitespace and persists
  const s2 = (
    await create({
      name: 'Prod Token',
      notes: '  Dùng cho backup hàng đêm, hết hạn cuối năm  '
    })
  ).data;
  assert.equal(s2.notes, 'Dùng cho backup hàng đêm, hết hạn cuối năm');

  // Verify DB persistence: notes is stored as plain string, secret is encrypted
  const rawRecord = x.hub.store.get('vault', s2.id);
  assert.equal(rawRecord.notes, 'Dùng cho backup hàng đêm, hết hạn cuối năm');
  assert.equal(typeof rawRecord.secret, 'string');
  assert(!rawRecord.secret.includes('super-secret-123'));

  // Verify list() and state.vault include notes
  const list = (await x.call('/api/vault')).data;
  const inList = list.find(item => item.id === s2.id);
  assert.equal(inList.notes, 'Dùng cho backup hàng đêm, hết hạn cuối năm');

  const state = (await x.call('/api/state')).data;
  const inState = state.vault.find(item => item.id === s2.id);
  assert.equal(inState.notes, 'Dùng cho backup hàng đêm, hết hạn cuối năm');

  // Reading the secret value works normally and does not affect notes
  const read = (await x.call('/api/vault/' + s2.id + '/read', 'POST')).data;
  assert.equal(read.secret, 'super-secret-123');

  // 3. Validation: notes must be a string up to 2000 chars
  for (const bad of [null, 123, {}, ['note'], 'x'.repeat(2001)]) {
    assert.equal((await create({ notes: bad })).status, 400);
    assert.equal(
      (await x.call('/api/vault/' + s2.id, 'PATCH', { notes: bad })).status,
      400
    );
  }

  // 2000 chars exact is allowed
  const exactMax = 'a'.repeat(2000);
  const sMax = (await create({ name: 'Max Note', notes: exactMax })).data;
  assert.equal(sMax.notes, exactMax);

  // 4. Update operations:
  // - updating only notes
  const updateNotes = (
    await x.call('/api/vault/' + s2.id, 'PATCH', { notes: 'Ghi chú đã cập nhật' })
  ).data;
  assert.equal(updateNotes.notes, 'Ghi chú đã cập nhật');
  assert.equal(updateNotes.name, 'Prod Token');

  // - updating only name preserves existing notes
  const updateName = (await x.call('/api/vault/' + s2.id, 'PATCH', { name: 'Prod Token V2' })).data;
  assert.equal(updateName.name, 'Prod Token V2');
  assert.equal(updateName.notes, 'Ghi chú đã cập nhật');

  // - clearing notes with empty/whitespace string
  const clearNotes = (await x.call('/api/vault/' + s2.id, 'PATCH', { notes: '   ' })).data;
  assert.equal(clearNotes.notes, '');

  // Verify restart / reopened store retains updated notes
  await x.call('/api/vault/' + s2.id, 'PATCH', { notes: 'Ghi chú sau restart' });
  const reopened = openStore(x.dir);
  assert.equal(reopened.get('vault', s2.id).notes, 'Ghi chú sau restart');
  reopened.close();

  // 5. Audit: updating notes does not set replaced=true
  const auditLogs = x.hub.store.logs();
  const noteUpdateLog = auditLogs.find(
    l => l.tool === 'vault.update' && l.input.id === s2.id && l.input.replaced === false
  );
  assert(noteUpdateLog, 'Audit log should record vault.update with replaced: false');

  // 6. Admin assistant tools support notes
  const admin = (
    await x.call('/api/admin-assistant', 'POST', { password: 'owner-password-123' })
  ).data;
  const adminCall = (name, args) => invoke(x, admin.token, name, args, true);

  const createdViaAdmin = output(
    await adminCall('vault_create', {
      name: 'Admin Secret',
      secret: 'admin-sec',
      notes: 'Tạo từ admin assistant'
    })
  );
  assert.equal(createdViaAdmin.name, 'Admin Secret');
  assert.equal(createdViaAdmin.notes, 'Tạo từ admin assistant');

  const updatedViaAdmin = output(
    await adminCall('vault_update', {
      id: createdViaAdmin.id,
      notes: 'Admin note updated'
    })
  );
  assert.equal(updatedViaAdmin.notes, 'Admin note updated');

  const listViaAdmin = output(await adminCall('vault_list', {}));
  const foundAdmin = listViaAdmin.find(item => item.id === createdViaAdmin.id);
  assert.equal(foundAdmin.notes, 'Admin note updated');

  // 7. Legacy records without notes field default safely to ''
  x.hub.store.put('vault', 'legacy-id', {
    id: 'legacy-id',
    name: 'Legacy Secret',
    secret: x.hub.store.seal({ secret: 'legacy-val' }),
    created: new Date().toISOString(),
    updated: new Date().toISOString()
  });
  const legacyList = (await x.call('/api/vault')).data;
  const legacyFound = legacyList.find(s => s.id === 'legacy-id');
  assert.equal(legacyFound.notes, '');

  const legacyUpdate = (
    await x.call('/api/vault/legacy-id', 'PATCH', { name: 'Legacy Renamed' })
  ).data;
  assert.equal(legacyUpdate.notes, '');
});
