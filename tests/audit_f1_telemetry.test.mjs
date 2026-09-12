import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
import { authService } from '../server/auth.mjs';
import { dispatchLlmCall, calculateCost, MODEL_PRICING } from '../server/llm.mjs';

test('O10 Telemetry: LLM usage, request ID, and pricing vs unmeasured mock', async t => {
  const originalFetch = globalThis.fetch;

  try {
    // 1. OpenAI provider mock with real usage metadata
    globalThis.fetch = async (url, opts) => {
      return new Response(
        JSON.stringify({
          id: 'chatcmpl-mock-123',
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Xin chào owner'
              }
            }
          ],
          usage: {
            prompt_tokens: 1000,
            completion_tokens: 500,
            total_tokens: 1500,
            prompt_tokens_details: {
              cached_tokens: 200
            }
          }
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'x-request-id': 'req-openai-789'
          }
        }
      );
    };

    const resWithUsage = await dispatchLlmCall({
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: 'sk-canary-secret-1',
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'test' }]
    });

    assert.equal(resWithUsage.content, 'Xin chào owner');
    assert.equal(resWithUsage.requestId, 'req-openai-789');
    assert.ok(resWithUsage.usage, 'Usage must be populated');
    assert.equal(resWithUsage.usage.promptTokens, 1000);
    assert.equal(resWithUsage.usage.completionTokens, 500);
    assert.equal(resWithUsage.usage.cachedTokens, 200);
    assert.equal(resWithUsage.usage.totalTokens, 1500);

    // Cost calculation test with known model
    const cost = calculateCost('openai', 'gpt-4o', resWithUsage.usage);
    assert.match(cost, /^\$\d+\.\d{6}$/);
    assert.equal(cost, '$0.007250');

    // 2. Mock provider WITHOUT usage metadata (e.g. Ollama or mock omitting usage)
    globalThis.fetch = async (url, opts) => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Phản hồi không có usage'
              }
            }
          ]
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    };

    const resWithoutUsage = await dispatchLlmCall({
      provider: 'ollama',
      model: 'llama3.2',
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'test' }]
    });

    assert.equal(resWithoutUsage.content, 'Phản hồi không có usage');
    assert.equal(resWithoutUsage.usage, undefined, 'Must not invent fake tokens or convert bytes');
    const costMissing = calculateCost('ollama', 'llama3.2', resWithoutUsage.usage);
    assert.equal(costMissing, 'không có', 'Missing usage must display "không có"');

    // 3. Unknown model without pricing table returns "không có"
    const costUnknownModel = calculateCost('openai', 'gpt-unknown-model', {
      promptTokens: 100,
      completionTokens: 50
    });
    assert.equal(costUnknownModel, 'không có', 'Unknown model must display "không có"');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('O10 Telemetry: Chat service audits provider, model, requestId, usage, and never leaks secrets', async t => {
  const x = await fixture(t);
  const CANARY_KEY = 'sk-super-secret-api-key-999';

  // Configure LLM
  const saveRes = await x.call('/api/llm', 'POST', {
    provider: 'openai',
    model: 'gpt-4o',
    apiKey: CANARY_KEY
  });
  assert.equal(saveRes.status, 200);

  // Check audit for saveConfig: must NEVER contain CANARY_KEY
  const logsAfterSave = x.hub.store.logs(50);
  const saveLog = logsAfterSave.find(l => l.tool === 'llm.save_config');
  assert.ok(saveLog, 'llm.save_config audit log must exist');
  assert.equal(saveLog.eventKind, 'admin_action');
  assert.equal(saveLog.actorType, 'owner');
  const allLogsStr = JSON.stringify(logsAfterSave);
  assert.ok(!allLogsStr.includes(CANARY_KEY), 'Audit logs must NEVER contain API key');

  // Test mock chat call
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url, opts) => {
      if (typeof url === 'string' && url.includes('api.openai.com')) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: 'Tôi sẵn sàng trợ giúp'
                }
              }
            ],
            usage: {
              prompt_tokens: 50,
              completion_tokens: 25,
              total_tokens: 75
            }
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'x-request-id': 'req-chat-telemetry-001'
            }
          }
        );
      }
      return originalFetch(url, opts);
    };

    const chatRes = await x.call('/api/chat', 'POST', {
      messages: [{ role: 'user', content: 'Xin chào trợ lý' }],
      currentRoute: 'overview'
    });
    assert.equal(chatRes.status, 200);
    assert.equal(chatRes.data.message.content, 'Tôi sẵn sàng trợ giúp');
    assert.ok(chatRes.data.telemetry, 'Telemetry payload should be returned');
    assert.equal(chatRes.data.telemetry.requestId, 'req-chat-telemetry-001');
    assert.equal(chatRes.data.telemetry.usage.totalTokens, 75);

    // Verify chat.message audit record
    const chatLog = x.hub.store.logs(10).find(l => l.tool === 'chat.message');
    assert.ok(chatLog, 'chat.message log must be present');
    assert.equal(chatLog.eventKind, 'llm_call');
    assert.equal(chatLog.actorType, 'owner');
    assert.equal(chatLog.status, 'success');
    assert.ok(chatLog.latencyMeasured > 0);
    assert.equal(chatLog.output.provider, 'openai');
    assert.equal(chatLog.output.model, 'gpt-4o');
    assert.equal(chatLog.output.requestId, 'req-chat-telemetry-001');
    assert.equal(chatLog.output.usage.promptTokens, 50);
    assert.match(chatLog.output.cost, /^\$\d+\.\d{6}$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('O10 Telemetry: Auth failure pre-dispatcher, token refresh, revoke, and actorType normalization', async t => {
  const x = await fixture(t);

  // 1. Invalid bearer token calling /mcp: pre-dispatcher auth failure
  const badMcpRes = await x.call(
    '/mcp',
    'POST',
    { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    { Authorization: 'Bearer invalid_agent_token' }
  );
  assert.equal(badMcpRes.status, 401);

  const mcpAuthLog = x.hub.store.logs(5).find(l => l.tool === 'auth.mcp');
  assert.ok(mcpAuthLog, 'auth.mcp log must be created on pre-dispatch 401');
  assert.equal(mcpAuthLog.eventKind, 'auth');
  assert.equal(mcpAuthLog.actorType, 'unauthenticated');
  assert.equal(mcpAuthLog.errorCategory, 'authentication');

  // 2. Owner login failure: wrong password
  const badLoginRes = await x.call(
    '/api/login',
    'POST',
    { username: 'owner', password: 'wrong-password-canary' }
  );
  assert.equal(badLoginRes.status, 401);

  const loginAuthLog = x.hub.store.logs(5).find(l => l.tool === 'auth.login');
  assert.ok(loginAuthLog, 'auth.login failure must be recorded');
  assert.equal(loginAuthLog.eventKind, 'auth');
  assert.equal(loginAuthLog.actorType, 'unauthenticated');
  assert.equal(loginAuthLog.errorCategory, 'authentication');
  assert.ok(!JSON.stringify(loginAuthLog).includes('wrong-password-canary'), 'Password must never be logged');

  // 3. Token refresh lifecycle: success and failure
  const authSvc = authService(x.hub.store, x.origin);
  const client = authSvc.register({ redirect_uris: [`${x.origin}/cb`] });
  const agentId = 'agent-refresh-test';
  x.hub.store.put('agent', agentId, { id: agentId, name: 'Refresh Agent', status: 'active', permissions: [] });
  const tokenPair = authSvc.issue(agentId, client.id, `${x.origin}/mcp`);

  // Successful refresh via /oauth/token
  const refreshRes = await x.call('/oauth/token', 'POST', {
    grant_type: 'refresh_token',
    client_id: client.id,
    resource: `${x.origin}/mcp`,
    refresh_token: tokenPair.refresh_token
  });
  assert.equal(refreshRes.status, 200);

  const refreshLog = x.hub.store.logs(5).find(l => l.tool === 'auth.token_refresh' && l.status === 'success');
  assert.ok(refreshLog, 'auth.token_refresh success log must exist');
  assert.equal(refreshLog.eventKind, 'auth');
  assert.equal(refreshLog.actorType, 'agent');

  // Failed refresh (replaying used refresh_token)
  const replayRes = await x.call('/oauth/token', 'POST', {
    grant_type: 'refresh_token',
    client_id: client.id,
    resource: `${x.origin}/mcp`,
    refresh_token: tokenPair.refresh_token
  });
  assert.equal(replayRes.status, 400);

  const failRefreshLog = x.hub.store.logs(5).find(l => l.tool === 'auth.token_refresh' && l.status === 'error');
  assert.ok(failRefreshLog, 'auth.token_refresh error log must exist');
  assert.equal(failRefreshLog.eventKind, 'auth');
  assert.equal(failRefreshLog.errorCategory, 'authentication');

  // 4. Agent revoke lifecycle
  const revokeRes = await x.call(
    `/api/agents/${agentId}`,
    'PATCH',
    { status: 'revoked' }
  );
  assert.equal(revokeRes.status, 200);

  const revokeLog = x.hub.store.logs(5).find(l => l.tool === 'auth.agent_revoke');
  assert.ok(revokeLog, 'auth.agent_revoke log must exist');
  assert.equal(revokeLog.eventKind, 'auth');
  assert.equal(revokeLog.status, 'success');
});

test('O10 Telemetry: System work telemetry (connector sync) and token expiration truth', async t => {
  const mockConnector = {
    sync: async () => [{ name: 'ping', inputSchema: { type: 'object' } }],
    call: async () => ({ content: [{ type: 'text', text: 'pong' }] })
  };
  const x = await fixture(t, mockConnector);

  // Create MCP connector
  const createMcpRes = await x.call('/api/mcps', 'POST', {
    provider: 'remote',
    name: 'Sync Connector',
    url: 'https://example.com/mcp',
    auth: 'none'
  });
  assert.equal(createMcpRes.status, 201);
  const mcpId = createMcpRes.data.id;

  // Sync connector: verify eventKind: system and latencyMeasured: 1
  const syncRes = await x.call(`/api/mcps/${mcpId}/sync`, 'POST', {});
  assert.equal(syncRes.status, 200);

  const syncLog = x.hub.store.logs(5).find(l => l.tool === 'mcp.sync');
  assert.ok(syncLog, 'mcp.sync audit log must exist');
  assert.equal(syncLog.eventKind, 'system');
  assert.equal(syncLog.latencyMeasured, 1);

  // Check state: token expiration truth
  // Create agent with 90-day token
  const createAgentRes = await x.call('/api/agents', 'POST', {
    name: 'Expiring Agent',
    permissions: []
  });
  assert.equal(createAgentRes.status, 201);
  const agentId = createAgentRes.data.id;

  const stateRes = await x.call('/api/state', 'GET');
  assert.equal(stateRes.status, 200);

  const expiringAgent = stateRes.data.agents.find(a => a.id === agentId);
  assert.ok(expiringAgent.tokenExpires, 'Agent with expiring token must expose tokenExpires');
  assert.ok(!isNaN(Date.parse(expiringAgent.tokenExpires)));

  // An agent without expiring tokens must NOT have tokenExpires
  x.hub.store.put('agent', 'agent-no-tokens', {
    id: 'agent-no-tokens',
    name: 'Perpetual Agent',
    status: 'active',
    permissions: []
  });

  const updatedState = await x.call('/api/state', 'GET');
  const perpetualAgent = updatedState.data.agents.find(a => a.id === 'agent-no-tokens');
  assert.equal(perpetualAgent.tokenExpires, undefined, 'Agent without expiry must NOT report tokenExpires');
});
