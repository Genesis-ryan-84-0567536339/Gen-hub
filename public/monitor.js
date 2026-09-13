const esc = v =>
  String(v ?? '').replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
const action = (label, value, cls = 'textbutton') =>
  `<button type="button" class="${cls}" data-action="${esc(value)}">${esc(label)}</button>`;
const number = n => Number(n || 0).toLocaleString('vi-VN');
const date = v =>
  v ? new Date(v).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : 'Chưa ghi nhận';
const phaseNames = {
  received: 'Tiếp nhận',
  policy: 'Kiểm tra quyền & dữ liệu',
  dispatch: 'Gọi công cụ',
  response: 'Nhận kết quả',
  audit: 'Lưu nhật ký'
};
export const monitorPhase = phase => phaseNames[phase] || 'Chưa xác định';
const bytes = n =>
  n >= 1048576
    ? (n / 1048576).toFixed(1) + ' MB'
    : n >= 1024
      ? (n / 1024).toFixed(1) + ' KB'
      : number(n) + ' B';
const stateName = state =>
  ({
    connected: 'Đã kết nối',
    active: 'Đã duyệt',
    pending: 'Chờ duyệt',
    revoked: 'Đã thu hồi',
    disconnected: 'Chưa kết nối',
    expired: 'Cần xác thực lại',
    deleted: 'Đã xóa',
    historical: 'Lịch sử',
    error: 'Có lỗi'
  })[state] || state;
export function monitorTimeline(item) {
  const events = item.timeline || [];
  if (!events.length) return '<p class="footnote">Nhật ký cũ chưa ghi thời điểm từng bước. Không thể dựng lại lưu trình đầy đủ.</p>';
  const failedPhase = item.policyDecision === 'deny' ? 'policy' : (item.status === 'error' || item.status === 'denied') ? [...events].reverse().find(e => e.phase !== 'audit')?.phase : '';
  return `<ol class="monitor-timeline" aria-label="Các bước xử lý">${Object.entries(phaseNames).map(([phase, label], i) => {
    const event = events.find(e => e.phase === phase);
    const current = item.state === 'running' && item.phase === phase;
    const failed = phase === failedPhase;
    return `<li class="${event ? 'recorded' : ''} ${current ? 'current' : ''} ${failed ? 'failed' : ''}"><span class="monitor-stepcircle" aria-hidden="true">${failed ? '!' : current ? '…' : event ? '✓' : i + 1}</span><b>${label}</b><small>${event ? date(event.at) : 'Không ghi nhận'}</small>${current ? '<span class="badge warn">Đang xử lý</span>' : failed ? '<span class="badge danger">Có lỗi / từ chối</span>' : ''}</li>`;
  }).join('')}</ol>${item.state === 'interrupted' ? '<p class="errorline">Hub đã gián đoạn khi xử lý. Chưa xác nhận kết quả bên dịch vụ; kiểm tra trước khi thử lại.</p>' : ''}`;
}
const colors = ['#287657', '#577bab', '#9778af', '#b28b42', '#5a9290', '#b16b75'];
export function renderMonitor(data, view, ui) {
  const { tab = 'overview', actor = '', mcp = '', toolFilter = 'all', period = '12', selectedTool = '' } = view;
  const tabs = `<div class="monitor-toolbar"><div class="monitor-tabs" aria-label="Monitor">${[['overview', 'Toàn cảnh'], ['flows', 'Luồng đang xử lý'], ['tools', 'Tồn kho công cụ']].map(([id, label]) => `<button type="button" class="monitor-tab ${id === tab ? 'active' : ''}" aria-pressed="${id === tab}" data-action="monitor-tab:${id}">${label}</button>`).join('')}</div><label>Thời gian <select class="filter" id="monitor-period">${[['today', 'Hôm nay'], ['12', '12 giờ qua'], ['24', '24 giờ qua'], ['168', '7 ngày qua']].map(([id, label]) => `<option value="${id}" ${id === period ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div>`;
  if (!data) return tabs + '<section class="card cardpad" role="status">Đang đọc dữ liệu Monitor…</section>';
  if (data.error && !data.totals) return tabs + `<section class="card cardpad"><p class="errorline" role="alert">${esc(data.error)}</p>${action('Thử lại', 'monitor-refresh', 'btn small')}</section>`;
  const name = (kind, id) => data[kind].find(x => x.id === id)?.name || id;
  const match = row => (!actor || (row.actor || row.agentId) === actor) && (!mcp || (row.mcp || row.mcpId) === mcp);
  const scopedTools = data.tools.filter(t => (!mcp || t.mcpId === mcp) && (!actor || t.grantedTo.includes(actor)));
  const focus = actor || mcp ? `<div class="monitor-focus"><span><strong>Đang xem: ${esc(actor ? name('agents', actor) : name('connections', mcp))}</strong><small>${esc(actor || mcp)} · Số liệu trong khoảng đã chọn</small></span>${action('Xem tất cả', 'monitor-clear')}</div>` : '';
  const context = `<div class="monitor-contextactions">${actor || mcp ? action('Mở trang quản lý →', `monitor-manage:${actor ? 'agents' : 'mcps'}:${actor || mcp}`) : action('Xem luồng đang xử lý →', 'monitor-tab:flows')}${action('Hỏi trợ lý về lựa chọn này', 'monitor-ask')}</div>`;
  const fresh = `<p class="footnote" role="status">${data.error ? 'Cập nhật lỗi — đang hiển thị dữ liệu cũ. ' + esc(data.error) : 'Dữ liệu từ Hub của bạn'} · Cập nhật ${date(data.fetchedAt)} · ${action('Làm mới', 'monitor-refresh')}</p>`;
  const coverage = `<p class="footnote">${date(data.since)} → ${date(data.until)} · Lịch sử giữ ${data.coverage.retentionDays} ngày; dữ liệu sớm nhất ${date(data.coverage.earliest)}.${data.coverage.incomplete ? ' Khoảng chọn vượt thời gian lưu giữ.' : ''} Không xác nhận hoạt động trước phần lịch sử còn lưu.</p>`;
  function requests(rows, live = false) {
    if (!rows.length) return '<p class="monitor-empty">Chưa có yêu cầu trong lựa chọn này.</p>';
    if (live) return `<div class="monitor-requests">${rows.map(r => `<article class="monitor-request"><div><b>${esc(r.tool)}</b><small>${esc(name('agents', r.actor))} → ${esc(name('connections', r.mcp))}</small><small>${date(r.startedAt)}</small></div><div><span class="badge ${r.state === 'interrupted' ? 'warn' : ''}">${r.state === 'interrupted' ? 'Chưa rõ kết quả' : monitorPhase(r.phase)}</span><div>${action('Xem yêu cầu', 'monitor-operation:' + r.id)}</div></div></article>`).join('')}</div>`;
    return `<table class="monitor-table"><thead><tr><th>Yêu cầu / Công cụ</th><th>Agent → Kết nối</th><th>Trạng thái</th><th>Thời điểm</th></tr></thead><tbody>${rows.map(r => `<tr><td>${action(r.tool, 'monitor-log:' + r.id, 'monitor-rowbutton')}<small>#${esc(r.id)}</small></td><td>${esc(name('agents', r.actor))}<small>→ ${esc(name('connections', r.mcp))}</small></td><td>${ui.badge(r.status)}</td><td>${date(r.created)}</td></tr>`).join('')}</tbody></table>`;
  }
  if (tab === 'flows') return tabs + focus + context + `<section class="card"><div class="cardhead"><h2>Luồng đang xử lý</h2><span class="badge">${data.totals.running} đang chạy tại Hub</span></div><div class="cardpad">${requests(data.active.filter(match), true)}</div></section><p class="footnote">Cập nhật mỗi 3 giây. Hub hiện từ chối khi hết lượt xử lý đồng thời, không xếp hàng. Yêu cầu đã hoàn tất nằm trong Nhật ký.</p>` + fresh;
  if (tab === 'tools') {
    const rows = data.tools.filter(t => (!mcp || t.mcpId === mcp) && (!actor || t.grantedTo.includes(actor)) && (toolFilter === 'all' || (toolFilter === 'unused' && t.published && !t.calls) || (toolFilter === 'unpublished' && !t.published) || (toolFilter === 'unavailable' && !t.available))).sort((a, b) => a.calls - b.calls || a.name.localeCompare(b.name));
    const selected = rows.find(t => t.mcpId + ':' + t.name === selectedTool);
    const detail = selected ? `<section class="card monitor-tool-detail"><div class="cardhead"><h2>${esc(selected.name)}</h2>${action('Đóng chi tiết', 'monitor-tool:')}</div><div class="cardpad"><dl class="monitor-details"><div><dt>Kết nối</dt><dd>${esc(selected.mcpName)} <small>${esc(selected.mcpId)}</small></dd></div><div><dt>Sử dụng</dt><dd>${number(selected.calls)} lượt trong khoảng chọn<small>${number(selected.retainedCalls)} lượt trong lịch sử còn lưu · Gần nhất ${date(selected.retainedLastCall)}</small></dd></div><div><dt>Được cấp cho</dt><dd>${selected.grantedTo.map(id => action(name('agents', id) + ' · ' + id, 'monitor-manage:agents:' + id + ':grants')).join(' · ') || 'Chưa cấp cho agent nào'}<small>${selected.callableBy.length} agent hiện dùng được</small></dd></div><div><dt>Trạng thái</dt><dd>${selected.published ? 'Đã công bố' : 'Chưa công bố'}<small>${selected.connectionReady ? 'Kết nối sẵn sàng' : 'Kết nối chưa sẵn sàng'}</small></dd></div></dl><div class="actions">${action('Quản lý công cụ', 'monitor-manage:mcps:' + selected.mcpId + ':tools', 'btn small')}${action('Xem lịch sử', 'monitor-tool-log:' + selected.mcpId + ':' + encodeURIComponent(selected.name), 'btn small')}${selected.published ? action('Cấp quyền hàng loạt', 'bulk-grants:' + encodeURIComponent(selectedTool), 'btn small') : ''}</div></div></section>` : '';
    return tabs + focus + context + `<section class="card"><div class="cardhead"><h2>Tồn kho công cụ</h2><div class="actions">${action('Cấp quyền hàng loạt', 'bulk-grants', 'btn small')}<label>Hiển thị <select class="filter" id="monitor-tool-filter">${[['all', 'Tất cả'], ['unused', 'Chưa dùng trong khoảng chọn'], ['unpublished', 'Chưa công bố'], ['unavailable', 'Chưa khả dụng']].map(([id, label]) => `<option value="${id}" ${id === toolFilter ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div></div><table class="monitor-table monitor-tools"><thead><tr><th>Công cụ / Kết nối</th><th>Được cấp cho</th><th>Trạng thái</th><th>Lượt gọi</th></tr></thead><tbody>${rows.map(t => `<tr class="monitor-tool ${selected === t ? 'chosen' : ''}"><td>${action(t.name, 'monitor-tool:' + encodeURIComponent(t.mcpId + ':' + t.name), 'monitor-rowbutton')}<small>${esc(t.mcpName)} · ${esc(t.mcpId)}</small></td><td>${t.grantedTo.length ? t.grantedTo.map(id => action(name('agents', id), 'monitor-manage:agents:' + id + ':grants')).join(' · ') : 'Chưa cấp'}<small>${t.callableBy.length} agent dùng được</small></td><td><span class="badge ${t.available ? '' : 'gray'}">${t.published ? 'Đã công bố' : 'Chưa công bố'}</span>${!t.connectionReady ? '<small>Kết nối chưa sẵn sàng</small>' : ''}</td><td>${number(t.calls)}<small>${t.calls ? 'Trong khoảng chọn' : 'Chưa ghi nhận sử dụng'}</small></td></tr>`).join('') || '<tr><td colspan="4">Không có công cụ phù hợp.</td></tr>'}</tbody></table><div class="cardpad"><p class="footnote">${rows.length} công cụ · Bấm tên để xem quan hệ, quyền và lịch sử. Công cụ dùng được khi đã công bố, kết nối sẵn sàng và agent hoạt động được cấp quyền.</p></div></section>` + detail + coverage + fresh;
  }
  const stats = `<section class="monitor-stats">${[
    ['Agent', data.totals.agents, 'agents', data.agents.filter(a => a.status === 'active').length + ' đang hoạt động'],
    ['Kết nối', data.totals.connections, 'mcps', data.connections.filter(m => m.on && m.status === 'connected').length + ' sẵn sàng'],
    ['Công cụ', data.totals.tools, 'tools', data.totals.published + ' công bố · ' + data.totals.available + ' khả dụng'],
    ['Vault', data.totals.secrets, 'vault', 'Quản lý bí mật và quyền truy cập']
  ].map(([label, n, target, sub]) => `<button type="button" class="card stat" data-action="${target === 'tools' ? 'monitor-tab:tools' : 'go:' + target}"><span class="statlabel">${label}<span aria-hidden="true">↗</span></span><span class="statvalue">${number(n)}</span><small>${sub}</small></button>`).join('')}</section>`;
  const relations = data.relationships.filter(match).sort((a, b) => b.calls - a.calls);
  const dim = (kind, id) => actor ? (kind === 'agents' ? id !== actor : !relations.some(r => r.mcpId === id)) : mcp ? (kind === 'connections' ? id !== mcp : !relations.some(r => r.agentId === id)) : false;
  const nodes = (kind, key) => data[kind].map((a, i) => `<button type="button" class="monitor-node ${view[key] === a.id ? 'selected' : ''} ${dim(kind, a.id) ? 'dim' : ''}" aria-pressed="${view[key] === a.id}" data-action="monitor-${key}:${esc(a.id)}" data-${key}-node="${esc(a.id)}" title="${esc(a.name + ' · ' + a.id)}"><span class="monitor-avatar" style="color:${colors[i % colors.length]}">${esc(a.name?.[0] || '?')}</span><span class="monitor-nodetext"><strong>${esc(a.name)}</strong><small>${kind === 'agents' ? esc(stateName(a.status)) : a.on === false ? 'Đang tắt' : (a.toolCount ?? 0) + ' công cụ · ' + esc(stateName(a.status))}</small></span><span class="monitor-nodecount">${number(a.calls)}</span></button>`).join('') || '<p class="muted">Chưa có dữ liệu.</p>';
  const graph = `<section class="card"><div class="cardhead"><h2>Bản đồ hoạt động</h2><span class="badge gray">${data.totals.running} đang xử lý</span></div><div class="cardpad"><div class="monitor-map"><svg class="monitor-wires" aria-hidden="true"></svg><div class="monitor-mapcol"><h3>AGENT · LƯỢT GỌI</h3>${nodes('agents', 'actor')}</div><div class="monitor-mapcol"><h3>KẾT NỐI · LƯỢT GỌI</h3>${nodes('connections', 'mcp')}</div></div><div class="monitor-mapfoot">Đường nối thể hiện lượt gọi trong khoảng chọn. Bấm agent hoặc kết nối để xem riêng.</div><details class="monitor-relations"><summary>Quan hệ cấp quyền và sử dụng (${relations.length})</summary>${relations.map(r => `<div class="listrow"><span>${esc(name('agents', r.agentId))} → ${esc(name('connections', r.mcpId))}</span><span>${r.granted} quyền đã cấp · ${r.callable || 0} dùng được · ${number(r.calls)} lượt</span></div>`).join('')}</details></div></section>`;
  const entries = data.agents.filter(a => a.calls);
  const total = entries.reduce((s, a) => s + a.calls, 0);
  let stop = 0;
  const gradient = entries.map((a, i) => { const start = stop; stop += a.calls / total * 100; return `${colors[i % colors.length]} ${start}% ${stop}%`; }).join(',');
  const volume = data.totals.inputBytes + data.totals.outputBytes;
  const inputPct = volume ? data.totals.inputBytes / volume * 100 : 0;
  const activity = `<section class="card"><div class="cardhead"><h2>Lượt gọi theo Agent</h2></div><div class="cardpad"><div class="monitor-donutrow"><div class="monitor-donut" role="img" aria-label="${number(total)} lượt gọi; chi tiết theo agent ở bên cạnh" style="background:${total ? 'conic-gradient(' + gradient + ')' : 'var(--line)'}"><div><strong class="monitor-total">${number(total)}</strong><small>lượt gọi</small></div></div><div class="monitor-legend">${entries.map((a, i) => `<button type="button" class="monitor-legendbutton" data-action="monitor-actor:${esc(a.id)}" title="${esc(a.id)}"><i style="background:${colors[i % colors.length]}"></i><span>${esc(a.name)}</span><b>${number(a.calls)}</b></button>`).join('') || '<p class="footnote">Chưa có lượt gọi trong khoảng chọn.</p>'}</div></div><div class="divider"></div><h3>Dung lượng vào / ra</h3><div class="monitor-numbers"><span>Đầu vào <b>${bytes(data.totals.inputBytes)}</b></span><span>Đầu ra <b>${bytes(data.totals.outputBytes)}</b></span></div><div class="monitor-volume" aria-hidden="true"><span style="width:${inputPct}%"></span><span style="width:${volume ? 100 - inputPct : 0}%"></span></div><p class="footnote">Byte JSON sau che bí mật, không phải token LLM.${data.coverage.bytesMissing ? ' ' + number(data.coverage.bytesMissing) + ' lượt chưa có số đo; tổng chỉ gồm phần đã đo.' : ''}</p>${action(scopedTools.filter(t => t.published && !t.calls).length + ' công cụ công bố chưa dùng trong khoảng chọn →', 'monitor-unused', 'monitor-attention')}</div></section>`;
  return tabs + (ui.endpoint || '') + stats + focus + context + `<div class="monitor-pair">${graph}${activity}</div><section class="card monitor-section"><div class="cardhead"><h2>Yêu cầu gần đây</h2><span class="badge gray">6 yêu cầu gần nhất</span></div>${requests(data.recent.filter(match).slice(0, 6))}</section><div class="monitor-contextactions">${action('Xem toàn bộ nhật ký →', 'monitor-history')}${action('Hỏi trợ lý', 'monitor-ask')}</div>` + coverage + fresh;
}

// Measure actual node positions after each render and container resize (including the chat dock).
let mapObserver;
export function layoutMonitorMap(data, view) {
  mapObserver?.disconnect();
  const map = document.querySelector('#monitor-body .monitor-map');
  if (!map || !data?.relationships) return;
  const draw = () => {
    if (!map.isConnected) return;
    const svg = map.querySelector('svg');
    const bounds = map.getBoundingClientRect();
    svg.replaceChildren();
    svg.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`);
    const agents = new Map([...map.querySelectorAll('[data-actor-node]')].map(el => [el.dataset.actorNode, el]));
    const mcps = new Map([...map.querySelectorAll('[data-mcp-node]')].map(el => [el.dataset.mcpNode, el]));
    for (const r of data.relationships.filter(r => r.calls > 0)) {
      const a = agents.get(r.agentId)?.getBoundingClientRect(), m = mcps.get(r.mcpId)?.getBoundingClientRect();
      if (!a || !m) continue;
      const x1 = a.right - bounds.left, y1 = a.top + a.height / 2 - bounds.top;
      const x2 = m.left - bounds.left, y2 = m.top + m.height / 2 - bounds.top, mid = (x1 + x2) / 2;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`);
      path.setAttribute('class', 'monitor-wire' + ((view.actor === r.agentId || view.mcp === r.mcpId) ? ' on' : ''));
      svg.append(path);
    }
  };
  mapObserver = new ResizeObserver(draw);
  mapObserver.observe(map);
  draw();
}
