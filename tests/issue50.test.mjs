import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fixture } from './helpers.mjs';
import { digest, id } from '../server/store.mjs';
import { migrateIds } from '../server/migrate-ids.mjs';

const execFileAsync = promisify(execFile);

const rpc = (x, path, token, method, params = {}) =>
  x.call(
    path,
    'POST',
    { jsonrpc: '2.0', id: 1, method, params },
    { Cookie: '', 'X-CSRF-Token': '', Authorization: 'Bearer ' + token }
  );

test('Issue #50: migrateIds migrates legacy unprefixed IDs, updates cross-references, keeps tokens active and audit intact', async t => {
  const x = await fixture(t);

  const initialLogCount = x.hub.store.logs(50).length;

  // 1. Setup legacy unprefixed entities in store
  const legacyMcpId = '4936494689d1eb1b6be2cabf';
  const legacyVaultId = '6_e0E6AHjPaaCbUi8fzUwFDa';
  const legacyClientId = 'clientOld1234567890abcdef';
  const legacyFlowId = 'flowOld1234567890abcdef';
  const legacyAgentId = 'VPFH9f4f3feUo3l3I0Uzlds-';
  const legacyAdminId = 'adminLegacy1234567890ab';

  // Seed legacy MCP
  x.hub.store.put('mcp', legacyMcpId, {
    id: legacyMcpId,
    name: 'Legacy MCP Service',
    provider: 'remote',
    description: 'Connector before Issue #40',
    on: true,
    status: 'connected',
    tools: [
      {
        name: 'echo',
        description: 'Echo data',
        published: true,
        inputSchema: { type: 'object', properties: { text: { type: 'string' } } }
      }
    ],
    auth: 'none',
    url: 'https://legacy-mcp.example.com',
    allowPrivate: false,
    created: new Date().toISOString()
  });

  // Seed legacy Vault secret
  x.hub.store.put('vault', legacyVaultId, {
    id: legacyVaultId,
    name: 'Legacy DB Secret',
    notes: 'Important production credential',
    secret: x.hub.store.seal({ secret: 'super-secret-legacy-value' }),
    created: new Date().toISOString(),
    updated: new Date().toISOString()
  });

  // Seed legacy OAuth Client
  x.hub.store.put('client', legacyClientId, {
    id: legacyClientId,
    client_id: legacyClientId,
    client_name: 'Legacy Claude Code Client',
    redirect_uris: ['http://127.0.0.1:8765/cb'],
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    expires: Date.now() + 90 * 86400000
  });

  // Seed legacy OAuth Flow
  x.hub.store.put('flow', legacyFlowId, {
    id: legacyFlowId,
    client_id: legacyClientId,
    redirect_uri: 'http://127.0.0.1:8765/cb',
    name: 'Legacy Claude Code Client',
    expires: Date.now() + 600000
  });

  // Seed legacy Agent with permissions pointing to legacy MCP and legacy Vault
  x.hub.store.put('agent', legacyAgentId, {
    id: legacyAgentId,
    name: 'Legacy Production Agent',
    client: legacyClientId,
    status: 'active',
    permissions: [
      legacyMcpId + ':echo',
      'vault:' + legacyVaultId
    ],
    created: new Date().toISOString(),
    last: null
  });

  // Seed active Bearer tokens pointing to legacy Agent
  const rawAccess = 'token_access_secret_12345678901234567890';
  const rawRefresh = 'refresh_token_secret_12345678901234567890';
  const accessDigest = digest(rawAccess);
  const refreshDigest = digest(rawRefresh);

  x.hub.store.put('token', accessDigest, {
    id: accessDigest,
    agent: legacyAgentId,
    client: legacyClientId,
    resource: x.origin + '/mcp',
    expires: Date.now() + 3600000,
    type: 'access'
  });

  x.hub.store.put('token', refreshDigest, {
    id: refreshDigest,
    agent: legacyAgentId,
    client: legacyClientId,
    resource: x.origin + '/mcp',
    expires: Date.now() + 30 * 86400000,
    type: 'refresh'
  });

  // Seed active code pointing to legacy Agent
  const rawCode = 'code_secret_12345678901234567890';
  const codeDigest = digest(rawCode);
  x.hub.store.put('code', codeDigest, {
    id: codeDigest,
    agent: legacyAgentId,
    client_id: legacyClientId,
    expires: Date.now() + 60000
  });

  // Seed legacy admin-assistant
  const rawAdminToken = 'gh_admin_legacy_token_12345678901234567890';
  x.hub.store.put('admin-assistant', 'main', {
    id: legacyAdminId,
    hash: digest(rawAdminToken),
    created: new Date().toISOString(),
    lastUsed: null
  });

  // Seed existing historical audit logs referencing legacy IDs
  x.hub.store.audit(legacyAgentId, legacyMcpId, 'echo', 'success', { text: 'hello' }, {});
  x.hub.store.audit('admin-assistant:' + legacyAdminId, 'hub', 'settings_update', 'success', {}, {});
  const preMigrationLogs = x.hub.store.logs(50);
  assert.equal(preMigrationLogs.length, initialLogCount + 2);

  // 2. Execute migration
  const result = migrateIds(x.hub.store);

  // 3. Verify migration result structure and counts
  assert.equal(result.total, 6);
  assert.equal(result.migrated.agent, 1);
  assert.equal(result.migrated.mcp, 1);
  assert.equal(result.migrated.vault, 1);
  assert.equal(result.migrated.client, 1);
  assert.equal(result.migrated.flow, 1);
  assert.equal(result.migrated.admin, 1);

  const newAgentId = result.mappings.agent[legacyAgentId];
  const newMcpId = result.mappings.mcp[legacyMcpId];
  const newVaultId = result.mappings.vault[legacyVaultId];
  const newClientId = result.mappings.client[legacyClientId];
  const newFlowId = result.mappings.flow[legacyFlowId];
  const newAdminId = result.mappings.admin[legacyAdminId];

  assert.match(newAgentId, /^agent-[0-9]{5}$/);
  assert.match(newMcpId, /^mcp-[0-9]{5}$/);
  assert.match(newVaultId, /^vault-[0-9]{5}$/);
  assert.match(newClientId, /^client-[0-9]{5}$/);
  assert.match(newFlowId, /^flow-[0-9]{5}$/);
  assert.match(newAdminId, /^admin-[0-9]{5}$/);

  // 4. Verify old keys deleted and new keys present in store
  assert.equal(x.hub.store.get('agent', legacyAgentId), null);
  assert.equal(x.hub.store.get('mcp', legacyMcpId), null);
  assert.equal(x.hub.store.get('vault', legacyVaultId), null);
  assert.equal(x.hub.store.get('client', legacyClientId), null);
  assert.equal(x.hub.store.get('flow', legacyFlowId), null);

  const migratedAgent = x.hub.store.get('agent', newAgentId);
  assert(migratedAgent, 'Migrated agent must exist under new ID');
  assert.equal(migratedAgent.id, newAgentId);
  assert.equal(migratedAgent.client, newClientId);
  assert.deepEqual(migratedAgent.permissions, [
    newMcpId + ':echo',
    'vault:' + newVaultId
  ]);

  const migratedMcp = x.hub.store.get('mcp', newMcpId);
  assert.equal(migratedMcp.id, newMcpId);

  const migratedVault = x.hub.store.get('vault', newVaultId);
  assert.equal(migratedVault.id, newVaultId);

  const migratedClient = x.hub.store.get('client', newClientId);
  assert.equal(migratedClient.id, newClientId);
  assert.equal(migratedClient.client_id, newClientId);

  const migratedFlow = x.hub.store.get('flow', newFlowId);
  assert.equal(migratedFlow.id, newFlowId);
  assert.equal(migratedFlow.client_id, newClientId);

  const migratedAdmin = x.hub.store.get('admin-assistant', 'main');
  assert.equal(migratedAdmin.id, newAdminId);
  assert.equal(migratedAdmin.hash, digest(rawAdminToken));

  // 5. Verify Token & Code cross-references (token digest remains UNCHANGED)
  const tokenRecord = x.hub.store.get('token', accessDigest);
  assert(tokenRecord, 'Access token record must still exist with unchanged digest ID');
  assert.equal(tokenRecord.agent, newAgentId);
  assert.equal(tokenRecord.client, newClientId);

  const refreshTokenRecord = x.hub.store.get('token', refreshDigest);
  assert.equal(refreshTokenRecord.agent, newAgentId);
  assert.equal(refreshTokenRecord.client, newClientId);

  const codeRecord = x.hub.store.get('code', codeDigest);
  assert.equal(codeRecord.agent, newAgentId);
  assert.equal(codeRecord.client_id, newClientId);

  // 6. Verify existing Bearer token still works for MCP calls
  const initRes = await rpc(x, '/mcp', rawAccess, 'initialize');
  assert.equal(initRes.status, 200);

  // Tools list should reflect new IDs and permissions
  const toolsRes = await rpc(x, '/mcp', rawAccess, 'tools/list');
  assert.equal(toolsRes.status, 200);
  const toolNames = toolsRes.data.result.tools.map(t => t.name);
  assert(toolNames.includes(newMcpId + '__echo'));
  assert(toolNames.includes('vault__' + newVaultId));

  // Vault read tool call should succeed
  const vaultCall = await rpc(x, '/mcp', rawAccess, 'tools/call', {
    name: 'vault__' + newVaultId,
    arguments: {}
  });
  assert.equal(vaultCall.status, 200);
  assert.equal(vaultCall.data.result.isError, false);
  const vaultContent = JSON.parse(vaultCall.data.result.content[0].text);
  assert.equal(vaultContent.secret, 'super-secret-legacy-value');

  // Static admin token still works on /mcp/admin
  const adminInit = await rpc(x, '/mcp/admin', rawAdminToken, 'initialize');
  assert.equal(adminInit.status, 200);

  // 7. Verify Historical Audit Logs were NOT modified and new migration audit exists
  const allLogs = x.hub.store.logs(50);
  const migrationLog = allLogs.find(l => l.tool === 'system.id_migration');
  assert(migrationLog, 'system.id_migration audit log must exist');
  assert.equal(migrationLog.actor, 'owner');
  assert.equal(migrationLog.mcp, 'hub');
  assert.equal(migrationLog.status, 'success');
  assert.equal(migrationLog.output.total, 6);
  assert.deepEqual(migrationLog.input.mappings.agent, { [legacyAgentId]: newAgentId });
  assert.deepEqual(migrationLog.input.mappings.mcp, { [legacyMcpId]: newMcpId });
  assert.deepEqual(migrationLog.input.mappings.vault, { [legacyVaultId]: newVaultId });

  // Historical logs must still reference legacy IDs
  const legacyMcpLog = allLogs.find(l => l.tool === 'echo');
  assert(legacyMcpLog, 'Historical echo log must be preserved');
  assert.equal(legacyMcpLog.actor, legacyAgentId);
  assert.equal(legacyMcpLog.mcp, legacyMcpId);

  const legacyAdminLog = allLogs.find(l => l.tool === 'settings_update');
  assert(legacyAdminLog, 'Historical admin log must be preserved');
  assert.equal(legacyAdminLog.actor, 'admin-assistant:' + legacyAdminId);

  // 8. Idempotency: Second migration run must do nothing (total = 0)
  const rerun = migrateIds(x.hub.store);
  assert.equal(rerun.total, 0);
  assert.equal(Object.keys(rerun.mappings.agent).length, 0);
  assert.equal(Object.keys(rerun.mappings.mcp).length, 0);
  assert.equal(Object.keys(rerun.mappings.vault).length, 0);
});

test('Issue #50: CLI commands `node server/admin.mjs migrate-ids` and `node server/migrate-ids.mjs` execute successfully', async t => {
  const x = await fixture(t);

  // Seed a legacy agent
  const legacyAid = 'agentLegacy99999999999999';
  x.hub.store.put('agent', legacyAid, {
    id: legacyAid,
    name: 'CLI Test Agent',
    client: 'Manual',
    status: 'active',
    permissions: [],
    created: new Date().toISOString(),
    last: null
  });

  // Execute `node server/admin.mjs migrate-ids`
  const adminCli = await execFileAsync(process.execPath, ['--no-warnings', 'server/admin.mjs', 'migrate-ids'], {
    cwd: process.cwd(),
    env: { ...process.env, DATA_DIR: x.dir }
  });
  const parsedAdmin = JSON.parse(adminCli.stdout);
  assert.equal(parsedAdmin.total, 1);
  assert(parsedAdmin.mappings.agent[legacyAid]);

  // Seed another legacy MCP
  const legacyMid = 'mcpLegacy88888888888888';
  x.hub.store.put('mcp', legacyMid, {
    id: legacyMid,
    name: 'Direct CLI Test MCP',
    provider: 'remote',
    description: 'Desc',
    on: true,
    status: 'connected',
    tools: [],
    auth: 'none',
    url: 'https://example.com',
    allowPrivate: false,
    created: new Date().toISOString()
  });

  // Execute `node server/migrate-ids.mjs` directly
  const directCli = await execFileAsync(process.execPath, ['--no-warnings', 'server/migrate-ids.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, DATA_DIR: x.dir }
  });
  const parsedDirect = JSON.parse(directCli.stdout);
  assert.equal(parsedDirect.total, 1);
  assert(parsedDirect.mappings.mcp[legacyMid]);
});
