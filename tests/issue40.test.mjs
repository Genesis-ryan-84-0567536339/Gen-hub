import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { id, prefixedId, openStore } from '../server/store.mjs';
import { fixture } from './helpers.mjs';

test('Issue #40: id() and prefixedId() generate type-prefixed IDs with high entropy and no double underscores', () => {
  assert.equal(typeof id(), 'string');
  assert.equal(id().length, 24);
  assert.equal(prefixedId, id);

  for (const type of ['agent', 'vault', 'mcp', 'flow', 'token', 'client', 'code', 'admin', 'doctor']) {
    for (let i = 0; i < 50; i++) {
      const generated = id(type);
      assert(
        generated.startsWith(type + '_'),
        `Expected ${generated} to start with ${type}_`
      );
      assert.equal(generated.length, type.length + 1 + 24);
      assert(
        /^[a-z]+_[A-Za-z0-9_-]{24}$/.test(generated),
        `Generated ID ${generated} should match standard prefixed format`
      );
      // Double underscore must never occur anywhere in the ID
      assert(!generated.includes('__'), `ID ${generated} must not contain double underscore`);
    }
  }
});

test('Issue #40: real Hub entities (agent, mcp, vault, OAuth, admin) are created with correct type prefixes', async t => {
  const x = await fixture(t);

  // 1. MCP connector creation
  const mcpRes = await x.call('/api/mcps', 'POST', {
    provider: 'remote',
    name: 'Custom Service',
    url: 'https://example.com/mcp',
    auth: 'none'
  });
  assert.equal(mcpRes.status, 201);
  const mid = mcpRes.data.id;
  assert.match(mid, /^mcp_[A-Za-z0-9_-]{24}$/);

  // 2. Vault secret creation
  const vaultRes = await x.call('/api/vault', 'POST', {
    name: 'API Key',
    secret: 'super-secret-value',
    sharing: 'private'
  });
  assert.equal(vaultRes.status, 201);
  const vid = vaultRes.data.id;
  assert.match(vid, /^vault_[A-Za-z0-9_-]{24}$/);

  // 3. Agent creation
  const agentRes = await x.call('/api/agents', 'POST', {
    name: 'Test Agent',
    permissions: []
  });
  assert.equal(agentRes.status, 201);
  const aid = agentRes.data.id;
  assert.match(aid, /^agent_[A-Za-z0-9_-]{24}$/);
  assert.match(agentRes.data.token, /^token_[A-Za-z0-9_-]{48}$/);

  // 4. OAuth Client Registration
  const clientRes = await x.call('/oauth/register', 'POST', {
    client_name: 'Test Client',
    redirect_uris: ['http://127.0.0.1:9999/cb'],
    token_endpoint_auth_method: 'none'
  });
  assert.equal(clientRes.status, 201);
  const cid = clientRes.data.client_id;
  assert.match(cid, /^client_[A-Za-z0-9_-]{24}$/);

  // 5. OAuth Flow Authorization
  const verifier = 'v'.repeat(43);
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const authQuery = new URLSearchParams({
    client_id: cid,
    redirect_uri: 'http://127.0.0.1:9999/cb',
    response_type: 'code',
    resource: x.origin + '/mcp',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 's123'
  });
  const authRedirect = await x.call('/oauth/authorize?' + authQuery);
  assert.equal(authRedirect.status, 302);
  const fid = authRedirect.headers.get('location').split('/').at(-1);
  assert.match(fid, /^flow_[A-Za-z0-9_-]{24}$/);

  // 6. OAuth Consent -> Code -> Token Exchange
  const consentRes = await x.call('/api/flows/' + fid, 'POST', {
    approve: true,
    permissions: []
  });
  assert.equal(consentRes.status, 200);
  const redirectUrl = new URL(consentRes.data.redirect);
  const code = redirectUrl.searchParams.get('code');
  assert.match(code, /^code_[A-Za-z0-9_-]{48}$/);

  const tokenRes = await x.call('/oauth/token', 'POST', {
    grant_type: 'authorization_code',
    client_id: cid,
    redirect_uri: 'http://127.0.0.1:9999/cb',
    resource: x.origin + '/mcp',
    code,
    code_verifier: verifier
  });
  assert.equal(tokenRes.status, 200);
  assert.match(tokenRes.data.access_token, /^token_[A-Za-z0-9_-]{48}$/);
  assert.match(tokenRes.data.refresh_token, /^refresh_[A-Za-z0-9_-]{48}$/);

  // 7. Admin Assistant creation
  const adminRes = await x.call('/api/admin-assistant', 'POST', {
    password: 'owner-password-123'
  });
  assert.equal(adminRes.status, 201);
  assert.match(adminRes.data.id, /^admin_[A-Za-z0-9_-]{24}$/);
  assert.match(adminRes.data.token, /^gh_admin_[A-Za-z0-9_-]{48}$/);

  // Verify all entity IDs pass admin tool id validation regex /^[A-Za-z0-9_-]{1,100}$/
  for (const entityId of [mid, vid, aid, cid, fid, adminRes.data.id]) {
    assert(
      /^[A-Za-z0-9_-]{1,100}$/.test(entityId),
      `Entity ID ${entityId} must pass admin-assistant schema validation`
    );
  }
});

test('Issue #40: legacy un-prefixed IDs remain 100% operational without data migration', async t => {
  const x = await fixture(t);

  // Inject legacy un-prefixed records directly into the store
  const legacyAgentId = '9vGsKpIg';
  const legacyMcpId = '4936494689d1eb1b6be2cabf';
  const legacyVaultId = 'legacyVaultSecretId123';

  x.hub.store.put('mcp', legacyMcpId, {
    id: legacyMcpId,
    name: 'Legacy MCP',
    provider: 'remote',
    description: 'Legacy service',
    on: true,
    status: 'connected',
    tools: [{ name: 'read', description: 'Read data', published: true, inputSchema: { type: 'object', properties: {} } }],
    auth: 'none',
    url: 'https://legacy.example.com',
    allowPrivate: false,
    created: new Date().toISOString()
  });

  x.hub.store.put('vault', legacyVaultId, {
    id: legacyVaultId,
    name: 'Legacy Secret',
    notes: 'Saved before Issue #40',
    secret: x.hub.store.seal('legacy-plain-value'),
    created: new Date().toISOString(),
    updated: new Date().toISOString()
  });

  x.hub.store.put('agent', legacyAgentId, {
    id: legacyAgentId,
    name: 'Legacy Agent',
    client: 'Manual',
    status: 'active',
    permissions: [legacyMcpId + ':read', 'vault:' + legacyVaultId],
    created: new Date().toISOString(),
    last: null
  });

  // Verify list & state return legacy records
  const stateRes = await x.call('/api/state');
  assert.equal(stateRes.status, 200);
  assert(stateRes.data.agents.some(a => a.id === legacyAgentId));
  assert(stateRes.data.mcps.some(m => m.id === legacyMcpId));
  assert(stateRes.data.vault.some(v => v.id === legacyVaultId));

  // Verify permission validation works with legacy IDs
  const patchRes = await x.call('/api/agents/' + legacyAgentId, 'PATCH', {
    name: 'Legacy Agent Renamed',
    permissions: ['vault:' + legacyVaultId]
  });
  assert.equal(patchRes.status, 200);
  assert.deepEqual(x.hub.store.get('agent', legacyAgentId).permissions, ['vault:' + legacyVaultId]);
});
