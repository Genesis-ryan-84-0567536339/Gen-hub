import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
import { kanbanService, issueColumn } from '../server/kanban.mjs';
import { kanbanCards, kanbanPage } from '../public/kanban.js';

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

test('Kanban Archive: Manual archive immediately archives all current Done issues', async t => {
  let issuesList = [
    issue(1, { title: 'Finished task 1', state: 'closed' }), // Done
    issue(2, { title: 'Finished task 2', labels: ['Status: Done'] }), // Done
    issue(3, { title: 'Active task 3', labels: ['Status: Backlog'] }) // Backlog
  ];

  const x = await fixture(
    t,
    {
      call: async () => result(issuesList)
    },
    { fetchFn: async () => ({ ok: false, status: 503 }) }
  );

  const m = source(x);
  const config = { repository: 'owner/project', connectorId: m.id };
  await x.call('/api/kanban', 'PATCH', config);

  // 1. Initial read: 2 Done issues, 1 Backlog issue
  const beforeData = (await x.call('/api/kanban')).data;
  assert.equal(beforeData.issues.length, 3);
  assert.equal(beforeData.issues.filter(i => i.column === 'Done').length, 2);

  // 2. Auth checks on POST /api/kanban/archive-done
  // Unauthenticated fails 401
  const unauth = await x.call('/api/kanban/archive-done', 'POST', {}, { Cookie: '' });
  assert.equal(unauth.status, 401);

  // Missing CSRF fails 403
  const noCsrf = await x.call('/api/kanban/archive-done', 'POST', {}, { 'X-CSRF-Token': '' });
  assert.equal(noCsrf.status, 403);

  // 3. Perform manual archive
  const archiveRes = await x.call('/api/kanban/archive-done', 'POST');
  assert.equal(archiveRes.status, 200);
  assert.equal(archiveRes.data.ok, true);
  assert.equal(archiveRes.data.archivedCount, 2);

  // 4. Check audit log
  const logs = x.hub.store.logs(5);
  const archiveLog = logs.find(l => l.tool === 'kanban.archive_done');
  assert(archiveLog, 'kanban.archive_done audit log must be recorded');
  assert.equal(archiveLog.input.count, 2);

  // 5. Subsequent read returns only Backlog issue; Done issues are hidden
  const afterData = (await x.call('/api/kanban')).data;
  assert.equal(afterData.issues.length, 1);
  assert.equal(afterData.issues[0].number, 3);
  assert.equal(afterData.issues.filter(i => i.column === 'Done').length, 0);

  // 6. Config preserves archived list
  const storedConfig = x.hub.store.get('kanban', 'config');
  assert.equal(storedConfig.archived.length, 2);
  assert.ok(storedConfig.archived.includes('owner/project#1'));
  assert.ok(storedConfig.archived.includes('owner/project#2'));
  assert.equal(Object.keys(storedConfig.doneObservedAt).length, 0);

  // 7. UI markup check
  const cardsHtml = kanbanCards(afterData);
  assert.match(cardsHtml, /Chuyển lưu trữ toàn bộ cột Done/);
  assert.match(cardsHtml, /disabled/); // Disabled because Done has 0 issues now

  const pageHtml = kanbanPage(afterData, [m]);
  assert.match(pageHtml, /Đã lưu trữ: <strong>2<\/strong> issue hoàn thành/);
});

test('Kanban Archive: Issue in Done for 25h is auto-archived; 23h in Done is not archived', async t => {
  const issuesList = [
    issue(10, { title: 'Old Done task', state: 'closed' }),
    issue(20, { title: 'Recent Done task', state: 'closed' }),
    issue(30, { title: 'In Progress task', labels: ['Status: In Progress'] })
  ];

  const x = await fixture(
    t,
    {
      call: async () => result(issuesList)
    },
    { fetchFn: async () => ({ ok: false, status: 503 }) }
  );

  const m = source(x);
  const board = kanbanService(x.hub.store, {
    call: async () => result(issuesList)
  });
  board.configure({ repository: 'owner/project', connectorId: m.id }, 'owner');

  const now = Date.now();
  // Simulate:
  // Issue 10 was first observed in Done 25 hours ago
  // Issue 20 was first observed in Done 23 hours ago
  const tMinus25h = new Date(now - 25 * 3600 * 1000).toISOString();
  const tMinus23h = new Date(now - 23 * 3600 * 1000).toISOString();

  x.hub.store.put('kanban', 'config', {
    repository: 'owner/project',
    connectorId: m.id,
    archived: [],
    doneObservedAt: {
      'owner/project#10': tMinus25h,
      'owner/project#20': tMinus23h
    }
  });

  // Call read at current time `now`
  const data = await board.read(now);

  // Issue 10 (25h) should be auto-archived and hidden
  assert(!data.issues.some(i => i.number === 10), 'Issue 10 must be auto-archived after 25h');

  // Issue 20 (23h) should still be visible in Done
  const issue20 = data.issues.find(i => i.number === 20);
  assert(issue20, 'Issue 20 must remain visible after only 23h');
  assert.equal(issue20.column, 'Done');

  // Issue 30 is unaffected
  assert(data.issues.some(i => i.number === 30));

  // Verify stored config
  const cfg = board.config();
  assert.deepEqual(cfg.archived, ['owner/project#10']);
  assert.equal(cfg.doneObservedAt['owner/project#10'], undefined);
  assert.equal(cfg.doneObservedAt['owner/project#20'], tMinus23h);
});

test('Kanban Archive: Issue leaving Done before 24h resets tracking; timer restarts if it returns to Done', async t => {
  const currentIssues = [
    issue(42, { title: 'Flipping task', state: 'closed' }) // initially Done
  ];

  const x = await fixture(t, null, { fetchFn: async () => ({ ok: false, status: 503 }) });
  const m = source(x);
  const board = kanbanService(x.hub.store, {
    call: async () => result(currentIssues)
  });
  board.configure({ repository: 'owner/project', connectorId: m.id }, 'owner');

  const T0 = Date.now();

  // 1. Initial read at T0 -> Observed in Done
  const read1 = await board.read(T0);
  assert.equal(read1.issues.length, 1);
  assert.equal(read1.issues[0].column, 'Done');
  const cfg1 = board.config();
  assert.equal(cfg1.doneObservedAt['owner/project#42'], new Date(T0).toISOString());
  assert.equal(cfg1.archived.length, 0);

  // 2. At T0 + 10 hours: Issue is reopened / moved to "In Progress"
  currentIssues[0] = issue(42, { title: 'Flipping task', state: 'open', labels: ['Status: In Progress'] });
  const T1 = T0 + 10 * 3600 * 1000;
  const read2 = await board.read(T1);
  assert.equal(read2.issues.length, 1);
  assert.equal(read2.issues[0].column, 'In Progress');

  // Tracking must be RESET
  const cfg2 = board.config();
  assert.equal(cfg2.doneObservedAt['owner/project#42'], undefined, 'doneObservedAt must be cleared when leaving Done');
  assert.equal(cfg2.archived.length, 0);

  // 3. At T0 + 20 hours: Issue is closed again / moved back to Done
  currentIssues[0] = issue(42, { title: 'Flipping task', state: 'closed' });
  const T2 = T0 + 20 * 3600 * 1000;
  const read3 = await board.read(T2);
  assert.equal(read3.issues.length, 1);
  assert.equal(read3.issues[0].column, 'Done');

  // New timestamp must be T2 (T0 + 20h), NOT T0
  const cfg3 = board.config();
  assert.equal(cfg3.doneObservedAt['owner/project#42'], new Date(T2).toISOString());

  // 4. At T0 + 35 hours (15 hours after returning to Done, but 35 hours since T0):
  // Since only 15h have elapsed since T2 (< 24h), it must NOT be auto-archived!
  const T3 = T0 + 35 * 3600 * 1000;
  const read4 = await board.read(T3);
  assert.equal(read4.issues.length, 1, 'Issue must NOT be archived because it was reset and only 15h in Done');
  assert.equal(read4.issues[0].number, 42);

  // 5. At T0 + 45 hours (25 hours after returning to Done at T2):
  // Now 25h >= 24h, it must be auto-archived!
  const T4 = T0 + 45 * 3600 * 1000;
  const read5 = await board.read(T4);
  assert.equal(read5.issues.length, 0, 'Issue must be auto-archived 25h after returning to Done');

  const cfg5 = board.config();
  assert.deepEqual(cfg5.archived, ['owner/project#42']);
  assert.equal(cfg5.doneObservedAt['owner/project#42'], undefined);
});

test('Kanban Archive: Gitea multi-repo board archive operates provider-agnostically across repos', async t => {
  const giteaIssues = {
    'repo-a': [issue(1, { title: 'Done in repo A', state: 'closed' })],
    'repo-b': [
      issue(1, { title: 'Done in repo B', state: 'closed' }),
      issue(2, { title: 'Backlog in repo B', labels: ['Status: Backlog'] })
    ]
  };

  const x = await fixture(t, null, { fetchFn: async () => ({ ok: false, status: 503 }) });
  const m = {
    id: 'mcp-gitea',
    provider: 'gitea-mcp',
    name: 'Gitea',
    on: true,
    status: 'connected',
    auth: 'token',
    secret: x.hub.store.seal({ token: 'gitea-token' }),
    tools: [{ name: 'list_issues', published: false }]
  };
  x.hub.store.put('mcp', m.id, m);

  const board = kanbanService(x.hub.store, {
    call: async (connector, toolName, args) => {
      if (toolName === 'search_repositories') {
        return result({
          data: [{ full_name: 'team/repo-a' }, { full_name: 'team/repo-b' }]
        });
      }
      if (toolName === 'list_issues') {
        const repo = args.repo;
        return result(giteaIssues[repo] || []);
      }
      return result([]);
    }
  });

  board.configure({ connectorId: m.id }, 'owner');
  const initial = await board.read();
  assert.equal(initial.issues.length, 3);
  assert.equal(initial.issues.filter(i => i.column === 'Done').length, 2);

  // Manual archive across multi-repo
  const archiveResult = await board.archiveDone('owner');
  assert.equal(archiveResult.archivedCount, 2);

  const after = await board.read();
  assert.equal(after.issues.length, 1);
  assert.equal(after.issues[0].repo, 'team/repo-b');
  assert.equal(after.issues[0].number, 2);

  const cfg = board.config();
  assert.ok(cfg.archived.includes('team/repo-a#1'));
  assert.ok(cfg.archived.includes('team/repo-b#1'));
});

test('Kanban Archive: Archived issues remain preserved in config across reconfiguration, but hidden from results', async t => {
  const issuesList = [
    issue(1, { title: 'Archived task 1', state: 'closed' }),
    issue(2, { title: 'Open task 2', labels: ['Status: Backlog'] })
  ];

  const x = await fixture(t, null, { fetchFn: async () => ({ ok: false, status: 503 }) });
  const m1 = source(x, 'github');
  const m2 = {
    id: 'mcp-test-2',
    provider: 'github',
    name: 'GitHub 2',
    on: true,
    status: 'connected',
    auth: 'token',
    secret: x.hub.store.seal({ token: 'key-2' }),
    tools: [{ name: 'list_issues', published: false }]
  };
  x.hub.store.put('mcp', m2.id, m2);

  const board = kanbanService(x.hub.store, {
    call: async () => result(issuesList)
  });

  // Seed with pre-existing archived issue
  x.hub.store.put('kanban', 'config', {
    repository: 'owner/project',
    connectorId: m1.id,
    archived: ['owner/project#1'],
    doneObservedAt: {}
  });

  const data = await board.read();
  // Issue 1 must be filtered out
  assert.equal(data.issues.length, 1);
  assert.equal(data.issues[0].number, 2);

  // Reconfigure board to a new repository and connector
  const newCfg = board.configure({ repository: 'owner/new-repo', connectorId: m2.id }, 'owner');
  // Archived items must NOT be lost during reconfiguration
  assert.deepEqual(newCfg.archived, ['owner/project#1']);

  const storedCfg = x.hub.store.get('kanban', 'config');
  assert.deepEqual(storedCfg.archived, ['owner/project#1']);
});

