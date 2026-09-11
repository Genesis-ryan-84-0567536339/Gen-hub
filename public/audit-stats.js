// Audit contains redacted JSON, not LLM token usage or raw network payloads.
export const payloadBytes = value => new TextEncoder().encode(JSON.stringify(value) ?? '').length;

export function pieArc(cx, cy, R, r, startFrac, endFrac) {
  const frac = endFrac - startFrac;
  if (frac <= 0) return '';
  if (frac >= 0.9999) {
    const mid = startFrac + frac / 2;
    return `${pieArc(cx, cy, R, r, startFrac, mid)} ${pieArc(cx, cy, R, r, mid, endFrac)}`;
  }
  const a0 = 2 * Math.PI * startFrac - Math.PI / 2;
  const a1 = 2 * Math.PI * endFrac - Math.PI / 2;
  const x0 = (cx + R * Math.cos(a0)).toFixed(2);
  const y0 = (cy + R * Math.sin(a0)).toFixed(2);
  const x1 = (cx + R * Math.cos(a1)).toFixed(2);
  const y1 = (cy + R * Math.sin(a1)).toFixed(2);
  const large = frac > 0.5 ? 1 : 0;
  if (r <= 0) {
    return `M ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1} L ${cx} ${cy} Z`;
  }
  const x2 = (cx + r * Math.cos(a1)).toFixed(2);
  const y2 = (cy + r * Math.sin(a1)).toFixed(2);
  const x3 = (cx + r * Math.cos(a0)).toFixed(2);
  const y3 = (cy + r * Math.sin(a0)).toFixed(2);
  return `M ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1} L ${x2} ${y2} A ${r} ${r} 0 ${large} 0 ${x3} ${y3} Z`;
}

export function isToolCall(log) {
  if (!log || typeof log !== 'object') return false;
  if (log.eventKind) return log.eventKind === 'tool_call' && log.actorType === 'agent';
  const actor = typeof log.actor === 'string' ? log.actor.trim() : '';
  if (!actor || actor === 'owner' || actor === 'system' || actor.startsWith('admin-assistant:')) {
    return false;
  }
  if (log.mcp === 'hub') return false;
  return true;
}

export function auditStats(logs, hours = 168, now = Date.now()) {
  const step = hours <= 24 ? 3600000 : 86400000;
  // Daily buckets follow the console's GMT+7 timezone.
  const offset = 7 * 3600000;
  const end = Math.floor((now + offset) / step) * step - offset;
  const size = Math.ceil((hours * 3600000) / step) + 1;
  const buckets = Array.from({ length: size }, (_, i) => ({
    start: end - (size - 1 - i) * step,
    count: 0,
    tools: new Map()
  }));
  const tools = new Set();
  for (const log of logs) {
    const timestamp = Date.parse(log.created);
    if (!isToolCall(log) || timestamp > now || timestamp < now - hours * 3600000) continue;
    const index = Math.floor((timestamp - buckets[0].start) / step);
    if (index < 0 || index >= buckets.length) continue;
    const key =
      log.mcp === 'vault'
        ? 'vault / ' + log.tool + ' / ' + (log.input?.id || '?')
        : log.mcp + ' / ' + log.tool;
    tools.add(key);
    const bucket = buckets[index];
    const row = bucket.tools.get(key) || { count: 0, input: 0, output: 0 };
    row.count++;
    row.input += payloadBytes(log.input);
    row.output += payloadBytes(log.output);
    bucket.count++;
    bucket.tools.set(key, row);
  }
  return { buckets, tools: [...tools].sort(), step };
}
