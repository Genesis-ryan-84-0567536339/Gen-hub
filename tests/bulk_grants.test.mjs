import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
import { seedMonitor } from './monitor-fixture.mjs';

const path = '/api/agents/bulk-grants';
const draft = { agentIds: ['agent-one', 'agent-two'], permissions: ['mcp-one:echo', 'mcp-two:unused'] };
const saved = s => s.list('agent').map(a => [a.id, a.permissions]);
async function preview(x, data = draft) {
  const r = await x.call(path, 'POST', { ...data, preview: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return { ...data, previewToken: r.data.previewToken };
}

test('Bulk grants previews then adds atomically, retains all prior rights and is idempotent', async t => {
  const x = await fixture(t); const s = x.hub.store; seedMonitor(s);
  s.put('agent', 'agent-one', { ...s.get('agent', 'agent-one'), permissions: ['mcp-one:echo', 'vault:existing', 'mcp-two:private'] });
  const before = saved(s); const count = s.logs(100).length;
  const request = await preview(x);
  assert.deepEqual(saved(s), before, 'preview does not change permissions');
  assert.equal(s.logs(100).length, count, 'preview does not write audit');
  const r = await x.call(path, 'POST', request);
  assert.equal(r.status, 200); assert.equal(r.data.addedCount, 3);
  assert.deepEqual(s.get('agent', 'agent-one').permissions, ['mcp-one:echo', 'vault:existing', 'mcp-two:private', 'mcp-two:unused']);
  assert.deepEqual(s.get('agent', 'agent-two').permissions, ['mcp-two:echo', 'mcp-one:echo', 'mcp-two:unused']);
  assert.equal(s.logs(1)[0].tool, 'agent.bulk_grants');
  assert.equal(s.logs(1)[0].eventKind, 'admin_action');
  const repeated = await x.call(path, 'POST', await preview(x));
  assert.equal(repeated.data.addedCount, 0);
  assert.equal(s.logs(100).length, count + 1, 'no duplicate mutation audit for no-op');
  const monitor = (await x.call('/api/monitor')).data;
  assert.ok(monitor.tools.find(t => t.mcpId === 'mcp-two' && t.name === 'unused').callableBy.includes('agent-one'));
});

test('Bulk grants rejects incomplete, stale, revoked, unpublished, secret and unauthenticated requests without partial writes', async t => {
  const x = await fixture(t); const s = x.hub.store; seedMonitor(s);
  const before = saved(s);
  for (const data of [
    { ...draft, agentIds: [] }, { ...draft, agentIds: ['agent-one', 'missing'] },
    { ...draft, agentIds: Array(101).fill('agent-one') },
    { ...draft, permissions: ['mcp-one:echo', 'mcp-two:private'] },
    { ...draft, permissions: ['vault:any'] }, { ...draft, permissions: [] },
    { ...draft, permissions: ['mcp-one:echo:invalid'] },
    draft
  ]) {
    assert.ok((await x.call(path, 'POST', data)).status >= 400);
    assert.deepEqual(saved(s), before);
  }
  assert.equal((await x.call(path, 'POST', draft, { Cookie: '' })).status, 401);
  assert.equal((await x.call(path, 'POST', draft, { 'X-CSRF-Token': '' })).status, 403);
  const request = await preview(x);
  s.put('agent', 'agent-two', { ...s.get('agent', 'agent-two'), permissions: [] });
  assert.equal((await x.call(path, 'POST', request)).status, 409, 'changed grants require another preview');
  assert.deepEqual(s.get('agent', 'agent-one').permissions, before[0][1]);
  const next = await preview(x);
  s.put('agent', 'agent-two', { ...s.get('agent', 'agent-two'), status: 'revoked' });
  assert.equal((await x.call(path, 'POST', next)).status, 409);
  assert.deepEqual(s.get('agent', 'agent-one').permissions, before[0][1]);
});

test('Bulk grants rolls back the entire transaction if persistence fails', async t => {
  const x = await fixture(t); seedMonitor(x.hub.store);
  const s = x.hub.store; const request = await preview(x); const before = saved(s);
  const original = s.put;
  s.put = (kind, id, value) => {
    if (kind === 'agent' && id === 'agent-two') throw Error('Simulated write failure');
    return original(kind, id, value);
  };
  t.after(() => { s.put = original; });
  assert.equal((await x.call(path, 'POST', request)).status, 500);
  assert.deepEqual(saved(s), before);
  assert.ok(!s.logs(100).some(l => l.tool === 'agent.bulk_grants'));
});
