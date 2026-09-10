import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
import { connectorService } from '../server/connectors.mjs';
import { provider } from '../server/catalog.mjs';
import { GITHUB_MCP_URL, githubTools, githubCall, checkStatusTool, githubCheckStatus } from '../server/github-mcp.mjs';
import { checkToolPermissions } from '../server/connectors.mjs';
import { connectionGuide } from '../public/connection-guides.js';

const upstream = () => [
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
    // A misleading hint must never publish issue_write or its wrappers.
    annotations: { readOnlyHint: true }
  },
  ...[
    'search_repositories',
    'get_file_contents',
    'list_issues',
    'add_issue_comment',
    'merge_pull_request'
  ].map(name => ({
    name,
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: !['add_issue_comment', 'merge_pull_request'].includes(name) }
  }))
];
const args = { owner: 'test-owner', repo: 'test-repo' };

function transport() {
  const state = {
    tools: upstream(),
    calls: [],
    requests: [],
    status: 200,
    output: { content: [{ type: 'text', text: 'ok' }], isError: false }
  };
  state.request = async (url, options) => {
    state.requests.push({ url, options });
    assert.equal(url, GITHUB_MCP_URL);
    if (options.method === 'DELETE') return { status: 200, headers: {} };
    const b = options.body;
    if (b.method !== 'initialize') assert.equal(options.headers['Mcp-Session-Id'], 'pilot-session');
    if (b.method === 'tools/call') state.calls.push(b.params);
    const result =
      b.method === 'tools/list'
        ? b.params.cursor
          ? { tools: state.tools.slice(2) }
          : { tools: state.tools.slice(0, 2), nextCursor: 'next' }
        : b.method === 'tools/call'
          ? state.output
          : {};
    return {
      status: state.status,
      headers: { 'mcp-session-id': 'pilot-session' },
      json: { jsonrpc: '2.0', id: b.id, result }
    };
  };
  return state;
}

test('issue wrappers construct fixed payloads and reject privilege escalation without schema enforcement by caller', () => {
  const tools = githubTools(upstream());
  assert(!tools.some(t => t.name === 'issue_write'));
  for (const name of [
    'add_issue_comment',
    'merge_pull_request',
    'list_issues',
    'search_repositories',
    'get_file_contents'
  ])
    assert.deepEqual(
      tools.find(t => t.name === name),
      upstream().find(t => t.name === name)
    );
  assert.deepEqual(githubCall('github_issue_create', { ...args, title: 'new', body: 'body' }), {
    name: 'issue_write',
    arguments: { method: 'create', ...args, title: 'new', body: 'body' }
  });
  assert.deepEqual(githubCall('github_issue_close', { ...args, issue_number: 12 }), {
    name: 'issue_write',
    arguments: { method: 'update', state: 'closed', ...args, issue_number: 12 }
  });
  for (const labels of [[], ['keep', 'new']])
    assert.deepEqual(githubCall('github_issue_label', { ...args, issue_number: 12, labels }), {
      name: 'issue_write',
      arguments: { method: 'update', ...args, issue_number: 12, labels }
    });
  const valid = {
    github_issue_create: { ...args, title: 'new' },
    github_issue_close: { ...args, issue_number: 12 },
    github_issue_label: { ...args, issue_number: 12, labels: ['keep'] }
  };
  for (const [name, input] of Object.entries(valid)) {
    for (const extra of [
      { method: 'update' },
      { state: 'open' },
      { assignees: ['other'] },
      { milestone: 1 },
      { issue_fields: [] },
      { parent_issue_number: 1 },
      { [name === 'github_issue_create' ? 'issue_number' : 'title']: 9 }
    ])
      assert.throws(() => githubCall(name, { ...input, ...extra }));
  }
  for (const labels of [null, 'label', {}, [1], [{}], [''], [' '.repeat(2)], Array(101).fill('a')])
    assert.throws(() => githubCall('github_issue_label', { ...args, issue_number: 1, labels }));
  for (const issue_number of [0, -1, 1.5, '1', null])
    assert.throws(() => githubCall('github_issue_close', { ...args, issue_number }));
  assert.throws(() => githubCall('issue_write', { ...args, method: 'update' }), /wrapper/);
  assert(!githubTools(upstream().slice(1)).some(t => t.name.startsWith('github_issue_')));
  const drift = upstream();
  drift[0].inputSchema.properties.method.enum = ['create'];
  assert.throws(() => githubTools(drift), /Schema/);
  assert.throws(() => githubTools([...upstream(), { name: 'github_issue_close' }]), /trùng/);
  assert.throws(() => githubTools([...upstream(), { name: 'github_check_status' }]), /trùng/);
  assert(githubTools(upstream().slice(1)).some(t => t.name === 'github_check_status'));
});

test('official connector pins endpoint and token transport, preserves MCP errors and never retries writes', async () => {
  const wire = transport();
  const service = connectorService(
    { unseal: () => ({ token: 'synthetic-pat' }) },
    { mcpRequest: wire.request }
  );
  const m = { provider: 'github-mcp', url: GITHUB_MCP_URL, auth: 'token', secret: true };
  assert.equal((await service.sync(m)).length, 9);
  assert(wire.requests.every(r => r.options.headers.Authorization === 'Bearer synthetic-pat'));
  const merge = { ...args, pullNumber: 4, expectedHeadSha: 'a'.repeat(40) };
  await service.call(m, 'merge_pull_request', merge);
  assert.deepEqual(wire.calls.at(-1), { name: 'merge_pull_request', arguments: merge });
  wire.output = { content: [{ type: 'text', text: 'Head SHA mismatch' }], isError: true };
  assert.deepEqual(await service.call(m, 'merge_pull_request', merge), wire.output);
  assert.equal(wire.calls.length, 2);
  const count = wire.requests.length;
  for (const change of [
    { url: 'http://api.githubcopilot.com/mcp/' },
    { url: 'https://evil.test/mcp/' },
    { url: GITHUB_MCP_URL + 'insiders' },
    { allowPrivate: true },
    { auth: 'none' }
  ])
    await assert.rejects(() => service.sync({ ...m, ...change }), /endpoint/);
  await assert.rejects(() => service.call(m, 'issue_write', {}), /wrapper/);
  assert.equal(wire.requests.length, count);
  wire.status = 401;
  await assert.rejects(
    () => service.call(m, 'github_issue_close', { ...args, issue_number: 1 }),
    e => e.status === 401
  );
  wire.status = 403;
  await assert.rejects(() => service.sync(m), /HTTP 403/);
  wire.status = 302;
  await assert.rejects(() => service.sync(m), /HTTP 302/);
  assert(!wire.requests.some(r => r.url !== GITHUB_MCP_URL));
});

test('PAT admin flow, owner publication, separate grants, resync, errors and audit through real Hub routes', async t => {
  const wire = transport();
  let service;
  const x = await fixture(t, {
    sync: m => service.sync(m),
    call: (m, n, a) => service.call(m, n, a)
  });
  service = connectorService(x.hub.store, { mcpRequest: wire.request });
  const admin = (await x.call('/api/admin-assistant', 'POST', { password: 'owner-password-123' }))
    .data;
  const adminCall = async (name, input) => {
    const r = await x.call(
      '/mcp/admin',
      'POST',
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: input } },
      { Authorization: 'Bearer ' + admin.token }
    );
    assert.equal(r.data.result.isError, false, JSON.stringify(r.data));
    return JSON.parse(r.data.result.content[0].text);
  };
  const rest = await adminCall('connector_add', { provider: 'github' });
  const restBefore = x.hub.store.get('mcp', rest.id);
  const m = await adminCall('connector_add', { provider: 'github-mcp' });
  const mid = m.id;
  assert.equal(m.url, GITHUB_MCP_URL);
  assert.equal(m.tools.length, 0);
  for (const change of [
    { url: 'https://evil.test/mcp/' },
    { auth: 'none' },
    { allowPrivate: true }
  ])
    assert.equal(
      (await x.call('/api/mcps', 'POST', { provider: 'github-mcp', ...change })).status,
      400
    );
  let synced = await adminCall('connector_set_token', { id: mid, token: 'synthetic-pat' });
  assert(synced.tools.every(t => t.published === false));
  assert(!synced.tools.some(t => t.name === 'issue_write'));
  assert(!JSON.stringify(synced).includes('synthetic-pat'));
  assert.equal(x.hub.store.unseal(x.hub.store.get('mcp', mid).secret).token, 'synthetic-pat');
  assert.equal(
    (
      await x.call('/api/agents', 'POST', {
        name: 'invalid',
        permissions: [mid + ':github_issue_create']
      })
    ).status,
    400
  );
  await adminCall('connector_update', {
    id: mid,
    published: [
      'github_issue_create',
      'github_issue_close',
      'github_issue_label',
      'merge_pull_request'
    ]
  });
  const agent = await adminCall('agent_create', {
    name: 'create-only',
    permissions: [mid + ':github_issue_create']
  });
  const rpc = (method, params = {}) =>
    x.call(
      '/mcp',
      'POST',
      { jsonrpc: '2.0', id: 1, method, params },
      { Authorization: 'Bearer ' + agent.token }
    );
  const call = (name, input) => rpc('tools/call', { name: mid + '__' + name, arguments: input });
  assert.deepEqual(
    (await rpc('tools/list')).data.result.tools.map(t => t.name),
    [mid + '__github_issue_create']
  );
  for (const name of [
    'github_issue_close',
    'github_issue_label',
    'issue_write',
    'merge_pull_request'
  ])
    assert((await call(name, { ...args, issue_number: 1 })).data.error);
  assert.equal(wire.calls.length, 0);
  assert(
    (
      await call('github_issue_create', {
        ...args,
        title: 'new',
        method: 'update',
        issue_number: 1
      })
    ).data.result.isError
  );
  assert.equal(wire.calls.length, 0);
  assert.equal(
    (await call('github_issue_create', { ...args, title: 'new' })).data.result.isError,
    false
  );
  assert.deepEqual(wire.calls[0], {
    name: 'issue_write',
    arguments: { method: 'create', ...args, title: 'new' }
  });
  wire.output = { isError: true, content: [{ type: 'text', text: 'Permission denied by GitHub' }] };
  assert.equal(
    (await call('github_issue_create', { ...args, title: 'denied' })).data.result.isError,
    true
  );
  synced = await adminCall('connector_sync', { id: mid });
  assert.equal(synced.tools.find(t => t.name === 'github_issue_create').published, true);
  wire.tools.push({
    name: 'new_write',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object' }
  });
  wire.tools.find(t => t.name === 'merge_pull_request').inputSchema.properties.newArg = {
    type: 'string'
  };
  synced = await adminCall('connector_sync', { id: mid });
  assert.equal(synced.tools.find(t => t.name === 'new_write').published, false);
  assert.equal(synced.tools.find(t => t.name === 'merge_pull_request').published, false);
  wire.tools = wire.tools.filter(t => t.name !== 'issue_write');
  synced = await adminCall('connector_sync', { id: mid });
  assert(!synced.tools.some(t => t.name.startsWith('github_issue_')));
  assert.equal((await rpc('tools/list')).data.result.tools.length, 0);
  wire.tools = upstream();
  synced = await adminCall('connector_sync', { id: mid });
  assert.equal(synced.tools.find(t => t.name === 'github_issue_create').published, false);
  assert((await call('github_issue_create', { ...args, title: 'after removal' })).data.error);
  await adminCall('connector_update', { id: mid, published: ['github_issue_create'] });
  wire.status = 401;
  assert((await call('github_issue_create', { ...args, title: 'expired' })).data.result.isError);
  assert.equal(x.hub.store.get('mcp', mid).status, 'expired');
  assert.equal((await rpc('tools/list')).data.result.tools.length, 0);
  assert.deepEqual(x.hub.store.get('mcp', rest.id), restBefore);
  const logs = (await x.call('/api/logs')).data;
  assert(logs.some(l => l.tool === 'github_issue_create' && l.status === 'success'));
  assert(logs.some(l => l.tool === 'github_issue_close' && l.status === 'denied'));
  assert(logs.some(l => l.tool === 'github_issue_create' && l.status === 'error'));
  assert(!JSON.stringify(logs).includes('synthetic-pat'));
});

test('catalog and connection guide distinguish REST and token-only MCP pilot', () => {
  assert.equal(provider('github').tools.length, 5);
  assert.equal(provider('github-mcp').oauth, undefined);
  assert.deepEqual(provider('github-mcp').tools, []);
  const guide = connectionGuide('github-mcp');
  assert(guide.steps.some(s => s.includes(GITHUB_MCP_URL)));
  assert(guide.note.includes('owner'));
});

test('github_check_status: validates input, calls GitHub REST, reduces check-runs output, preserves security and passes tool permissions', async t => {
  // 1. Tool definition & Schema checks
  assert.equal(checkStatusTool.name, 'github_check_status');
  assert.equal(checkStatusTool.annotations.readOnlyHint, true);
  assert.equal(checkStatusTool.annotations.destructiveHint, false);
  assert.equal(checkStatusTool.annotations.openWorldHint, true);
  assert.equal(checkStatusTool.published, false);
  assert.deepEqual(checkStatusTool.inputSchema.required, ['owner', 'repo', 'ref']);

  // 2. Input validation
  const token = 'ghp_test_secret_pat_9876543210';
  await assert.rejects(() => githubCheckStatus({ repo: 'r', ref: 'main' }, { token }), /Thiếu tham số owner/);
  await assert.rejects(() => githubCheckStatus({ owner: 'o', ref: 'main' }, { token }), /Thiếu tham số repo/);
  await assert.rejects(() => githubCheckStatus({ owner: 'o', repo: 'r' }, { token }), /Thiếu tham số ref/);
  await assert.rejects(() => githubCheckStatus({ owner: '  ', repo: 'r', ref: 'main' }, { token }), /owner không được rỗng/);
  await assert.rejects(() => githubCheckStatus({ owner: 'o', repo: '', ref: 'main' }, { token }), /repo không được rỗng/);
  await assert.rejects(() => githubCheckStatus({ owner: 'o', repo: 'r', ref: '   ' }, { token }), /ref không được rỗng/);
  await assert.rejects(() => githubCheckStatus({ owner: 'o', repo: 'r', ref: 'main', extra: 1 }, { token }), /Tham số không hỗ trợ/);
  await assert.rejects(() => githubCheckStatus({ owner: 'o', repo: 'r', ref: 'main' }, {}), /credential/);

  // 3. Mock REST call and Output reduction
  let requestedUrl = null;
  let requestedOptions = null;
  const mockGithubResponse = {
    total_count: 2,
    check_runs: [
      {
        id: 42,
        head_sha: '1234567890abcdef',
        name: 'build-test',
        status: 'completed',
        conclusion: 'success',
        details_url: 'https://github.com/o/r/runs/42',
        output: { title: 'Passed', summary: 'All 50 tests passed' },
        started_at: '2026-09-10T00:00:00Z',
        completed_at: '2026-09-10T00:01:00Z'
      },
      {
        id: 43,
        head_sha: '1234567890abcdef',
        name: 'lint',
        status: 'in_progress',
        conclusion: null,
        details_url: 'https://github.com/o/r/runs/43',
        started_at: '2026-09-10T00:01:00Z'
      }
    ]
  };

  const mockRequest = async (url, options) => {
    requestedUrl = url;
    requestedOptions = options;
    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      json: mockGithubResponse
    };
  };

  const result = await githubCall(
    'github_check_status',
    { owner: 'my-org', repo: 'my-repo', ref: 'epic/ci-status' },
    { token, request: mockRequest }
  );

  assert.equal(
    requestedUrl,
    'https://api.github.com/repos/my-org/my-repo/commits/epic%2Fci-status/check-runs'
  );
  assert.equal(requestedOptions.method, 'GET');
  assert.equal(requestedOptions.headers.Authorization, 'Bearer ' + token);
  assert.equal(requestedOptions.headers.Accept, 'application/vnd.github+json');
  assert.equal(requestedOptions.headers['X-GitHub-Api-Version'], '2022-11-28');

  // Verify reduced output
  assert.equal(result.isError, false);
  const runs = JSON.parse(result.content[0].text);
  assert.deepEqual(runs, [
    { name: 'build-test', status: 'completed', conclusion: 'success' },
    { name: 'lint', status: 'in_progress', conclusion: null }
  ]);

  // Verify secret token is NOT leaked in output
  assert(!JSON.stringify(result).includes(token));
  assert(!result.content[0].text.includes('42'));
  assert(!result.content[0].text.includes('details_url'));

  // 4. REST Error handling
  await assert.rejects(
    () =>
      githubCall(
        'github_check_status',
        { owner: 'o', repo: 'r', ref: 'm' },
        {
          token,
          request: async () => ({ status: 401, headers: {} })
        }
      ),
    e => e.status === 401
  );
  await assert.rejects(
    () =>
      githubCall(
        'github_check_status',
        { owner: 'o', repo: 'r', ref: 'm' },
        {
          token,
          request: async () => ({ status: 403, headers: {} })
        }
      ),
    e => e.status === 403
  );
  await assert.rejects(
    () =>
      githubCall(
        'github_check_status',
        { owner: 'o', repo: 'r', ref: 'm' },
        {
          token,
          request: async () => ({ status: 500, headers: {} })
        }
      ),
    e => e.status === 502
  );

  // 5. checkToolPermissions marks github_check_status as 'ok' by default
  const permissionEvaluated = checkToolPermissions({ provider: 'github-mcp' }, [checkStatusTool]);
  assert.equal(permissionEvaluated[0].permission.status, 'ok');
  assert.equal(permissionEvaluated[0].permission.reason, 'Khả dụng');

  // 6. Integration via connectorService: calls REST directly, does NOT forward to upstream MCP
  const wire = transport();
  let restCalled = false;
  const service = connectorService(
    { unseal: () => ({ token }) },
    {
      mcpRequest: wire.request,
      serviceRequest: async (url, options) => {
        restCalled = true;
        return mockRequest(url, options);
      }
    }
  );
  const m = { provider: 'github-mcp', url: GITHUB_MCP_URL, auth: 'token', secret: true };
  const serviceOut = await service.call(m, 'github_check_status', {
    owner: 'my-org',
    repo: 'my-repo',
    ref: 'main'
  });
  assert.equal(restCalled, true);
  assert.equal(wire.calls.length, 0); // Upstream MCP tools/call was NOT invoked
  assert.deepEqual(JSON.parse(serviceOut.content[0].text), [
    { name: 'build-test', status: 'completed', conclusion: 'success' },
    { name: 'lint', status: 'in_progress', conclusion: null }
  ]);

  // 7. Real Hub route execution (/mcp tools/call) and Audit log verification
  let hubRestCalled = false;
  let hubService;
  const x = await fixture(t, {
    sync: m => hubService.sync(m),
    call: (m, n, a) => hubService.call(m, n, a)
  });
  hubService = connectorService(x.hub.store, {
    mcpRequest: wire.request,
    serviceRequest: async (url, options) => {
      hubRestCalled = true;
      return mockRequest(url, options);
    }
  });

  const admin = (
    await x.call('/api/admin-assistant', 'POST', { password: 'owner-password-123' })
  ).data;
  const adminCall = async (name, input) => {
    const r = await x.call(
      '/mcp/admin',
      'POST',
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: input } },
      { Authorization: 'Bearer ' + admin.token }
    );
    assert.equal(r.data.result.isError, false);
    return JSON.parse(r.data.result.content[0].text);
  };

  const ghMcp = await adminCall('connector_add', { provider: 'github-mcp' });
  await adminCall('connector_set_token', { id: ghMcp.id, token });
  await adminCall('connector_update', {
    id: ghMcp.id,
    published: ['github_check_status']
  });

  const agent = await adminCall('agent_create', {
    name: 'ci-watcher',
    permissions: [ghMcp.id + ':github_check_status']
  });

  const agentRpc = (method, params = {}) =>
    x.call(
      '/mcp',
      'POST',
      { jsonrpc: '2.0', id: 1, method, params },
      { Authorization: 'Bearer ' + agent.token }
    );

  const toolsList = (await agentRpc('tools/list')).data.result.tools;
  assert.deepEqual(
    toolsList.map(t => t.name),
    [ghMcp.id + '__github_check_status']
  );

  const callRes = await agentRpc('tools/call', {
    name: ghMcp.id + '__github_check_status',
    arguments: { owner: 'my-org', repo: 'my-repo', ref: 'main' }
  });
  assert.equal(callRes.status, 200);
  assert.equal(callRes.data.result.isError, false);
  assert.equal(hubRestCalled, true);
  const checkRunsOut = JSON.parse(callRes.data.result.content[0].text);
  assert.equal(checkRunsOut.length, 2);

  // Check audit log
  const logs = (await x.call('/api/logs')).data;
  const checkLog = logs.find(l => l.tool === 'github_check_status');
  assert.ok(checkLog, 'Audit log for github_check_status must exist');
  assert.equal(checkLog.status, 'success');
  assert.equal(checkLog.actor, agent.id);
  assert(!JSON.stringify(logs).includes(token), 'Audit logs must NOT leak the PAT token');
});
