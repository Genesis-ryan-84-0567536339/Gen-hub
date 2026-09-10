// Audit contains redacted JSON, not LLM token usage or raw network payloads.
export const payloadBytes = value => new TextEncoder().encode(JSON.stringify(value) ?? '').length;

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
    if (
      log.actor === 'owner' ||
      log.actor.startsWith('admin-assistant:') ||
      log.mcp === 'hub' ||
      timestamp > now ||
      timestamp < now - hours * 3600000
    )
      continue;
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
