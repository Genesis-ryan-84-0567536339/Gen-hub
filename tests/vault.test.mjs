import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fixture } from './helpers.mjs';
import { openStore } from '../server/store.mjs';
import { vaultService } from '../server/vault.mjs';

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
async function agent(x, name, permissions = []) {
  const r = await x.call('/api/agents', 'POST', { name, permissions });
  assert.equal(r.status, 201);
  return r.data;
}
async function secret(x, name, value, extra = {}) {
  const r = await x.call('/api/vault', 'POST', { name, secret: value, ...extra });
  assert.equal(r.status, 201);
  assert(!('secret' in r.data));
  return r.data;
}

test('Vault is private, individually granted, encrypted, auditable, and cannot be written through normal MCP', async t => {
  const x = await fixture(t);
  const value = ' arbitrary-secret-with-newline\nkeep whitespace ';
  const a = await agent(x, 'reader');
  const s = await secret(x, 'Script key', value);
  const other = await secret(x, 'Other key', 'unshared-key');
  assert.deepEqual((await rpc(x, a.token, 'tools/list')).data.result.tools, []);
  assert((await invoke(x, a.token, 'vault__' + s.id)).data.error);
  for (const permission of ['vault:*', 'vault', 'vault:' + s.id + ':extra', 'vault:missing'])
    assert.equal(
      (await x.call('/api/agents/' + a.id, 'PATCH', { permissions: [permission] })).status,
      400
    );
  await x.call('/api/agents/' + a.id, 'PATCH', { permissions: ['vault:' + s.id] });
  assert.deepEqual(
    (await rpc(x, a.token, 'tools/list')).data.result.tools.map(t => t.name),
    ['vault__' + s.id]
  );
  assert.equal(output(await invoke(x, a.token, 'vault__' + s.id)).secret, value);
  assert((await invoke(x, a.token, 'vault__' + other.id)).data.error);
  assert.equal(
    (await invoke(x, a.token, 'vault__' + s.id, { id: other.id, secret: value })).data.result
      .isError,
    true
  );
  assert(
    (await invoke(x, a.token, 'vault_create', { name: 'backdoor', secret: value })).data.error
  );
  assert.equal(
    (
      await x.call(
        '/api/vault',
        'POST',
        { name: 'backdoor', secret: value },
        { Cookie: '', Authorization: 'Bearer ' + a.token }
      )
    ).status,
    401
  );
  assert.equal((await x.call('/api/vault/' + s.id + '/read')).status, 404);
  assert.equal(
    (await x.call('/api/vault/' + s.id + '/read', 'POST', {}, { 'X-CSRF-Token': '' })).status,
    403
  );
  assert.equal((await x.call('/api/vault/' + s.id + '/read', 'POST')).data.secret, value);
  const state = (await x.call('/api/state')).data;
  assert.equal(state.agents[0].effective, 1);
  assert(!JSON.stringify(state).includes(value.trim()));
  assert(!JSON.stringify(x.hub.store.list('vault')).includes(value.trim()));
  for (const file of ['hub.db', 'hub.db-wal'])
    assert(!readFileSync(join(x.dir, file)).includes(value));
  assert(
    x.hub.store
      .logs()
      .some(
        l =>
          l.tool === 'vault.read' &&
          l.actor === a.id &&
          l.input.id === s.id &&
          l.status === 'success'
      )
  );
  assert(!JSON.stringify(x.hub.store.logs()).includes('arbitrary-secret-with-newline'));
  const reopened = openStore(x.dir);
  assert.equal(vaultService(reopened).read(s.id, 'owner').secret, value);
  reopened.close();
  await x.call('/api/agents/' + a.id, 'PATCH', { permissions: [] });
  assert((await invoke(x, a.token, 'vault__' + s.id)).data.error);
  await x.call('/api/agents/' + a.id, 'PATCH', {
    permissions: ['vault:' + s.id],
    status: 'revoked'
  });
  assert.equal((await invoke(x, a.token, 'vault__' + s.id)).status, 401);
});

test('sharing is an explicit snapshot, is atomic on invalid selection, and preserves unrelated grants', async t => {
  const x = await fixture(t);
  const a = await agent(x, 'A'),
    b = await agent(x, 'B');
  const one = await secret(x, 'One', 'value-one', { sharing: 'selected', agents: [a.id] });
  const two = await secret(x, 'Two', 'value-two');
  const share = body => x.call('/api/vault/' + two.id + '/grants', 'POST', body);
  assert.equal((await share({ sharing: 'selected', agents: [a.id, 'missing'] })).status, 400);
  assert.deepEqual(x.hub.store.get('agent', a.id).permissions, ['vault:' + one.id]);
  assert.equal(
    (
      await x.call('/api/vault', 'POST', {
        name: 'Bad',
        secret: 'not-saved',
        sharing: 'selected',
        agents: ['missing']
      })
    ).status,
    400
  );
  assert.equal(x.hub.store.list('vault').length, 2);
  await share({ sharing: 'all-active' });
  const later = await agent(x, 'Later');
  assert.deepEqual(x.hub.store.get('agent', later.id).permissions, []);
  assert.deepEqual(
    x.hub.store.get('agent', a.id).permissions.sort(),
    ['vault:' + one.id, 'vault:' + two.id].sort()
  );
  assert.deepEqual(x.hub.store.get('agent', b.id).permissions, ['vault:' + two.id]);
  assert(
    x.hub.store
      .logs()
      .some(l => l.tool === 'vault.share_all' && l.actor === 'owner' && l.input.agents.length === 2)
  );
  await share({ sharing: 'private' });
  assert.deepEqual(x.hub.store.get('agent', a.id).permissions, ['vault:' + one.id]);
  assert.deepEqual(x.hub.store.get('agent', b.id).permissions, []);
  const rename = await x.call('/api/vault/' + one.id, 'PATCH', { name: 'Renamed' });
  assert.equal(rename.data.name, 'Renamed');
  assert.equal((await x.call('/api/vault/' + one.id + '/read', 'POST')).data.secret, 'value-one');
  await x.call('/api/vault/' + one.id, 'PATCH', { secret: 'value-replaced' });
  assert.equal(output(await invoke(x, a.token, 'vault__' + one.id)).secret, 'value-replaced');
  await x.call('/api/security/pin', 'POST', { password: 'owner-password-123', pin: '8492' });
  assert.equal((await x.call('/api/vault/' + one.id, 'DELETE', { pin: '8492' })).status, 200);
  assert.deepEqual(x.hub.store.get('agent', a.id).permissions, []);
  assert((await invoke(x, a.token, 'vault__' + one.id)).data.error);
  assert(x.hub.store.logs().some(l => l.tool === 'vault.read' && l.input.id === one.id));
});

test('OAuth consent can grant one Vault secret without exposing the rest of the Vault', async t => {
  const x = await fixture(t);
  const s = await secret(x, 'OAuth key', 'oauth-secret-value');
  await secret(x, 'Private key', 'another-secret');
  const client = (
    await x.call('/oauth/register', 'POST', {
      client_name: 'OAuth reader',
      redirect_uris: ['http://127.0.0.1:1234/callback']
    })
  ).data;
  const verifier = 'x'.repeat(43);
  const params = {
    client_id: client.client_id,
    redirect_uri: client.redirect_uris[0],
    response_type: 'code',
    resource: x.origin + '/mcp',
    code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(verifier).digest('base64url')
  };
  const response = await x.call('/oauth/authorize?' + new URLSearchParams(params));
  const flow = response.headers.get('location').split('/').at(-1);
  const approved = await x.call('/api/flows/' + flow, 'POST', {
    approve: true,
    permissions: ['vault:' + s.id]
  });
  const code = new URL(approved.data.redirect).searchParams.get('code');
  const exchanged = await x.call('/oauth/token', 'POST', {
    ...params,
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier
  });
  assert.equal(exchanged.status, 200);
  assert.deepEqual(
    (await rpc(x, exchanged.data.access_token, 'tools/list')).data.result.tools.map(t => t.name),
    ['vault__' + s.id]
  );
  assert.equal(
    output(await invoke(x, exchanged.data.access_token, 'vault__' + s.id)).secret,
    'oauth-secret-value'
  );
});

test('admin Vault tools reuse owner operations without ever logging secret values, including failures', async t => {
  const x = await fixture(t);
  const admin = (await x.call('/api/admin-assistant', 'POST', { password: 'owner-password-123' }))
    .data;
  const call = (name, args) => invoke(x, admin.token, name, args, true);
  const s = output(
    await call('vault_create', { name: 'Admin key', secret: 'admin-vault-credential' })
  );
  assert.equal(output(await call('vault_read', { id: s.id })).secret, 'admin-vault-credential');
  assert.equal(
    (await call('vault_update', { id: s.id, name: '', secret: 'failed-update-credential' })).data
      .result.isError,
    true
  );
  await call('vault_update', { id: s.id, secret: 'replacement-vault-credential' });
  const a = await agent(x, 'reader');
  await call('vault_share', { id: s.id, sharing: 'selected', agents: [a.id] });
  assert.equal(
    output(await invoke(x, a.token, 'vault__' + s.id)).secret,
    'replacement-vault-credential'
  );
  await call('vault_list', {});
  await call('hub_state', {});
  await call('audit_list', {});
  const logs = x.hub.store.logs();
  for (const value of [
    'admin-vault-credential',
    'replacement-vault-credential',
    'failed-update-credential'
  ])
    assert(!JSON.stringify(logs).includes(value));
  assert(logs.some(l => l.actor === 'admin-assistant:' + admin.id && l.tool === 'vault.read'));
});

test('destructive PIN gates web and admin, is hash-only, rate limited across targets, and reset only by owner step-up', async t => {
  const x = await fixture(t);
  const s = await secret(x, 'Delete me', 'delete-credential');
  const m = (await x.call('/api/mcps', 'POST', { provider: 'github' })).data;
  const a = await agent(x, 'Revoked');
  await x.call('/api/agents/' + a.id, 'PATCH', { status: 'revoked' });
  const admin = (await x.call('/api/admin-assistant', 'POST', { password: 'owner-password-123' }))
    .data;
  assert.equal((await x.call('/api/vault/' + s.id, 'DELETE')).status, 403);
  assert.equal(
    (await x.call('/api/security/pin', 'POST', { password: 'wrong', pin: '8492' })).status,
    403
  );
  assert.equal(
    (
      await x.call(
        '/api/security/pin',
        'POST',
        { password: 'owner-password-123', pin: '8492' },
        { 'X-CSRF-Token': '' }
      )
    ).status,
    403
  );
  assert.equal(
    (await x.call('/api/security/pin', 'POST', { password: 'owner-password-123', pin: '8492' }))
      .status,
    200
  );
  assert(!('pin' in x.hub.store.get('security', 'pin')));
  assert.notEqual(x.hub.store.get('security', 'pin').hash, '8492');
  assert.equal((await x.call('/api/state')).data.security.pinConfigured, true);
  const methods = [
    ['/api/agents/' + a.id, 'DELETE'],
    ['/api/mcps/' + m.id, 'DELETE'],
    ['/api/mcps/' + m.id + '/disconnect', 'POST'],
    ['/api/vault/' + s.id, 'DELETE']
  ];
  for (const [path, method] of methods)
    assert.equal((await x.call(path, method, { pin: '1234' })).status, 403);
  const refused = await invoke(x, admin.token, 'connector_remove', { id: m.id, pin: '1234' }, true);
  assert.equal(refused.data.result.isError, true);
  // Correct PIN is also blocked once the shared failure budget is exhausted.
  assert.equal((await x.call('/api/vault/' + s.id, 'DELETE', { pin: '8492' })).status, 429);
  assert(
    x.hub.store.get('vault', s.id) && x.hub.store.get('mcp', m.id) && x.hub.store.get('agent', a.id)
  );
  assert(
    (
      await invoke(
        x,
        admin.token,
        'security_pin_set',
        { password: 'owner-password-123', pin: '7777' },
        true
      )
    ).data.error
  );
  assert.equal(
    (await x.call('/api/security/pin', 'POST', { password: 'owner-password-123', pin: '5738' }))
      .status,
    200
  );
  for (const [name, id] of [
    ['agent_remove', a.id],
    ['connector_disconnect', m.id],
    ['connector_remove', m.id],
    ['vault_remove', s.id]
  ]) {
    assert.equal((await invoke(x, admin.token, name, { id }, true)).data.result.isError, true);
    assert.equal(
      (await invoke(x, admin.token, name, { id, pin: '5738' }, true)).data.result.isError,
      false
    );
  }
  const logs = x.hub.store.logs();
  assert(logs.some(l => l.tool === 'security.pin_check' && l.status === 'denied'));
  for (const log of logs) {
    if (log.input?.pin) assert.equal(log.input.pin, '[REDACTED]');
    assert(!JSON.stringify(log).includes('owner-password-123'));
  }
  assert(!x.hub.store.get('vault', s.id));
});
