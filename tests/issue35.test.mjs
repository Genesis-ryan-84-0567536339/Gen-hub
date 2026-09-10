import test from 'node:test';
import assert from 'node:assert/strict';
import { pieArc, auditStats } from '../public/audit-stats.js';

test('Issue #35: pieArc generates valid SVG path arc geometry for pie and donut charts', () => {
  // Empty or non-positive fraction
  assert.equal(pieArc(100, 100, 80, 48, 0.5, 0.5), '');
  assert.equal(pieArc(100, 100, 80, 48, 0.6, 0.4), '');

  // 50% donut slice (quarter circle to bottom)
  const halfDonut = pieArc(100, 100, 80, 48, 0, 0.5);
  assert.match(halfDonut, /^M 100\.00 20\.00 A 80 80 0 0 1 100\.00 180\.00 L 100\.00 148\.00 A 48 48 0 0 0 100\.00 52\.00 Z$/);

  // 100% full donut slice splits into two arcs so SVG doesn't drop 360-deg arc
  const fullDonut = pieArc(100, 100, 80, 48, 0, 1);
  assert(fullDonut.includes('M 100.00 20.00'));
  assert(fullDonut.includes('M 100.00 180.00'));
  assert.equal((fullDonut.match(/M /g) || []).length, 2);

  // Large arc (> 50% fraction) has largeArc flag = 1
  const largeSlice = pieArc(100, 100, 80, 48, 0, 0.75);
  assert.match(largeSlice, /A 80 80 0 1 1/);
  assert.match(largeSlice, /A 48 48 0 1 0/);

  // Small arc (< 50% fraction) has largeArc flag = 0
  const smallSlice = pieArc(100, 100, 80, 48, 0, 0.25);
  assert.match(smallSlice, /A 80 80 0 0 1/);
  assert.match(smallSlice, /A 48 48 0 0 0/);

  // r = 0 (solid pie chart without inner hole)
  const solidPie = pieArc(100, 100, 80, 0, 0, 0.5);
  assert.match(solidPie, /L 100 100 Z$/);
});

test('Issue #35: tool ratio statistics and pie data aggregation from audit logs', () => {
  const now = Date.parse('2026-09-10T07:00:00Z');
  const log = (created, extra = {}) => ({
    id: Math.random().toString(36).slice(2),
    actor: 'agent-1',
    mcp: 'mcp-test',
    tool: 'query',
    status: 'success',
    created,
    input: { q: 'test' },
    output: { ok: true },
    ...extra
  });

  const logs = [
    log('2026-09-10T05:00:00Z', { tool: 'query' }),
    log('2026-09-10T05:30:00Z', { tool: 'query' }),
    log('2026-09-10T06:00:00Z', { tool: 'query' }),
    log('2026-09-10T06:15:00Z', { tool: 'mutate' }),
    log('2026-09-09T08:00:00Z', { tool: 'query' }) // older day within 168h
  ];

  const stats = auditStats(logs, 168, now);
  assert.equal(stats.tools.length, 2);
  assert(stats.tools.includes('mcp-test / query'));
  assert(stats.tools.includes('mcp-test / mutate'));

  // Calculate totals matching app.js logic
  const toolCounts = new Map(stats.tools.map(k => [k, 0]));
  let totalCalls = 0;
  for (const bucket of stats.buckets) {
    for (const [key, row] of bucket.tools) {
      if (toolCounts.has(key)) {
        toolCounts.set(key, toolCounts.get(key) + row.count);
        totalCalls += row.count;
      }
    }
  }

  assert.equal(totalCalls, 5);
  assert.equal(toolCounts.get('mcp-test / query'), 4);
  assert.equal(toolCounts.get('mcp-test / mutate'), 1);

  const queryFrac = toolCounts.get('mcp-test / query') / totalCalls;
  const mutateFrac = toolCounts.get('mcp-test / mutate') / totalCalls;
  assert.equal(queryFrac, 0.8);
  assert.equal(mutateFrac, 0.2);

  const arc1 = pieArc(100, 100, 80, 48, 0, queryFrac);
  const arc2 = pieArc(100, 100, 80, 48, queryFrac, queryFrac + mutateFrac);
  assert(arc1.length > 0);
  assert(arc2.length > 0);
});
