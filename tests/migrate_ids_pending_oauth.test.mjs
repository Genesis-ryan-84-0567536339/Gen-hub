import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { migrateIds } from '../server/migrate-ids.mjs';
import { fixture } from './helpers.mjs';

function digest(val) {
  return createHash('sha256').update(val).digest('base64url');
}

test('C6 Migration Review: pending in-flight OAuth flows and state survive ID migration intact', async t => {
  const x = await fixture(t);
  const store = x.hub.store;

  const legacyMcpId = 'legacy-drive-mcp-99999';
  const legacyClientId = 'legacy-client-88888';
  const legacyFlowId = 'legacy-flow-77777';

  // 1. Seed legacy MCP
  store.put('mcp', legacyMcpId, {
    id: legacyMcpId,
    name: 'Google Drive Connector',
    provider: 'drive',
    status: 'pending',
    created: new Date().toISOString()
  });

  // 2. Seed pending in-flight oauthstate (connector auth in progress)
  const rawOAuthState = 'oauth_state_secret_' + randomBytes(16).toString('hex');
  const stateKey = digest(rawOAuthState);
  const verifier = randomBytes(32).toString('base64url');
  const sessionId = 'test-owner-session-123';

  store.put('oauthstate', stateKey, {
    id: stateKey,
    mcp: legacyMcpId,
    session: sessionId,
    credential: store.seal({
      client_id: 'google-client-id',
      client_secret: 'google-secret',
      oauth: {
        token: 'https://oauth2.googleapis.com/token',
        scope: 'drive.file'
      }
    }),
    verifier,
    expires: Date.now() + 600000
  });

  // 3. Seed pending in-flight agent auth flow
  store.put('client', legacyClientId, {
    id: legacyClientId,
    client_id: legacyClientId,
    client_name: 'Pending Claude Client',
    redirect_uris: ['http://127.0.0.1:8765/cb'],
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code'],
    response_types: ['code'],
    expires: Date.now() + 90 * 86400000
  });

  store.put('flow', legacyFlowId, {
    id: legacyFlowId,
    client_id: legacyClientId,
    redirect_uri: 'http://127.0.0.1:8765/cb',
    name: 'Pending Claude Client',
    expires: Date.now() + 600000
  });

  // Verify baseline before migration
  const preState = store.get('oauthstate', stateKey);
  assert.equal(preState.id, stateKey);
  assert.equal(preState.mcp, legacyMcpId);

  // 4. Run migration
  const result = migrateIds(store);

  // 5. Verify MCP was migrated to standard mcp-NNNNN
  const newMcpId = result.mappings.mcp[legacyMcpId];
  assert.ok(newMcpId, 'Legacy MCP must be in migration mappings');
  assert.match(newMcpId, /^mcp-[0-9]{5}$/);
  assert.equal(store.get('mcp', legacyMcpId), null, 'Old MCP ID must be removed');
  const migratedMcp = store.get('mcp', newMcpId);
  assert.equal(migratedMcp.id, newMcpId);

  // 6. Verify pending in-flight oauthstate
  // Primary key (stateKey / digest) MUST remain unchanged so callback finds it
  const migratedState = store.get('oauthstate', stateKey);
  assert.ok(migratedState, 'oauthstate record must still be retrievable by its digest key');
  assert.equal(migratedState.id, stateKey, 'oauthstate.id must NOT be overwritten with MCP id');
  assert.equal(
    migratedState.mcp,
    newMcpId,
    'oauthstate.mcp must be updated to the new migrated MCP id'
  );
  assert.equal(migratedState.verifier, verifier);

  // 7. Verify pending flow client_id was updated
  const newClientId = result.mappings.client[legacyClientId];
  const newFlowId = result.mappings.flow[legacyFlowId];
  const migratedFlow = store.get('flow', newFlowId);
  assert.ok(migratedFlow, 'Pending flow must be migrated');
  assert.equal(migratedFlow.client_id, newClientId);

  // 8. Rerun migration is idempotent and does not alter the pending oauthstate
  migrateIds(store);
  const reState = store.get('oauthstate', stateKey);
  assert.equal(reState.mcp, newMcpId);
  assert.equal(reState.id, stateKey);
});
