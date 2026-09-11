const esc = v =>
  String(v ?? '').replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
const number = v => Number(v).toLocaleString('vi-VN', { maximumFractionDigits: 3 });
const date = v =>
  v ? new Date(v).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : 'N/A';
export const categoryLabels = {
  validation: 'Validation',
  denied: 'Policy denials',
  authentication: 'Xác thực',
  rate_limit: 'Rate limit',
  timeout: 'Timeout',
  upstream_transport: 'Upstream transport',
  upstream_tool_conflict: 'Upstream tool / conflict',
  internal: 'Nội bộ',
  unclassified: 'Chưa phân loại'
};
export const rateLabel = v => (v === null ? 'Không có mẫu' : number(v * 100) + '%');
export const percentileLabel = (stats, key = 'p95') =>
  stats?.[key] === null || !stats
    ? 'N/A · n=0'
    : `${number(stats[key])} ms · n=${stats.n}${stats.smallSample ? ' · Mẫu nhỏ' : ''}`;
export function auditLink(summary, filters = {}) {
  return (
    '#audit?' +
    new URLSearchParams({
      ...summary.filters,
      since: summary.since,
      before: summary.until,
      eventKind: 'tool_call',
      actorType: 'agent',
      ...filters
    })
  );
}
export function operationsPanel(
  summary,
  { hours = 24, loading = false, error = null, mcps = [], agents = [] } = {}
) {
  const ranges = [
    [1, '1 giờ'],
    [24, '24 giờ'],
    [168, '7 ngày'],
    [720, '30 ngày'],
    [2160, '90 ngày']
  ];
  const header = `<div class="cardhead"><h2>Vận hành công cụ</h2><label>Khoảng xem <select id="overview-hours" aria-label="Khoảng xem vận hành">${ranges.map(([v, label]) => `<option value="${v}" ${hours === v ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div>`;
  if (!summary)
    return `<section class="card operations">${header}<p class="cardpad" role="${error ? 'alert' : 'status'}">${error ? 'Không tải được số liệu: ' + esc(error) : 'Đang tải số liệu vận hành…'}</p></section>`;
  const t = summary.totals,
    d = summary.data;
  const link = (label, filters = {}) =>
    `<a href="${esc(auditLink(summary, filters))}">${esc(label)}</a>`;
  const stat = (label, value, sub, filters) =>
    `<div class="stat"><div class="statlabel">${esc(label)}</div><div class="statvalue">${filters ? link(value, filters) : esc(value)}</div><p class="sub">${esc(sub)}</p></div>`;
  const upstream = t.errorCategories.upstream_transport + t.errorCategories.upstream_tool_conflict;
  const name = (id, list) => list.find(x => x.id === id)?.name || id;
  const max = Math.max(1, ...summary.buckets.map(b => b.calls));
  const chart = summary.buckets
    .map((b, i) => {
      const x = (i * 1000) / summary.buckets.length,
        width = Math.max(1, 1000 / summary.buckets.length - 2);
      const height = (110 * b.calls) / max;
      const title = `${date(b.start)} – ${date(b.end)}: ${b.calls} calls; ${b.success} success / ${b.error} error / ${b.denied} denied; lỗi ${rateLabel(b.errorRate)}`;
      return `<a href="${esc(auditLink(summary, { since: b.start, before: b.end }))}" aria-label="${esc(title)}"><title>${esc(title)}</title><rect x="${x}" y="0" width="${width}" height="120" fill="transparent"/><rect x="${x}" y="${120 - height}" width="${width}" height="${Math.max(2, height)}" fill="${b.calls ? '#377eb8' : '#cbd5e1'}"/><rect x="${x}" y="${120 - height}" width="${width}" height="${(110 * b.error) / max}" fill="#be3548"/><rect x="${x}" y="${120 - height + (110 * b.error) / max}" width="${width}" height="${(110 * b.denied) / max}" fill="#bc7615"/></a>`;
    })
    .join('');
  const groupTable = (rows, dimension) =>
    `<div class="tablewrap"><table><thead><tr><th>${dimension === 'connectors' ? 'Connector' : dimension === 'agents' ? 'Agent' : 'Tool / connector'}</th><th>p95 thành công</th><th>Calls</th><th>Lỗi / calls</th><th>p50 thành công</th><th>p95 lỗi</th></tr></thead><tbody>${
      rows
        .slice(0, dimension === 'connectors' ? rows.length : 10)
        .map(g => {
          const filters =
            dimension === 'connectors'
              ? { mcp: g.id }
              : dimension === 'agents'
                ? { actor: g.id }
                : { mcp: g.mcp, tool: g.tool };
          const label =
            dimension === 'connectors'
              ? name(g.id, mcps)
              : dimension === 'agents'
                ? name(g.id, agents)
                : g.tool + ' / ' + name(g.mcp, mcps);
          return `<tr><td>${link(label, filters)}<small class="sub operations-id">${esc(g.id)}</small></td><td>${link(percentileLabel(g.latency.success), { ...filters, outcome: 'success' })}</td><td>${g.calls}</td><td>${g.error}/${g.calls} · ${rateLabel(g.errorRate)}</td><td>${percentileLabel(g.latency.success, 'p50')}</td><td>${link(percentileLabel(g.latency.error), { ...filters, status: 'error' })}</td></tr>`;
        })
        .join('') || '<tr><td colspan="6">Không có mẫu · p50/p95 N/A</td></tr>'
    }</tbody></table></div>`;
  return `<section class="card operations">${header}<div class="cardpad">
    ${error ? `<p role="alert" class="errorline">Không tải được số liệu mới: ${esc(error)}. Đang hiển thị lần tải trước.</p>` : ''}
    <p class="footnote" role="status">${loading ? 'Đang cập nhật… · ' : ''}Cập nhật lúc ${date(d.fetchedAt)} · Asia/Ho_Chi_Minh (GMT+7)<br>${date(summary.since)} → ${date(summary.until)}</p>
    <p class="footnote operations-coverage">${d.incomplete ? 'Khoảng xem vượt retention: dữ liệu không đầy đủ. ' : ''}Bản ghi sớm nhất còn lưu: ${date(d.earliestAvailableAt)} · ${d.legacyRecords} lịch sử · ${d.unclassifiedRecords} chưa phân loại · ${d.missingLatency} calls chưa đo latency${t.unknown ? ' · ' + t.unknown + ' kết quả chưa rõ' : ''}.</p>
    <div class="operations-kpis">${stat('Tool calls', number(t.calls), `${t.success} thành công · ${t.error} lỗi · ${t.denied} bị từ chối`, {})}${stat('Tỷ lệ lỗi thực thi', rateLabel(t.errorRate), `${t.error}/${t.calls} tool calls; từ chối ${rateLabel(t.deniedRate)}`, { status: 'error' })}${stat('Calls / phút', number(t.callsPerMinute), 'Tổng calls / số phút trong khoảng')}${stat('p95 thành công', percentileLabel(t.latency.success), 'p50: ' + percentileLabel(t.latency.success, 'p50'), { outcome: 'success' })}</div>
    <p class="operations-errors">${link('Validation: ' + t.errorCategories.validation, { errorCategory: 'validation' })} · ${link('Policy denials: ' + t.denied, { policyDecision: 'deny' })} · Upstream: ${upstream} (transport + tool/conflict) · ${link('Timeout: ' + t.errorCategories.timeout, { errorCategory: 'timeout' })}</p>
    <h3>Lưu lượng theo ${summary.bucketMs === 300000 ? '5 phút' : summary.bucketMs === 3600000 ? 'giờ' : 'ngày'}</h3>
    <p class="footnote">Xanh: thành công · Đỏ: lỗi · Vàng: từ chối · Xám: không có mẫu. Chọn cột để mở nhật ký đúng khoảng. Đỉnh thang: ${max} calls.</p>
    <svg class="operations-chart" viewBox="0 0 1000 125" role="img" aria-label="Lưu lượng tool calls theo thời gian">${chart}</svg><div class="operations-axis"><span>${date(summary.buckets[0]?.start)}</span><span>${date(summary.until)}</span></div>
    <details><summary>Số liệu theo thời gian và loại lỗi</summary><div class="tablewrap"><table><thead><tr><th>Bắt đầu (GMT+7)</th><th>Calls</th><th>Success / error / denied</th><th>Calls/phút</th><th>Tỷ lệ lỗi</th><th>Loại lỗi</th><th>p95 success / error</th></tr></thead><tbody>${summary.buckets
      .map(
        b =>
          `<tr><td>${link(date(b.start), { since: b.start, before: b.end })}</td><td>${b.calls}</td><td>${b.success} / ${b.error} / ${b.denied}</td><td>${number(b.callsPerMinute)}</td><td>${rateLabel(b.errorRate)}</td><td>${
            Object.entries(b.errorCategories)
              .filter(([, n]) => n)
              .map(([c, n]) =>
                link(categoryLabels[c] + ': ' + n, {
                  since: b.start,
                  before: b.end,
                  errorCategory: c
                })
              )
              .join(' · ') || '—'
          }</td><td>${percentileLabel(b.latency.success)} / ${percentileLabel(b.latency.error)}</td></tr>`
      )
      .join('')}</tbody></table></div></details>
    <div class="operations-breakdowns"><div><h3>Loại lỗi</h3><ul>${Object.entries(t.errorCategories)
      .map(([c, n]) => `<li>${link(categoryLabels[c] + ': ' + n, { errorCategory: c })}</li>`)
      .join(
        ''
      )}</ul></div><div><h3>Độ trễ thực thi lỗi</h3><p>p50: ${percentileLabel(t.latency.error, 'p50')}</p><p>p95: ${percentileLabel(t.latency.error)}</p><details><summary>Histogram độ trễ (số mẫu tích lũy)</summary><table><thead><tr><th>≤ ms</th><th>Success</th><th>Error</th></tr></thead><tbody>${t.latency.success.histogram.map((b, i) => `<tr><td>${b.le ?? '+∞'}</td><td>${b.count}</td><td>${t.latency.error.histogram[i].count}</td></tr>`).join('')}</tbody></table></details></div></div>
    <h3>Độ trễ từng connector</h3>${groupTable(summary.connectors, 'connectors')}
    <h3>Agent đóng góp nhiều nhất · Top 10 theo calls</h3>${groupTable(summary.agents, 'agents')}
    <h3>Tool đóng góp nhiều nhất · Top 10 theo calls</h3>${groupTable(summary.tools, 'tools')}
    <details class="operations-quality"><summary>Tình trạng dữ liệu</summary><p>${d.incomplete ? 'Khoảng xem vượt retention — dữ liệu không đầy đủ.' : 'Tổng hợp toàn bộ metadata còn lưu trong khoảng, không giới hạn 200/5.000 dòng.'} Bản ghi sớm nhất còn lưu: ${date(d.earliestAvailableAt)}. Retention: ${d.effectiveRetentionDays} ngày; ranh giới ${date(d.retentionBoundary)}.</p><p>${d.legacyRecords} bản ghi lịch sử (best-effort) · ${d.unclassifiedRecords} chưa phân loại · ${d.missingLatency} tool calls chưa đo latency. Không có bằng chứng đảm bảo thu thập liên tục trước bản ghi sớm nhất. Khoảng trống không được coi là khỏe.</p><p>Ngoài mẫu số tool calls: ${d.otherEvents.admin_action} admin actions, ${d.otherEvents.auth} auth/security, ${d.otherEvents.system} system, ${d.otherEvents.unclassified} chưa phân loại. Auth/security: ${d.securityErrors.authentication} authentication errors, ${d.securityErrors.rate_limit} rate limits.</p><p>Latency từ tools/call hợp lệ qua policy, validation và connector (gồm refresh token, initialize, upstream, cleanup) đến trước ghi audit/trả HTTP. Success và error tách riêng; từ chối không vào percentile. Nearest-rank trên mẫu gốc; n&lt;20: mẫu nhỏ. Tỷ lệ lỗi = execution errors / tất cả tool calls, policy denial là tỷ lệ riêng. Đây là chất lượng thực thi, không phải uptime.</p></details>
  </div></section>`;
}
