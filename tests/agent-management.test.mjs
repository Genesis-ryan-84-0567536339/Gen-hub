import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fixture } from './helpers.mjs';
import { connectionGuide } from '../public/connection-guides.js';

test('owner names OAuth agents, renames them and deletes only revoked agents while retaining audit', async t => {
  const x = await fixture(t);
  assert.equal(
    (await x.call('/api/security/pin', 'POST', { password: 'owner-password-123', pin: '8492' }))
      .status,
    200
  );
  const client = (
    await x.call('/oauth/register', 'POST', {
      client_name: 'Duplicate client',
      redirect_uris: ['http://127.0.0.1:1234/callback']
    })
  ).data.client_id;
  const verifier = 'x'.repeat(43);
  const params = {
    client_id: client,
    redirect_uri: 'http://127.0.0.1:1234/callback',
    response_type: 'code',
    resource: x.origin + '/mcp',
    code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(verifier).digest('base64url')
  };
  async function authorize(name) {
    const redirect = await x.call('/oauth/authorize?' + new URLSearchParams(params));
    const flow = redirect.headers.get('location').split('/').at(-1);
    const result = await x.call('/api/flows/' + flow, 'POST', {
      approve: true,
      name,
      permissions: []
    });
    const code = new URL(result.data.redirect).searchParams.get('code');
    return (
      await x.call('/oauth/token', 'POST', {
        ...params,
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier
      })
    ).data;
  }
  const token = await authorize('Laptop cá nhân');
  await authorize('');
  const agents = (await x.call('/api/state')).data.agents;
  assert.deepEqual(agents.map(a => a.name).sort(), ['Duplicate client', 'Laptop cá nhân'].sort());
  const a = agents.find(a => a.name === 'Laptop cá nhân');
  await x.call('/api/agents/' + a.id, 'PATCH', {
    description: 'Agent OAuth trên laptop',
    instructions: 'Hướng dẫn chỉ dành cho laptop'
  });
  const initialized = await x.call(
    '/mcp',
    'POST',
    { jsonrpc: '2.0', id: 1, method: 'initialize' },
    { Authorization: 'Bearer ' + token.access_token }
  );
  assert.ok(initialized.data.result.instructions.endsWith('Hướng dẫn chỉ dành cho laptop'));
  assert.ok(initialized.data.result.instructions.includes('Kết nối nguồn chuẩn'));

  assert.equal((await x.call('/api/agents/' + a.id, 'DELETE')).status, 409);
  for (const name of ['', ' '.repeat(4), 'x'.repeat(81), 12])
    assert.equal((await x.call('/api/agents/' + a.id, 'PATCH', { name })).status, 400);
  assert.equal(
    (await x.call('/api/agents/' + a.id, 'PATCH', { name: ' Máy văn phòng ' })).data.name,
    'Máy văn phòng'
  );
  x.hub.store.audit(a.id, 'hub', 'test.history', 'success', {}, { retained: true });
  assert.equal(
    (await x.call('/api/agents/' + a.id, 'DELETE', undefined, { 'X-CSRF-Token': 'wrong' })).status,
    403
  );
  await x.call('/api/agents/' + a.id, 'PATCH', { status: 'revoked' });
  assert.equal((await x.call('/api/agents/' + a.id, 'DELETE', { pin: '8492' })).status, 200);
  assert.equal((await x.call('/api/agents/' + a.id, 'PATCH', { status: 'active' })).status, 404);
  assert.equal(
    (
      await x.call(
        '/mcp',
        'POST',
        { jsonrpc: '2.0', id: 1, method: 'tools/list' },
        {
          Authorization: 'Bearer ' + token.access_token,
          Accept: 'application/json, text/event-stream'
        }
      )
    ).status,
    401
  );
  assert.equal(
    (
      await x.call('/oauth/token', 'POST', {
        grant_type: 'refresh_token',
        client_id: client,
        resource: params.resource,
        refresh_token: token.refresh_token
      })
    ).status,
    400
  );
  const state = (await x.call('/api/state')).data;
  assert.equal(state.agents.length, 1);
  assert(state.logs.some(l => l.actor === a.id && l.tool === 'test.history'));
  assert(state.logs.some(l => l.tool === 'agent.remove' && l.input.name === 'Máy văn phòng'));
});

test('contextual guides match trusted host boundaries and distinguish remote OAuth from API tokens', () => {
  assert.match(connectionGuide('github').recommendation, /Token/);
  assert.match(connectionGuide('drive').recommendation, /OAuth/);
  assert(
    connectionGuide('remote', 'https://api.githubcopilot.com/mcp').links.some(([, link]) =>
      link.includes('personal-access-tokens/new')
    )
  );
  assert.match(
    connectionGuide('remote', 'https://mcp.notion.com/mcp').steps.join(' '),
    /chưa hỗ trợ OAuth/
  );
  assert.equal(connectionGuide('remote', 'https://github.com.evil.example/mcp'), null);
  assert.equal(connectionGuide('remote', 'https://github.com@evil.example/mcp'), null);
  assert.equal(connectionGuide('remote', 'not a URL'), null);
});
