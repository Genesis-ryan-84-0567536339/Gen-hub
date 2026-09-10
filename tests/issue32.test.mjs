import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
import { connectorService, checkToolPermissions } from '../server/connectors.mjs';
import { provider } from '../server/catalog.mjs';

test('checkToolPermissions: GitHub classic PAT and OAuth scopes inspection', () => {
  const gh = provider('github');
  assert.ok(gh);

  // Full repo scope
  const okTools = checkToolPermissions(gh, gh.tools, {
    headers: { 'x-oauth-scopes': 'repo, read:user' }
  });
  assert.equal(okTools.length, gh.tools.length);
  for (const t of okTools) {
    assert.equal(t.permission.status, 'ok');
    assert.equal(t.permission.reason, 'Khả dụng');
  }

  // Limited scope: read:user only (missing repo)
  const limitedTools = checkToolPermissions(gh, gh.tools, {
    headers: { 'x-oauth-scopes': 'read:user' }
  });
  const searchTool = limitedTools.find(t => t.name === 'search_repositories');
  assert.equal(searchTool.permission.status, 'ok');

  const fileTool = limitedTools.find(t => t.name === 'get_file_contents');
  assert.equal(fileTool.permission.status, 'missing');
  assert.match(fileTool.permission.reason, /Thiếu quyền: cần scope repo/);

  const issueTool = limitedTools.find(t => t.name === 'create_issue');
  assert.equal(issueTool.permission.status, 'missing');
  assert.match(issueTool.permission.reason, /Thiếu quyền: cần scope repo/);

  // Fine-grained PAT without scope header
  const fineGrained = checkToolPermissions(gh, gh.tools, {
    headers: {}
  });
  for (const t of fineGrained) {
    assert.equal(t.permission.status, 'unknown');
    assert.match(t.permission.reason, /fine-grained/);
  }
});

test('checkToolPermissions: Slack OAuth and Bot scopes inspection', () => {
  const slack = provider('slack');
  assert.ok(slack);

  // Has channels:read and chat:write, missing channels:history
  const partial = checkToolPermissions(slack, slack.tools, {
    headers: { 'x-oauth-scopes': 'channels:read, chat:write' }
  });
  const listChan = partial.find(t => t.name === 'list_channels');
  assert.equal(listChan.permission.status, 'ok');

  const postMsg = partial.find(t => t.name === 'post_message');
  assert.equal(postMsg.permission.status, 'ok');

  const history = partial.find(t => t.name === 'read_history');
  assert.equal(history.permission.status, 'missing');
  assert.match(history.permission.reason, /Thiếu quyền: cần scope channels:history/);

  // No scope info returned
  const unknown = checkToolPermissions(slack, slack.tools, { headers: {} });
  for (const t of unknown) {
    assert.equal(t.permission.status, 'unknown');
  }
});

test('checkToolPermissions: Google Drive readonly vs write scopes', () => {
  const drive = provider('drive');
  assert.ok(drive);

  // Readonly scope in credential
  const readonlyTools = checkToolPermissions(drive, drive.tools, {
    credential: { scope: 'https://www.googleapis.com/auth/drive.readonly' }
  });
  const listFiles = readonlyTools.find(t => t.name === 'list_files');
  assert.equal(listFiles.permission.status, 'ok');

  const readFile = readonlyTools.find(t => t.name === 'read_file');
  assert.equal(readFile.permission.status, 'ok');

  const createFile = readonlyTools.find(t => t.name === 'create_file');
  assert.equal(createFile.permission.status, 'missing');
  assert.match(createFile.permission.reason, /cần scope ghi Drive \(hiện chỉ có readonly\)/);

  // Full write scope
  const writeTools = checkToolPermissions(drive, drive.tools, {
    credential: { scope: 'https://www.googleapis.com/auth/drive' }
  });
  for (const t of writeTools) {
    assert.equal(t.permission.status, 'ok');
  }
});

test('checkToolPermissions: Telegram, Discord, Figma, and MCP default status', () => {
  const tg = provider('telegram');
  const tgTools = checkToolPermissions(tg, tg.tools);
  for (const t of tgTools) {
    assert.equal(t.permission.status, 'ok');
  }

  const discord = provider('discord');
  const dcTools = checkToolPermissions(discord, discord.tools);
  for (const t of dcTools) {
    assert.equal(t.permission.status, 'unknown');
    assert.match(t.permission.reason, /Discord/);
  }

  const figma = provider('figma');
  const figmaTools = checkToolPermissions(figma, figma.tools);
  for (const t of figmaTools) {
    assert.equal(t.permission.status, 'unknown');
    assert.match(t.permission.reason, /Figma/);
  }

  const mcpTools = checkToolPermissions({ provider: 'remote' }, [
    { name: 'custom_tool', inputSchema: {} }
  ]);
  assert.equal(mcpTools[0].permission.status, 'unknown');
});

test('connectorService: sync probes GitHub scopes and detects missing permissions', async t => {
  const { hub } = await fixture(t);
  const store = hub.store;

  const mockServiceRequest = async (url, options) => {
    if (url.includes('/user')) {
      return {
        status: 200,
        headers: { 'x-oauth-scopes': 'public_repo, read:user' },
        json: { login: 'octocat' }
      };
    }
    return { status: 404, json: { message: 'Not found' } };
  };

  const service = connectorService(store, { serviceRequest: mockServiceRequest });
  const m = {
    id: 'gh-test',
    provider: 'github',
    auth: 'token',
    secret: store.seal({ token: 'test-token' })
  };

  const tools = await service.sync(m);
  const searchTool = tools.find(t => t.name === 'search_repositories');
  assert.equal(searchTool.permission.status, 'ok');

  const issueTool = tools.find(t => t.name === 'create_issue');
  assert.equal(issueTool.permission.status, 'ok'); // public_repo covers public repo issues

  // Now test invalid token returns 401
  const authFailRequest = async () => ({
    status: 401,
    json: { message: 'Bad credentials' }
  });
  const failService = connectorService(store, { serviceRequest: authFailRequest });
  await assert.rejects(() => failService.sync(m), e => e.status === 401);
});

test('connectorService: Slack missing_scope returns 403 and descriptive error', async t => {
  const { hub } = await fixture(t);
  const store = hub.store;

  const mockServiceRequest = async url => {
    if (url.includes('auth.test')) {
      return {
        status: 200,
        headers: { 'x-oauth-scopes': 'channels:read' },
        json: { ok: true }
      };
    }
    if (url.includes('conversations.history')) {
      return {
        status: 200,
        headers: {},
        json: { ok: false, error: 'missing_scope', needed: 'channels:history' }
      };
    }
    return { status: 200, headers: {}, json: { ok: true } };
  };

  const service = connectorService(store, { serviceRequest: mockServiceRequest });
  const m = {
    id: 'slack-test',
    provider: 'slack',
    auth: 'token',
    secret: store.seal({ token: 'xoxb-test' })
  };

  const tools = await service.sync(m);
  const historyTool = tools.find(t => t.name === 'read_history');
  assert.equal(historyTool.permission.status, 'missing');
  assert.match(historyTool.permission.reason, /channels:history/);

  // Calling read_history throws HubError with 403 status
  await assert.rejects(
    () => service.call(m, 'read_history', { channel: 'C123' }),
    e => e.status === 403 && e.message.includes('channels:history')
  );
});

test('connectorService: remote MCP pagination retrieves > 50 tools without arbitrary limit', async t => {
  const { hub } = await fixture(t);
  const store = hub.store;

  // Generate 80 tools across 2 pages of 40 each
  const page1 = Array.from({ length: 40 }, (_, i) => ({
    name: `tool_page1_${i}`,
    inputSchema: { type: 'object', properties: {} }
  }));
  const page2 = Array.from({ length: 40 }, (_, i) => ({
    name: `tool_page2_${i}`,
    inputSchema: { type: 'object', properties: {} }
  }));

  const mockMcpRequest = async (url, options) => {
    const body = options.body;
    if (body.method === 'initialize') {
      return {
        status: 200,
        headers: { 'mcp-session-id': 'sess-1' },
        json: {
          jsonrpc: '2.0',
          id: body.id,
          result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'large' } }
        }
      };
    }
    if (body.method === 'notifications/initialized') {
      return { status: 202, headers: {}, json: {} };
    }
    if (body.method === 'tools/list') {
      if (!body.params.cursor) {
        return {
          status: 200,
          headers: { 'mcp-session-id': 'sess-1' },
          json: {
            jsonrpc: '2.0',
            id: body.id,
            result: { tools: page1, nextCursor: 'page2-cursor' }
          }
        };
      }
      if (body.params.cursor === 'page2-cursor') {
        return {
          status: 200,
          headers: { 'mcp-session-id': 'sess-1' },
          json: {
            jsonrpc: '2.0',
            id: body.id,
            result: { tools: page2 }
          }
        };
      }
    }
    return { status: 200, headers: {}, json: { jsonrpc: '2.0', id: body.id, result: {} } };
  };

  const service = connectorService(store, { mcpRequest: mockMcpRequest });
  const m = {
    id: 'large-mcp',
    provider: 'remote',
    url: 'https://example.com/mcp',
    auth: 'none'
  };

  const tools = await service.sync(m);
  assert.equal(tools.length, 80);
  for (const t of tools) {
    assert.equal(t.permission.status, 'unknown');
  }
});

test('Hub routes: sync persists tool permissions and exposes them to state and API', async t => {
  const mockConnector = {
    sync: async m => [
      {
        name: 'echo_read',
        description: 'Read echo',
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: true },
        permission: { status: 'ok', reason: 'Khả dụng' }
      },
      {
        name: 'echo_write',
        description: 'Write echo',
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: false },
        permission: { status: 'missing', reason: 'Thiếu quyền: cần scope write' }
      }
    ],
    call: async () => ({ content: [{ type: 'text', text: 'ok' }], isError: false })
  };
  const x = await fixture(t, mockConnector);
  await x.call('/api/login', 'POST', { username: 'owner', password: 'owner-password-123' });

  const addRes = await x.call('/api/mcps', 'POST', {
    provider: 'remote',
    name: 'Test MCP',
    url: 'https://example.com/mcp',
    auth: 'none'
  });
  assert.equal(addRes.status, 201);
  const mid = addRes.data.id;

  const syncRes = await x.call(`/api/mcps/${mid}/sync`, 'POST');
  assert.equal(syncRes.status, 200);
  assert.equal(syncRes.data.tools.length, 2);
  assert.equal(syncRes.data.tools[0].permission.status, 'ok');
  assert.equal(syncRes.data.tools[1].permission.status, 'missing');

  const stateRes = await x.call('/api/state');
  assert.equal(stateRes.status, 200);
  const mcp = stateRes.data.mcps.find(m => m.id === mid);
  assert.ok(mcp);
  assert.equal(mcp.tools[0].permission.status, 'ok');
  assert.equal(mcp.tools[1].permission.status, 'missing');
});
