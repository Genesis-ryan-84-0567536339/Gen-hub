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
  GITEA_TOOLS,
  isDefaultGiteaUrl
} from '../server/gitea-mcp.mjs';
import { connectionGuide } from '../public/connection-guides.js';

test('giteaTools returns 59 standardized tools with published: false and appropriate annotations', () => {
  const tools = giteaTools();
  assert.equal(tools.length, 59);

  const expectedNames = [
    // Files
    'get_file_contents',
    'create_or_update_file',
    'push_files',
    // Repo & Commits
    'get_repository',
    'create_repository',
    'fork_repository',
    'list_commits',
    'get_commit',
    'list_repo_topics',
    'set_repo_topics',
    // Branches & Tags
    'list_branches',
    'create_branch',
    'list_tags',
    'create_tag',
    'delete_tag',
    // PRs & Reviews
    'list_pull_requests',
    'create_pull_request',
    'pull_request_read',
    'merge_pull_request',
    'list_pr_commits',
    'list_pr_reviews',
    'create_pr_review',
    // Issues
    'list_issues',
    'issue_read',
    'update_issue',
    'add_issue_comment',
    'gitea_issue_create',
    'gitea_issue_close',
    'gitea_issue_label',
    // Labels
    'list_repo_labels',
    'get_repo_label',
    'create_repo_label',
    'update_repo_label',
    'delete_repo_label',
    // Milestones
    'list_milestones',
    'get_milestone',
    'create_milestone',
    'update_milestone',
    'delete_milestone',
    // Releases
    'list_releases',
    'get_release',
    'create_release',
    'delete_release',
    // Collaborators
    'list_collaborators',
    'check_collaborator',
    'add_collaborator',
    'remove_collaborator',
    // Search
    'search_repositories',
    'search_issues',
    'search_users',
    // Orgs & Teams
    'list_user_orgs',
    'get_org',
    'list_org_repos',
    'list_org_teams',
    'list_team_members',
    // Webhooks
    'list_repo_hooks',
    'get_repo_hook',
    'create_repo_hook',
    'delete_repo_hook'
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
});

test('catalog registers gitea-mcp provider correctly with 59 tools', () => {
  const p = provider('gitea-mcp');
  assert(p);
  assert.equal(p.id, 'gitea-mcp');
  assert.equal(p.name, 'Gitea MCP (pilot)');
  assert.equal(p.category, 'Phát triển');
  assert.equal(p.auth, 'PAT');
  assert.equal(p.tools.length, 59);
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

  await assert.rejects(
    () => giteaCall('update_issue', { owner: 'o', repo: 'r', issue_number: 1, state: 'invalid' }, { token: 'pat' }),
    /state phải là/
  );

  await assert.rejects(
    () => giteaCall('update_issue', { owner: 'o', repo: 'r', issue_number: -5 }, { token: 'pat' }),
    /ngoài phạm vi|Schema/
  );
});

test('giteaCall executes broad scope of tools with mock requests', async () => {
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

    if (url.endsWith('/repos/test-owner/test-repo') && options.method === 'GET') {
      return { status: 200, json: { id: 1, name: 'test-repo', full_name: 'test-owner/test-repo' } };
    }

    if (url.endsWith('/user/repos') && options.method === 'POST') {
      return { status: 201, json: { id: 2, name: options.body.name } };
    }

    if (url.includes('/forks') && options.method === 'POST') {
      return { status: 202, json: { id: 3, name: 'forked-repo' } };
    }

    if (url.includes('/commits') && options.method === 'GET') {
      return { status: 200, json: [{ sha: 'sha-c1', commit: { message: 'first commit' } }] };
    }

    if (url.includes('/git/commits/sha-c1') && options.method === 'GET') {
      return { status: 200, json: { sha: 'sha-c1', message: 'first commit details' } };
    }

    if (url.includes('/topics') && options.method === 'GET') {
      return { status: 200, json: { topics: ['go', 'gitea'] } };
    }

    if (url.includes('/topics') && options.method === 'PUT') {
      return { status: 200, json: { topics: options.body.topics } };
    }

    if (url.includes('/branches') && options.method === 'GET') {
      return {
        status: 200,
        json: [{ name: 'main', commit: { id: 'c1' }, protected: true }]
      };
    }

    if (url.includes('/branches') && options.method === 'POST') {
      return { status: 201, json: { name: options.body.new_branch_name, commit: { id: 'c3' } } };
    }

    if (url.includes('/tags') && options.method === 'GET') {
      return { status: 200, json: [{ name: 'v1.0.0', id: 'tag-1' }] };
    }

    if (url.includes('/tags') && options.method === 'POST') {
      return { status: 201, json: { name: options.body.tag_name, message: options.body.message } };
    }

    if (url.includes('/tags/v1.0.0') && options.method === 'DELETE') {
      return { status: 204 };
    }

    if (url.includes('/pulls/10/reviews') && options.method === 'POST') {
      return { status: 200, json: { id: 50, state: options.body.event, body: options.body.body } };
    }

    if (url.includes('/issues/42') && options.method === 'PATCH') {
      return {
        status: 200,
        json: {
          number: 42,
          title: options.body.title || 'Bug report',
          body: options.body.body || 'Fixed description',
          state: options.body.state || 'closed',
          user: { username: 'reporter' },
          assignees: (options.body.assignees || []).map(u => ({ username: u })),
          milestone: options.body.milestone ? { id: options.body.milestone, title: 'v1.0' } : null,
          labels: [{ name: 'bug' }],
          updated_at: '2026-09-11T00:00:00Z'
        }
      };
    }

    if (url.includes('/labels') && options.method === 'GET') {
      return { status: 200, json: [{ id: 1, name: 'bug', color: '#ff0000' }] };
    }

    if (url.includes('/labels/1') && options.method === 'GET') {
      return { status: 200, json: { id: 1, name: 'bug', color: '#ff0000' } };
    }

    if (url.endsWith('/labels') && options.method === 'POST') {
      return { status: 201, json: { id: 2, name: options.body.name, color: options.body.color } };
    }

    if (url.includes('/labels/1') && options.method === 'PATCH') {
      return { status: 200, json: { id: 1, name: options.body.name || 'bug', color: options.body.color } };
    }

    if (url.includes('/labels/1') && options.method === 'DELETE') {
      return { status: 204 };
    }

    if (url.includes('/milestones') && options.method === 'GET') {
      return { status: 200, json: [{ id: 10, title: 'v1.0', state: 'open' }] };
    }

    if (url.includes('/milestones/10') && options.method === 'GET') {
      return { status: 200, json: { id: 10, title: 'v1.0', state: 'open' } };
    }

    if (url.endsWith('/milestones') && options.method === 'POST') {
      return { status: 201, json: { id: 11, title: options.body.title, state: 'open' } };
    }

    if (url.includes('/milestones/10') && options.method === 'PATCH') {
      return { status: 200, json: { id: 10, title: options.body.title || 'v1.0', state: 'closed' } };
    }

    if (url.includes('/milestones/10') && options.method === 'DELETE') {
      return { status: 204 };
    }

    if (url.includes('/releases') && options.method === 'GET') {
      return { status: 200, json: [{ id: 20, tag_name: 'v1.0.0', name: 'Release 1.0' }] };
    }

    if (url.includes('/releases/20') && options.method === 'GET') {
      return { status: 200, json: { id: 20, tag_name: 'v1.0.0', name: 'Release 1.0' } };
    }

    if (url.endsWith('/releases') && options.method === 'POST') {
      return { status: 201, json: { id: 21, tag_name: options.body.tag_name, name: options.body.name } };
    }

    if (url.includes('/releases/20') && options.method === 'DELETE') {
      return { status: 204 };
    }

    if (url.includes('/collaborators') && options.method === 'GET') {
      return { status: 200, json: [{ id: 5, login: 'collab1' }] };
    }

    if (url.includes('/collaborators/collab1') && options.method === 'GET') {
      return { status: 204 };
    }

    if (url.includes('/collaborators/collab1') && options.method === 'PUT') {
      return { status: 204 };
    }

    if (url.includes('/collaborators/collab1') && options.method === 'DELETE') {
      return { status: 204 };
    }

    if (url.includes('/repos/search') && options.method === 'GET') {
      return { status: 200, json: { data: [{ id: 1, name: 'repo-found' }] } };
    }

    if (url.includes('/repos/issues/search') && options.method === 'GET') {
      return { status: 200, json: { data: [{ id: 10, title: 'issue-found' }] } };
    }

    if (url.includes('/users/search') && options.method === 'GET') {
      return { status: 200, json: { data: [{ id: 100, username: 'user-found' }] } };
    }

    if (url.includes('/user/orgs') && options.method === 'GET') {
      return { status: 200, json: [{ id: 1, username: 'my-org' }] };
    }

    if (url.includes('/orgs/my-org') && options.method === 'GET') {
      return { status: 200, json: { id: 1, name: 'my-org', full_name: 'My Organization' } };
    }

    if (url.includes('/orgs/my-org/repos') && options.method === 'GET') {
      return { status: 200, json: [{ id: 1, name: 'org-repo' }] };
    }

    if (url.includes('/orgs/my-org/teams') && options.method === 'GET') {
      return { status: 200, json: [{ id: 7, name: 'dev-team' }] };
    }

    if (url.includes('/teams/7/members') && options.method === 'GET') {
      return { status: 200, json: [{ id: 3, username: 'member1' }] };
    }

    if (url.includes('/hooks') && options.method === 'GET') {
      return { status: 200, json: [{ id: 30, type: 'gitea' }] };
    }

    if (url.includes('/hooks/30') && options.method === 'GET') {
      return { status: 200, json: { id: 30, type: 'gitea', config: { url: 'https://webhook.site/test' } } };
    }

    if (url.endsWith('/hooks') && options.method === 'POST') {
      return { status: 201, json: { id: 31, type: options.body.type } };
    }

    if (url.includes('/hooks/30') && options.method === 'DELETE') {
      return { status: 204 };
    }

    return { status: 404, json: { message: 'Not found' } };
  };

  const opts = { url: 'http://gitea:3000', token: 'secret-pat', request: mockRequest };
  const repoArgs = { owner: 'test-owner', repo: 'test-repo' };

  // Repo operations
  const rRepo = await giteaCall('get_repository', repoArgs, opts);
  assert.equal(rRepo.isError, false);

  const rNewRepo = await giteaCall('create_repository', { name: 'my-new-repo' }, opts);
  assert.equal(rNewRepo.isError, false);

  const rFork = await giteaCall('fork_repository', repoArgs, opts);
  assert.equal(rFork.isError, false);

  const rCommits = await giteaCall('list_commits', repoArgs, opts);
  assert.equal(rCommits.isError, false);

  const rCommit = await giteaCall('get_commit', { ...repoArgs, sha: 'sha-c1' }, opts);
  assert.equal(rCommit.isError, false);

  const rTopics = await giteaCall('list_repo_topics', repoArgs, opts);
  assert.equal(rTopics.isError, false);

  const rSetTopics = await giteaCall('set_repo_topics', { ...repoArgs, topics: ['gitea', 'mcp'] }, opts);
  assert.equal(rSetTopics.isError, false);

  // Tags
  const rTags = await giteaCall('list_tags', repoArgs, opts);
  assert.equal(rTags.isError, false);

  const rNewTag = await giteaCall('create_tag', { ...repoArgs, tag_name: 'v1.1.0' }, opts);
  assert.equal(rNewTag.isError, false);

  const rDelTag = await giteaCall('delete_tag', { ...repoArgs, tag_name: 'v1.0.0' }, opts);
  assert.equal(rDelTag.isError, false);

  // Reviews
  const rReview = await giteaCall('create_pr_review', { ...repoArgs, pull_number: 10, event: 'APPROVED', body: 'Looks good' }, opts);
  assert.equal(rReview.isError, false);

  // Issues
  const rUpdateIssue = await giteaCall('update_issue', {
    ...repoArgs,
    issue_number: 42,
    title: 'Updated Title',
    body: 'Updated Body',
    state: 'closed',
    assignees: ['dev1'],
    milestone: 10
  }, opts);
  assert.equal(rUpdateIssue.isError, false);
  const updatedData = JSON.parse(rUpdateIssue.content[0].text);
  assert.equal(updatedData.number, 42);
  assert.equal(updatedData.title, 'Updated Title');
  assert.equal(updatedData.state, 'closed');
  assert.equal(updatedData.body, 'Updated Body');
  assert.deepEqual(updatedData.assignees, [{ username: 'dev1' }]);
  assert.equal(updatedData.milestone.id, 10);

  // Labels
  const rLabels = await giteaCall('list_repo_labels', repoArgs, opts);
  assert.equal(rLabels.isError, false);

  const rNewLabel = await giteaCall('create_repo_label', { ...repoArgs, name: 'feat', color: '#00ff00' }, opts);
  assert.equal(rNewLabel.isError, false);

  const rUpdateLabel = await giteaCall('update_repo_label', { ...repoArgs, label_id: 1, color: '#0000ff' }, opts);
  assert.equal(rUpdateLabel.isError, false);

  const rDelLabel = await giteaCall('delete_repo_label', { ...repoArgs, label_id: 1 }, opts);
  assert.equal(rDelLabel.isError, false);

  // Milestones
  const rMilestones = await giteaCall('list_milestones', repoArgs, opts);
  assert.equal(rMilestones.isError, false);

  const rNewMilestone = await giteaCall('create_milestone', { ...repoArgs, title: 'v2.0' }, opts);
  assert.equal(rNewMilestone.isError, false);

  const rUpdateMilestone = await giteaCall('update_milestone', { ...repoArgs, milestone_id: 10, state: 'closed' }, opts);
  assert.equal(rUpdateMilestone.isError, false);

  const rDelMilestone = await giteaCall('delete_milestone', { ...repoArgs, milestone_id: 10 }, opts);
  assert.equal(rDelMilestone.isError, false);

  // Releases
  const rReleases = await giteaCall('list_releases', repoArgs, opts);
  assert.equal(rReleases.isError, false);

  const rNewRelease = await giteaCall('create_release', { ...repoArgs, tag_name: 'v1.1.0', name: 'Release 1.1' }, opts);
  assert.equal(rNewRelease.isError, false);

  const rDelRelease = await giteaCall('delete_release', { ...repoArgs, release_id: 20 }, opts);
  assert.equal(rDelRelease.isError, false);

  // Collaborators
  const rCollabs = await giteaCall('list_collaborators', repoArgs, opts);
  assert.equal(rCollabs.isError, false);

  const rCheckCollab = await giteaCall('check_collaborator', { ...repoArgs, collaborator: 'collab1' }, opts);
  assert.equal(rCheckCollab.isError, false);

  const rAddCollab = await giteaCall('add_collaborator', { ...repoArgs, collaborator: 'collab1', permission: 'write' }, opts);
  assert.equal(rAddCollab.isError, false);

  const rRemCollab = await giteaCall('remove_collaborator', { ...repoArgs, collaborator: 'collab1' }, opts);
  assert.equal(rRemCollab.isError, false);

  // Search
  const rSearchRepos = await giteaCall('search_repositories', { q: 'gitea' }, opts);
  assert.equal(rSearchRepos.isError, false);

  const rSearchIssues = await giteaCall('search_issues', { q: 'bug' }, opts);
  assert.equal(rSearchIssues.isError, false);

  const rSearchUsers = await giteaCall('search_users', { q: 'alice' }, opts);
  assert.equal(rSearchUsers.isError, false);

  // Orgs & Teams
  const rOrgs = await giteaCall('list_user_orgs', {}, opts);
  assert.equal(rOrgs.isError, false);

  const rOrg = await giteaCall('get_org', { org: 'my-org' }, opts);
  assert.equal(rOrg.isError, false);

  const rOrgRepos = await giteaCall('list_org_repos', { org: 'my-org' }, opts);
  assert.equal(rOrgRepos.isError, false);

  const rOrgTeams = await giteaCall('list_org_teams', { org: 'my-org' }, opts);
  assert.equal(rOrgTeams.isError, false);

  const rTeamMembers = await giteaCall('list_team_members', { team_id: 7 }, opts);
  assert.equal(rTeamMembers.isError, false);

  // Webhooks
  const rHooks = await giteaCall('list_repo_hooks', repoArgs, opts);
  assert.equal(rHooks.isError, false);

  const rHook = await giteaCall('get_repo_hook', { ...repoArgs, hook_id: 30 }, opts);
  assert.equal(rHook.isError, false);

  const rNewHook = await giteaCall('create_repo_hook', { ...repoArgs, type: 'gitea', target_url: 'https://example.com/hook' }, opts);
  assert.equal(rNewHook.isError, false);

  const rDelHook = await giteaCall('delete_repo_hook', { ...repoArgs, hook_id: 30 }, opts);
  assert.equal(rDelHook.isError, false);
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
  assert.equal(m.tools.length, 59);
  assert(m.tools.every(t => t.published === false));

  // 2. Set credential for internal Gitea
  const synced = await adminCall('connector_set_token', {
    id: m.id,
    token: 'pat-token-999'
  });

  assert.equal(probedUrl, 'http://gitea:3000/api/v1/user');
  assert.equal(probeHeaders.Authorization, 'token pat-token-999');
  assert.equal(synced.status, 'connected');
  assert.equal(synced.url, DEFAULT_GITEA_URL);
  assert.equal(synced.allowPrivate, true);
  assert.equal(synced.tools.length, 59);
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
  assert.equal(calledUrl, 'http://gitea:3000/api/v1/repos/test-org/test-repo/issues');

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

test('gitea-mcp SSRF prevention and allowPrivate handling', async t => {
  // 1. Helper function checks
  assert.equal(isDefaultGiteaUrl(DEFAULT_GITEA_URL), true);
  assert.equal(isDefaultGiteaUrl('http://gitea:3000'), true);
  assert.equal(isDefaultGiteaUrl('http://gitea:3000/api/v1'), true);
  assert.equal(isDefaultGiteaUrl('http://gitea:3000/api/v1/'), true);
  assert.equal(isDefaultGiteaUrl(), true);
  assert.equal(isDefaultGiteaUrl(''), true);

  assert.equal(isDefaultGiteaUrl('http://192.168.1.100:3000/api/v1'), false);
  assert.equal(isDefaultGiteaUrl('http://10.0.0.5/api/v1'), false);
  assert.equal(isDefaultGiteaUrl('http://169.254.169.254/latest/meta-data'), false);
  assert.equal(isDefaultGiteaUrl('https://gitea.example.com/api/v1'), false);

  // 2. Default Gitea URL automatically allows private network
  let capturedOpts = null;
  const mockInspect = async (url, opts) => {
    capturedOpts = opts;
    return { status: 200, json: { id: 1, name: 'repo' } };
  };

  await giteaCall('get_repository', { owner: 'o', repo: 'r' }, {
    url: DEFAULT_GITEA_URL,
    token: 'tok',
    request: mockInspect
  });
  assert.equal(capturedOpts.allowPrivate, true, 'Default URL must auto-enable allowPrivate');

  // Also when url option is omitted (defaults to DEFAULT_GITEA_URL)
  capturedOpts = null;
  await giteaCall('get_repository', { owner: 'o', repo: 'r' }, {
    token: 'tok',
    request: mockInspect
  });
  assert.equal(capturedOpts.allowPrivate, true, 'Omitted URL defaults to default Gitea and enables allowPrivate');

  // 3. Custom URL pointing to private network without allowPrivate has allowPrivate = false
  capturedOpts = null;
  await giteaCall('get_repository', { owner: 'o', repo: 'r' }, {
    url: 'http://192.168.1.100:3000/api/v1',
    token: 'tok',
    allowPrivate: false,
    request: mockInspect
  });
  assert.equal(capturedOpts.allowPrivate, false, 'Custom private URL without allowPrivate must have allowPrivate: false');

  // Custom URL without specifying allowPrivate also defaults to false
  capturedOpts = null;
  await giteaCall('get_repository', { owner: 'o', repo: 'r' }, {
    url: 'http://192.168.1.100:3000/api/v1',
    token: 'tok',
    request: mockInspect
  });
  assert.equal(capturedOpts.allowPrivate, false, 'Custom private URL with omitted allowPrivate must have allowPrivate: false');

  // 4. Custom URL with explicit allowPrivate: true gets allowPrivate = true
  capturedOpts = null;
  await giteaCall('get_repository', { owner: 'o', repo: 'r' }, {
    url: 'http://192.168.1.100:3000/api/v1',
    token: 'tok',
    allowPrivate: true,
    request: mockInspect
  });
  assert.equal(capturedOpts.allowPrivate, true, 'Custom private URL with explicit allowPrivate: true gets allowPrivate: true');

  // 5. Verification against real Hub network layer:
  // Custom private IP request fails SSRF check when allowPrivate is not set
  await assert.rejects(
    () => giteaCall('get_repository', { owner: 'o', repo: 'r' }, {
      url: 'http://192.168.1.100:3000/api/v1',
      token: 'tok'
    }),
    /Địa chỉ mạng riêng chưa được owner cho phép/
  );

  await assert.rejects(
    () => giteaCall('get_repository', { owner: 'o', repo: 'r' }, {
      url: 'http://10.0.0.5/api/v1',
      token: 'tok'
    }),
    /Địa chỉ mạng riêng chưa được owner cho phép/
  );

  // 6. Hub lifecycle check: connector_add / POST /api/mcps and credential endpoint
  const x = await fixture(t);

  // 6a. Default URL auto-sets allowPrivate: true
  const addDefaultRes = await x.call('/api/mcps', 'POST', {
    provider: 'gitea-mcp',
    name: 'Default Gitea'
  });
  assert.equal(addDefaultRes.status, 201);
  assert.equal(addDefaultRes.data.allowPrivate, true);

  // 6b. Custom URL without allowPrivate -> allowPrivate: false
  const addCustomRes = await x.call('/api/mcps', 'POST', {
    provider: 'gitea-mcp',
    name: 'Custom Gitea',
    url: 'http://192.168.1.100:3000/api/v1'
  });
  assert.equal(addCustomRes.status, 201);
  assert.equal(addCustomRes.data.allowPrivate, false);

  // 6c. Custom URL with allowPrivate: true -> allowPrivate: true
  const addCustomAllowedRes = await x.call('/api/mcps', 'POST', {
    provider: 'gitea-mcp',
    name: 'Custom Allowed Gitea',
    url: 'http://192.168.1.100:3000/api/v1',
    allowPrivate: true
  });
  assert.equal(addCustomAllowedRes.status, 201);
  assert.equal(addCustomAllowedRes.data.allowPrivate, true);

  // 6d. Updating credential with custom private URL without allowPrivate -> disables allowPrivate
  // and sync attempt with real request rejects with SSRF error
  const credUpdateRes = await x.call(`/api/mcps/${addDefaultRes.data.id}/credential`, 'POST', {
    url: 'http://192.168.1.100:3000/api/v1',
    token: 'some-token'
  });
  assert.equal(credUpdateRes.status, 400);
  assert.match(credUpdateRes.data.error, /mạng riêng/);
});
