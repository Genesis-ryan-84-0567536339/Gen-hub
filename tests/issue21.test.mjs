import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fixture } from './helpers.mjs';

async function setupOAuthClient(x) {
  const client = (
    await x.call('/oauth/register', 'POST', {
      client_name: 'Admin Client',
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
  return { client, verifier, params };
}

async function authorizeFlow(x, params, flowBody) {
  const redirect = await x.call('/oauth/authorize?' + new URLSearchParams(params));
  const flow = redirect.headers.get('location').split('/').at(-1);
  const result = await x.call('/api/flows/' + flow, 'POST', flowBody);
  return { flow, result };
}

const rpc = (x, path, token, method, params = {}) =>
  x.call(
    path,
    'POST',
    { jsonrpc: '2.0', id: 1, method, params },
    { Cookie: '', 'X-CSRF-Token': '', Authorization: 'Bearer ' + token }
  );

test('Issue #21: Admin Assistant authorization via OAuth consent with password step-up', async t => {
  const x = await fixture(t);
  const { verifier, params } = await setupOAuthClient(x);

  // 1. Consent with isAdmin: true but missing password -> 403
  const { result: failNoPass } = await authorizeFlow(x, params, {
    approve: true,
    name: 'Admin Agent Attempt 1',
    permissions: [],
    isAdmin: true
  });
  assert.equal(failNoPass.status, 403);
  assert.match(failNoPass.data.error, /Mật khẩu/);

  // 2. Consent with isAdmin: true but incorrect password -> 403
  const { result: failWrongPass } = await authorizeFlow(x, params, {
    approve: true,
    name: 'Admin Agent Attempt 2',
    permissions: [],
    isAdmin: true,
    password: 'wrong-password'
  });
  assert.equal(failWrongPass.status, 403);
  assert.match(failWrongPass.data.error, /Mật khẩu/);

  // 3. Consent with isAdmin: true and valid owner password -> 200 and redirect code
  const { result: okConsent } = await authorizeFlow(x, params, {
    approve: true,
    name: 'Admin Assistant OAuth',
    permissions: [],
    isAdmin: true,
    password: 'owner-password-123'
  });
  assert.equal(okConsent.status, 200);
  assert(okConsent.data.redirect);

  const code = new URL(okConsent.data.redirect).searchParams.get('code');
  const tokenData = (
    await x.call('/oauth/token', 'POST', {
      ...params,
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier
    })
  ).data;
  assert(tokenData.access_token);

  // Verify agent record has isAdmin: true in state
  const state = (await x.call('/api/state')).data;
  const adminAgent = state.agents.find(a => a.name === 'Admin Assistant OAuth');
  assert(adminAgent, 'Admin agent should exist');
  assert.equal(adminAgent.isAdmin, true);

  // Verify /api/admin-assistant status reflects active OAuth admin agent
  const adminStatus = (await x.call('/api/admin-assistant')).data;
  assert.equal(adminStatus.active, true);
  assert.equal(adminStatus.adminCount, 1);

  // 4. Admin agent calls /mcp/admin -> succeeds
  const adminInit = await rpc(x, '/mcp/admin', tokenData.access_token, 'initialize');
  assert.equal(adminInit.status, 200);
  assert.equal(adminInit.data.result.serverInfo.name, 'gen-hub-admin');

  const toolsList = await rpc(x, '/mcp/admin', tokenData.access_token, 'tools/list');
  assert.equal(toolsList.status, 200);
  const toolNames = toolsList.data.result.tools.map(t => t.name);
  assert(toolNames.includes('hub_state'));
  assert(toolNames.includes('agent_create'));
  assert(toolNames.includes('audit_list'));

  // Call an admin tool and check audit attribution
  const callResult = await rpc(x, '/mcp/admin', tokenData.access_token, 'tools/call', {
    name: 'hub_state',
    arguments: {}
  });
  assert.equal(callResult.status, 200);
  assert.equal(callResult.data.result.isError, false);

  const logs = (await x.call('/api/logs')).data;
  assert(logs.some(l => l.actor === 'admin-assistant:' + adminAgent.id));
  // verified audit attribution
});

test('Issue #21: Normal agent without isAdmin cannot access /mcp/admin and cannot escalate privilege', async t => {
  const x = await fixture(t);
  const { verifier, params } = await setupOAuthClient(x);

  // Create normal agent without isAdmin
  const { result: normalConsent } = await authorizeFlow(x, params, {
    approve: true,
    name: 'Normal Agent',
    permissions: [],
    isAdmin: false
  });
  const normalCode = new URL(normalConsent.data.redirect).searchParams.get('code');
  const normalToken = (
    await x.call('/oauth/token', 'POST', {
      ...params,
      grant_type: 'authorization_code',
      code: normalCode,
      code_verifier: verifier
    })
  ).data;

  // Normal agent calling /mcp/admin -> 401 Unauthorized
  const adminAttempt = await rpc(x, '/mcp/admin', normalToken.access_token, 'initialize');
  assert.equal(adminAttempt.status, 401);
  assert(adminAttempt.headers.get('www-authenticate')?.includes('gen-hub-admin'));

  // Calling /mcp/admin with no token -> 401 Unauthorized with WWW-Authenticate
  const noToken = await x.call('/mcp/admin', 'POST', {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize'
  });
  assert.equal(noToken.status, 401);
  assert(noToken.headers.get('www-authenticate')?.includes('gen-hub-admin'));

  // Privilege escalation attempt 1: Injecting fake "admin" permission in consent
  const { result: fakePermConsent } = await authorizeFlow(x, params, {
    approve: true,
    name: 'Attacker Agent',
    permissions: ['admin:settings_update']
  });
  assert.equal(fakePermConsent.status, 400);
  assert.match(fakePermConsent.data.error, /Tool chưa được công bố/);

  // Privilege escalation attempt 2: Trying to patch isAdmin: true via /api/agents/:id
  const normalAgent = (await x.call('/api/state')).data.agents.find(a => a.name === 'Normal Agent');
  const patchAttempt = await x.call('/api/agents/' + normalAgent.id, 'PATCH', {
    isAdmin: true
  });
  assert.equal(patchAttempt.status, 200);
  assert.equal(patchAttempt.data.isAdmin, undefined);

  // Still cannot access /mcp/admin
  const stillForbidden = await rpc(x, '/mcp/admin', normalToken.access_token, 'initialize');
  assert.equal(stillForbidden.status, 401);

  // Privilege escalation attempt 3: Manual agent creation with isAdmin: true
  const manualAgent = await x.call('/api/agents', 'POST', {
    name: 'Manual Agent',
    permissions: [],
    isAdmin: true
  });
  assert.equal(manualAgent.status, 201);
  assert.equal(manualAgent.data.isAdmin, undefined);
  const manualTokenCall = await rpc(x, '/mcp/admin', manualAgent.data.token, 'initialize');
  assert.equal(manualTokenCall.status, 401);
});

test('Issue #21: Admin agent calling /mcp is strictly isolated from admin tools', async t => {
  const x = await fixture(t);
  const { verifier, params } = await setupOAuthClient(x);

  // Authorize admin agent with no normal permissions
  const { result: okConsent } = await authorizeFlow(x, params, {
    approve: true,
    name: 'Admin Agent For MCP Test',
    permissions: [],
    isAdmin: true,
    password: 'owner-password-123'
  });
  const code = new URL(okConsent.data.redirect).searchParams.get('code');
  const token = (
    await x.call('/oauth/token', 'POST', {
      ...params,
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier
    })
  ).data;

  // Normal /mcp endpoint: tools/list returns NO admin tools
  const mcpTools = await rpc(x, '/mcp', token.access_token, 'tools/list');
  assert.equal(mcpTools.status, 200);
  assert.deepEqual(mcpTools.data.result.tools, []);

  // Calling an admin tool on /mcp fails (rpcError -32602)
  const fakeCall = await rpc(x, '/mcp', token.access_token, 'tools/call', {
    name: 'hub_state',
    arguments: {}
  });
  assert.equal(fakeCall.data.error.code, -32602);
  assert.match(fakeCall.data.error.message, /Tool không khả dụng hoặc chưa được cấp quyền/);
});

test('Issue #21: Revoking admin agent cuts off both /mcp and /mcp/admin immediately', async t => {
  const x = await fixture(t);
  const { verifier, params } = await setupOAuthClient(x);

  const { result: okConsent } = await authorizeFlow(x, params, {
    approve: true,
    name: 'To Be Revoked Admin',
    permissions: [],
    isAdmin: true,
    password: 'owner-password-123'
  });
  const code = new URL(okConsent.data.redirect).searchParams.get('code');
  const token = (
    await x.call('/oauth/token', 'POST', {
      ...params,
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier
    })
  ).data;

  const agent = (await x.call('/api/state')).data.agents.find(a => a.name === 'To Be Revoked Admin');

  // Verify access before revoke
  assert.equal((await rpc(x, '/mcp/admin', token.access_token, 'initialize')).status, 200);

  // Revoke agent via PATCH /api/agents/:id
  const revokeRes = await x.call('/api/agents/' + agent.id, 'PATCH', { status: 'revoked' });
  assert.equal(revokeRes.status, 200);
  assert.equal(revokeRes.data.status, 'revoked');

  // Verify immediate cutoff on /mcp/admin and /mcp
  assert.equal((await rpc(x, '/mcp/admin', token.access_token, 'initialize')).status, 401);
  assert.equal((await rpc(x, '/mcp', token.access_token, 'initialize')).status, 401);
});
