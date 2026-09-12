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
export const CHART_PALETTE = [
  '#28754f', // 0: Forest green (brand primary)
  '#467fba', // 1: Steel blue
  '#b87324', // 2: Amber gold
  '#9164b0', // 3: Purple
  '#bd5266', // 4: Crimson rose
  '#27878b', // 5: Teal cyan
  '#6d7333', // 6: Olive green
  '#77614c', // 7: Warm brown
  '#1d5b96', // 8: Deep cobalt
  '#d65b32', // 9: Bright terracotta
  '#5a3c8a', // 10: Deep violet
  '#1f7a68', // 11: Sea green / pine
  '#ba356d', // 12: Vivid magenta
  '#396e82', // 13: Slate petrol
  '#8a6218', // 14: Ochre bronze
  '#4a585e'  // 15: Charcoal slate
];

export function chartColor(index) {
  return CHART_PALETTE[index % CHART_PALETTE.length];
}

export function chartCssBackground(index) {
  const color = chartColor(index);
  if (index < 8) return color;
  const pat = (index - 8) % 8;
  switch (pat) {
    case 0:
      return `repeating-linear-gradient(45deg, ${color}, ${color} 3px, rgba(255,255,255,0.55) 3px, rgba(255,255,255,0.55) 5px)`;
    case 1:
      return `repeating-linear-gradient(-45deg, ${color}, ${color} 3px, rgba(255,255,255,0.55) 3px, rgba(255,255,255,0.55) 5px)`;
    case 2:
      return `radial-gradient(circle, rgba(255,255,255,0.65) 1.5px, transparent 1.5px) 0 0/5px 5px, ${color}`;
    case 3:
      return `repeating-linear-gradient(0deg, ${color}, ${color} 3px, rgba(255,255,255,0.55) 3px, rgba(255,255,255,0.55) 5px)`;
    case 4:
      return `repeating-linear-gradient(90deg, ${color}, ${color} 3px, rgba(255,255,255,0.55) 3px, rgba(255,255,255,0.55) 5px)`;
    case 5:
      return `repeating-linear-gradient(45deg, rgba(255,255,255,0.45) 0, rgba(255,255,255,0.45) 1.5px, transparent 1.5px, transparent 4px), repeating-linear-gradient(-45deg, rgba(255,255,255,0.45) 0, rgba(255,255,255,0.45) 1.5px, transparent 1.5px, transparent 4px), ${color}`;
    case 6:
      return `repeating-linear-gradient(60deg, ${color}, ${color} 2px, rgba(255,255,255,0.6) 2px, rgba(255,255,255,0.6) 3.5px)`;
    case 7:
    default:
      return `repeating-linear-gradient(0deg, rgba(255,255,255,0.45) 0, rgba(255,255,255,0.45) 1.5px, transparent 1.5px, transparent 4px), repeating-linear-gradient(90deg, rgba(255,255,255,0.45) 0, rgba(255,255,255,0.45) 1.5px, transparent 1.5px, transparent 4px), ${color}`;
  }
}

export function chartSvgPatternDefs(prefix, count) {
  let defs = '';
  for (let i = 0; i < count; i++) {
    if (i < 8) continue;
    const color = chartColor(i);
    const id = `${prefix}-pat-${i}`;
    const pat = (i - 8) % 8;
    let content = `<rect width="8" height="8" fill="${color}"/>`;
    if (pat === 0) {
      content += `<path d="M-2,2 l4,-4 M0,8 l8,-8 M6,10 l4,-4" stroke="rgba(255,255,255,0.55)" stroke-width="2"/>`;
    } else if (pat === 1) {
      content += `<path d="M-2,6 l4,4 M0,0 l8,8 M6,-2 l4,4" stroke="rgba(255,255,255,0.55)" stroke-width="2"/>`;
    } else if (pat === 2) {
      content += `<circle cx="2" cy="2" r="1.5" fill="rgba(255,255,255,0.65)"/><circle cx="6" cy="6" r="1.5" fill="rgba(255,255,255,0.65)"/>`;
    } else if (pat === 3) {
      content += `<line x1="0" y1="2" x2="8" y2="2" stroke="rgba(255,255,255,0.55)" stroke-width="2"/><line x1="0" y1="6" x2="8" y2="6" stroke="rgba(255,255,255,0.55)" stroke-width="2"/>`;
    } else if (pat === 4) {
      content += `<line x1="2" y1="0" x2="2" y2="8" stroke="rgba(255,255,255,0.55)" stroke-width="2"/><line x1="6" y1="0" x2="6" y2="8" stroke="rgba(255,255,255,0.55)" stroke-width="2"/>`;
    } else if (pat === 5) {
      content += `<path d="M0,0 l8,8 M8,0 l-8,8" stroke="rgba(255,255,255,0.45)" stroke-width="1.5"/>`;
    } else if (pat === 6) {
      content += `<path d="M0,4 l4,-4 M0,8 l8,-8 M4,8 l4,-4" stroke="rgba(255,255,255,0.6)" stroke-width="1.5"/>`;
    } else {
      content += `<path d="M0,4 h8 M4,0 v8" stroke="rgba(255,255,255,0.45)" stroke-width="1.5"/>`;
    }
    defs += `<pattern id="${id}" width="8" height="8" patternUnits="userSpaceOnUse">${content}</pattern>`;
  }
  return defs ? `<defs>${defs}</defs>` : '';
}

export function chartFill(prefix, index) {
  if (index < 8) return chartColor(index);
  return `url(#${prefix}-pat-${index})`;
}
