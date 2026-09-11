import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
import { kanbanService, issueColumn, giteaWebBase, normalize } from '../server/kanban.mjs';
import { connectorService } from '../server/connectors.mjs';
import { kanbanPage, kanbanCards } from '../public/kanban.js';

const issue = (number, extra = {}) => ({
  number,
  title: 'Issue ' + number,
  state: 'open',
  labels: [],
  assignees: [],
  ...extra
});
const result = data => ({ content: [{ type: 'text', text: JSON.stringify(data) }] });
function source(x, provider = 'github') {
  const m = {
    id: 'mcp-test',
    provider,
    name: 'GitHub',
    on: true,
    status: 'connected',
    auth: 'token',
    secret: x.hub.store.seal({ token: 'synthetic-connector-key' }),
    tools: [{ name: 'list_issues', published: false }]
  };
  x.hub.store.put('mcp', m.id, m);
  return m;
}
test('Kanban maps explicit status labels, closed issues and conflicting labels deterministically', () => {
  assert.equal(issueColumn(issue(1, { labels: ['agent:claude'] })), 'Backlog');
  assert.equal(issueColumn(issue(1, { labels: [{ name: 'Status: In Progress' }] })), 'In Progress');
  assert.equal(issueColumn(issue(1, { labels: ['status:ready', 'Status: Review'] })), 'Review');
  assert.equal(issueColumn(issue(1, { state: 'CLOSED', labels: ['Status: Ready'] })), 'Done');
});
test('owner board uses the existing REST connector, paginates, excludes PRs and never exposes credentials', async t => {
  const requests = [];
  const x = await fixture(t, null, { fetchFn: async () => ({ ok: false, status: 503 }) });
  const m = source(x);
  const up = connectorService(x.hub.store, {
    serviceRequest: async (url, opts) => {
      requests.push({ url, opts });
      return {
        status: 200,
        json:
          new URL(url).searchParams.get('page') === '1'
            ? Array.from({ length: 100 }, (_, i) =>
                issue(i + 1, i === 0 ? { pull_request: {} } : {})
              )
            : [
                issue(101, {
                  state: 'closed',
                  body: 'not sent to frontend',
                  html_url: 'javascript:alert(1)'
                })
              ]
      };
    }
  });
  const board = kanbanService(x.hub.store, up);
  board.configure({ repository: 'owner/project', connectorId: m.id }, 'owner');
  const data = await board.read();
  assert.equal(data.issues.length, 100);
  assert.equal(data.issues[0].column, 'Done');
  assert.equal(data.issues[0].url, 'https://github.com/owner/project/issues/101');
  assert.equal(requests.length, 2);
  assert.equal(new URL(requests[1].url).searchParams.get('page'), '2');
  assert.equal(requests[0].opts.headers.Authorization, 'Bearer synthetic-connector-key');
  assert(!JSON.stringify(data).includes('synthetic-connector-key'));
  assert(!JSON.stringify(data).includes('not sent to frontend'));
  await board.read();
  assert.equal(requests.length, 2);
  assert.throws(() =>
    board.configure({ repository: 'owner/../../outside', connectorId: m.id }, 'owner')
  );
});
test('GitHub MCP board uses cursor pagination and normalizes its response', async t => {
  const x = await fixture(t, null, { fetchFn: async () => ({ ok: false, status: 503 }) });
  const m = source(x, 'github-mcp'),
    calls = [];
  const board = kanbanService(x.hub.store, {
    call: async (m, name, args) => {
      calls.push({ name, args });
      return result({
        issues: [issue(args.after ? 2 : 1)],
        pageInfo: { hasNextPage: !args.after, endCursor: 'next-page' }
      });
    }
  });
  board.configure({ repository: 'owner/project', connectorId: m.id }, 'owner');
  assert.equal((await board.read()).issues.length, 2);
  assert.equal(calls[1].args.after, 'next-page');
  assert.equal(calls[1].args.page, undefined);
  assert.equal(calls[0].args.state, undefined);
});
test('failed pagination keeps the prior complete snapshot; source changes invalidate in-flight results', async t => {
  const x = await fixture(t, null, { fetchFn: async () => ({ ok: false, status: 503 }) });
  const m = source(x);
  let fail = false;
  const board = kanbanService(x.hub.store, {
    call: async () => {
      if (fail) throw Error('sensitive-upstream-detail');
      return result([issue(1)]);
    }
  });
  board.configure({ repository: 'owner/project', connectorId: m.id }, 'owner');
  const first = await board.read();
  const now = Date.now();
  t.mock.method(Date, 'now', () => now + 121000);
  fail = true;
  const stale = await board.read();
  assert.equal(stale.stale, true);
  assert.equal(stale.fetchedAt, first.fetchedAt);
  assert.deepEqual(stale.issues, first.issues);
  assert(!stale.error.includes('sensitive-upstream-detail'));
  let resolve;
  const racing = kanbanService(x.hub.store, {
    call: () =>
      new Promise(r => {
        resolve = r;
      })
  });
  const pending = racing.read();
  x.hub.store.put('mcp', m.id, { ...m, on: false });
  resolve(result([issue(2)]));
  await assert.rejects(pending, /connector GitHub/);
  await assert.rejects(board.read(), /connector GitHub/);
});
test('Kanban API requires owner session and CSRF; markup escapes issue content and only links to normalized URLs', async t => {
  const x = await fixture(
    t,
    {
      call: async () =>
        result([issue(1, { title: '<script>alert(1)</script>', labels: ['Status: Ready'] })])
    },
    { fetchFn: async () => ({ ok: false, status: 503 }) }
  );
  const m = source(x);
  assert.equal((await x.call('/api/kanban')).data.configured, false);
  const config = { repository: 'owner/project', connectorId: m.id };
  assert.equal((await x.call('/api/kanban', 'PATCH', config, { 'X-CSRF-Token': '' })).status, 403);
  assert.equal((await x.call('/api/kanban', 'PATCH', config)).status, 200);
  assert.equal((await x.call('/api/kanban', 'GET', undefined, { Cookie: '' })).status, 401);
  const data = (await x.call('/api/kanban')).data;
  assert.equal(data.issues[0].column, 'Ready');
  const html = kanbanPage(data, [m]);
  assert(!html.includes('<script>'));
  assert(html.includes('&lt;script&gt;'));
  assert(!html.includes('synthetic-connector-key'));
});

test('Gitea multi-repo Kanban board discovers all repos, excludes PRs, attaches repo and constructs safe URLs', async t => {
  const x = await fixture(t, null, { fetchFn: async () => ({ ok: false, status: 503 }) });
  const m = {
    id: 'mcp-gitea',
    provider: 'gitea-mcp',
    name: 'Gitea Self-Host',
    url: 'http://gitea:3000/api/v1',
    on: true,
    status: 'connected',
    auth: 'token',
    secret: x.hub.store.seal({ token: 'gitea-secret-token' }),
    tools: [
      { name: 'search_repositories', published: false },
      { name: 'list_issues', published: false }
    ]
  };
  x.hub.store.put('mcp', m.id, m);

  const calls = [];
  const board = kanbanService(x.hub.store, {
    call: async (connector, toolName, args) => {
      calls.push({ toolName, args });
      if (toolName === 'search_repositories') {
        return result({
          ok: true,
          data: [
            { name: 'core', owner: { login: 'ryan' }, full_name: 'ryan/core' },
            { name: 'docs', owner: { login: 'ryan' }, full_name: 'ryan/docs' }
          ]
        });
      }
      if (toolName === 'list_issues') {
        if (args.repo === 'core') {
          return result([
            issue(1, {
              title: 'Fix issue core',
              labels: ['status:in-progress'],
              assignees: [{ username: 'agent-1' }],
              updated_at: '2026-09-11T10:00:00Z'
            }),
            issue(2, {
              title: 'Pull request 2',
              pull_request: { merged: false }
            })
          ]);
        }
        if (args.repo === 'docs') {
          return result([
            issue(1, {
              title: 'Docs issue 1',
              state: 'closed',
              updated_at: '2026-09-11T12:00:00Z'
            })
          ]);
        }
      }
      return result([]);
    }
  });

  // Gitea configuration does NOT require repository
  const configured = board.configure({ connectorId: m.id }, 'owner');
  assert.equal(configured.connectorId, m.id);
  assert.equal(configured.repository, '');

  const data = await board.read();
  assert.equal(data.configured, true);
  assert.equal(data.stale, false);
  assert.equal(data.truncated, false);
  assert.equal(data.issues.length, 2);

  // Issue 1 in docs was updated later (12:00 vs 10:00), so it comes first
  const docsIssue = data.issues.find(i => i.repo === 'ryan/docs');
  const coreIssue = data.issues.find(i => i.repo === 'ryan/core');

  assert(docsIssue, 'Docs issue must exist');
  assert(coreIssue, 'Core issue must exist');

  assert.equal(docsIssue.id, 'ryan/docs#1');
  assert.equal(docsIssue.column, 'Done');
  assert.equal(docsIssue.url, 'http://gitea:3000/ryan/docs/issues/1');
  assert.equal(docsIssue.repo, 'ryan/docs');

  assert.equal(coreIssue.id, 'ryan/core#1');
  assert.equal(coreIssue.column, 'In Progress');
  assert.equal(coreIssue.url, 'http://gitea:3000/ryan/core/issues/1');
  assert.equal(coreIssue.repo, 'ryan/core');
  assert.deepEqual(coreIssue.assignees, ['agent-1']);

  // Pull request #2 in core was excluded
  assert(!data.issues.some(i => i.number === 2));

  // No secrets leaked
  assert(!JSON.stringify(data).includes('gitea-secret-token'));

  // giteaWebBase normalization checks
  assert.equal(giteaWebBase('http://gitea:3000/api/v1'), 'http://gitea:3000');
  assert.equal(giteaWebBase('http://gitea:3000/api/v1/'), 'http://gitea:3000');
  assert.equal(giteaWebBase('https://hub.example.com/gitea/api/v1'), 'https://hub.example.com/gitea');
  assert.equal(giteaWebBase('javascript:alert(1)'), 'http://gitea:3000');
});

test('Gitea multi-repo Kanban handles error caching and UI filtering by repo/agent', async t => {
  const x = await fixture(t, null, { fetchFn: async () => ({ ok: false, status: 503 }) });
  const m = {
    id: 'mcp-gitea',
    provider: 'gitea-mcp',
    name: 'Gitea Self-Host',
    on: true,
    status: 'connected',
    auth: 'token',
    secret: x.hub.store.seal({ token: 'gitea-token' }),
    tools: [{ name: 'list_issues', published: false }]
  };
  x.hub.store.put('mcp', m.id, m);

  let fail = false;
  const board = kanbanService(x.hub.store, {
    call: async (connector, toolName, args) => {
      if (fail) throw new Error('gitea-db-timeout');
      if (toolName === 'search_repositories') {
        return result({
          data: [{ full_name: 'team/repo-1' }, { full_name: 'team/repo-2' }]
        });
      }
      if (toolName === 'list_issues') {
        if (args.repo === 'repo-1') {
          return result([
            issue(1, {
              title: 'Task 1',
              labels: ['agent:claude', 'status:ready'],
              assignees: ['agent-bob']
            })
          ]);
        }
        return result([
          issue(2, {
            title: 'Task 2',
            labels: ['agent:codex', 'status:backlog'],
            assignees: ['agent-alice']
          })
        ]);
      }
      return result([]);
    }
  });

  board.configure({ connectorId: m.id }, 'owner');
  const initial = await board.read();
  assert.equal(initial.issues.length, 2);

  // Stale snapshot on error
  const now = Date.now();
  t.mock.method(Date, 'now', () => now + 121000);
  fail = true;
  const staleData = await board.read();
  assert.equal(staleData.stale, true);
  assert.equal(staleData.issues.length, 2);
  assert(!staleData.error.includes('gitea-db-timeout'));
  assert.match(staleData.error, /Gitea/);

  // UI tests
  const html = kanbanPage(initial, [m]);
  assert.match(html, /Tất cả issue từ Gitea/);
  assert.match(html, /team\/repo-1/);
  assert.match(html, /team\/repo-2/);

  // kanbanCards filtering by repo
  const repo1Cards = kanbanCards(initial, '', { repo: 'team/repo-1' });
  assert.match(repo1Cards, /Task 1/);
  assert(!repo1Cards.includes('Task 2'));

  // kanbanCards filtering by agent
  const claudeCards = kanbanCards(initial, '', { agent: 'claude' });
  assert.match(claudeCards, /Task 1/);
  assert(!claudeCards.includes('Task 2'));

  const aliceCards = kanbanCards(initial, '', { agent: 'agent-alice' });
  assert.match(aliceCards, /Task 2/);
  assert(!aliceCards.includes('Task 1'));

  // Text search filters across repo
  const textFiltered = kanbanCards(initial, 'repo-2');
  assert.match(textFiltered, /Task 2/);
  assert(!textFiltered.includes('Task 1'));
});
