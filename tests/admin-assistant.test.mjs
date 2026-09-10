import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fixture } from './helpers.mjs';
import { adminAssistant } from '../server/admin-assistant.mjs';
import { openStore } from '../server/store.mjs';

async function create(x) {
  const r = await x.call('/api/admin-assistant', 'POST', { password: 'owner-password-123' });
  assert.equal(r.status, 201);
  return r.data;
}
const rpc = (x, token, method, params = {}) =>
  x.call(
    '/mcp/admin',
    'POST',
    { jsonrpc: '2.0', id: 1, method, params },
    { Cookie: '', 'X-CSRF-Token': '', Authorization: 'Bearer ' + token }
  );
async function invoke(x, token, name, args = {}) {
  const response = await rpc(x, token, 'tools/call', { name, arguments: args });
  assert.equal(response.status, 200);
  assert.equal(response.data.result.isError, false, JSON.stringify(response.data));
  return JSON.parse(response.data.result.content[0].text);
}

test('admin token requires owner password, is one-time/hash-only, persists, and is isolated from normal auth', async t => {
  const x = await fixture(t);
  assert.equal((await x.call('/api/admin-assistant', 'POST', { password: 'wrong' })).status, 403);
  assert.equal(
    (
      await x.call(
        '/api/admin-assistant',
        'POST',
        { password: 'owner-password-123' },
        { 'X-CSRF-Token': 'wrong' }
      )
    ).status,
    403
  );
  const a = await create(x);
  assert.equal(
    (await x.call('/api/admin-assistant', 'POST', { password: 'owner-password-123' })).status,
    409
  );
  const metadata = (await x.call('/api/admin-assistant')).data;
  assert.equal(metadata.active, true);
  assert(!('token' in metadata) && !('hash' in metadata));
  assert(!JSON.stringify((await x.call('/api/state')).data).includes(a.token));
  assert(!readFileSync(join(x.dir, 'hub.db')).includes(a.token));
  assert(!JSON.stringify(x.hub.store.list('admin-assistant')).includes(a.token));
  assert.equal(x.hub.store.get('admin-assistant', 'main').expires, undefined);
  const reopened = openStore(x.dir);
  const restored = adminAssistant(reopened, x.origin, () => {});
  assert.equal(
    restored.authenticate({ headers: { authorization: 'Bearer ' + a.token } }),
    'admin-assistant:' + a.id
  );
  reopened.close();
  const normal = (await x.call('/api/agents', 'POST', { name: 'normal', permissions: [] })).data;
  assert.equal((await rpc(x, normal.token, 'tools/list')).status, 401);
  assert.equal(
    (await x.call('/mcp/admin', 'POST', { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status,
    401
  );
  assert.equal(
    (
      await x.call('/api/state', 'GET', undefined, {
        Cookie: '',
        Authorization: 'Bearer ' + a.token
      })
    ).status,
    401
  );
  assert.equal(
    (
      await x.call(
        '/mcp',
        'POST',
        { jsonrpc: '2.0', id: 1, method: 'tools/list' },
        { Authorization: 'Bearer ' + a.token }
      )
    ).status,
    401
  );
  assert.equal((await x.call('/.well-known/oauth-protected-resource/mcp/admin')).status, 404);
  assert.equal(
    (await rpc(x, a.token, 'initialize', { protocolVersion: '2025-06-18' })).data.result.serverInfo
      .name,
    'gen-hub-admin'
  );
  const definitions = (await rpc(x, a.token, 'tools/list')).data.result.tools;
  assert(definitions.some(d => d.name === 'connector_add'));
  assert(!definitions.some(d => /shell|deploy|file_write|admin_token/.test(d.name)));
  assert.equal(
    (await rpc(x, a.token, 'tools/call', { name: 'shell', arguments: {} })).data.error.code,
    -32602
  );
  assert.equal((await x.call('/api/admin-assistant', 'DELETE')).data.active, false);
  assert.equal((await rpc(x, a.token, 'tools/list')).status, 401);
  assert.equal(
    (
      await x.call(
        '/mcp',
        'POST',
        { jsonrpc: '2.0', id: 1, method: 'tools/list' },
        { Authorization: 'Bearer ' + normal.token }
      )
    ).status,
    200
  );
  const replacement = await create(x);
  assert.notEqual(replacement.token, a.token);
  assert.equal((await rpc(x, a.token, 'tools/list')).status, 401);
});

test('admin tools reuse owner operations, preserve agent policy and attribute success/failure audit without credentials', async t => {
  const x = await fixture(t, {
    sync: async () => [
      {
        name: 'echo',
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: true }
      }
    ],
    call: async () => ({ content: [{ type: 'text', text: 'ok' }] })
  });
  const { token, id } = await create(x);
  assert.equal(
    (await x.call('/api/security/pin', 'POST', { password: 'owner-password-123', pin: '8492' }))
      .status,
    200
  );
  const m = await invoke(x, token, 'connector_add', {
    provider: 'remote',
    name: 'Test',
    url: 'https://example.com/mcp'
  });
  await invoke(x, token, 'connector_set_token', { id: m.id, token: 'private-service-credential' });
  await invoke(x, token, 'connector_update', { id: m.id, published: ['echo'] });
  const agent = await invoke(x, token, 'agent_create', {
    name: 'worker',
    permissions: [m.id + ':echo']
  });
  assert.equal(
    (await invoke(x, token, 'policy_check', { agent: agent.id, mcp: m.id, tool: 'echo' })).allowed,
    true
  );
  await invoke(x, token, 'agent_update', { id: agent.id, name: 'renamed', status: 'revoked' });
  await invoke(x, token, 'agent_remove', { id: agent.id, pin: '8492' });
  await invoke(x, token, 'settings_update', { name: 'Managed by assistant', retention: 7 });
  assert.equal((await x.call('/api/state')).data.settings.name, 'Managed by assistant');
  const bad = await rpc(x, token, 'tools/call', {
    name: 'connector_remove',
    arguments: { id: '../password' }
  });
  assert.equal(bad.data.result.isError, true);
  await invoke(x, token, 'hub_state');
  await invoke(x, token, 'audit_list');
  await invoke(x, token, 'connector_disconnect', { id: m.id, pin: '8492' });
  await invoke(x, token, 'connector_remove', { id: m.id, pin: '8492' });
  const logs = (await x.call('/api/logs')).data;
  assert(logs.some(l => l.actor === 'admin-assistant:' + id && l.tool === 'mcp.add'));
  assert(logs.some(l => l.actor === 'admin-assistant:' + id && l.status === 'error'));
  assert(logs.some(l => l.tool === 'admin.audit_list' && Number.isInteger(l.output.count)));
  for (const secret of [token, agent.token, 'private-service-credential'])
    assert(!JSON.stringify(logs).includes(secret));
});

test('admin OAuth consent keeps its actor and current owner password remains required for password changes', async t => {
  const x = await fixture(t);
  const admin = await create(x);
  const client = (
    await x.call('/oauth/register', 'POST', {
      client_name: 'worker',
      redirect_uris: ['http://127.0.0.1:4321/callback']
    })
  ).data;
  const response = await x.call(
    '/oauth/authorize?' +
      new URLSearchParams({
        client_id: client.client_id,
        redirect_uri: client.redirect_uris[0],
        response_type: 'code',
        resource: x.origin + '/mcp',
        code_challenge_method: 'S256',
        code_challenge: createHash('sha256').update('a'.repeat(43)).digest('base64url')
      })
  );
  const flow = response.headers.get('location').split('/').at(-1);
  await invoke(x, admin.token, 'agent_decide', {
    id: flow,
    approve: true,
    name: 'Named by owner assistant',
    permissions: []
  });
  const logs = x.hub.store.logs();
  assert(logs.some(l => l.tool === 'agent.authorize' && l.actor === 'admin-assistant:' + admin.id));
  assert.equal(
    (
      await rpc(x, admin.token, 'tools/call', {
        name: 'owner_password_change',
        arguments: { current: 'wrong', password: 'new-password-123' }
      })
    ).data.result.isError,
    true
  );
  await invoke(x, admin.token, 'owner_password_change', {
    current: 'owner-password-123',
    password: 'new-password-123'
  });
  assert.equal((await x.call('/api/state')).status, 401);
  assert.equal((await rpc(x, admin.token, 'tools/list')).status, 200);
  assert(!JSON.stringify(x.hub.store.logs()).includes('owner-password-123'));
});
