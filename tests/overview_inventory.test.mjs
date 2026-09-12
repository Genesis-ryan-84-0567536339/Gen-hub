import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
import { isToolCall, auditStats } from '../public/audit-stats.js';

// ─────────────────────────────────────────────────────────────────
// Helper: build a minimal MCP record with published tools
// ─────────────────────────────────────────────────────────────────
function makeMcp(store, id, name, tools = []) {
  const m = {
    id,
    name,
    provider: 'github',
    on: true,
    status: 'connected',
    auth: 'token',
    secret: store.seal({ token: 'test-token' }),
    tools: tools.map(t => ({ name: t, published: true, description: '' }))
  };
  store.put('mcp', id, m);
  return m;
}

// Helper: seed an agent
function makeAgent(store, id, name) {
  const a = { id, name, status: 'active', permissions: [], effective: 0 };
  store.put('agent', id, a);
  return a;
}

// Helper: override `created` timestamp of last audit row
function setCreated(store, rowId, iso) {
  store.db.prepare('UPDATE audit SET created=? WHERE id=?').run(iso, rowId);
}

// ─────────────────────────────────────────────────────────────────
// Unit tests: agent pie logic (isToolCall + byAgentCalls grouping)
// ─────────────────────────────────────────────────────────────────

test('Overview/Agent pie: isToolCall rejects owner, system, admin-assistant, hub mcp', () => {
  assert.equal(isToolCall({ actor: 'owner', mcp: 'mcp-x', tool: 'foo', status: 'success' }), false, 'owner must be excluded');
  assert.equal(isToolCall({ actor: 'system', mcp: 'mcp-x', tool: 'foo', status: 'success' }), false, 'system must be excluded');
  assert.equal(isToolCall({ actor: 'admin-assistant:abc123', mcp: 'mcp-x', tool: 'foo', status: 'success' }), false, 'admin-assistant must be excluded');
  assert.equal(isToolCall({ actor: 'agent-001', mcp: 'hub', tool: 'settings.get', status: 'success' }), false, 'hub mcp must be excluded');
  assert.equal(isToolCall({ actor: 'agent-001', mcp: 'mcp-x', tool: 'list_issues', status: 'success' }), true, 'real agent call must be included');
});

test('Overview/Agent pie: two agents with same name but different IDs stay separate', () => {
  // Simulate the byAgentCalls logic from overview()
  const logs = [
    { actor: 'agent-aaa', mcp: 'mcp-1', tool: 'foo', status: 'success', created: new Date().toISOString() },
    { actor: 'agent-bbb', mcp: 'mcp-1', tool: 'bar', status: 'success', created: new Date().toISOString() },
    { actor: 'agent-aaa', mcp: 'mcp-1', tool: 'foo', status: 'success', created: new Date().toISOString() }
  ];
  // Both agents have display name "Dev Agent"
  const agentNameMap = new Map([['agent-aaa', 'Dev Agent'], ['agent-bbb', 'Dev Agent']]);
  const byAgentCalls = new Map();
  const cutoff = Date.now() - 12 * 3600000;
  for (const log of logs) {
    if (!isToolCall(log)) continue;
    const ts = Date.parse(log.created);
    if (ts < cutoff) continue;
    const key = log.actor + '\x00' + (agentNameMap.get(log.actor) || log.actor);
    byAgentCalls.set(key, (byAgentCalls.get(key) || 0) + 1);
  }
  // There should be 2 distinct entries even though both display as "Dev Agent"
  assert.equal(byAgentCalls.size, 2, 'agents with same name but different IDs must not be merged');
  // The compound keys must contain the agent IDs
  const keys = [...byAgentCalls.keys()];
  assert.ok(keys.some(k => k.startsWith('agent-aaa\x00')), 'agent-aaa key must exist');
  assert.ok(keys.some(k => k.startsWith('agent-bbb\x00')), 'agent-bbb key must exist');
  // Call counts: agent-aaa called 2 times, agent-bbb called 1 time
  assert.equal(byAgentCalls.get('agent-aaa\x00Dev Agent'), 2);
  assert.equal(byAgentCalls.get('agent-bbb\x00Dev Agent'), 1);
});

test('Overview/Agent pie: agent with 0 calls in 12h does not appear', () => {
  const now = Date.now();
  const cutoff = now - 12 * 3600000;
  const logs = [
    // This call is older than 12h — must be excluded
    { actor: 'agent-old', mcp: 'mcp-1', tool: 'foo', status: 'success', created: new Date(cutoff - 1000).toISOString() },
    // This call is within 12h
    { actor: 'agent-new', mcp: 'mcp-1', tool: 'bar', status: 'success', created: new Date(now - 1000).toISOString() }
  ];
  const agentNameMap = new Map([['agent-old', 'Old Agent'], ['agent-new', 'New Agent']]);
  const byAgentCalls = new Map();
  for (const log of logs) {
    if (!isToolCall(log)) continue;
    const ts = Date.parse(log.created);
    if (ts < cutoff) continue;
    const key = log.actor + '\x00' + (agentNameMap.get(log.actor) || log.actor);
    byAgentCalls.set(key, (byAgentCalls.get(key) || 0) + 1);
  }
  assert.equal(byAgentCalls.size, 1, 'only 1 agent should appear (old one excluded)');
  assert.ok([...byAgentCalls.keys()].every(k => k.startsWith('agent-new')), 'only agent-new should be in pie');
});

// ─────────────────────────────────────────────────────────────────
// Integration tests: GET /api/tool-inventory
// ─────────────────────────────────────────────────────────────────

test('Tool inventory: new MCP with no calls → all tools show callCount=0, lastCall=null', async t => {
  const x = await fixture(t);
  makeMcp(x.hub.store, 'mcp-test1', 'My MCP', ['list_issues', 'create_issue']);

  const { status, data } = await x.call('/api/tool-inventory');
  assert.equal(status, 200);
  assert.ok(Array.isArray(data.inventory), 'inventory must be an array');
  assert.equal(data.inventory.length, 2, 'should have 2 tools');

  for (const item of data.inventory) {
    assert.equal(item.mcpName, 'My MCP');
    assert.equal(item.callCount, 0, `${item.toolName}: callCount must be 0`);
    assert.equal(item.lastCall, null, `${item.toolName}: lastCall must be null`);
    assert.ok(['list_issues', 'create_issue'].includes(item.toolName));
  }
});

test('Tool inventory: calling one tool updates its row only, not others', async t => {
  const x = await fixture(t);
  makeMcp(x.hub.store, 'mcp-test2', 'Test MCP', ['tool_a', 'tool_b', 'tool_c']);
  makeAgent(x.hub.store, 'agent-x1', 'Agent X');

  // Call tool_b once by a real agent
  x.hub.store.audit('agent-x1', 'mcp-test2', 'tool_b', 'success', {}, {});

  const { status, data } = await x.call('/api/tool-inventory');
  assert.equal(status, 200);

  const toolA = data.inventory.find(i => i.toolName === 'tool_a');
  const toolB = data.inventory.find(i => i.toolName === 'tool_b');
  const toolC = data.inventory.find(i => i.toolName === 'tool_c');

  assert.ok(toolA, 'tool_a must be present');
  assert.ok(toolB, 'tool_b must be present');
  assert.ok(toolC, 'tool_c must be present');

  assert.equal(toolA.callCount, 0, 'tool_a must still be 0');
  assert.equal(toolB.callCount, 1, 'tool_b must be 1 after 1 call');
  assert.ok(toolB.lastCall !== null, 'tool_b lastCall must be set');
  assert.equal(toolC.callCount, 0, 'tool_c must still be 0');
});

test('Tool inventory: sorted ascending by callCount (unused tools first)', async t => {
  const x = await fixture(t);
  makeMcp(x.hub.store, 'mcp-sort', 'Sort MCP', ['alpha', 'beta', 'gamma']);
  makeAgent(x.hub.store, 'agent-y1', 'Agent Y');

  // gamma: 3 calls, beta: 1 call, alpha: 0 calls
  x.hub.store.audit('agent-y1', 'mcp-sort', 'gamma', 'success', {}, {});
  x.hub.store.audit('agent-y1', 'mcp-sort', 'gamma', 'success', {}, {});
  x.hub.store.audit('agent-y1', 'mcp-sort', 'gamma', 'success', {}, {});
  x.hub.store.audit('agent-y1', 'mcp-sort', 'beta', 'success', {}, {});

  const { data } = await x.call('/api/tool-inventory');
  const names = data.inventory.map(i => i.toolName);

  // alpha (0) must come before beta (1) which must come before gamma (3)
  const idxAlpha = names.indexOf('alpha');
  const idxBeta = names.indexOf('beta');
  const idxGamma = names.indexOf('gamma');
  assert.ok(idxAlpha < idxBeta, 'alpha (0 calls) must be before beta (1 call)');
  assert.ok(idxBeta < idxGamma, 'beta (1 call) must be before gamma (3 calls)');
});

test('Tool inventory: owner and system calls do NOT count toward callCount', async t => {
  const x = await fixture(t);
  makeMcp(x.hub.store, 'mcp-excl', 'Excl MCP', ['my_tool']);

  // These must NOT be counted
  x.hub.store.audit('owner', 'mcp-excl', 'my_tool', 'success', {}, {});
  x.hub.store.audit('system', 'mcp-excl', 'my_tool', 'success', {}, {});
  x.hub.store.audit('admin-assistant:tok123', 'mcp-excl', 'my_tool', 'success', {}, {});

  const { data } = await x.call('/api/tool-inventory');
  const item = data.inventory.find(i => i.toolName === 'my_tool');
  assert.ok(item, 'my_tool must appear in inventory');
  assert.equal(item.callCount, 0, 'owner/system/admin-assistant calls must not be counted');
  assert.equal(item.lastCall, null, 'lastCall must be null when only excluded actors called');
});

test('Tool inventory: disconnected/off MCP tools do not appear', async t => {
  const x = await fixture(t);
  // connected MCP
  makeMcp(x.hub.store, 'mcp-on', 'Online MCP', ['good_tool']);
  // disconnected MCP (status !== 'connected')
  x.hub.store.put('mcp', 'mcp-off', {
    id: 'mcp-off', name: 'Offline MCP', provider: 'github', on: true, status: 'error',
    auth: 'token', secret: x.hub.store.seal({ token: 'x' }),
    tools: [{ name: 'bad_tool', published: true, description: '' }]
  });
  // turned-off MCP (on: false)
  x.hub.store.put('mcp', 'mcp-disabled', {
    id: 'mcp-disabled', name: 'Disabled MCP', provider: 'github', on: false, status: 'connected',
    auth: 'token', secret: x.hub.store.seal({ token: 'x' }),
    tools: [{ name: 'disabled_tool', published: true, description: '' }]
  });

  const { data } = await x.call('/api/tool-inventory');
  const toolNames = data.inventory.map(i => i.toolName);
  assert.ok(toolNames.includes('good_tool'), 'good_tool from connected MCP must appear');
  assert.ok(!toolNames.includes('bad_tool'), 'bad_tool from disconnected MCP must NOT appear');
  assert.ok(!toolNames.includes('disabled_tool'), 'disabled_tool from off MCP must NOT appear');
});

test('Tool inventory: unpublished tools do not appear', async t => {
  const x = await fixture(t);
  const m = {
    id: 'mcp-pub', name: 'Pub MCP', provider: 'github', on: true, status: 'connected',
    auth: 'token', secret: x.hub.store.seal({ token: 'x' }),
    tools: [
      { name: 'pub_tool', published: true, description: '' },
      { name: 'priv_tool', published: false, description: '' }
    ]
  };
  x.hub.store.put('mcp', m.id, m);

  const { data } = await x.call('/api/tool-inventory');
  const toolNames = data.inventory.map(i => i.toolName);
  assert.ok(toolNames.includes('pub_tool'), 'published tool must appear');
  assert.ok(!toolNames.includes('priv_tool'), 'unpublished tool must NOT appear');
});

test('Tool inventory: lastCall reflects ISO timestamp of most recent agent call', async t => {
  const x = await fixture(t);
  makeMcp(x.hub.store, 'mcp-ts', 'TS MCP', ['ts_tool']);
  makeAgent(x.hub.store, 'agent-ts1', 'Agent TS');

  const r1 = x.hub.store.audit('agent-ts1', 'mcp-ts', 'ts_tool', 'success', {}, {});
  setCreated(x.hub.store, Number(r1.lastInsertRowid), '2026-09-01T01:00:00.000Z');
  const r2 = x.hub.store.audit('agent-ts1', 'mcp-ts', 'ts_tool', 'success', {}, {});
  setCreated(x.hub.store, Number(r2.lastInsertRowid), '2026-09-10T15:00:00.000Z');
  const r3 = x.hub.store.audit('agent-ts1', 'mcp-ts', 'ts_tool', 'success', {}, {});
  setCreated(x.hub.store, Number(r3.lastInsertRowid), '2026-09-05T08:00:00.000Z');

  const { data } = await x.call('/api/tool-inventory');
  const item = data.inventory.find(i => i.toolName === 'ts_tool');
  assert.ok(item, 'ts_tool must appear');
  assert.equal(item.callCount, 3, 'must count all 3 calls');
  assert.equal(item.lastCall, '2026-09-10T15:00:00.000Z', 'lastCall must be the most recent timestamp');
});

test('Tool inventory: requires authentication (401 without session)', async t => {
  const x = await fixture(t);
  const resp = await fetch(x.origin + '/api/tool-inventory', {
    headers: { 'Content-Type': 'application/json', Origin: x.origin }
  });
  assert.ok(resp.status === 401 || resp.status === 403, `Expected 401/403 without session, got ${resp.status}`);
});

test('Tool inventory: multiple MCPs show all their published tools', async t => {
  const x = await fixture(t);
  makeMcp(x.hub.store, 'mcp-a', 'MCP Alpha', ['a1', 'a2']);
  makeMcp(x.hub.store, 'mcp-b', 'MCP Beta', ['b1', 'b2', 'b3']);

  const { data } = await x.call('/api/tool-inventory');
  assert.equal(data.inventory.length, 5, 'should have 5 tools total across 2 MCPs');

  const mcpNames = [...new Set(data.inventory.map(i => i.mcpName))];
  assert.ok(mcpNames.includes('MCP Alpha'), 'MCP Alpha must appear');
  assert.ok(mcpNames.includes('MCP Beta'), 'MCP Beta must appear');

  const alphaTools = data.inventory.filter(i => i.mcpName === 'MCP Alpha').map(i => i.toolName).sort();
  assert.deepEqual(alphaTools, ['a1', 'a2']);
  const betaTools = data.inventory.filter(i => i.mcpName === 'MCP Beta').map(i => i.toolName).sort();
  assert.deepEqual(betaTools, ['b1', 'b2', 'b3']);
});

test('Tool inventory: hub mcp calls are excluded from counts', async t => {
  const x = await fixture(t);
  makeMcp(x.hub.store, 'mcp-hub-test', 'Hub Test MCP', ['my_tool']);
  makeAgent(x.hub.store, 'agent-hub1', 'Agent Hub');

  // A call to the hub itself (mcp='hub') must not count
  x.hub.store.audit('agent-hub1', 'hub', 'settings.get', 'success', {}, {});
  // A real call to the MCP
  x.hub.store.audit('agent-hub1', 'mcp-hub-test', 'my_tool', 'success', {}, {});

  const { data } = await x.call('/api/tool-inventory');
  const item = data.inventory.find(i => i.toolName === 'my_tool');
  assert.ok(item, 'my_tool must appear');
  assert.equal(item.callCount, 1, 'only the real MCP call should be counted, not hub call');
});
