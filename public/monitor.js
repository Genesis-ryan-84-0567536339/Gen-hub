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
  if (!events.length)
    return '<p class="footnote">Nhật ký cũ chưa ghi thời điểm từng bước. Không thể dựng lại lưu trình đầy đủ.</p>';
  return `<ol class="monitor-timeline" aria-label="Các bước xử lý">${Object.entries(phaseNames)
    .map(([phase, label]) => {
      const event = events.find(e => e.phase === phase);
      const current = item.state === 'running' && item.phase === phase;
      return `<li class="${event ? 'recorded' : ''} ${current ? 'current' : ''}"><b>${label}</b><small>${event ? date(event.at) : 'Không ghi nhận'}</small>${current ? '<span class="badge warn">Đang xử lý</span>' : ''}</li>`;
    })
    .join(
      ''
    )}</ol>${item.state === 'interrupted' ? '<p class="errorline">Hub đã gián đoạn khi xử lý. Chưa xác nhận kết quả bên dịch vụ; kiểm tra trước khi thử lại.</p>' : ''}`;
}
export function renderMonitor(data, view, ui) {
  const { tab = 'overview', actor = '', mcp = '', toolFilter = 'all', period = '12' } = view;
  const tabs = `<div class="monitor-toolbar"><div class="monitor-tabs" aria-label="Monitor">${[
    ['overview', 'Toàn cảnh'],
    ['flows', 'Luồng đang xử lý'],
    ['tools', 'Tồn kho công cụ']
  ]
    .map(
      ([id, label]) =>
        `<button type="button" class="btn small ${id === tab ? 'primary' : ''}" aria-pressed="${id === tab}" data-action="monitor-tab:${id}">${label}</button>`
    )
    .join('')}</div><label>Thời gian <select class="filter" id="monitor-period">${[
    ['today', 'Hôm nay'],
    ['12', '12 giờ qua'],
    ['24', '24 giờ qua'],
    ['168', '7 ngày qua']
  ]
    .map(
      ([id, label]) => `<option value="${id}" ${id === period ? 'selected' : ''}>${label}</option>`
    )
    .join('')}</select></label></div>`;
  if (!data)
    return tabs + '<section class="card cardpad" role="status">Đang đọc dữ liệu Monitor…</section>';
  if (data.error && !data.totals)
    return (
      tabs +
      `<section class="card cardpad"><p class="errorline" role="alert">${esc(data.error)}</p>${action('Thử lại', 'monitor-refresh', 'btn small')}</section>`
    );
  const name = (kind, id) => data[kind].find(x => x.id === id)?.name || id;
  const match = row =>
    (!actor || (row.actor || row.agentId) === actor) && (!mcp || (row.mcp || row.mcpId) === mcp);
  const focus =
    actor || mcp
      ? `<div class="monitor-focus"><span>Đang xem: <b>${esc(actor ? name('agents', actor) : name('connections', mcp))}</b></span><div class="actions">${action('Mở trang quản lý', `monitor-manage:${actor ? 'agents' : 'mcps'}:${actor || mcp}`)}${action('Xem tất cả', 'monitor-clear')}</div></div>`
      : '';
  const fresh = `<p class="footnote" role="status">${data.error ? 'Cập nhật lỗi — đang hiển thị dữ liệu cũ. ' + esc(data.error) : 'Dữ liệu thật qua Gen-hub'} · Cập nhật ${date(data.fetchedAt)} · ${action('Làm mới', 'monitor-refresh')} · ${action('Hỏi trợ lý', 'monitor-ask')}</p>`;
  const coverage = `<p class="footnote">Thống kê trong khoảng ${date(data.since)} → ${date(data.until)}. Lịch sử được giữ ${data.coverage.retentionDays} ngày; dữ liệu sớm nhất ${date(data.coverage.earliest)}.${data.coverage.incomplete ? ' Khoảng chọn vượt thời gian lưu giữ.' : ''} Không xác nhận hoạt động trước phần lịch sử còn lưu.</p>`;
  function requests(rows, live = false) {
    if (!rows.length) return '<p class="muted">Chưa có yêu cầu trong lựa chọn này.</p>';
    return `<div class="monitor-requests">${rows.map(r => `<article class="monitor-request"><div><b>${esc(r.tool)}</b><small>${esc(name('agents', r.actor))} → ${esc(name('connections', r.mcp))}</small><small>${date(r.startedAt || r.created)}</small></div><div>${live ? `<span class="badge ${r.state === 'interrupted' ? 'warn' : ''}">${r.state === 'interrupted' ? 'Chưa rõ kết quả' : monitorPhase(r.phase)}</span>` : ui.badge(r.status)}<div>${action('Xem yêu cầu', live ? 'monitor-operation:' + r.id : 'monitor-log:' + r.id)}</div></div></article>`).join('')}</div>`;
  }
  if (tab === 'flows')
    return (
      tabs +
      fresh +
      focus +
      `<section class="card"><div class="cardhead"><h2>Luồng đang xử lý</h2><span class="badge">${data.totals.running} đang chạy tại Hub</span></div><div class="cardpad">${requests(data.active.filter(match), true)}</div></section><p class="footnote">Trạng thái cập nhật mỗi 3 giây khi mở trang. Hub hiện từ chối khi hết lượt xử lý đồng thời, không xếp hàng. Yêu cầu nhanh đã hoàn tất nằm trong Nhật ký.</p>`
    );
  if (tab === 'tools') {
    const rows = data.tools.filter(
      t =>
        (!mcp || t.mcpId === mcp) &&
        (!actor || t.grantedTo.includes(actor)) &&
        (toolFilter === 'all' ||
          (toolFilter === 'unused' && !t.retainedCalls) ||
          (toolFilter === 'unpublished' && !t.published) ||
          (toolFilter === 'unavailable' && !t.available))
    );
    return (
      tabs +
      fresh +
      focus +
      `<section class="card"><div class="cardhead"><h2>Tồn kho công cụ</h2><label>Hiển thị <select class="filter" id="monitor-tool-filter">${[
        ['all', 'Tất cả'],
        ['unused', 'Chưa ghi nhận sử dụng'],
        ['unpublished', 'Chưa công bố'],
        ['unavailable', 'Chưa khả dụng']
      ]
        .map(
          ([id, label]) =>
            `<option value="${id}" ${id === toolFilter ? 'selected' : ''}>${label}</option>`
        )
        .join(
          ''
        )}</select></label></div><div class="cardpad"><div class="monitor-tools">${rows.map(t => `<article class="monitor-tool"><div><b class="mono">${esc(t.name)}</b><small>${action(t.mcpName, 'monitor-manage:mcps:' + t.mcpId + ':tools')}</small><small>${t.published ? 'Đã công bố' : 'Chưa công bố'} · ${t.connectionReady ? 'Kết nối sẵn sàng' : 'Kết nối chưa sẵn sàng'}</small></div><div><small>Được cấp cho</small>${t.grantedTo.length ? t.grantedTo.map(id => action(name('agents', id), 'monitor-manage:agents:' + id + ':grants')).join(' · ') : 'Chưa cấp'}<small>${t.callableBy.length} agent hiện dùng được</small></div><div><b>${number(t.retainedCalls)} lượt trong lịch sử còn lưu</b><small>${t.retainedLastCall ? date(t.retainedLastCall) : 'Chưa ghi nhận sử dụng'}</small>${action('Xem lịch sử', 'monitor-tool-log:' + t.mcpId + ':' + encodeURIComponent(t.name))}</div></article>`).join('') || '<p class="muted">Không có công cụ phù hợp.</p>'}</div><p class="footnote">${rows.length} công cụ · Dùng được khi agent còn hoạt động, được cấp quyền, công cụ được công bố và kết nối sẵn sàng. Bao gồm công cụ chưa công bố và kết nối đang tắt. Đổi quyền và công bố tại trang quản lý tương ứng.</p></div></section>` +
      coverage
    );
  }
  const stats = `<section class="stats monitor-stats">${[
    ['Agent', data.totals.agents, 'agents'],
    ['Kết nối', data.totals.connections, 'mcps'],
    ['Công cụ', data.totals.tools, 'tools'],
    ['Kho bí mật', data.totals.secrets, 'vault']
  ]
    .map(
      ([label, n, target]) =>
        `<button type="button" class="card stat" data-action="${target === 'tools' ? 'monitor-tab:tools' : 'go:' + target}"><span class="statlabel">${label}</span><span class="statvalue">${number(n)}</span><small>${target === 'tools' ? data.totals.published + ' công bố · ' + data.totals.available + ' khả dụng' : 'Mở để quản lý →'}</small></button>`
    )
    .join('')}</section>`;
  const relations = data.relationships.filter(match).sort((a, b) => b.calls - a.calls);
  const agentRows = data.agents.filter(a => !mcp || relations.some(r => r.agentId === a.id));
  const mcpRows = data.connections.filter(m => !actor || relations.some(r => r.mcpId === m.id));
  const graph = `<section class="card"><div class="cardhead"><h2>Bản đồ hoạt động</h2><span class="badge gray">Agent → Công cụ → Kết nối</span></div><div class="cardpad"><div class="monitor-map"><div><h3>Agent</h3>${agentRows.map(a => `<button type="button" class="monitor-node ${actor === a.id ? 'selected' : ''}" aria-pressed="${actor === a.id}" data-action="monitor-actor:${esc(a.id)}"><b>${esc(a.name)}</b><small>${esc(a.id)} · ${esc(stateName(a.status))}</small><span>${number(a.calls)} lượt · ${a.granted} quyền</span></button>`).join('') || '<p class="muted">Chưa có agent.</p>'}</div><div><h3>Kết nối</h3>${mcpRows.map(m => `<button type="button" class="monitor-node ${view.mcp === m.id ? 'selected' : ''}" aria-pressed="${view.mcp === m.id}" data-action="monitor-mcp:${esc(m.id)}"><b>${esc(m.name)}</b><small>${esc(m.id)} · ${m.on === false ? 'Đang tắt' : esc(stateName(m.status))}</small><span>${number(m.calls)} lượt${m.toolCount !== undefined ? ' · ' + m.toolCount + ' công cụ' : ''}</span></button>`).join('') || '<p class="muted">Chưa có kết nối.</p>'}</div></div><details class="monitor-relations"><summary>Quan hệ cấp quyền và sử dụng (${relations.length})</summary>${relations.map(r => `<div class="listrow"><span>${esc(name('agents', r.agentId))} → ${esc(name('connections', r.mcpId))}</span><span>${r.granted} quyền đã cấp · ${r.callable || 0} dùng được · ${number(r.calls)} lượt</span></div>`).join('')}</details></div></section>`;
  const body = `<div class="monitor-pair">${graph}<section class="card"><div class="cardhead"><h2>Nội dung & hoạt động</h2></div><div class="cardpad"><p><strong class="monitor-total">${number(data.totals.calls)}</strong> lượt gọi ${actor || mcp ? 'của đối tượng đang chọn' : 'toàn Hub'} trong khoảng chọn</p><dl class="monitor-numbers"><div><dt>Đầu vào đã lưu</dt><dd>${bytes(data.totals.inputBytes)}</dd></div><div><dt>Đầu ra đã lưu</dt><dd>${bytes(data.totals.outputBytes)}</dd></div></dl><p class="footnote">Byte JSON sau che bí mật, không phải token LLM.${data.coverage.bytesMissing ? ' ' + number(data.coverage.bytesMissing) + ' lượt chưa có số đo dung lượng; tổng byte chỉ gồm phần đã đo.' : ''}</p>${action(data.totals.running + ' yêu cầu đang chạy', 'monitor-tab:flows', 'btn small')}<hr>${action(data.tools.filter(t => t.published && !t.retainedCalls).length + ' công cụ công bố chưa ghi nhận sử dụng', 'monitor-unused', 'btn small')}</div></section></div>`;
  const uniqueLabel = (kind, id) => name(kind, id) + ' · ' + id;
  const byMcp = data.connections
    .filter(m => m.calls)
    .map(m => [uniqueLabel('connections', m.id), m.calls]);
  const byBytes = data.connections
    .filter(m => m.inputBytes + m.outputBytes)
    .map(m => [uniqueLabel('connections', m.id), m.inputBytes + m.outputBytes]);
  const toolTotals = new Map();
  for (const r of data.toolActivity) {
    const k = JSON.stringify([r.mcp, r.tool]);
    const row = toolTotals.get(k) || [uniqueLabel('connections', r.mcp) + ' / ' + r.tool, 0];
    row[1] += r.calls;
    toolTotals.set(k, row);
  }
  const pies = `<section class="card monitor-section"><div class="cardhead"><h2>Hoạt động công cụ</h2></div><div class="cardpad"><div class="pie-row">${ui.smallPie('MCP theo lượt gọi', byMcp, 'lượt')}${ui.smallPie('Tool theo lượt gọi', [...toolTotals.values()], 'lượt')}${ui.smallPie('MCP theo dung lượng', byBytes, 'byte')}${ui.smallPie(
    'Lượt gọi theo Agent',
    data.agents.filter(a => a.calls).map(a => [uniqueLabel('agents', a.id), a.calls]),
    'lượt'
  )}</div></div></section>`;
  return (
    tabs +
    fresh +
    stats +
    focus +
    body +
    pies +
    `<section class="card monitor-section"><div class="cardhead"><h2>30 yêu cầu gần nhất trong lựa chọn</h2>${action('Mở Nhật ký', 'monitor-history')}</div><div class="cardpad">${requests(data.recent.filter(match))}</div></section>` +
    coverage
  );
}
