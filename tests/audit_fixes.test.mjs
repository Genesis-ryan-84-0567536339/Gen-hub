import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { fixture } from './helpers.mjs';
import {
  normalizeSettings,
  DEFAULT_SETTINGS,
  VALID_RETENTIONS
} from '../public/settings.js';
import { isToolCall, auditStats } from '../public/audit-stats.js';

test('Audit Fix 1 (C3): normalizeSettings defaults and validation', () => {
  // Missing / empty settings
  const empty = normalizeSettings(null);
  assert.equal(empty.name, DEFAULT_SETTINGS.name);
  assert.equal(empty.retention, 30);
  assert.equal(empty.effectiveRetentionDays, 30);
  assert.equal(empty.onboarded, false);

  // Incomplete record with only onboarded: true (Audit C3 scenario)
  const legacy = normalizeSettings({ onboarded: true });
  assert.equal(legacy.onboarded, true);
  assert.equal(legacy.name, 'Gen-hub');
  assert.equal(legacy.retention, 30);
  assert.equal(legacy.effectiveRetentionDays, 30);

  // Valid retentions preserved
  assert.equal(normalizeSettings({ retention: 7 }).effectiveRetentionDays, 7);
  assert.equal(normalizeSettings({ retention: 30 }).effectiveRetentionDays, 30);
  assert.equal(normalizeSettings({ retention: 90 }).effectiveRetentionDays, 90);

  // Invalid retention values fallback to default 30
  assert.equal(normalizeSettings({ retention: 15 }).effectiveRetentionDays, 30);
  assert.equal(normalizeSettings({ retention: 'foo' }).effectiveRetentionDays, 30);
  assert.equal(normalizeSettings({ retention: -1 }).effectiveRetentionDays, 30);
});

test('Audit Fix 1 (C3): store.clean() uses 30 days default when retention field is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'genhub-clean-test-'));
  try {
    const store = openStore(dir);
    // Seed settings with only { onboarded: true } (no retention field)
    store.put('settings', 'main', { onboarded: true });

    const now = Date.now();
    const tenDaysAgo = new Date(now - 10 * 86400000).toISOString();
    const twentyDaysAgo = new Date(now - 20 * 86400000).toISOString();
    const thirtyFiveDaysAgo = new Date(now - 35 * 86400000).toISOString();

    const payload = store.seal({ input: {}, output: {} });
    store.db.prepare(
      'INSERT INTO audit(created,actor,mcp,tool,status,latency,payload) VALUES(?,?,?,?,?,?,?)'
    ).run(tenDaysAgo, 'agt-1', 'mcp-1', 'toolA', 'success', 10, payload);

    store.db.prepare(
      'INSERT INTO audit(created,actor,mcp,tool,status,latency,payload) VALUES(?,?,?,?,?,?,?)'
    ).run(twentyDaysAgo, 'agt-1', 'mcp-1', 'toolB', 'success', 10, payload);

    store.db.prepare(
      'INSERT INTO audit(created,actor,mcp,tool,status,latency,payload) VALUES(?,?,?,?,?,?,?)'
    ).run(thirtyFiveDaysAgo, 'agt-1', 'mcp-1', 'toolC', 'success', 10, payload);

    assert.equal(store.logs(10).length, 3);

    // Clean audit
    store.clean();

    const remaining = store.logs(10);
    // 35 days ago should be purged; 10 and 20 days ago must remain
    assert.equal(remaining.length, 2);
    assert.ok(remaining.some(l => l.tool === 'toolA'));
    assert.ok(remaining.some(l => l.tool === 'toolB'));
    assert.ok(!remaining.some(l => l.tool === 'toolC'));

    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Audit Fix 1 (C3): /api/state returns retention=30 and effectiveRetentionDays=30 for incomplete record', async t => {
  const x = await fixture(t);
  // Put incomplete settings record
  x.hub.store.put('settings', 'main', { onboarded: true });

  const stateRes = await x.call('/api/state');
  assert.equal(stateRes.status, 200);
  assert.equal(stateRes.data.settings.name, 'Gen-hub');
  assert.equal(stateRes.data.settings.retention, 30);
  assert.equal(stateRes.data.settings.effectiveRetentionDays, 30);
  assert.equal(stateRes.data.settings.onboarded, true);

  // PATCH settings with valid retention
  const patchRes = await x.call('/api/settings', 'PATCH', { retention: 90 });
  assert.equal(patchRes.status, 200);
  assert.equal(patchRes.data.retention, 90);
  assert.equal(patchRes.data.effectiveRetentionDays, 90);

  // PATCH settings with invalid retention fails
  const invalidPatch = await x.call('/api/settings', 'PATCH', { retention: 45 });
  assert.equal(invalidPatch.status, 400);

  // Static /settings.js is served
  const jsRes = await fetch(x.origin + '/settings.js');
  assert.equal(jsRes.status, 200);
  assert.ok(jsRes.headers.get('content-type').includes('javascript'));
  const jsText = await jsRes.text();
  assert.ok(jsText.includes('normalizeSettings'));
});

test('Audit Fix 2 (5.2): isToolCall distinguishes agent tool calls from system and maintenance events', () => {
  // System events
  assert.equal(isToolCall({ actor: 'system', mcp: 'hub', tool: 'system.update' }), false);
  assert.equal(isToolCall({ actor: 'system', mcp: 'hub', tool: 'system.check_update' }), false);

  // Owner events
  assert.equal(isToolCall({ actor: 'owner', mcp: 'hub', tool: 'owner.login' }), false);
  assert.equal(isToolCall({ actor: 'owner', mcp: 'hub', tool: 'settings.update' }), false);
  assert.equal(isToolCall({ actor: 'owner', mcp: 'mcp-gh', tool: 'list_issues' }), false);

  // Admin assistant events
  assert.equal(isToolCall({ actor: 'admin-assistant:agt-99', mcp: 'hub', tool: 'mcp.add' }), false);
  assert.equal(isToolCall({ actor: 'admin-assistant:agt-99', mcp: 'mcp-gh', tool: 'list_issues' }), false);

  // Hub maintenance actions
  assert.equal(isToolCall({ actor: 'agt-12345', mcp: 'hub', tool: 'security.pin_check' }), false);

  // Null / invalid objects
  assert.equal(isToolCall(null), false);
  assert.equal(isToolCall({}), false);
  assert.equal(isToolCall({ actor: '' }), false);

  // Genuine agent tool calls
  assert.equal(isToolCall({ actor: 'agt-12345', mcp: 'mcp-gh', tool: 'list_issues' }), true);
  assert.equal(isToolCall({ actor: 'agt-12345', mcp: 'vault', tool: 'vault.read' }), true);
  assert.equal(isToolCall({ actor: 'agent-bot', mcp: 'gitea-1', tool: 'get_repo' }), true);
});

test('Audit Fix 2 (5.2): KPI "Lượt gọi hôm nay" and auditStats ignore system/owner events', () => {
  const dayFormatter = v =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(v));
  const today = dayFormatter(Date.now());

  // Fixture: 0 agent calls, but several owner & system actions (Audit 5.2 scenario)
  const logs = [
    { created: new Date().toISOString(), actor: 'owner', mcp: 'hub', tool: 'owner.login', input: {}, output: {} },
    { created: new Date().toISOString(), actor: 'owner', mcp: 'hub', tool: 'settings.update', input: {}, output: {} },
    { created: new Date().toISOString(), actor: 'system', mcp: 'hub', tool: 'system.update', input: {}, output: {} },
    { created: new Date().toISOString(), actor: 'admin-assistant:ag1', mcp: 'hub', tool: 'mcp.sync', input: {}, output: {} }
  ];

  // Overview daily KPI count with only system/owner logs
  const dailyCalls = logs.filter(l => isToolCall(l) && dayFormatter(l.created) === today);
  assert.equal(dailyCalls.length, 0, 'KPI must be 0 when no real agent tool call occurred');

  // auditStats count
  const stats = auditStats(logs, 24);
  const totalInBuckets = stats.buckets.reduce((acc, b) => acc + b.count, 0);
  assert.equal(totalInBuckets, 0, 'auditStats bucket count must be 0 for non-agent events');

  // Add 1 real agent tool call
  logs.push({
    created: new Date().toISOString(),
    actor: 'agt-12345',
    mcp: 'mcp-54413',
    tool: 'get_repo',
    input: { repo: 'Gen-hub' },
    output: { ok: true }
  });

  const updatedDailyCalls = logs.filter(l => isToolCall(l) && dayFormatter(l.created) === today);
  assert.equal(updatedDailyCalls.length, 1, 'KPI must increment only on real agent tool call');

  const updatedStats = auditStats(logs, 24);
  const updatedTotal = updatedStats.buckets.reduce((acc, b) => acc + b.count, 0);
  assert.equal(updatedTotal, 1, 'auditStats bucket count must reflect genuine agent call');
});
