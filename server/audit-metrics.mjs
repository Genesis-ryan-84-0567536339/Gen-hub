// Shared SQL projection: historical rows stay untouched; unknown evidence stays unknown.
export const errorCategories = [
  'validation',
  'denied',
  'authentication',
  'rate_limit',
  'timeout',
  'upstream_transport',
  'upstream_tool_conflict',
  'internal',
  'unclassified'
];
const actor = `CASE WHEN actor='owner' THEN 'owner' WHEN actor='system' THEN 'system' WHEN actor LIKE 'admin-assistant:%' THEN 'admin' WHEN actor LIKE 'agent-%' OR actor LIKE 'agt-%' THEN 'agent' ELSE 'unclassified' END`;
const kind = `CASE WHEN tool LIKE 'system.%' OR actor='system' THEN 'system' WHEN tool LIKE 'owner.%' OR tool LIKE 'security.%' OR tool LIKE 'auth.%' THEN 'auth' WHEN actor='owner' OR actor LIKE 'admin-assistant:%' THEN 'admin_action' WHEN (${actor})='agent' AND mcp!='hub' THEN 'tool_call' ELSE 'unclassified' END`;
export const auditFields = {
  eventKind: `COALESCE(eventKind, ${kind})`,
  actorType: `COALESCE(actorType, ${actor})`,
  policyDecision: `COALESCE(policyDecision, CASE WHEN status='denied' THEN 'deny' WHEN (${kind})='tool_call' AND status IN ('success','ok') THEN 'allow' END)`,
  outcome: `COALESCE(outcome, CASE WHEN status IN ('success','ok') THEN 'success' WHEN status IN ('error','denied') THEN 'error' END)`,
  errorCategory: `COALESCE(errorCategory, CASE WHEN status='denied' THEN 'denied' WHEN status='error' THEN 'unclassified' END)`,
  latencyMeasured: `COALESCE(latencyMeasured, CASE WHEN (${kind})='tool_call' AND latency>0 THEN 1 ELSE 0 END)`,
  classification: `CASE WHEN eventKind IS NULL THEN 'legacy' ELSE 'recorded' END`
};
export const auditProjection =
  Object.entries(auditFields)
    .map(([key, sql]) => `${sql} AS ${key}`)
    .join(', ') + ', operationId';
export function classifyError(error, phase = 'internal') {
  if (error?.errorCategory === 'validation' || phase === 'validation') return 'validation';
  const status = error?.upstreamStatus ?? error?.status;
  if (status === 400 && !error?.upstreamStatus) return 'validation';
  if (status === 429) return 'rate_limit';
  if (status === 401) return 'authentication';
  if (
    status === 408 ||
    status === 504 ||
    /timeout|timed out|hết thời gian/i.test(error?.message || '')
  )
    return 'timeout';
  if (phase === 'upstream')
    return [409, 422].includes(status) ? 'upstream_tool_conflict' : 'upstream_transport';
  return 'internal';
}
export function newClassification({ actor, mcp, tool, status, latency }, meta = {}) {
  const actorType =
    meta.actorType ??
    (actor === 'owner'
      ? 'owner'
      : actor === 'system'
        ? 'system'
        : actor.startsWith('admin-assistant:')
          ? 'admin'
          : /^(agent|agt)-/.test(actor)
            ? 'agent'
            : 'unclassified');
  const eventKind =
    actor === 'system' || tool.startsWith('system.')
      ? 'system'
      : /^(auth|owner|security)\./.test(tool)
        ? 'auth'
        : ['owner', 'admin'].includes(actorType)
          ? 'admin_action'
          : actorType === 'agent' && mcp !== 'hub'
            ? 'tool_call'
            : 'unclassified';
  return {
    eventKind,
    actorType,
    policyDecision:
      status === 'denied'
        ? 'deny'
        : eventKind === 'tool_call' && ['ok', 'success'].includes(status)
          ? 'allow'
          : null,
    outcome: ['ok', 'success'].includes(status) ? 'success' : 'error',
    errorCategory: status === 'denied' ? 'denied' : status === 'error' ? 'unclassified' : null,
    latencyMeasured: Number(Number.isFinite(latency)),
    ...meta
  };
}
export const histogramBounds = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000];
export function latencyStats(values) {
  values.sort((a, b) => a - b);
  const n = values.length;
  let index = 0;
  const histogram = [...histogramBounds, null].map(le => {
    while (index < n && (le === null || values[index] <= le)) index++;
    return { le, count: index };
  });
  return {
    n,
    p50: n ? values[Math.ceil(n * 0.5) - 1] : null,
    p95: n ? values[Math.ceil(n * 0.95) - 1] : null,
    smallSample: n > 0 && n < 20,
    histogram
  };
}
function accumulator() {
  return {
    calls: 0,
    success: 0,
    error: 0,
    denied: 0,
    unknown: 0,
    errorCategories: Object.fromEntries(errorCategories.map(c => [c, 0])),
    samples: { success: [], error: [] }
  };
}
function add(a, row) {
  a.calls++;
  if (row.policyDecision === 'deny') a.denied++;
  else if (row.outcome === 'success') a.success++;
  else if (row.outcome === 'error') a.error++;
  else a.unknown++;
  if (row.errorCategory) a.errorCategories[row.errorCategory]++;
  if (row.latencyMeasured && row.policyDecision !== 'deny' && a.samples[row.outcome])
    a.samples[row.outcome].push(row.latency);
}
function finish(a, minutes) {
  const { samples, ...rest } = a;
  return {
    ...rest,
    callsPerMinute: a.calls / minutes,
    errorRate: a.calls ? a.error / a.calls : null,
    deniedRate: a.calls ? a.denied / a.calls : null,
    latency: { success: latencyStats(samples.success), error: latencyStats(samples.error) }
  };
}
export function summarizeAudit(rows, { since, until, ...filters }, coverage) {
  const start = Date.parse(since),
    end = Date.parse(until),
    duration = end - start;
  const step = duration <= 6 * 3600000 ? 300000 : duration <= 7 * 86400000 ? 3600000 : 86400000;
  const offset = 7 * 3600000,
    first = Math.floor((start + offset) / step) * step - offset;
  const buckets = Array.from({ length: Math.ceil((end - first) / step) }, (_, i) => ({
    ...accumulator(),
    start: Math.max(start, first + i * step),
    end: Math.min(end, first + (i + 1) * step)
  }));
  const total = accumulator(),
    groups = { connectors: new Map(), agents: new Map(), tools: new Map() };
  const data = {
    ...coverage,
    legacyRecords: 0,
    unclassifiedRecords: 0,
    missingLatency: 0,
    otherEvents: { admin_action: 0, auth: 0, system: 0, unclassified: 0 },
    securityErrors: Object.fromEntries(errorCategories.map(c => [c, 0]))
  };
  const seenOperations = new Set();
  for (const r of rows) {
    if (r.classification === 'legacy') data.legacyRecords++;
    if (r.eventKind === 'unclassified' || r.errorCategory === 'unclassified')
      data.unclassifiedRecords++;
    if (r.eventKind !== 'tool_call' || r.actorType !== 'agent') {
      const operationKey = r.operationId ? r.eventKind + ':' + r.operationId : 'legacy:' + r.id;
      if (!seenOperations.has(operationKey)) {
        data.otherEvents[r.eventKind in data.otherEvents ? r.eventKind : 'unclassified']++;
        seenOperations.add(operationKey);
      }
      if (r.eventKind === 'auth' && r.errorCategory) data.securityErrors[r.errorCategory]++;
      continue;
    }
    if (!r.latencyMeasured) data.missingLatency++;
    add(total, r);
    const bucket = buckets[Math.floor((Date.parse(r.created) - first) / step)];
    if (bucket) add(bucket, r);
    for (const [dimension, key] of [
      ['connectors', r.mcp],
      ['agents', r.actor],
      ['tools', JSON.stringify([r.mcp, r.tool])]
    ]) {
      const group = groups[dimension].get(key) || {
        ...accumulator(),
        id: key,
        mcp: r.mcp,
        tool: r.tool
      };
      add(group, r);
      groups[dimension].set(key, group);
    }
  }
  return {
    since,
    until,
    filters,
    timezone: 'Asia/Ho_Chi_Minh',
    bucketMs: step,
    data,
    totals: finish(total, duration / 60000),
    buckets: buckets.map(b => ({
      ...finish(b, (b.end - b.start) / 60000),
      start: new Date(b.start).toISOString(),
      end: new Date(b.end).toISOString()
    })),
    ...Object.fromEntries(
      Object.entries(groups).map(([key, map]) => [
        key,
        [...map.values()].map(g => finish(g, duration / 60000)).sort((a, b) => b.calls - a.calls)
      ])
    )
  };
}
