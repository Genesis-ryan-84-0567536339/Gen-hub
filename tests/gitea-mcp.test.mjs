import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
import { connectorService, checkToolPermissions } from '../server/connectors.mjs';
import { provider } from '../server/catalog.mjs';
import {
  DEFAULT_GITEA_URL,
  giteaBaseUrl,
  giteaEndpoint,
  giteaPublished,
  giteaTools,
  giteaCall,
  GITEA_TOOLS
} from '../server/gitea-mcp.mjs';
import { connectionGuide } from '../public/connection-guides.js';

test('giteaTools returns 15 standardized tools with published: false and appropriate annotations', () => {
  const tools = giteaTools();
  assert.equal(tools.length, 15);

  const expectedNames = [
    'get_file_contents',
    'create_or_update_file',
    'push_files',
    'list_branches',
    'create_branch',
    'list_pull_requests',
    'create_pull_request',
    'merge_pull_request',
    'pull_request_read',
    'list_issues',
    'issue_read',
    'add_issue_comment',
    'gitea_issue_create',
    'gitea_issue_close',
    'gitea_issue_label'
  ];

  for (const name of expectedNames) {
    const t = tools.find(x => x.name === name);
    assert(t, `Tool ${name} must exist`);
    assert.equal(t.published, false, `Tool ${name} must have published: false by default`);
    assert(t.description && t.description.length > 5);
    assert.equal(t.inputSchema.type, 'object');
    assert(Array.isArray(t.inputSchema.required));
    assert.equal(t.inputSchema.additionalProperties, false);
  }

  // Check readOnly and destructive hints
  const readTools = ['get_file_contents', 'list_branches', 'list_pull_requests', 'pull_request_read', 'list_issues', 'issue_read'];
  for (const name of readTools) {
    const t = tools.find(x => x.name === name);
    assert.equal(t.annotations.readOnlyHint, true);
    assert.equal(t.annotations.destructiveHint, false);
  }

  const writeTools = ['create_or_update_file', 'push_files', 'create_branch', 'create_pull_request', 'merge_pull_request', 'add_issue_comment', 'gitea_issue_create', 'gitea_issue_close', 'gitea_issue_label'];
  for (const name of writeTools) {
    const t = tools.find(x => x.name === name);
    assert.equal(t.annotations.readOnlyHint, false);
    assert.equal(t.annotations.destructiveHint, true);
  }
});

test('catalog registers gitea-mcp provider correctly', () => {
  const p = provider('gitea-mcp');
  assert(p);
  assert.equal(p.id, 'gitea-mcp');
  assert.equal(p.name, 'Gitea MCP (pilot)');
  assert.equal(p.category, 'Phát triển');
  assert.equal(p.auth, 'PAT');
  assert.equal(p.tools.length, 15);
  assert(p.tools.every(t => t.published === false));
});

test('giteaBaseUrl and giteaEndpoint validate and normalize URLs', () => {
  assert.equal(giteaBaseUrl(), DEFAULT_GITEA_URL);
  assert.equal(giteaBaseUrl('http://gitea:3000'), 'http://gitea:3000/api/v1');
  assert.equal(giteaBaseUrl('http://gitea:3000/api/v1'), 'http://gitea:3000/api/v1');
  assert.equal(giteaBaseUrl('https://gitea.example.com/api/v1/'), 'https://gitea.example.com/api/v1');
  assert.equal(giteaBaseUrl('https://gitea.example.com/'), 'https://gitea.example.com/api/v1');

  assert.equal(giteaEndpoint({ url: 'http://gitea:3000/api/v1' }), 'http://gitea:3000/api/v1');
  assert.throws(() => giteaEndpoint({ url: 'ftp://gitea:3000' }), /Gitea URL không hợp lệ/);
  assert.throws(() => giteaEndpoint({ url: 'http://user:pass@gitea:3000' }), /Gitea URL không hợp lệ/);
});

test('giteaPublished preserves published status across identical schemas', () => {
  const t = giteaTools()[0];
  assert.equal(giteaPublished(t, null), false);
  assert.equal(giteaPublished(t, { published: false, inputSchema: t.inputSchema, annotations: t.annotations }), false);
  assert.equal(giteaPublished(t, { published: true, inputSchema: t.inputSchema, annotations: t.annotations }), true);

  // Schema change resets published to false
  const modifiedSchema = { ...t.inputSchema, properties: { ...t.inputSchema.properties, extra: { type: 'string' } } };
  assert.equal(giteaPublished(t, { published: true, inputSchema: modifiedSchema, annotations: t.annotations }), false);
});

test('checkToolPermissions marks gitea-mcp tools as ok by default', () => {
  const tools = giteaTools();
  const checked = checkToolPermissions({ provider: 'gitea-mcp' }, tools);
  assert(checked.every(t => t.permission?.status === 'ok' && t.permission?.reason === 'Khả dụng'));
});

test('connectionGuide provides instructions for gitea-mcp', () => {
  const guide = connectionGuide('gitea-mcp');
  assert(guide);
  assert.equal(guide.title, 'Gitea MCP (pilot)');
  assert(guide.steps.length >= 3);
  assert(guide.links.length >= 1);
});

test('giteaCall enforces credentials and validates input schemas', async () => {
  await assert.rejects(
    () => giteaCall('get_file_contents', { owner: 'o', repo: 'r', filepath: 'f' }, { token: '' }),
    /MCP chưa có credential/
  );

  await assert.rejects(
    () => giteaCall('invalid_tool', {}, { token: 'pat' }),
    /Tool không hỗ trợ/
  );

  await assert.rejects(
    () => giteaCall('get_file_contents', { owner: '', repo: 'r', filepath: 'f' }, { token: 'pat' }),
    /owner không được rỗng/
  );

  await assert.rejects(
    () => giteaCall('merge_pull_request', { owner: 'o', repo: 'r', pull_number: -1 }, { token: 'pat' }),
    /ngoài phạm vi|Schema/
  );
});

test('giteaCall executes all operations with mock requests and header verification', async () => {
  const requests = [];
  const mockRequest = async (url, options) => {
    requests.push({ url, options });
    assert.equal(options.headers.Authorization, 'token secret-pat');
    assert.equal(options.allowPrivate, true);

    if (url.includes('/contents/README.md')) {
      if (options.method === 'GET') {
        return {
          status: 200,
          json: {
            name: 'README.md',
            path: 'README.md',
            sha: 'blob-sha-123',
            size: 13,
            content: Buffer.from('Hello, Gitea!').toString('base64'),
            encoding: 'base64'
          }
        };
      }
      if (options.method === 'PUT') {
        return {
          status: 200,
          json: {
            content: { name: 'README.md', path: 'README.md', sha: 'blob-sha-new' },
            commit: { sha: 'commit-sha-456', message: 'update readme' }
          }
        };
      }
    }

    if (url.endsWith('/contents') && options.method === 'POST') {
      return {
        status: 200,
        json: {
          commit: { sha: 'batch-commit-sha', message: options.body.message },
          files: options.body.files.map(f => ({ path: f.path, sha: 'sha-' + f.path }))
        }
      };
    }

    if (url.includes('/branches') && options.method === 'GET') {
      return {
        status: 200,
        json: [
          { name: 'main', commit: { id: 'c1' }, protected: true },
          { name: 'feat', commit: { id: 'c2' }, protected: false }
        ]
      };
    }

    if (url.includes('/branches') && options.method === 'POST') {
      return {
        status: 201,
        json: { name: options.body.new_branch_name, commit: { id: 'c3' } }
      };
    }

    if (url.includes('/pulls') && options.method === 'GET' && !url.includes('/pulls/10')) {
      return {
        status: 200,
        json: [
          {
            number: 10,
            title: 'PR Title',
            state: 'open',
            user: { username: 'alice' },
            head: { ref: 'feat', sha: 'c2' },
            base: { ref: 'main', sha: 'c1' },
            created_at: '2026-09-10T10:00:00Z',
            updated_at: '2026-09-10T11:00:00Z'
          }
        ]
      };
    }

    if (url.includes('/pulls') && options.method === 'POST' && !url.includes('/merge')) {
      return {
        status: 201,
        json: {
          number: 11,
          title: options.body.title,
          state: 'open',
          head: { ref: options.body.head, sha: 'c2' },
          base: { ref: options.body.base, sha: 'c1' }
        }
      };
    }

    if (url.includes('/pulls/10/merge') && options.method === 'POST') {
      return {
        status: 200,
        json: { message: 'merged successfully' }
      };
    }

    if (url.includes('/pulls/10') && options.method === 'GET') {
      return {
        status: 200,
        json: {
          number: 10,
          title: 'PR Title',
          body: 'PR body text',
          state: 'closed',
          user: { username: 'alice' },
          head: { ref: 'feat', sha: 'c2' },
          base: { ref: 'main', sha: 'c1' },
          merged: true,
          merged_at: '2026-09-10T12:00:00Z',
          created_at: '2026-09-10T10:00:00Z',
          updated_at: '2026-09-10T12:00:00Z'
        }
      };
    }

    if (url.includes('/issues') && options.method === 'GET' && !url.includes('/issues/5')) {
      return {
        status: 200,
        json: [
          {
            number: 5,
            title: 'Issue 5',
            state: 'open',
            user: { username: 'bob' },
            labels: [{ name: 'bug' }],
            created_at: '2026-09-10T09:00:00Z',
            updated_at: '2026-09-10T09:30:00Z'
          }
        ]
      };
    }

    if (url.includes('/issues/5/comments') && options.method === 'POST') {
      return {
        status: 201,
        json: { id: 101, user: { username: 'carol' }, body: options.body.body, created_at: '2026-09-10T13:00:00Z' }
      };
    }

    if (url.includes('/issues/5/labels') && options.method === 'PUT') {
      return {
        status: 200,
        json: options.body.labels.map(name => ({ name }))
      };
    }

    if (url.includes('/issues/5') && options.method === 'GET') {
      return {
        status: 200,
        json: {
          number: 5,
          title: 'Issue 5',
          body: 'Bug report description',
          state: 'open',
          user: { username: 'bob' },
          labels: [{ name: 'bug' }],
          comments: 1,
          created_at: '2026-09-10T09:00:00Z',
          updated_at: '2026-09-10T13:00:00Z'
        }
      };
    }

    if (url.includes('/issues/5') && options.method === 'PATCH') {
      return {
        status: 200,
        json: { number: 5, title: 'Issue 5', state: options.body.state }
      };
    }

    if (url.endsWith('/issues') && options.method === 'POST') {
      return {
        status: 201,
        json: { number: 6, title: options.body.title, state: 'open', user: { username: 'me' } }
      };
    }

    return { status: 404, json: { message: 'Not found' } };
  };

  const opts = { url: 'http://gitea:3000', token: 'secret-pat', request: mockRequest };

  // 1. get_file_contents
  const rFile = await giteaCall('get_file_contents', { owner: 'repo-owner', repo: 'repo-name', filepath: 'README.md' }, opts);
  assert.equal(rFile.isError, false);
  const dataFile = JSON.parse(rFile.content[0].text);
  assert.equal(dataFile.content, 'Hello, Gitea!');
  assert.equal(dataFile.sha, 'blob-sha-123');

  // 2. create_or_update_file
  const rUpdate = await giteaCall('create_or_update_file', {
    owner: 'repo-owner',
    repo: 'repo-name',
    filepath: 'README.md',
    content: 'New content',
    message: 'update readme'
  }, opts);
  assert.equal(rUpdate.isError, false);
  const dataUpdate = JSON.parse(rUpdate.content[0].text);
  assert.equal(dataUpdate.commit.sha, 'commit-sha-456');

  // 3. push_files
  const rPush = await giteaCall('push_files', {
    owner: 'repo-owner',
    repo: 'repo-name',
    branch: 'main',
    message: 'batch commit',
    files: [{ path: 'file1.txt', content: 'c1' }, { path: 'file2.txt', content: 'c2' }]
  }, opts);
  assert.equal(rPush.isError, false);
  const dataPush = JSON.parse(rPush.content[0].text);
  assert.equal(dataPush.commit.sha, 'batch-commit-sha');
  assert.equal(dataPush.files.length, 2);

  // 4. list_branches
  const rBranches = await giteaCall('list_branches', { owner: 'repo-owner', repo: 'repo-name' }, opts);
  assert.equal(rBranches.isError, false);
  const dataBranches = JSON.parse(rBranches.content[0].text);
  assert.equal(dataBranches.length, 2);

  // 5. create_branch
  const rNewBranch = await giteaCall('create_branch', { owner: 'repo-owner', repo: 'repo-name', branch: 'feat-2' }, opts);
  assert.equal(rNewBranch.isError, false);
  const dataNewBranch = JSON.parse(rNewBranch.content[0].text);
  assert.equal(dataNewBranch.name, 'feat-2');

  // 6. list_pull_requests
  const rPRs = await giteaCall('list_pull_requests', { owner: 'repo-owner', repo: 'repo-name', state: 'open' }, opts);
  assert.equal(rPRs.isError, false);
  const dataPRs = JSON.parse(rPRs.content[0].text);
  assert.equal(dataPRs.length, 1);
  assert.equal(dataPRs[0].number, 10);

  // 7. create_pull_request
  const rNewPR = await giteaCall('create_pull_request', {
    owner: 'repo-owner',
    repo: 'repo-name',
    title: 'New PR',
    head: 'feat',
    base: 'main',
    body: 'Details'
  }, opts);
  assert.equal(rNewPR.isError, false);
  const dataNewPR = JSON.parse(rNewPR.content[0].text);
  assert.equal(dataNewPR.number, 11);

  // 8. merge_pull_request
  const rMerge = await giteaCall('merge_pull_request', {
    owner: 'repo-owner',
    repo: 'repo-name',
    pull_number: 10,
    merge_method: 'squash'
  }, opts);
  assert.equal(rMerge.isError, false);
  const dataMerge = JSON.parse(rMerge.content[0].text);
  assert.equal(dataMerge.merged, true);

  // 9. pull_request_read
  const rReadPR = await giteaCall('pull_request_read', { owner: 'repo-owner', repo: 'repo-name', pull_number: 10 }, opts);
  assert.equal(rReadPR.isError, false);
  const dataReadPR = JSON.parse(rReadPR.content[0].text);
  assert.equal(dataReadPR.number, 10);
  assert.equal(dataReadPR.merged, true);

  // 10. list_issues
  const rIssues = await giteaCall('list_issues', { owner: 'repo-owner', repo: 'repo-name' }, opts);
  assert.equal(rIssues.isError, false);
  const dataIssues = JSON.parse(rIssues.content[0].text);
  assert.equal(dataIssues.length, 1);
  assert.equal(dataIssues[0].number, 5);

  // 11. issue_read
  const rReadIssue = await giteaCall('issue_read', { owner: 'repo-owner', repo: 'repo-name', issue_number: 5 }, opts);
  assert.equal(rReadIssue.isError, false);
  const dataReadIssue = JSON.parse(rReadIssue.content[0].text);
  assert.equal(dataReadIssue.number, 5);

  // 12. add_issue_comment
  const rComment = await giteaCall('add_issue_comment', {
    owner: 'repo-owner',
    repo: 'repo-name',
    issue_number: 5,
    body: 'LGTM'
  }, opts);
  assert.equal(rComment.isError, false);
  const dataComment = JSON.parse(rComment.content[0].text);
  assert.equal(dataComment.body, 'LGTM');

  // 13. gitea_issue_create
  const rCreateIssue = await giteaCall('gitea_issue_create', {
    owner: 'repo-owner',
    repo: 'repo-name',
    title: 'Issue 6',
    body: 'Created via MCP'
  }, opts);
  assert.equal(rCreateIssue.isError, false);
  const dataCreateIssue = JSON.parse(rCreateIssue.content[0].text);
  assert.equal(dataCreateIssue.number, 6);

  // 14. gitea_issue_close
  const rCloseIssue = await giteaCall('gitea_issue_close', {
    owner: 'repo-owner',
    repo: 'repo-name',
    issue_number: 5
  }, opts);
  assert.equal(rCloseIssue.isError, false);
  const dataCloseIssue = JSON.parse(rCloseIssue.content[0].text);
  assert.equal(dataCloseIssue.state, 'closed');

  // 15. gitea_issue_label
  const rLabelIssue = await giteaCall('gitea_issue_label', {
    owner: 'repo-owner',
    repo: 'repo-name',
    issue_number: 5,
    labels: ['bug', 'triage']
  }, opts);
  assert.equal(rLabelIssue.isError, false);
  const dataLabelIssue = JSON.parse(rLabelIssue.content[0].text);
  assert.deepEqual(dataLabelIssue.labels, ['bug', 'triage']);

  // Clear labels with []
  const rClearLabels = await giteaCall('gitea_issue_label', {
    owner: 'repo-owner',
    repo: 'repo-name',
    issue_number: 5,
    labels: []
  }, opts);
  assert.equal(rClearLabels.isError, false);
  const dataClearLabels = JSON.parse(rClearLabels.content[0].text);
  assert.deepEqual(dataClearLabels.labels, []);

  // Ensure secret-pat was never placed into returned payloads
  for (const r of [rFile, rUpdate, rPush, rBranches, rNewBranch, rPRs, rNewPR, rMerge, rReadPR, rIssues, rReadIssue, rComment, rCreateIssue, rCloseIssue, rLabelIssue]) {
    assert(!JSON.stringify(r).includes('secret-pat'));
  }
});

test('full Hub lifecycle: add gitea-mcp, configure token, sync, publish tool, call via /mcp and audit', async t => {
  let probedUrl = null;
  let probeHeaders = null;
  let calledUrl = null;

  const mockRequest = async (url, options) => {
    if (url.includes('/user') && options.method === 'GET') {
      probedUrl = url;
      probeHeaders = options.headers;
      return {
        status: 200,
        headers: {},
        json: { id: 1, login: 'gitea-user' }
      };
    }
    if (url.includes('/repos/test-org/test-repo/issues') && options.method === 'POST') {
      calledUrl = url;
      return {
        status: 201,
        headers: {},
        json: { number: 42, title: options.body.title, state: 'open', user: { username: 'gitea-user' } }
      };
    }
    return { status: 404, json: { message: 'not found' } };
  };

  let service;
  const x = await fixture(t, {
    sync: m => service.sync(m),
    call: (m, n, a) => service.call(m, n, a)
  });
  service = connectorService(x.hub.store, { serviceRequest: mockRequest, mcpRequest: mockRequest });

  const adminRes = await x.call('/api/admin-assistant', 'POST', { password: 'owner-password-123' });
  const admin = adminRes.data;

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

  // 1. Add gitea-mcp connector
  const m = await adminCall('connector_add', { provider: 'gitea-mcp', name: 'Internal Gitea' });
  assert.equal(m.provider, 'gitea-mcp');
  assert.equal(m.url, DEFAULT_GITEA_URL);
  assert.equal(m.allowPrivate, true);
  assert.equal(m.status, 'disconnected');
  assert.equal(m.tools.length, 15);
  assert(m.tools.every(t => t.published === false));

  // 2. Set credential with custom URL
  const customUrl = 'http://gitea-custom:3000/api/v1';
  const synced = await adminCall('connector_set_token', {
    id: m.id,
    token: 'pat-token-999',
    url: customUrl
  });

  assert.equal(probedUrl, 'http://gitea-custom:3000/api/v1/user');
  assert.equal(probeHeaders.Authorization, 'token pat-token-999');
  assert.equal(synced.status, 'connected');
  assert.equal(synced.url, customUrl);
  assert(synced.tools.every(t => t.published === false));
  assert(synced.tools.every(t => t.permission?.status === 'ok'));

  // Ensure PAT is never in public entity
  assert(!JSON.stringify(synced).includes('pat-token-999'));

  // 3. Create agent without tool published -> fail
  const agentFail = await x.call('/api/agents', 'POST', {
    name: 'gitea-agent',
    permissions: [m.id + ':gitea_issue_create']
  });
  assert.equal(agentFail.status, 400);

  // 4. Publish gitea_issue_create
  await adminCall('connector_update', {
    id: m.id,
    published: ['gitea_issue_create']
  });

  // 5. Create agent with permission
  const agent = await adminCall('agent_create', {
    name: 'gitea-agent',
    permissions: [m.id + ':gitea_issue_create']
  });

  // 6. Call tool via /mcp JSON-RPC endpoint
  const rpcRes = await x.call(
    '/mcp',
    'POST',
    {
      jsonrpc: '2.0',
      id: 200,
      method: 'tools/call',
      params: {
        name: m.id + '__gitea_issue_create',
        arguments: {
          owner: 'test-org',
          repo: 'test-repo',
          title: 'Automated Bug Report',
          body: 'Found an error in build.'
        }
      }
    },
    { Authorization: 'Bearer ' + agent.token }
  );

  assert.equal(rpcRes.status, 200);
  assert.equal(rpcRes.data.result.isError, false);
  const createdIssue = JSON.parse(rpcRes.data.result.content[0].text);
  assert.equal(createdIssue.number, 42);
  assert.equal(createdIssue.title, 'Automated Bug Report');
  assert.equal(calledUrl, 'http://gitea-custom:3000/api/v1/repos/test-org/test-repo/issues');

  // 7. Verify audit log
  const logs = (await x.call('/api/logs')).data;
  const callLog = logs.find(l => l.tool === 'gitea_issue_create');
  assert(callLog, 'Audit log must record gitea_issue_create');
  assert.equal(callLog.actor, agent.id);
  assert.equal(callLog.mcp, m.id);
  assert.equal(callLog.status, 'success');
  assert.equal(callLog.input.owner, 'test-org');
  assert.equal(callLog.input.repo, 'test-repo');
  assert(!JSON.stringify(callLog).includes('pat-token-999'));
});
