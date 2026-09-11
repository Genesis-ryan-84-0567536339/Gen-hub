import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';

test('Audit Query O2: regression list_issues outside 200 most recent logs', async t => {
  const x = await fixture(t);
  const targetIds = [];

  // Insert 4 list_issues logs first
  for (let i = 0; i < 4; i++) {
    const res = x.hub.store.audit(
      'agt-10001',
      'mcp-54413',
      'list_issues',
      'success',
      { repo: 'Gen-hub', page: i + 1 },
      { count: 10 }
    );
    targetIds.push(Number(res.lastInsertRowid));
  }

  // Insert 220 newer logs of other tools so list_issues is pushed beyond the top 200
  for (let i = 0; i < 220; i++) {
    x.hub.store.audit(
      'agt-10002',
      'mcp-54413',
      'get_issue',
      'success',
      { id: i },
      { title: `Issue ${i}` }
    );
  }

  // Verify total count > 220
  const totalCount = x.hub.store.logs(300).length;
  assert.ok(totalCount >= 224, `Total logs should be >= 224, got ${totalCount}`);

  // 1. Query server-side by tool=list_issues
  const resByTool = await x.call('/api/logs?tool=list_issues&paginate=true');
  assert.equal(resByTool.status, 200);
  assert.ok(resByTool.data.rows, 'Response should have rows property');
  assert.equal(resByTool.data.rows.length, 4, 'Should find all 4 list_issues logs outside top 200');
  const foundIds = resByTool.data.rows.map(r => r.id).sort((a, b) => a - b);
  assert.deepEqual(foundIds, targetIds.sort((a, b) => a - b));

  // 2. Query server-side by general search q=list_issues
  const resByQ = await x.call('/api/logs?q=list_issues&paginate=true');
  assert.equal(resByQ.status, 200);
  assert.equal(resByQ.data.rows.length, 4, 'Search q=list_issues should find all 4 logs');
});

test('Audit Query O2: search by agent display name ("Agy3") resolves server-side', async t => {
  const x = await fixture(t);

  // Create two agents
  x.hub.store.put('agent', 'agt-agy3', {
    id: 'agt-agy3',
    name: 'Agy3',
    status: 'active',
    permissions: []
  });
  x.hub.store.put('agent', 'agt-agy2', {
    id: 'agt-agy2',
    name: 'Agy2',
    status: 'active',
    permissions: []
  });

  // Insert logs for both agents
  for (let i = 0; i < 5; i++) {
    x.hub.store.audit('agt-agy3', 'mcp-54413', 'tool_a', 'success', {}, {});
  }
  for (let i = 0; i < 3; i++) {
    x.hub.store.audit('agt-agy2', 'mcp-54413', 'tool_b', 'success', {}, {});
  }

  // 1. Query by actor=Agy3 (display name)
  const resByName = await x.call('/api/logs?actor=Agy3&paginate=true');
  assert.equal(resByName.status, 200);
  assert.equal(resByName.data.rows.length, 5, 'Should return exactly 5 logs for agent Agy3');
  assert.ok(resByName.data.rows.every(r => r.actor === 'agt-agy3'));

  // 2. Query by actor=agt-agy3 (raw ID)
  const resById = await x.call('/api/logs?actor=agt-agy3&paginate=true');
  assert.equal(resById.status, 200);
  assert.equal(resById.data.rows.length, 5);
  assert.ok(resById.data.rows.every(r => r.actor === 'agt-agy3'));

  // 3. Query by general search q=Agy3
  const resByQ = await x.call('/api/logs?q=Agy3&paginate=true');
  assert.equal(resByQ.status, 200);
  assert.equal(resByQ.data.rows.length, 5);
  assert.ok(resByQ.data.rows.every(r => r.actor === 'agt-agy3'));
});

test('Audit Query O2: keyset cursor pagination does not duplicate or miss rows when new events arrive', async t => {
  const x = await fixture(t);

  // Insert 105 logs with sequential markers for specific actor
  for (let i = 1; i <= 105; i++) {
    x.hub.store.audit('agt-pag', 'mcp-test', `op_${i}`, 'success', { step: i }, {});
  }

  // Page 1: limit 40
  const page1 = await x.call('/api/logs?actor=agt-pag&limit=40&paginate=true');
  assert.equal(page1.status, 200);
  assert.equal(page1.data.rows.length, 40);
  assert.equal(page1.data.hasMore, true);
  assert.ok(page1.data.nextCursor);

  // While client is reading Page 1, 5 new logs are inserted (e.g. incoming agent calls)
  for (let i = 1; i <= 5; i++) {
    x.hub.store.audit('agt-pag', 'mcp-test', `new_op_${i}`, 'success', {}, {});
  }

  // Page 2: limit 40, cursor from page 1
  const page2 = await x.call(`/api/logs?actor=agt-pag&limit=40&cursor=${page1.data.nextCursor}&paginate=true`);
  assert.equal(page2.status, 200);
  assert.equal(page2.data.rows.length, 40);
  assert.equal(page2.data.hasMore, true);
  assert.ok(page2.data.nextCursor);

  // Page 3: limit 40, cursor from page 2
  const page3 = await x.call(`/api/logs?actor=agt-pag&limit=40&cursor=${page2.data.nextCursor}&paginate=true`);
  assert.equal(page3.status, 200);
  assert.equal(page3.data.rows.length, 25);
  assert.equal(page3.data.hasMore, false);
  assert.equal(page3.data.nextCursor, null);

  // Verify that all 105 original logs are present across pages 1, 2, 3 with NO duplicates and NO omissions
  const allIds = [
    ...page1.data.rows.map(r => r.id),
    ...page2.data.rows.map(r => r.id),
    ...page3.data.rows.map(r => r.id)
  ];
  assert.equal(allIds.length, 105, 'Total retrieved logs should be exactly 105');
  const uniqueIds = new Set(allIds);
  assert.equal(uniqueIds.size, 105, 'Every retrieved log ID must be unique (no duplicates)');

  // Verify descending order
  for (let i = 0; i < allIds.length - 1; i++) {
    assert.ok(allIds[i] > allIds[i + 1], 'IDs must be in strictly descending order');
  }
});

test('Audit Query O2: combined filters (status, actor, connector, latency, since, until) apply proper AND logic in SQL', async t => {
  const x = await fixture(t);

  // 1. Target log: matches all criteria
  const target = x.hub.store.audit(
    'agt-target',
    'mcp-target',
    'deploy',
    'error',
    {},
    {},
    150
  );
  x.hub.store.db.prepare("UPDATE audit SET created = '2026-09-01T12:00:00.000Z' WHERE id = ?").run(target.lastInsertRowid);

  // 2. Different status (success)
  const l2 = x.hub.store.audit('agt-target', 'mcp-target', 'deploy', 'success', {}, {}, 150);
  x.hub.store.db.prepare("UPDATE audit SET created = '2026-09-01T12:00:00.000Z' WHERE id = ?").run(l2.lastInsertRowid);

  // 3. Different actor
  const l3 = x.hub.store.audit('agt-other', 'mcp-target', 'deploy', 'error', {}, {}, 150);
  x.hub.store.db.prepare("UPDATE audit SET created = '2026-09-01T12:00:00.000Z' WHERE id = ?").run(l3.lastInsertRowid);

  // 4. Different connector
  const l4 = x.hub.store.audit('agt-target', 'mcp-other', 'deploy', 'error', {}, {}, 150);
  x.hub.store.db.prepare("UPDATE audit SET created = '2026-09-01T12:00:00.000Z' WHERE id = ?").run(l4.lastInsertRowid);

  // 5. Different latency (too low)
  const l5 = x.hub.store.audit('agt-target', 'mcp-target', 'deploy', 'error', {}, {}, 50);
  x.hub.store.db.prepare("UPDATE audit SET created = '2026-09-01T12:00:00.000Z' WHERE id = ?").run(l5.lastInsertRowid);

  // 6. Different latency (too high)
  const l6 = x.hub.store.audit('agt-target', 'mcp-target', 'deploy', 'error', {}, {}, 350);
  x.hub.store.db.prepare("UPDATE audit SET created = '2026-09-01T12:00:00.000Z' WHERE id = ?").run(l6.lastInsertRowid);

  // 7. Different date (too early)
  const l7 = x.hub.store.audit('agt-target', 'mcp-target', 'deploy', 'error', {}, {}, 150);
  x.hub.store.db.prepare("UPDATE audit SET created = '2026-08-25T12:00:00.000Z' WHERE id = ?").run(l7.lastInsertRowid);

  // Execute combined query
  const query = new URLSearchParams({
    actor: 'agt-target',
    status: 'error',
    connector: 'mcp-target',
    tool: 'deploy',
    since: '2026-09-01T00:00:00.000Z',
    until: '2026-09-02T00:00:00.000Z',
    minLatency: '100',
    maxLatency: '200',
    paginate: 'true'
  });

  const res = await x.call('/api/logs?' + query);
  assert.equal(res.status, 200);
  assert.equal(res.data.rows.length, 1, 'Only the exact matching log must be returned');
  assert.equal(res.data.rows[0].actor, 'agt-target');
  assert.equal(res.data.rows[0].status, 'error');
  assert.equal(res.data.rows[0].mcp, 'mcp-target');
  assert.equal(res.data.rows[0].tool, 'deploy');
  assert.equal(res.data.rows[0].latency, 150);

  // status='ok' matches 'success'
  const okRes = await x.call('/api/logs?status=ok&actor=agt-target&paginate=true');
  assert.equal(okRes.status, 200);
  assert.ok(okRes.data.rows.every(r => r.status === 'success'));
});

test('Audit Query O2: list view excludes unsealed payload vs GET /api/logs/:id returns decrypted payload', async t => {
  const x = await fixture(t);

  const inserted = x.hub.store.audit(
    'agt-secret',
    'vault',
    'read_credential',
    'success',
    { token: 'secret-token-value', account: 'prod-db' },
    { connectionString: 'postgres://user:pass@host/db', records: [1, 2, 3] },
    42,
    'Agent granted access via policy'
  );
  const logId = Number(inserted.lastInsertRowid);

  // 1. List query (metadata only)
  const listRes = await x.call('/api/logs?id=' + logId + '&paginate=true');
  assert.equal(listRes.status, 200);
  assert.equal(listRes.data.rows.length, 1);
  const metaRow = listRes.data.rows[0];

  assert.equal(metaRow.id, logId);
  assert.equal(metaRow.actor, 'agt-secret');
  assert.equal(metaRow.mcp, 'vault');
  assert.equal(metaRow.tool, 'read_credential');
  assert.equal(metaRow.status, 'success');
  assert.equal(metaRow.latency, 42);
  // CRITICAL: payload must NOT be decrypted in list view
  assert.equal(metaRow.input, undefined, 'List view must not contain input payload');
  assert.equal(metaRow.output, undefined, 'List view must not contain output payload');
  assert.equal(metaRow.reason, undefined, 'List view must not contain reason');

  // 2. Detail query GET /api/logs/:id
  const detailRes = await x.call('/api/logs/' + logId);
  assert.equal(detailRes.status, 200);
  const detail = detailRes.data;

  assert.equal(detail.id, logId);
  assert.equal(detail.actor, 'agt-secret');
  assert.equal(detail.status, 'success');
  assert.equal(detail.latency, 42);
  assert.equal(detail.reason, 'Agent granted access via policy');
  // Payload decrypted and sensitive fields redacted
  assert.equal(detail.input.token, '[REDACTED]', 'Sensitive token field must be redacted');
  assert.equal(detail.input.account, 'prod-db');
  assert.deepEqual(detail.output.records, [1, 2, 3]);

  // 3. Detail query on non-existent ID returns 404
  const notFound = await x.call('/api/logs/9999999');
  assert.equal(notFound.status, 404);
});

test('Audit Query O2: parameter validation errors', async t => {
  const x = await fixture(t);

  const badCases = [
    { until: 'not-a-date' },
    { status: 'not-a-status' },
    { minLatency: '-1' },
    { minLatency: 'abc' },
    { maxLatency: '-10' },
    { cursor: '0' },
    { cursor: 'xyz' },
    { id: '0' },
    { id: 'invalid' }
  ];

  for (const c of badCases) {
    const res = await x.call('/api/logs?' + new URLSearchParams(c));
    assert.equal(res.status, 400, `Expected 400 for ${JSON.stringify(c)}, got ${res.status}`);
  }
});
