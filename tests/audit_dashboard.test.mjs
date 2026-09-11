import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { latencyStats, classifyError } from '../server/audit-metrics.mjs';
import { HubError, assertSchema } from '../server/net.mjs';
import { fixture } from './helpers.mjs';
const range = { since: '2026-09-10T00:00:00.000Z', until: '2026-09-11T00:00:00.000Z' };
const seed = (
  store,
  {
    actor = 'agent-a',
    mcp = 'mcp-a',
    tool = 'merge',
    status = 'success',
    latency = 100,
    created = '2026-09-10T01:00:00.000Z',
    meta = {}
  } = {}
) => {
  const r = store.audit(
    actor,
    mcp,
    tool,
    status,
    { sensitivePayload: 'must-not-fetch' },
    {},
    latency,
    '',
    meta
  );
  store.db.prepare('UPDATE audit SET created=? WHERE id=?').run(created, Number(r.lastInsertRowid));
  return Number(r.lastInsertRowid);
};
const apiSummary = (x, filters = {}) =>
  x.call('/api/logs/summary?' + new URLSearchParams({ ...range, ...filters }));

test('O1/O3: 32 tool calls + 4 system events; 7 validation and 1 conflict; exact drill-down and metadata only', async t => {
  const x = await fixture(t),
    store = x.hub.store;
  for (let i = 0; i < 24; i++) seed(store, { latency: (i + 1) * 100 });
  for (let i = 0; i < 7; i++)
    seed(store, {
      status: 'error',
      latency: i + 1,
      meta: { policyDecision: 'allow', errorCategory: 'validation' }
    });
  seed(store, {
    status: 'error',
    latency: 3505,
    meta: { policyDecision: 'allow', errorCategory: 'upstream_tool_conflict' }
  });
  for (let i = 0; i < 4; i++)
    seed(store, { actor: 'system', mcp: 'hub', tool: 'system.update', latency: undefined });
  let { data: summary, status } = await apiSummary(x);
  assert.equal(status, 200);
  assert.equal(summary.totals.calls, 32);
  assert.equal(summary.totals.success, 24);
  assert.equal(summary.totals.error, 8);
  assert.equal(summary.totals.errorRate, 0.25);
  assert.equal(summary.totals.callsPerMinute, 32 / 1440);
  assert.equal(summary.totals.errorCategories.validation, 7);
  assert.equal(summary.totals.errorCategories.upstream_tool_conflict, 1);
  assert.equal(
    summary.buckets.reduce((n, b) => n + b.calls, 0),
    32
  );
  assert.equal(summary.data.otherEvents.system, 4);
  assert.equal(summary.totals.latency.success.p95, 2300);
  assert.equal(summary.totals.latency.error.p95, 3505);
  assert.equal(summary.totals.latency.error.smallSample, true);
  assert(!JSON.stringify(summary).includes('sensitivePayload'));
  const empty = summary.buckets.find(b => b.calls === 0);
  assert.equal(empty.errorRate, null);
  assert.equal(empty.latency.success.p95, null);
  const bucket = summary.buckets.find(b => b.error);
  const query = new URLSearchParams({
    since: bucket.start,
    before: bucket.end,
    eventKind: 'tool_call',
    actorType: 'agent',
    errorCategory: 'validation'
  });
  const page = (await x.call('/api/logs?' + query + '&paginate=true')).data;
  assert.equal(page.rows.length, 7);
  assert(
    page.rows.every(r => !('input' in r) && r.policyDecision === 'allow' && r.outcome === 'error')
  );
  const exportRows = (await x.call('/api/logs?' + query + '&includePayload=true')).data;
  assert.deepEqual(
    exportRows.map(r => r.id),
    page.rows.map(r => r.id)
  );
  for (const actor of ['owner', 'admin-assistant:agent-a', 'system']) seed(store, { actor });
  const after = (await apiSummary(x)).data;
  assert.deepEqual(after.totals, summary.totals);
  // A broken encrypted payload cannot affect a metadata summary.
  store.db.prepare("UPDATE audit SET payload='not-ciphertext'").run();
  assert.deepEqual((await apiSummary(x)).data.totals, summary.totals);
});

test('O4: fixed nearest-rank percentiles, separate distributions, histogram and empty/small samples', () => {
  const values = Array.from({ length: 100 }, (_, i) => 100 - i);
  const stats = latencyStats(values);
  assert.equal(stats.p50, 50);
  assert.equal(stats.p95, 95);
  assert.equal(stats.smallSample, false);
  assert.equal(stats.histogram.find(b => b.le === 50).count, 50);
  assert.equal(stats.histogram.at(-1).count, 100);
  assert.equal(latencyStats([9, 1, 3, 2]).p95, 9);
  assert.equal(latencyStats([0]).p95, 0);
  assert.equal(latencyStats([]).p95, null);
  assert.equal(latencyStats(Array(19).fill(1)).smallSample, true);
  assert.equal(latencyStats(Array(20).fill(1)).smallSample, false);
  // Aggregate source samples, not the average of the per-group p95s (550).
  assert.equal(latencyStats([...Array(100).fill(100), 1000]).p95, 100);
});

test('O1 migration: raw history unchanged across reopen, conservative classification, unmeasured zero excluded', t => {
  const dir = mkdtempSync(join(tmpdir(), 'audit-c-legacy-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'master.key'), randomBytes(32));
  const db = new DatabaseSync(join(dir, 'hub.db'));
  db.exec(
    'CREATE TABLE audit (id INTEGER PRIMARY KEY AUTOINCREMENT,created TEXT NOT NULL,actor TEXT NOT NULL,mcp TEXT NOT NULL,tool TEXT NOT NULL,status TEXT NOT NULL,latency INTEGER NOT NULL,payload TEXT NOT NULL); PRAGMA user_version=1;'
  );
  const insert = db.prepare(
    'INSERT INTO audit(created,actor,mcp,tool,status,latency,payload) VALUES(?,?,?,?,?,?,?)'
  );
  insert.run(range.since, 'agent-old', 'mcp-gone', 'merge', 'error', 3505, 'encrypted-history');
  insert.run(range.since, 'owner', 'mcp-gone', 'merge', 'success', 0, 'encrypted-history-2');
  insert.run(range.since, 'unknown-uuid', 'mcp-gone', 'merge', 'error', 0, 'encrypted-history-3');
  insert.run(range.since, 'agent-old', 'mcp-gone', 'merge', 'success', 0, 'encrypted-history-4');
  const before = db.prepare('SELECT * FROM audit').all();
  db.close();
  let store = openStore(dir);
  let summary = store.summary(range);
  assert.equal(summary.totals.calls, 2);
  assert.equal(summary.totals.latency.success.n, 0);
  assert.equal(summary.totals.latency.error.n, 1);
  assert.equal(summary.data.unclassifiedRecords, 2);
  const row = store.logs(1, { id: 1, includePayload: false })[0];
  assert.equal(row.classification, 'legacy');
  assert.equal(row.policyDecision, null);
  assert.equal(row.errorCategory, 'unclassified');
  store.close();
  store = openStore(dir);
  try {
    assert.deepEqual(
      store.db.prepare('SELECT id,created,actor,mcp,tool,status,latency,payload FROM audit').all(),
      before
    );
    assert.equal(
      store.db.prepare('SELECT COUNT(*) AS n FROM audit WHERE eventKind IS NOT NULL').get().n,
      0
    );
  } finally {
    store.close();
  }
});

test('O3: >5000 records, identity grouping, exclusive boundaries, adaptive buckets, API guards and retention', async t => {
  const x = await fixture(t),
    store = x.hub.store;
  store.tx(() => {
    for (let i = 0; i < 5100; i++) seed(store, { mcp: i % 2 ? 'mcp-a' : 'mcp-b' });
  });
  seed(store, { created: range.until });
  seed(store, { created: '2026-09-09T23:59:59.999Z' });
  const summary = (await apiSummary(x)).data;
  assert.equal(summary.totals.calls, 5100);
  assert.equal(summary.connectors.length, 2);
  assert.equal(summary.tools.length, 2);
  assert(summary.connectors.every(g => g.calls === 2550));
  assert.equal((await apiSummary(x, { mcp: 'mcp-b' })).data.totals.calls, 2550);
  assert.equal((await apiSummary(x, { until: '2026-09-10T02:00:00Z' })).data.bucketMs, 300000);
  assert.equal((await apiSummary(x, { since: '2026-08-01T00:00:00Z' })).data.bucketMs, 86400000);
  store.put('settings', 'main', { retention: 7 });
  assert.equal(
    (
      await apiSummary(x, {
        since: new Date(Date.now() - 30 * 86400000).toISOString(),
        until: new Date().toISOString()
      })
    ).data.data.incomplete,
    true
  );
  for (const filters of [
    { since: 'bad' },
    { until: range.since },
    { errorCategory: 'oops' },
    { cursor: '1' },
    { secret: 'id' },
    { includePayload: 'true' },
    { since: '2020-01-01' }
  ])
    assert.equal((await apiSummary(x, filters)).status, 400);
  assert.equal((await x.call('/api/logs/summary', 'GET', undefined, { Cookie: '' })).status, 401);
});

const invoke = (x, token, name, args = {}, admin = false) =>
  x.call(
    admin ? '/mcp/admin' : '/mcp',
    'POST',
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
    { Authorization: 'Bearer ' + token }
  );
test('O1 runtime: ALLOW + conflict, validation vs transport, denial, missing name and pre-dispatch 401/429', async t => {
  let mode = 'success';
  const x = await fixture(t, {
    sync: async () => [
      {
        name: 'merge',
        inputSchema: { type: 'object', required: ['sha'], properties: { sha: { type: 'string' } } },
        annotations: { readOnlyHint: true }
      }
    ],
    call: async () => {
      if (mode === 'success') return { content: [], isError: false };
      if (mode === 'conflict')
        return { content: [{ type: 'text', text: 'merge conflict' }], isError: true };
      throw new HubError('upstream failure', Number(mode));
    }
  });
  const m = (
    await x.call('/api/mcps', 'POST', {
      provider: 'remote',
      name: 'Test',
      url: 'https://example.com/mcp',
      auth: 'none'
    })
  ).data;
  await x.call('/api/mcps/' + m.id + '/sync', 'POST');
  const a = (await x.call('/api/agents', 'POST', { name: 'Test', permissions: [m.id + ':merge'] }))
    .data;
  const last = () => x.hub.store.logs(1, { actor: a.id })[0];
  await invoke(x, a.token, m.id + '__merge');
  assert.equal(last().errorCategory, 'validation');
  assert.equal(last().policyDecision, 'allow');
  mode = 'conflict';
  await invoke(x, a.token, m.id + '__merge', { sha: 'known' });
  assert.equal(last().policyDecision, 'allow');
  assert.equal(last().outcome, 'error');
  assert.equal(last().errorCategory, 'upstream_tool_conflict');
  assert(last().phases.connectorTotal >= 0);
  for (const [code, category] of [
    [502, 'upstream_transport'],
    [504, 'timeout'],
    [429, 'rate_limit'],
    [409, 'upstream_tool_conflict']
  ]) {
    mode = String(code);
    await invoke(x, a.token, m.id + '__merge', { sha: 'known' });
    assert.equal(last().errorCategory, category);
    assert.equal(last().policyDecision, 'allow');
  }
  await invoke(x, a.token, m.id + '__not_granted');
  assert.equal(last().policyDecision, 'deny');
  assert.equal(last().errorCategory, 'denied');
  await invoke(x, a.token, undefined);
  assert.equal(last().eventKind, 'tool_call');
  assert.equal(last().errorCategory, 'validation');
  const record = x.hub.store.get('agent', a.id);
  x.hub.store.put('agent', a.id, { ...record, isAdmin: true });
  await invoke(x, a.token, m.id + '__not_granted');
  assert.equal(last().actorType, 'admin');
  assert.equal(last().eventKind, 'admin_action');
  x.hub.store.put('agent', a.id, record);
  assert.equal(last().actorType, 'admin', 'Recorded role survives later role changes');
  assert.equal((await invoke(x, 'invalid', m.id + '__merge')).status, 401);
  for (let i = 0; i < 241; i++)
    await x.call(
      '/mcp',
      'POST',
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      { Authorization: 'Bearer ' + a.token }
    );
  const s = (await x.call('/api/logs/summary')).data;
  assert.equal(s.totals.calls, 8);
  assert.equal(s.totals.denied, 1);
  assert.equal(s.data.securityErrors.authentication, 1);
  assert(s.data.securityErrors.rate_limit > 0);
  assert.equal(s.totals.latency.error.n, 7);
});

test('O1: admin operation correlation and Vault one call/one measured audit without secret', async t => {
  const x = await fixture(t);
  const admin = (await x.call('/api/admin-assistant', 'POST', { password: 'owner-password-123' }))
    .data;
  await invoke(x, admin.token, 'settings_update', { name: 'Updated' }, true);
  const rows = x.hub.store.logs(10).filter(r => r.actor === 'admin-assistant:' + admin.id);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].operationId, rows[1].operationId);
  assert(rows.every(r => r.eventKind === 'admin_action'));
  const secret = (await x.call('/api/vault', 'POST', { name: 'Secret', secret: 'CANARY_VALUE' }))
    .data;
  const a = (
    await x.call('/api/agents', 'POST', { name: 'Reader', permissions: ['vault:' + secret.id] })
  ).data;
  await invoke(x, a.token, 'vault__' + secret.id);
  await invoke(x, a.token, 'vault__' + secret.id, { invalid: true });
  const calls = x.hub.store.logs(10, { actor: a.id });
  assert.equal(calls.length, 2);
  assert(calls.every(r => r.latencyMeasured === 1));
  assert.equal(calls[0].errorCategory, 'validation');
  assert.equal(calls[1].outcome, 'success');
  assert(!JSON.stringify(calls).includes('CANARY_VALUE'));
});

test('O1 classification uses error type/phase, never free-text provider messages for validation', () => {
  assert.equal(classifyError(new HubError('missing sha', 502), 'upstream'), 'upstream_transport');
  assert.equal(classifyError(new HubError('validation', 401), 'upstream'), 'authentication');
  assert.equal(classifyError(new Error('boom'), 'internal'), 'internal');
  assert.throws(
    () => assertSchema({ required: ['sha'] }, {}),
    e => classifyError(e, 'upstream') === 'validation'
  );
});

test('O4 instrumented MCP initializes, calls, cleans up and preserves upstream 429 classification', async t => {
  const { connectorService } = await import('../server/connectors.mjs');
  const { withAuditTiming, measurePhase } = await import('../server/audit-timing.mjs');
  const x = await fixture(t);
  let status = 200;
  const service = connectorService(x.hub.store, {
    mcpRequest: async (url, opts) => ({
      status,
      headers: { 'mcp-session-id': 'mock-session' },
      json: { id: opts.body?.id, result: { content: [], isError: false } }
    })
  });
  const m = { id: 'mcp-remote', provider: 'remote', url: 'https://example.com/mcp' };
  const phases = {};
  await withAuditTiming(phases, async () => {
    await measurePhase('credentialRefresh', async () => {});
    await service.call(m, 'echo', {});
  });
  const event = x.hub.store.audit('agent-phase', m.id, 'echo', 'success', {}, {}, 1, '', {
    phases
  });
  const detail = await x.call('/api/logs/' + event.lastInsertRowid);
  assert.equal(
    typeof detail.data.phases.credentialRefresh,
    'number',
    'Timing metadata must survive secret redaction'
  );
  for (const phase of ['initialize', 'upstreamCall', 'cleanup']) assert(phases[phase] >= 0, phase);
  status = 429;
  await assert.rejects(
    () => service.call(m, 'echo', {}),
    e => e.status === 502 && classifyError(e, 'upstream') === 'rate_limit'
  );
});
