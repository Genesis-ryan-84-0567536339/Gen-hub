import test from 'node:test';
import assert from 'node:assert/strict';
import { latencyStats, summarizeAudit } from '../server/audit-metrics.mjs';
import { operationsPanel, percentileLabel, rateLabel, auditLink } from '../public/operations.js';
const range = { since: '2026-09-10T00:00:00.000Z', until: '2026-09-11T00:00:00.000Z' };
const coverage = {
  fetchedAt: range.until,
  effectiveRetentionDays: 30,
  retentionBoundary: range.since,
  earliestAvailableAt: null
};

test('O3/O4 presentation: no requests means no sample and N/A, small samples labeled', () => {
  const summary = summarizeAudit([], range, coverage);
  const html = operationsPanel(summary);
  assert(html.includes('Không có mẫu'));
  assert(html.includes('N/A · n=0'));
  assert(!html.includes('100%'));
  assert.equal(percentileLabel(latencyStats([])), 'N/A · n=0');
  assert.equal(rateLabel(null), 'Không có mẫu');
  assert.match(percentileLabel(latencyStats([1])), /Mẫu nhỏ/);
  assert(!percentileLabel(latencyStats(Array(20).fill(1))).includes('Mẫu nhỏ'));
});

test('Dashboard links preserve exact metadata filters and labels escape stored names', () => {
  const row = {
    id: 1,
    actor: 'agent-a',
    mcp: 'mcp-a',
    tool: '<script>alert(1)</script>',
    created: range.since,
    eventKind: 'tool_call',
    actorType: 'agent',
    outcome: 'success',
    policyDecision: 'allow',
    latencyMeasured: 1,
    latency: 1
  };
  const summary = summarizeAudit([row], range, coverage);
  const href = auditLink(summary, { mcp: row.mcp, tool: row.tool });
  const query = new URLSearchParams(href.split('?')[1]);
  assert.equal(query.get('before'), range.until);
  assert.equal(query.get('tool'), row.tool);
  assert.equal(query.get('eventKind'), 'tool_call');
  assert.equal(query.get('actorType'), 'agent');
  const html = operationsPanel(summary, {
    mcps: [{ id: row.mcp, name: '<img src=x onerror=alert(1)>' }]
  });
  assert(!html.includes('<script>'));
  assert(!html.includes('<img src=x'));
  assert(html.includes('&lt;script&gt;'));
  assert(html.includes('&lt;img'));
});
