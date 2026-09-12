import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
import { sanitizeText, redact, protectPayload, MAX_PAYLOAD_BYTES } from '../server/store.mjs';
import { createLogger } from '../server/logger.mjs';
import { HubError } from '../server/net.mjs';

test('O11 Sanitizer: comprehensive canary secret, header, URL query, and nested JSON protection', () => {
  // 1. Raw Bearer and Basic headers in free text
  const bearerText = 'Connection failed with Bearer sk-canary-secret-abc1234567890 and Basic dXNlcjpwYXNz';
  const sanitizedBearer = sanitizeText(bearerText);
  assert.equal(sanitizedBearer, 'Connection failed with Bearer [REDACTED] and Basic [REDACTED]');
  assert.ok(!sanitizedBearer.includes('sk-canary-secret'));

  // 2. Token prefixes: OpenAI, GitHub, Slack, Gen-hub, canary-secret
  const prefixText = 'Keys: sk-canary-openai-key-999999999999, ghp_canarygithubtoken123456789012, xoxb-1234567890-canary-slack, token_canarygenhubagenttoken123';
  const sanitizedPrefix = sanitizeText(prefixText);
  assert.ok(!sanitizedPrefix.includes('sk-canary-openai-key'));
  assert.ok(!sanitizedPrefix.includes('ghp_canarygithubtoken'));
  assert.ok(!sanitizedPrefix.includes('xoxb-1234567890'));
  assert.ok(!sanitizedPrefix.includes('token_canarygenhubagenttoken'));
  assert.match(sanitizedPrefix, /sk-\[REDACTED\]/);
  assert.match(sanitizedPrefix, /xox-\[REDACTED\]/);
  assert.match(sanitizedPrefix, /token_\[REDACTED\]/);

  // 3. URLs with query parameter secrets
  const urlText = 'Request to https://api.upstream.com/data?token=canary-secret-token-1&other=public&api_key=canary-key-2#frag';
  const sanitizedUrl = sanitizeText(urlText);
  assert.equal(sanitizedUrl, 'Request to https://api.upstream.com/data?token=[REDACTED]&other=public&api_key=[REDACTED]#frag');

  // 4. Nested JSON in string format
  const nestedJsonStr = JSON.stringify({
    outer: 'public-data',
    auth: {
      password: 'canary-secret-password-123',
      token: 'canary-secret-token-456'
    },
    message: 'Error from https://api.service.org/?secret=canary-query-secret'
  });
  const redactedJson = redact(nestedJsonStr);
  assert.ok(!redactedJson.includes('canary-secret-password-123'));
  assert.ok(!redactedJson.includes('canary-secret-token-456'));
  assert.ok(!redactedJson.includes('canary-query-secret'));
  const parsed = JSON.parse(redactedJson);
  assert.equal(parsed.auth.password, '[REDACTED]');
  assert.equal(parsed.auth.token, '[REDACTED]');
  assert.match(parsed.message, /secret=\[REDACTED\]/);

  // 5. Embedded key-value pattern in text
  const kvText = 'Provider returned error: api_key=canary-secret-kv-987654321, status: 502';
  const sanitizedKv = sanitizeText(kvText);
  assert.ok(!sanitizedKv.includes('canary-secret-kv'));
  assert.match(sanitizedKv, /api_key=\[REDACTED\]/);
});

test('O11 Correlation ID: always server-generated (never trusts client header), error response, and audit log correlation', async t => {
  const x = await fixture(t);
  const SPOOFED_REQUEST_ID = 'attacker-supplied-id-' + Date.now();

  // Make request with an attacker-supplied X-Request-ID to an endpoint that fails authentication.
  const mcpRes = await x.call(
    '/mcp',
    'POST',
    { jsonrpc: '2.0', id: 42, method: 'tools/list' },
    {
      'X-Request-ID': SPOOFED_REQUEST_ID,
      Authorization: 'Bearer invalid_agent_token'
    }
  );
  assert.equal(mcpRes.status, 401);

  // 1. The server must NEVER honor a client-supplied correlation ID for the audit
  // trail — it must generate its own, ignoring whatever the client sent, since
  // this ID is used to correlate/dedupe security-relevant audit rows on a public
  // endpoint any anonymous caller can reach.
  const serverOpId = mcpRes.headers.get('x-request-id');
  assert.ok(serverOpId, 'Response must include a server-assigned X-Request-ID');
  assert.notEqual(serverOpId, SPOOFED_REQUEST_ID, 'Server must not echo back a client-supplied correlation ID');

  // 2. Audit log must record the server-generated operationId, not the spoofed one.
  const authLog = x.hub.store.logs(5).find(l => l.tool === 'auth.mcp');
  assert.ok(authLog, 'auth.mcp audit log must exist');
  assert.equal(authLog.operationId, serverOpId, 'Audit operationId must match the server-generated ID');
  assert.notEqual(authLog.operationId, SPOOFED_REQUEST_ID);

  // 3. Querying /api/logs with operationId filter must find this exact log by the real ID.
  const queryRes = await x.call(`/api/logs?operationId=${serverOpId}`);
  assert.equal(queryRes.status, 200);
  assert.ok(Array.isArray(queryRes.data) ? queryRes.data.length >= 1 : queryRes.data.rows.length >= 1);
  const foundRow = (Array.isArray(queryRes.data) ? queryRes.data : queryRes.data.rows).find(
    r => r.operationId === serverOpId
  );
  assert.ok(foundRow, 'Log query by operationId must retrieve matching row');

  // 4. Searching via free-text q filter finds by operationId.
  const searchRes = await x.call(`/api/logs?q=${serverOpId}`);
  assert.equal(searchRes.status, 200);
  const searchRow = (Array.isArray(searchRes.data) ? searchRes.data : searchRes.data.rows).find(
    r => r.operationId === serverOpId
  );
  assert.ok(searchRow, 'Log search by q must match operationId');
});

test('O11 Diagnostics: full chain request -> policy -> upstream tracking and safe credential retention', async t => {
  let simulatedUpstreamStatus = 200;
  let simulatedError = null;

  const mockConnector = {
    sync: async () => [{ name: 'test_tool', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }],
    call: async () => {
      if (simulatedError) throw simulatedError;
      return { content: [{ type: 'text', text: 'upstream-success' }], status: simulatedUpstreamStatus };
    }
  };

  const x = await fixture(t, mockConnector);

  // Register an active agent with permission to call test_tool
  const mcpRes = await x.call('/api/mcps', 'POST', {
    provider: 'remote',
    name: 'Diag MCP',
    url: 'https://example.com/mcp',
    auth: 'none'
  });
  assert.equal(mcpRes.status, 201);
  const mcpId = mcpRes.data.id;

  // Sync MCP
  await x.call(`/api/mcps/${mcpId}/sync`, 'POST', {});

  // Create agent
  const agentRes = await x.call('/api/agents', 'POST', {
    name: 'Diag Agent',
    permissions: [`${mcpId}:test_tool`]
  });
  assert.equal(agentRes.status, 201);
  const agentToken = agentRes.data.token;
  const agentId = agentRes.data.id;

  // 1. Success tool call: records upstreamStatus 200, phase 'upstream', credentialVersion
  const successCallRes = await x.call(
    '/mcp',
    'POST',
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: `${mcpId}__test_tool`, arguments: { query: 'test' } }
    },
    {
      'X-Request-ID': 'attacker-supplied-should-be-ignored',
      Authorization: `Bearer ${agentToken}`
    }
  );
  assert.equal(successCallRes.status, 200);
  const SUCCESS_REQ_ID = successCallRes.headers.get('x-request-id');
  assert.ok(SUCCESS_REQ_ID);
  assert.notEqual(SUCCESS_REQ_ID, 'attacker-supplied-should-be-ignored', 'server must not honor client-supplied correlation id');

  const successLogs = x.hub.store.logs(5);
  const successAudit = successLogs.find(l => l.operationId === SUCCESS_REQ_ID && l.tool === 'test_tool');
  assert.ok(successAudit, 'Success audit must be recorded');
  assert.equal(successAudit.policyDecision, 'allow');
  assert.equal(successAudit.status, 'success');

  // Detail query unseals diagnostic metadata
  const successDetail = x.hub.store.log(successAudit.id);
  assert.equal(successDetail.upstreamStatus, 200);
  assert.equal(successDetail.phase, 'upstream');
  assert.equal(successDetail.credentialId, mcpId);
  assert.equal(typeof successDetail.credentialVersion, 'number');
  assert.ok(!JSON.stringify(successDetail).includes(agentToken), 'Secret token must never be in diagnostic metadata');

  // 2. Upstream failure: records upstreamStatus 502, phase 'upstream', errorCategory
  const upstreamErr = new HubError('Upstream internal timeout at https://service.internal/?token=canary-err-token', 502);
  upstreamErr.upstreamStatus = 502;
  simulatedError = upstreamErr;

  const failCallRes = await x.call(
    '/mcp',
    'POST',
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: `${mcpId}__test_tool`, arguments: { query: 'fail' } }
    },
    {
      Authorization: `Bearer ${agentToken}`
    }
  );
  assert.equal(failCallRes.status, 200); // JSON-RPC returns 200 with isError or error
  const FAIL_REQ_ID = failCallRes.headers.get('x-request-id');
  assert.ok(FAIL_REQ_ID);

  const failLogs = x.hub.store.logs(5);
  const failAudit = failLogs.find(l => l.operationId === FAIL_REQ_ID && l.tool === 'test_tool');
  assert.ok(failAudit, 'Fail audit must be recorded');
  assert.equal(failAudit.policyDecision, 'allow');
  assert.equal(failAudit.status, 'error');

  const failDetail = x.hub.store.log(failAudit.id);
  assert.equal(failDetail.upstreamStatus, 502);
  assert.equal(failDetail.phase, 'upstream');
  assert.equal(failDetail.credentialId, mcpId);
  assert.ok(!JSON.stringify(failDetail).includes('canary-err-token'), 'Error message canary secret must be sanitized');
  assert.match(failDetail.output.error, /token=\[REDACTED\]/);

  // 3. Policy denial: records policyDecision 'deny', phase 'policy'
  const denyCallRes = await x.call(
    '/mcp',
    'POST',
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: `${mcpId}__unpermitted_tool`, arguments: {} }
    },
    {
      Authorization: `Bearer ${agentToken}`
    }
  );
  assert.equal(denyCallRes.status, 200);
  assert.ok(denyCallRes.data.error, 'Should return JSON-RPC error on denied tool');
  const DENY_REQ_ID = denyCallRes.headers.get('x-request-id');
  assert.ok(DENY_REQ_ID);
  assert.equal(denyCallRes.data.error.data?.operationId, DENY_REQ_ID, 'RPC error data must contain operationId');

  const denyLogs = x.hub.store.logs(5);
  const denyAudit = denyLogs.find(l => l.operationId === DENY_REQ_ID);
  assert.ok(denyAudit, 'Deny audit must be recorded');
  assert.equal(denyAudit.policyDecision, 'deny');
  assert.equal(denyAudit.status, 'denied');
  const denyDetail = x.hub.store.log(denyAudit.id);
  assert.equal(denyDetail.phase, 'policy');
});

test('O11 Payload Protection: size limits, metadata-only mode, export sanitization, and structured logger', async t => {
  const x = await fixture(t);

  // 1. Large payload protection: exceed MAX_PAYLOAD_BYTES (64KB)
  const hugeData = 'x'.repeat(MAX_PAYLOAD_BYTES + 5000);
  const protectedPayload = protectPayload({ content: hugeData });
  assert.equal(protectedPayload._truncated, true, 'Payload over limit must be truncated');
  assert.ok(protectedPayload._originalBytes > MAX_PAYLOAD_BYTES);

  // Normal small payload is not truncated
  const smallPayload = protectPayload({ content: 'normal-size' });
  assert.equal(smallPayload._truncated, undefined);
  assert.equal(smallPayload.content, 'normal-size');

  // 2. Metadata-only mode: stores { metadataOnly: true }
  const metadataOnlyPayload = protectPayload({ sensitive: 'super-secret' }, true);
  assert.deepEqual(metadataOnlyPayload, { metadataOnly: true });

  const metaLogId = x.hub.store.audit('agent-test', 'hub', 'secure.tool', 'success', { secretParam: '12345' }, { resultData: 'top-secret' }, 15, '', {
    metadataOnly: true
  }).lastInsertRowid;
  const sealedDetail = x.hub.store.log(metaLogId);
  assert.deepEqual(sealedDetail.input, { metadataOnly: true });
  assert.deepEqual(sealedDetail.output, { metadataOnly: true });
  assert.ok(!JSON.stringify(sealedDetail).includes('12345'));
  assert.ok(!JSON.stringify(sealedDetail).includes('top-secret'));

  // 3. Canary secrets do not leak into audit export
  const canaryLogId = x.hub.store.audit('agent-test', 'hub', 'tool.canary', 'error', {
    text: 'Upstream call failed: sk-canary-secret-export-check-987654321 and token_canarytoken123'
  }, {
    error: 'Error: api_key=canary-key-99999999'
  }, 20).lastInsertRowid;

  const loginResp = await fetch(`${x.origin}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: x.origin },
    body: JSON.stringify({ username: 'owner', password: 'owner-password-123' })
  });
  const cookie = loginResp.headers.get('set-cookie').split(';')[0];
  const exportRes = await fetch(`${x.origin}/api/logs/export?format=jsonl&id=${canaryLogId}`, {
    headers: { Cookie: cookie, Origin: x.origin }
  });
  assert.equal(exportRes.status, 200);
  const exportText = await exportRes.text();
  assert.ok(!exportText.includes('sk-canary-secret-export-check'));
  assert.ok(!exportText.includes('canarytoken123'));
  assert.ok(!exportText.includes('canary-key-99999999'));
  assert.match(exportText, /sk-\[REDACTED\]/);
  assert.match(exportText, /api_key=\[REDACTED\]/);

  // 4. Structured logger produces valid JSON with operationId
  const logger = createLogger(x.hub.store);
  const logEntry = logger.error('Test error message', { code: 'ERR_TEST', operationId: 'custom-op-1' });
  assert.equal(logEntry.level, 'error');
  assert.equal(logEntry.operationId, 'custom-op-1');
  assert.equal(logEntry.message, 'Test error message');
  assert.ok(logEntry.timestamp);
});
