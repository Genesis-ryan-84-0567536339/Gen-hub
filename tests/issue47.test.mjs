import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
import { connectorService, checkToolPermissions } from '../server/connectors.mjs';
import { GITHUB_MCP_URL } from '../server/github-mcp.mjs';

test('Issue #47: checkToolPermissions marks active GitHub MCP tools as "ok" by default', () => {
  const mcpConnector = { id: 'mcp-gh', provider: 'github-mcp' };
  const rawTools = [
    { name: 'search_repositories', description: 'Search repos', inputSchema: {} },
    { name: 'github_issue_create', description: 'Create issue', inputSchema: {} },
    { name: 'list_issues', description: 'List issues', inputSchema: {} }
  ];

  // Without headers or credential scope (standard GitHub MCP endpoint behavior)
  const evaluated = checkToolPermissions(mcpConnector, rawTools);
  assert.equal(evaluated.length, 3);
  for (const t of evaluated) {
    assert.equal(t.permission.status, 'ok');
    assert.equal(t.permission.reason, 'Khả dụng');
  }

  // Pre-existing permission is preserved if already set
  const withExisting = [
    {
      name: 'custom_tool',
      inputSchema: {},
      permission: { status: 'custom_status', reason: 'Custom reason' }
    }
  ];
  const evaluatedExisting = checkToolPermissions(mcpConnector, withExisting);
  assert.equal(evaluatedExisting[0].permission.status, 'custom_status');
  assert.equal(evaluatedExisting[0].permission.reason, 'Custom reason');
});

test('Issue #47: checkToolPermissions checks scopes if x-oauth-scopes header or credential scope provided', () => {
  const mcpConnector = { id: 'mcp-gh', provider: 'github-mcp' };
  const scopedTools = [
    { name: 'repo_tool', scopes: ['repo'], inputSchema: {} },
    { name: 'org_tool', scopes: ['read:org'], inputSchema: {} },
    { name: 'unscoped_tool', inputSchema: {} }
  ];

  // Token with only 'repo' scope via header
  const headerEvaluated = checkToolPermissions(mcpConnector, scopedTools, {
    headers: { 'x-oauth-scopes': 'repo, read:user' }
  });
  assert.equal(headerEvaluated.find(t => t.name === 'repo_tool').permission.status, 'ok');
  assert.equal(headerEvaluated.find(t => t.name === 'org_tool').permission.status, 'missing');
  assert.match(
    headerEvaluated.find(t => t.name === 'org_tool').permission.reason,
    /Thiếu quyền: cần scope read:org/
  );
  assert.equal(headerEvaluated.find(t => t.name === 'unscoped_tool').permission.status, 'ok');

  // Token with only 'read:org' via credential.scope
  const credEvaluated = checkToolPermissions(mcpConnector, scopedTools, {
    credential: { scope: 'read:org' }
  });
  assert.equal(credEvaluated.find(t => t.name === 'repo_tool').permission.status, 'missing');
  assert.match(
    credEvaluated.find(t => t.name === 'repo_tool').permission.reason,
    /Thiếu quyền: cần scope repo/
  );
  assert.equal(credEvaluated.find(t => t.name === 'org_tool').permission.status, 'ok');
  assert.equal(credEvaluated.find(t => t.name === 'unscoped_tool').permission.status, 'ok');
});

test('Issue #47: connectorService.sync assigns "ok" permission to all GitHub MCP tools', async t => {
  const { hub } = await fixture(t);
  const store = hub.store;

  const upstreamTools = [
    {
      name: 'issue_write',
      inputSchema: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          title: { type: 'string' },
          body: { type: 'string' },
          issue_number: { type: 'number' },
          labels: { type: 'array', items: { type: 'string' } },
          method: { type: 'string', enum: ['create', 'update'] },
          state: { type: 'string', enum: ['open', 'closed'] }
        },
        required: ['owner', 'repo', 'method']
      },
      annotations: { readOnlyHint: false }
    },
    {
      name: 'search_repositories',
      description: 'Search repos on GitHub',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true }
    },
    {
      name: 'get_file_contents',
      description: 'Get file content',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true }
    }
  ];

  const mockMcpRequest = async (url, options) => {
    assert.equal(url, GITHUB_MCP_URL);
    const b = options.body;
    if (b.method === 'initialize') {
      return {
        status: 200,
        headers: { 'mcp-session-id': 'sess-gh-pilot' },
        json: {
          jsonrpc: '2.0',
          id: b.id,
          result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'copilot' } }
        }
      };
    }
    if (b.method === 'notifications/initialized') {
      return { status: 202, headers: {}, json: {} };
    }
    if (b.method === 'tools/list') {
      return {
        status: 200,
        headers: { 'mcp-session-id': 'sess-gh-pilot' },
        json: {
          jsonrpc: '2.0',
          id: b.id,
          result: { tools: upstreamTools }
        }
      };
    }
    if (options.method === 'DELETE') {
      return { status: 200, headers: {}, json: {} };
    }
    return { status: 200, headers: {}, json: { jsonrpc: '2.0', id: b.id, result: {} } };
  };

  const service = connectorService(store, { mcpRequest: mockMcpRequest });
  const m = {
    id: 'mcp-gh-test',
    provider: 'github-mcp',
    url: GITHUB_MCP_URL,
    auth: 'token',
    secret: store.seal({ token: 'ghp_synthetic_token' })
  };

  const tools = await service.sync(m);
  // Upstream had 3 tools: 1 issue_write (expanded into 3 wrappers) + 2 regular = 5 tools
  assert.equal(tools.length, 5);
  for (const tool of tools) {
    assert.equal(
      tool.permission?.status,
      'ok',
      `Tool ${tool.name} must have permission status "ok"`
    );
    assert.equal(
      tool.permission?.reason,
      'Khả dụng',
      `Tool ${tool.name} must have permission reason "Khả dụng"`
    );
  }
});

test('Issue #47: Hub routes sync persists "ok" tool permissions for GitHub MCP in state', async t => {
  const upstreamTools = [
    {
      name: 'issue_write',
      inputSchema: {
        type: 'object',
        properties: {
          owner: { type: 'string' },
          repo: { type: 'string' },
          title: { type: 'string' },
          body: { type: 'string' },
          issue_number: { type: 'number' },
          labels: { type: 'array', items: { type: 'string' } },
          method: { type: 'string', enum: ['create', 'update'] },
          state: { type: 'string', enum: ['open', 'closed'] }
        },
        required: ['owner', 'repo', 'method']
      },
      annotations: { readOnlyHint: false }
    },
    {
      name: 'list_issues',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true }
    }
  ];

  const mockMcpRequest = async (url, options) => {
    assert.equal(url, GITHUB_MCP_URL);
    const b = options.body;
    if (b.method === 'initialize') {
      return {
        status: 200,
        headers: { 'mcp-session-id': 'sess-pilot' },
        json: {
          jsonrpc: '2.0',
          id: b.id,
          result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'gh' } }
        }
      };
    }
    if (b.method === 'notifications/initialized') {
      return { status: 202, headers: {}, json: {} };
    }
    if (b.method === 'tools/list') {
      return {
        status: 200,
        headers: { 'mcp-session-id': 'sess-pilot' },
        json: {
          jsonrpc: '2.0',
          id: b.id,
          result: { tools: upstreamTools }
        }
      };
    }
    if (options.method === 'DELETE') {
      return { status: 200, headers: {}, json: {} };
    }
    return { status: 200, headers: {}, json: { jsonrpc: '2.0', id: b.id, result: {} } };
  };

  let service;
  const x = await fixture(t, {
    sync: m => service.sync(m),
    call: (m, n, a) => service.call(m, n, a)
  });
  service = connectorService(x.hub.store, { mcpRequest: mockMcpRequest });

  // Log in as owner
  await x.call('/api/login', 'POST', { username: 'owner', password: 'owner-password-123' });

  // Add GitHub MCP connector
  const addRes = await x.call('/api/mcps', 'POST', {
    provider: 'github-mcp',
    name: 'GitHub Copilot MCP'
  });
  assert.equal(addRes.status, 201);
  const mid = addRes.data.id;

  // Set token (triggers sync)
  const tokenRes = await x.call(`/api/mcps/${mid}/credential`, 'POST', {
    token: 'ghp_mock_copilot_pat'
  });
  assert.equal(tokenRes.status, 200);

  // Verify all returned tools have permission.status === 'ok'
  assert.equal(tokenRes.data.tools.length, 4);
  for (const t of tokenRes.data.tools) {
    assert.equal(t.permission?.status, 'ok');
    assert.equal(t.permission?.reason, 'Khả dụng');
  }

  // Verify state endpoint also exposes permission.status === 'ok'
  const stateRes = await x.call('/api/state');
  assert.equal(stateRes.status, 200);
  const mcpInState = stateRes.data.mcps.find(m => m.id === mid);
  assert.ok(mcpInState);
  assert.equal(mcpInState.tools.length, 4);
  for (const t of mcpInState.tools) {
    assert.equal(t.permission?.status, 'ok');
    assert.equal(t.permission?.reason, 'Khả dụng');
  }
});
