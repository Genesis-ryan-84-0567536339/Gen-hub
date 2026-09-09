import { connectionGuide } from './connection-guides.js';
('use strict');
const $ = s => document.querySelector(s),
  esc = v =>
    String(v ?? '').replace(
      /[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
const paths = {
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  plug: 'M8 3v5m8-5v5M6 8h12v3a6 6 0 0 1-12 0V8zm6 9v4',
  bot: 'M8 3h8m-4 0v4M5 7h14v13H5zM2 12h3m14 0h3M9 12v2m6-2v2M9 17h6',
  activity: 'M3 12h4l3-7 4 14 3-7h4',
  settings:
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z',
  plus: 'M12 5v14M5 12h14',
  search: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm5 12 6 6',
  check: 'm5 12 4 4L19 6',
  close: 'm6 6 12 12M6 18 18 6',
  arrow: 'M5 12h14m-5-5 5 5-5 5',
  copy: 'M9 8h11v13H9zM15 8V3H4v13h5',
  shield: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3zm-4 9 3 3 5-6',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 4v5l3 2',
  link: 'm9 15 6-6M8 17l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m0 10a4 4 0 0 0 6 0l5-5a4 4 0 0 0-6-6l-1 1',
  lock: 'M6 10h12v11H6zM8 10V7a4 4 0 0 1 8 0v3',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  refresh: 'M20 7v5h-5M4 17v-5h5M5 8a8 8 0 0 1 14-2l1 6M4 12l1 6a8 8 0 0 0 14-2',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 7v7m0-10v.1',
  menu: 'M4 6h16M4 12h16M4 18h16',
  logout: 'M9 4H4v16h5m5-14 6 6-6 6m-6-6h12',
  file: 'M6 3h8l4 4v14H6zM14 3v5h4M9 12h6m-6 4h6'
};
const I = n =>
  `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[n] || paths.plug}"/></svg>`;
const btn = (label, action, cls = '', icon = '') =>
  `<button type="button" class="btn ${cls}" data-action="${esc(action)}">${icon ? I(icon) : ''}${label}</button>`;
const sw = (on, action, label, disabled = false) =>
  `<button type="button" class="switch" role="switch" aria-checked="${!!on}" aria-label="${esc(label)}" data-action="${esc(action)}" ${disabled ? 'disabled' : ''}></button>`;
const names = {
  overview: 'Tổng quan',
  mcps: 'MCP & kết nối',
  agents: 'Agent & quyền',
  audit: 'Nhật ký',
  settings: 'Cài đặt'
};
let state = null,
  csrf = '',
  route = location.hash.slice(1) || 'overview',
  modalContext = {},
  filter = '',
  statusFilter = 'all',
  agentFilter = 'all',
  mcpFilter = 'all',
  timeFilter = 'all';
const modal = $('#modal');
const date = v =>
  v ? new Date(v).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : 'Chưa hoạt động';
function badge(status) {
  const label = {
    connected: 'Đã kết nối',
    disconnected: 'Chưa kết nối',
    expired: 'Cần kết nối lại',
    active: 'Đã duyệt',
    revoked: 'Đã thu hồi',
    pending: 'Chờ duyệt',
    success: 'Thành công',
    denied: 'Bị từ chối',
    error: 'Có lỗi'
  };
  return `<span class="badge ${['expired', 'pending', 'denied'].includes(status) ? 'warn' : status === 'error' ? 'red' : ['revoked', 'disconnected'].includes(status) ? 'gray' : ''}">${label[status] || esc(status)}</span>`;
}
function logo(m) {
  return `<span class="serviceicon ${esc(m.provider || 'files')}">${m.provider === 'github' ? 'G' : m.provider === 'drive' ? I('file') : m.provider === 'slack' ? '#' : m.provider === 'figma' ? 'F' : I('plug')}</span>`;
}
async function api(path, method = 'GET', data) {
  const r = await fetch('/api/' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
    ...(data ? { body: JSON.stringify(data) } : {})
  });
  let d;
  try {
    d = await r.json();
  } catch {
    throw Error('Không đọc được phản hồi từ Hub');
  }
  if (!r.ok) {
    if (r.status === 401 && path !== 'login') {
      state = null;
      login();
    }
    throw Error(d.error || 'Yêu cầu thất bại');
  }
  return d;
}
function toast(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('show');
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 4500);
}
function login(error = '') {
  $('#app').innerHTML =
    `<main class="loginwrap"><div class="loginbrand"><span class="brandmark">g</span>gen-hub</div><section class="card cardpad"><h1>Chào mừng trở lại</h1><p class="subtitle">Đăng nhập để quản lý không gian công cụ.</p><form id="login" style="margin-top:28px"><label class="field">Tài khoản owner<input class="input" name="username" autocomplete="username" required autofocus></label><label class="field">Mật khẩu<input class="input" name="password" type="password" autocomplete="current-password" required></label><p class="errorline" id="login-error">${esc(error)}</p><button class="btn primary" type="submit" style="width:100%">Đăng nhập</button></form><p class="footnote">Tài khoản được tạo trong bước cài đặt trên terminal.</p></section></main>`;
}
async function refresh() {
  state = await api('state');
  render();
}
async function boot() {
  try {
    const s = await api('session');
    csrf = s.csrf;
    await refresh();
    if (route.startsWith('consent/')) await consent(route.slice(8));
    else if (!state.settings.onboarded) onboarding();
  } catch (e) {
    if (!state) login(e.message === 'Hãy đăng nhập' ? '' : e.message);
    else toast(e.message);
  }
}
function head(title, sub, actions = '') {
  return `<div class="pagehead"><div><h1>${title}</h1><p class="subtitle">${sub}</p></div><div class="actions">${actions}</div></div>`;
}
function render() {
  if (!state) return;
  const r = names[route] ? route : 'overview';
  $('#app').innerHTML =
    `<div class="mobileoverlay" data-action="menu"></div><aside class="sidebar"><a class="brand" href="#overview"><span class="brandmark">g</span>gen-hub</a><div class="workspace"><span class="avatar">${esc(state.owner[0].toUpperCase())}</span><div><b>${esc(state.settings.name)}</b><small>Không gian cá nhân</small></div></div><div class="navlabel">Không gian quản lý</div><nav class="nav">${Object.keys(
      names
    )
      .map(
        (k, i) =>
          `<a href="#${k}" class="${r === k ? 'active' : ''}" ${r === k ? 'aria-current="page"' : ''}>${I(['grid', 'plug', 'bot', 'activity', 'settings'][i])}${names[k]}</a>`
      )
      .join(
        ''
      )}</nav><div class="sidebottom"><div class="health"><b><span class="dot"></span>Hub đang hoạt động</b><p>Linux · Gen-hub v0.1.0</p></div><div class="profile"><span class="avatar">${esc(state.owner[0].toUpperCase())}</span><div class="spacer"><b>${esc(state.owner)}</b><small>Chủ sở hữu</small></div><button class="iconbutton" data-action="logout" aria-label="Đăng xuất">${I('logout')}</button></div></div></aside><div class="shell"><header class="topbar"><div class="crumb"><button class="iconbutton mobilemenu" data-action="menu" aria-label="Menu">${I('menu')}</button><span>Không gian cá nhân</span><span>/</span><strong>${names[r]}</strong></div><div class="actions">${btn('Hướng dẫn', 'onboard', 'small', 'info')}<button class="iconbutton" data-action="refresh" aria-label="Làm mới">${I('refresh')}</button></div></header><main class="main"><div class="demo"><span>${I('lock')}${esc(new URL(state.origin).host)}</span><span>Dữ liệu từ Hub của bạn · ${new Date().toLocaleTimeString('vi-VN')}</span></div>${r === 'overview' ? overview() : r === 'mcps' ? mcps() : r === 'agents' ? agents() : r === 'audit' ? auditPage() : settings()}<footer class="bottomcaption"><span>GEN-HUB / Không gian công cụ của bạn</span><span>Tiếng Việt · GMT+7</span></footer></main></div>`;
  document.title = names[r] + ' · Gen-hub';
}
function overview() {
  const logs = state.logs,
    day = v =>
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(v)),
    today = day(Date.now()),
    calls = logs.filter(l => l.actor !== 'owner' && day(l.created) === today),
    connected = state.mcps.filter(m => m.status === 'connected').length,
    tools = state.mcps.reduce(
      (s, m) =>
        s + (m.on && m.status === 'connected' ? m.tools.filter(t => t.published).length : 0),
      0
    );
  const buckets = Array.from({ length: 12 }, (_, i) => {
    const start = Date.now() - (12 - i) * 3600000;
    return logs.filter(
      l =>
        l.actor !== 'owner' &&
        Date.parse(l.created) >= start &&
        Date.parse(l.created) < start + 3600000
    ).length;
  });
  const max = Math.max(1, ...buckets);
  return (
    head(
      'Tổng quan',
      'Mọi kết nối. Một nơi kiểm soát.',
      btn('Kết nối agent', 'connect', '', 'link') + btn('Thêm MCP', 'add', 'primary', 'plus')
    ) +
    `<section class="stats">${[
      ['MCP đã kết nối', connected, '/ ' + state.mcps.length, 'plug'],
      ['Agent đã duyệt', state.agents.filter(a => a.status === 'active').length, 'agent', 'bot'],
      ['Tool đang cung cấp', tools, 'tool', 'shield'],
      ['Lượt gọi hôm nay', calls.length, 'trong 200 log gần nhất', 'activity']
    ]
      .map(
        s =>
          `<div class="card stat"><div class="statlabel">${s[0]}${I(s[3])}</div><div class="statvalue">${s[1]}<small>${s[2]}</small></div></div>`
      )
      .join(
        ''
      )}</section><div class="dashboardgrid"><section class="card"><div class="cardhead"><h2>Hoạt động công cụ</h2><span class="badge gray">12 giờ gần đây</span></div><div class="cardpad"><div class="charttop"><strong>${calls.length ? Math.round((calls.filter(l => l.status === 'success').length / calls.length) * 100) + '%' : '—'}<small>thành công</small></strong></div><div class="chart"><div class="bars">${buckets.map((n, i) => `<div class="bar" style="height:${n ? Math.max(3, (n / max) * 100) : 1}%" title="${12 - i} giờ trước: ${n} lượt gọi"></div>`).join('')}</div></div><div class="charttimes"><span>12 giờ trước</span><span>Hiện tại</span></div>${!calls.length ? '<p class="footnote">Chưa có lượt gọi công cụ hôm nay.</p>' : ''}</div></section><section class="card endpointcard"><div class="cardhead"><h2>Một endpoint cho mọi agent</h2>${I('link')}</div><div class="cardpad"><p class="subtitle" style="margin-bottom:25px">Composite MCP có xác thực và phân quyền riêng.</p><div class="codecopy"><code>${esc(state.endpoint)}</code><button class="iconbutton" data-action="copyendpoint" aria-label="Sao chép">${I('copy')}</button></div><p class="footnote">Chỉ các tool bạn cấp mới được agent nhìn thấy và sử dụng.</p><div style="margin-top:25px">${btn('Hướng dẫn kết nối', 'connect', 'small', 'arrow')}</div></div></section></div><section class="card" style="margin-bottom:22px"><div class="cardhead"><h2>Kết nối cần chú ý</h2>${btn('Quản lý MCP', 'go:mcps', 'small')}</div><div class="cardpad">${
      state.mcps
        .filter(m => m.status !== 'connected')
        .map(
          m =>
            `<div class="listrow"><div class="inline">${logo(m)}<div><h3>${esc(m.name)}</h3><p class="sub">${esc(m.lastError || 'Chưa hoàn tất kết nối')}</p></div></div>${btn('Kết nối', 'credential:' + m.id, 'small')}</div>`
        )
        .join('') || '<p class="muted">Không có kết nối lỗi.</p>'
    }</div></section><section class="card"><div class="cardhead"><h2>Nhật ký gần đây</h2>${btn('Xem tất cả', 'go:audit', 'small')}</div>${logTable(logs.slice(0, 5))}</section>`
  );
}
function empty(title, desc) {
  return `<div class="card empty">${I('plug')}<h3>${title}</h3><p>${desc}</p></div>`;
}
function searchInput(placeholder) {
  return `<label class="search">${I('search')}<input id="search" value="${esc(filter)}" placeholder="${placeholder}" aria-label="${placeholder}"></label>`;
}
function mcps() {
  return (
    head(
      'MCP & kết nối',
      'Thêm dịch vụ, kết nối tài khoản và công bố tool cho agent.',
      btn('Thêm MCP', 'add', 'primary', 'plus')
    ) +
    `<div class="toolbar">${searchInput('Tìm MCP…')}<span class="muted">${state.mcps.length} MCP</span></div><div id="results">${mcpResults()}</div>`
  );
}
function mcpResults() {
  const rows = state.mcps.filter(m => m.name.toLowerCase().includes(filter.toLowerCase()));
  return rows.length
    ? `<div class="servicegrid">${rows.map(m => `<article class="card servicecard"><div class="servicecardtop">${logo(m)}${badge(m.status)}</div><h2>${esc(m.name)}</h2><p>${esc(m.description)}</p><div class="inline" style="margin-top:17px"><span class="badge gray">${esc(m.provider === 'remote' ? 'MCP tùy chỉnh' : state.catalog.find(c => c.id === m.provider)?.category)}</span><span class="sub">${m.tools.filter(t => t.published).length}/${m.tools.length} tool công bố</span></div><div class="divider"></div><div class="servicecardfoot"><span class="togglelabel">${sw(m.on, 'toggle:' + m.id, 'Cung cấp ' + m.name)}Cung cấp</span>${btn('Quản lý', 'mcp:' + m.id, 'small')}</div></article>`).join('')}</div>`
    : empty('Chưa có MCP phù hợp', 'Thêm MCP để kết nối dịch vụ và cung cấp công cụ cho agent.');
}
function agents() {
  return (
    head(
      'Agent & quyền',
      'Cấp công cụ riêng cho từng agent; thu hồi ngay khi cần.',
      btn('Kết nối agent', 'connect', 'primary', 'plus')
    ) +
    `<div class="toolbar">${searchInput('Tìm agent…')}</div><div id="results">${agentResults()}</div><div class="info" style="margin-top:20px">${I('shield')}Agent kết nối qua OAuth cần owner đăng nhập và duyệt. Bạn cũng có thể tạo token riêng cho MCP client không hỗ trợ OAuth.</div>`
  );
}
function shortAgentId(agent) {
  let size = Math.min(8, agent.id.length);
  while (
    size < agent.id.length &&
    state.agents.some(other => other.id !== agent.id && other.id.endsWith(agent.id.slice(-size)))
  )
    size++;
  return agent.id.slice(-size);
}
function agentResults() {
  const rows = state.agents.filter(a =>
    (a.name + ' ' + a.id).toLowerCase().includes(filter.toLowerCase())
  );
  return rows.length
    ? `<div class="card tablewrap"><table><thead><tr><th>Agent</th><th>Trạng thái</th><th>Tool khả dụng</th><th>Lần gọi gần nhất</th><th></th></tr></thead><tbody>${rows.map(a => `<tr><td><div class="inline">${I('bot')}<div><h3>${esc(a.name)}</h3><code class="mono" title="${esc(a.id)}">#${esc(shortAgentId(a))}</code><p class="sub">${a.client === 'Manual' ? 'Token riêng' : 'OAuth'}</p></div></div></td><td>${badge(a.status)}</td><td>${a.effective} / ${a.permissions.length}</td><td>${date(a.last)}</td><td>${btn('Quản lý quyền', 'agent:' + a.id, 'small')}</td></tr>`).join('')}</tbody></table></div>`
    : empty('Chưa có agent', 'Kết nối agent bằng endpoint MCP hoặc tạo token riêng.');
}
function options(rows, current) {
  return rows
    .map(
      ([v, l]) => `<option value="${esc(v)}" ${v === current ? 'selected' : ''}>${esc(l)}</option>`
    )
    .join('');
}
function logFilter(logs = state.logs) {
  return logs.filter(
    l =>
      (l.tool + ' ' + l.actor + ' ' + l.id).toLowerCase().includes(filter.toLowerCase()) &&
      (statusFilter === 'all' || l.status === statusFilter) &&
      (agentFilter === 'all' || l.actor === agentFilter) &&
      (mcpFilter === 'all' || l.mcp === mcpFilter) &&
      (timeFilter === 'all' || Date.parse(l.created) > Date.now() - Number(timeFilter) * 3600000)
  );
}
function auditPage() {
  return (
    head(
      'Nhật ký',
      'Input, output và quyết định cấp quyền của từng lượt gọi.',
      btn('Xuất JSONL', 'export', '', 'download')
    ) +
    `<div class="toolbar">${searchInput('Tìm tool, actor hoặc ID…')}<div class="actions"><select id="statusfilter" class="filter" aria-label="Kết quả">${options(
      [
        ['all', 'Tất cả kết quả'],
        ['success', 'Thành công'],
        ['denied', 'Bị từ chối'],
        ['error', 'Có lỗi']
      ],
      statusFilter
    )}</select><select id="agentfilter" class="filter" aria-label="Agent">${options([['all', 'Tất cả agent'], ['owner', 'Owner'], ...[...new Set(state.logs.filter(l => l.actor.startsWith('admin-assistant:')).map(l => l.actor))].map(actor => [actor, 'Trợ lý quản trị #' + actor.slice(-8)]), ...state.agents.map(a => [a.id, a.name])], agentFilter)}</select><select id="mcpfilter" class="filter" aria-label="MCP">${options([['all', 'Tất cả MCP'], ['hub', 'Hub'], ...state.mcps.map(m => [m.id, m.name])], mcpFilter)}</select><select id="timefilter" class="filter" aria-label="Thời gian">${options(
      [
        ['all', 'Tất cả thời gian'],
        ['1', 'Giờ qua'],
        ['24', '24 giờ qua'],
        ['168', '7 ngày qua']
      ],
      timeFilter
    )}</select></div></div><div class="card" id="results">${logTable(logFilter())}</div><p class="footnote">Hiển thị tối đa 200 bản ghi mới nhất. Xuất JSONL áp dụng cùng bộ lọc trên tối đa 5.000 bản ghi. Trường credential luôn được ẩn.</p>`
  );
}
function logTable(rows) {
  return rows.length
    ? `<div class="tablewrap"><table><thead><tr><th>Thời gian</th><th>Người thực hiện</th><th>Công cụ / Thao tác</th><th>Kết quả</th><th>Xử lý</th><th></th></tr></thead><tbody>${rows.map(l => `<tr><td>${date(l.created)}</td><td>${esc(l.actor === 'owner' ? state.owner : state.agents.find(a => a.id === l.actor)?.name || l.actor)}</td><td><div class="mono">${esc(l.tool)}</div><div class="sub">${esc(state.mcps.find(m => m.id === l.mcp)?.name || 'Hub')} · #${l.id}</div></td><td>${badge(l.status)}</td><td class="mono">${l.latency} ms</td><td>${btn('Chi tiết', 'log:' + l.id, 'small')}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty"><h3>Chưa có nhật ký phù hợp</h3><p>Thay đổi bộ lọc hoặc bắt đầu sử dụng Hub.</p></div>';
}
function settings() {
  return (
    head('Cài đặt', 'Thông tin Hub, truy cập và nhật ký.') +
    `<div class="twocol"><section class="card cardpad"><h2>Không gian cá nhân</h2><form id="settings" style="margin-top:23px"><label class="field">Tên Hub<input class="input" name="name" value="${esc(state.settings.name)}" required maxlength="60"></label><label class="field">Lưu nhật ký<select name="retention">${options(
      [
        [7, '7 ngày'],
        [30, '30 ngày'],
        [90, '90 ngày']
      ],
      state.settings.retention
    )}</select></label><button class="btn primary" type="submit">Lưu thay đổi</button></form><div class="divider"></div><div class="settingsrow"><div><h3>Agent mới cần được duyệt</h3><p>Quyền do owner cấp tại Hub.</p></div><span class="badge">Luôn bật</span></div><div class="settingsrow"><div><h3>Credential được mã hóa</h3><p>Khóa và dữ liệu nằm trên máy cài Gen-hub.</p></div>${I('lock')}</div><div class="divider"></div>${btn('Đổi mật khẩu owner', 'password', '', 'lock')}</section><div><section class="card cardpad"><h2>Domain & endpoint</h2><p class="footnote" style="margin-bottom:20px">${esc(state.origin)}</p><div class="codecopy"><code>${esc(state.endpoint)}</code><button class="iconbutton" data-action="copyendpoint" aria-label="Sao chép">${I('copy')}</button></div><p class="footnote">Domain, DNS, Caddy và tunnel được thiết lập bằng TUI. Dùng lệnh gen-hub status trên máy để xem dịch vụ.</p><div class="divider"></div><p class="jsonlabel">OAuth callback cho dịch vụ</p><code class="mono">${esc(state.origin)}/oauth/callback</code></section><section class="card cardpad" style="margin-top:22px"><h2>Bắt đầu sử dụng</h2><p class="footnote" style="margin-bottom:18px">Mở lại hướng dẫn thêm MCP, kết nối và cấp quyền agent.</p>${btn('Mở hướng dẫn', 'onboard', '', 'info')}</section></div></div>` +
    adminAssistantSettings()
  );
}
function adminAssistantSettings() {
  const a = state.adminAssistant || {};
  return `<section class="card cardpad" style="margin-top:24px"><h2>Trợ lý AI quản trị riêng</h2><p class="footnote">Quyền quản trị console như owner. Token không tự hết hạn; chỉ cấp cho trợ lý cá nhân và thu hồi tại đây khi cần.</p><div class="codecopy"><code>${esc(a.endpoint || state.origin + '/mcp/admin')}</code></div>${a.active ? `<p>Đang hoạt động · #${esc(a.id.slice(-8))}</p><p class="footnote">Tạo: ${date(a.created)} · Dùng gần nhất: ${date(a.lastUsed)}</p>${btn('Thu hồi token trợ lý', 'admin-revoke', 'danger')}` : `<p class="footnote">Chưa có token hoạt động. Bạn cần nhập lại mật khẩu owner để tạo; token chỉ hiển thị một lần.</p>${btn('Tạo token trợ lý', 'admin-create', 'primary')}`}</section>`;
}
function show(title, sub, body, footer = '', sheet = false) {
  modal.className = sheet ? 'sheet' : '';
  modal.innerHTML = `<div class="modalhead"><div><h2>${title}</h2><p>${sub}</p></div><button class="iconbutton" data-action="close" aria-label="Đóng">${I('close')}</button></div><div class="modalbody">${body}</div>${footer ? `<div class="modalfooter">${footer}</div>` : ''}`;
  if (!modal.open) modal.showModal();
}
function close() {
  modal.close();
  modal.innerHTML = '';
  modalContext = {};
}
function onboarding() {
  show(
    'Bắt đầu với Gen-hub',
    'Hoàn tất bốn bước để agent sử dụng công cụ.',
    `<div class="steps">${[
      [
        'Thêm MCP',
        'Chọn Google Drive, GitHub, Slack, Telegram, Discord, Figma hoặc MCP HTTP tùy chỉnh.'
      ],
      [
        'Kết nối tài khoản',
        'Nhập token hoặc cấu hình OAuth app rồi đăng nhập nhà cung cấp. Credential chỉ lưu tại Hub.'
      ],
      ['Cấp quyền agent', 'Công bố tool ở MCP, sau đó cấp tool cụ thể cho từng agent.'],
      [
        'Thử và kiểm tra nhật ký',
        'Kết nối agent với endpoint tổng, gọi một tool đọc và xem input/output trong Nhật ký.'
      ]
    ]
      .map(s => `<div class="step"><div><h3>${s[0]}</h3><p>${s[1]}</p></div></div>`)
      .join(
        ''
      )}</div><div class="info">${I('info')}Mỗi dịch vụ có yêu cầu quyền riêng. Trong màn hình kết nối có link hướng dẫn và địa chỉ callback của Hub.</div>`,
    btn('Để sau', 'onboard-done') + btn('Thêm MCP đầu tiên', 'onboard-add', 'primary', 'plus')
  );
}
function add() {
  show(
    'Thêm MCP',
    'Các bộ công cụ tích hợp gọi API thật của dịch vụ.',
    state.catalog
      .map(
        c =>
          `<div class="catalogrow">${logo({ provider: c.id })}<div><h3>${esc(c.name)}</h3><p>${esc(c.description)} · ${esc(c.auth)}</p></div>${btn('Thêm', 'install:' + c.id, 'small')}</div>`
      )
      .join('') +
      `<div class="divider"></div><h3>MCP HTTP tùy chỉnh</h3><form id="remote" style="margin-top:20px"><label class="field">Tên MCP<input class="input" name="name" required maxlength="60"></label><label class="field">Địa chỉ endpoint<input class="input" type="url" name="url" placeholder="https://mcp.example.com/mcp" required></label><div id="remote-guide" aria-live="polite"></div><label class="field">Xác thực<select name="auth"><option value="token">Bearer token</option><option value="none">Không xác thực</option></select></label><label class="checkboxline"><input type="checkbox" name="allowPrivate">Cho phép truy cập server nội bộ / localhost của máy cài Hub</label><button class="btn primary" type="submit">Thêm MCP tùy chỉnh</button></form>`,
    btn('Đóng', 'close')
  );
}
function mcp(id) {
  const m = state.mcps.find(m => m.id === id);
  modalContext = { kind: 'mcp', id };
  show(
    esc(m.name),
    'Công bố tool tại đây; cấp cho agent trong Agent & quyền.',
    `<div class="mcpdetailtop">${logo(m)}<div><h3>${esc(m.name)}</h3><p>${esc(m.description)}</p></div><span class="spacer"></span>${badge(m.status)}</div><div class="actions">${btn('Kết nối / xác thực', 'credential:' + id, 'small', 'link')}${btn('Đồng bộ tool', 'sync:' + id, 'small', 'refresh')}${m.hasCredential ? btn('Ngắt kết nối', 'disconnect:' + id, 'danger small') : ''}</div>${m.lastError ? `<p class="errorline" style="margin-top:15px">${esc(m.lastError)}</p>` : ''}<div class="settingsrow"><div><h3>Cung cấp MCP</h3><p>${m.on ? 'MCP đang được bật' : 'Tạm dừng cho tất cả agent'}</p></div>${sw(m.on, 'toggle:' + id, 'Cung cấp MCP')}</div><p class="footnote">Đồng bộ lần gần nhất: ${date(m.syncedAt)}</p><div class="divider"></div><div class="toolgroup">${m.tools.map(t => `<div class="toolrow"><div><b>${esc(t.name)}</b><p>${esc(t.description)}</p></div><div class="inline"><span class="badge ${t.annotations?.readOnlyHint ? 'gray' : 'warn'}">${t.annotations?.readOnlyHint ? 'Đọc' : 'Ghi / khác'}</span>${sw(t.published, 'publish:' + id + ':' + t.name, 'Công bố ' + t.name)}</div></div>`).join('') || '<div class="empty">Kết nối rồi đồng bộ danh sách tool.</div>'}</div><div class="divider"></div>${btn('Gỡ MCP khỏi Hub', 'remove:' + id, 'danger small')}`,
    btn('Đóng', 'close'),
    true
  );
}
function connectionGuideHtml(provider, endpoint) {
  const guide = connectionGuide(provider, endpoint);
  if (!guide)
    return '<p class="footnote">Lấy loại token do nhà cung cấp MCP yêu cầu. Gen-hub hiện hỗ trợ Bearer token hoặc không xác thực cho MCP HTTP tùy chỉnh.</p>';
  return `<section class="card cardpad"><h3>${esc(guide.title)}</h3><p>${esc(guide.recommendation)}</p><ol>${guide.steps.map(step => `<li>${esc(step)}</li>`).join('')}</ol><div class="actions">${guide.links.map(([label, url]) => `<a class="textbutton" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`).join('')}</div><p class="footnote">${esc(guide.note)}</p></section>`;
}
function credential(id) {
  const m = state.mcps.find(m => m.id === id),
    c = state.catalog.find(c => c.id === m.provider);
  modalContext = { kind: 'credential', id };
  const tokenForm =
    m.provider === 'drive'
      ? ''
      : `<div class="divider"></div><h3>${m.auth === 'none' ? 'Kết nối không xác thực' : 'Kết nối bằng token'}</h3>${m.auth === 'none' ? `<p class="footnote">Endpoint: ${esc(m.url)}</p>${btn('Kiểm tra & đồng bộ', 'sync:' + id, 'primary')}` : `<form id="credential" style="margin-top:18px"><label class="field">${['telegram', 'discord'].includes(m.provider) ? 'Bot token' : 'Access token'}<input class="input" name="token" type="password" required autocomplete="new-password"></label><button class="btn primary" type="submit">Lưu & kiểm tra kết nối</button></form>`}`;
  const oauthForm = !c?.oauth
    ? ''
    : `<div class="divider"></div><h3>Đăng nhập bằng OAuth</h3><p class="footnote">Tạo OAuth App của bạn tại <a href="${esc(c.guide)}" target="_blank" rel="noopener noreferrer">trang nhà cung cấp</a>, rồi khai báo chính xác Redirect URI: <code>${esc(state.origin)}/oauth/callback</code></p><form id="oauth" style="margin-top:18px"><label class="field">Client ID<input name="client_id" class="input" required autocomplete="off"></label><label class="field">Client secret<input name="client_secret" class="input" type="password" required autocomplete="new-password"></label><button class="btn primary" type="submit">Lưu & đăng nhập ${esc(m.name)}</button></form>`;
  show(
    'Kết nối ' + esc(m.name),
    'Thông tin xác thực được mã hóa trên Hub.',
    connectionGuideHtml(m.provider, m.url) + tokenForm + oauthForm,
    btn('Đóng', 'close')
  );
}
function grantRows(selected) {
  return (
    state.mcps
      .map(
        m =>
          `<div class="toolgroup"><div class="toolgrouphead"><div class="inline">${logo(m)}<div><h3>${esc(m.name)}</h3><p class="sub">${m.on ? '' : 'MCP tạm dừng · '}${m.status === 'connected' ? 'Đã kết nối' : 'Kết nối chưa sẵn sàng'}</p></div></div></div>${
            m.tools
              .filter(t => t.published || selected.includes(m.id + ':' + t.name))
              .map(
                t =>
                  `<label class="toolrow"><div><b>${esc(t.name)}</b><p>${esc(t.description)}${!t.published ? ' · Chưa công bố' : ''}</p></div><input type="checkbox" name="permissions" value="${esc(m.id + ':' + t.name)}" ${selected.includes(m.id + ':' + t.name) ? 'checked' : ''} ${!t.published ? 'disabled' : ''}></label>`
              )
              .join('') || '<p class="footnote" style="padding:15px">Chưa công bố tool.</p>'
          }</div>`
      )
      .join('') || '<div class="info">Thêm MCP và công bố tool trước khi cấp quyền.</div>'
  );
}
function agent(id) {
  const a = state.agents.find(a => a.id === id);
  modalContext = { kind: 'agent', id };
  show(
    esc(a.name),
    'ID: ' + esc(a.id),
    `<div class="inline" style="margin-bottom:22px">${badge(a.status)}<span class="muted">${a.effective} tool khả dụng</span></div><form id="grants"><label class="field">Tên gợi nhớ<input class="input" name="name" value="${esc(a.name)}" required maxlength="80"></label>${grantRows(a.permissions)}<div class="actions"><button class="btn primary" type="submit">Lưu quyền</button>${a.status === 'active' ? btn('Thu hồi agent', 'revoke:' + id, 'danger') : btn('Xóa agent', 'delete-agent:' + id, 'danger')}</div></form><div class="divider"></div><h3>Kiểm tra quyền đã lưu</h3><form id="test" style="margin-top:18px"><label class="field">Chọn tool<select name="tool">${state.mcps.flatMap(m => m.tools.map(t => `<option value="${esc(m.id + ':' + t.name)}">${esc(m.name)} / ${esc(t.name)}</option>`)).join('')}</select></label><button class="btn" type="submit">Kiểm tra quyền</button><div id="test-result" style="margin-top:16px"></div></form>`,
    btn('Đóng', 'close'),
    true
  );
}
function connect() {
  modalContext = { kind: 'connect' };
  show(
    'Kết nối agent',
    'Chọn OAuth hoặc tạo token riêng cho client.',
    `<div class="codecopy"><code>${esc(state.endpoint)}</code><button class="iconbutton" data-action="copyendpoint" aria-label="Sao chép">${I('copy')}</button></div><div class="steps"><div class="step"><div><h3>Thêm endpoint vào MCP client</h3><p>Chọn Streamable HTTP. Client hỗ trợ OAuth sẽ mở trang đăng nhập Hub để bạn duyệt và cấp quyền.</p></div></div><div class="step"><div><h3>Agent chỉ thấy tool được cấp</h3><p>Quyền được kiểm tra trên mỗi lượt gọi. Không chuyển token dịch vụ cho agent.</p></div></div></div><div class="divider"></div><h3>Tạo token riêng</h3><p class="footnote">Dành cho client dùng Authorization: Bearer. Token hết hạn sau 90 ngày; chỉ hiển thị một lần.</p><form id="manual-agent" style="margin-top:20px"><label class="field">Tên agent<input class="input" name="name" required maxlength="80" placeholder="Codex CLI"></label>${grantRows([])}<button class="btn primary" type="submit">Tạo agent & token</button></form>`,
    btn('Đóng', 'close'),
    true
  );
}
async function consent(flow) {
  const f = await api('flows/' + flow);
  modalContext = { kind: 'consent', id: flow };
  show(
    'Duyệt kết nối agent',
    esc(f.name),
    `<div class="info">${I('shield')}Client yêu cầu sử dụng Gen-hub. Chỉ chọn tool bạn muốn cấp.</div><p class="footnote" style="margin-bottom:20px">Sau khi duyệt, quay về: ${esc(f.redirect_uri)}</p><form id="consent"><label class="field">Tên gợi nhớ cho agent<input class="input" name="name" value="${esc(f.name)}" maxlength="80" placeholder="Ví dụ: Claude trên laptop"></label><p class="footnote">Tên gợi ý do client tự khai báo; bạn có thể sửa. Mỗi agent còn có ID riêng trong danh sách.</p>${grantRows([])}<div class="actions">${btn('Từ chối', 'deny:' + flow, 'danger')}<button class="btn primary" type="submit">Duyệt & cấp quyền</button></div></form>`,
    '',
    true
  );
}
function log(id, tab = 'input') {
  const l = state.logs.find(l => String(l.id) === String(id));
  modalContext = { kind: 'log', id, tab };
  const data =
    tab === 'input'
      ? l.input
      : tab === 'output'
        ? l.output
        : {
            decision: l.status === 'denied' ? 'DENY' : l.status === 'error' ? 'ERROR' : 'ALLOW',
            reason: l.reason,
            actor: l.actor,
            mcp: l.mcp,
            tool: l.tool
          };
  show(
    'Chi tiết nhật ký',
    '#' + l.id,
    `<div class="inline" style="justify-content:space-between;margin-bottom:22px"><span class="mono">${esc(l.tool)}</span>${badge(l.status)}</div><dl class="detailgrid"><div><dt>Thời điểm</dt><dd>${date(l.created)}</dd></div><div><dt>Thời gian xử lý</dt><dd>${l.latency} ms</dd></div><div><dt>Người thực hiện</dt><dd>${esc(state.agents.find(a => a.id === l.actor)?.name || l.actor)}</dd></div><div><dt>MCP</dt><dd>${esc(state.mcps.find(m => m.id === l.mcp)?.name || l.mcp)}</dd></div></dl><div class="tabs">${[
      ['input', 'Input'],
      ['output', 'Output'],
      ['policy', 'Quyết định cấp quyền']
    ]
      .map(
        t =>
          `<button class="tab ${tab === t[0] ? 'active' : ''}" data-action="logtab:${t[0]}">${t[1]}</button>`
      )
      .join(
        ''
      )}</div><pre class="json">${esc(JSON.stringify(data, null, 2))}</pre><p class="footnote">Các trường credential được ẩn trước khi ghi nhật ký.</p>`,
    btn('Đóng', 'close'),
    true
  );
}
function confirmation(title, detail, action) {
  show(
    title,
    'Thao tác sẽ áp dụng ngay trên Hub.',
    `<p>${detail}</p>`,
    btn('Hủy', 'close') + btn('Xác nhận', action, 'danger')
  );
}
async function copy(value) {
  try {
    await navigator.clipboard.writeText(value);
    toast('Đã sao chép');
  } catch {
    show(
      'Sao chép',
      'Chọn nội dung bên dưới.',
      `<textarea class="input" readonly>${esc(value)}</textarea>`,
      btn('Đóng', 'close')
    );
    modal.querySelector('textarea').select();
  }
}
function download(name, data) {
  const u = URL.createObjectURL(new Blob([data], { type: 'application/json' })),
    a = document.createElement('a');
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
async function act(action, args) {
  const id = args[0];
  if (action === 'close') return close();
  if (action === 'menu') {
    document.querySelector('.sidebar').classList.toggle('open');
    document.querySelector('.mobileoverlay').classList.toggle('open');
    return;
  }
  if (action === 'go') {
    close();
    location.hash = id;
    return;
  }
  if (action === 'refresh') {
    await refresh();
    return toast('Đã cập nhật dữ liệu');
  }
  if (action === 'logout') {
    await api('logout', 'POST');
    state = null;
    close();
    login();
    return;
  }
  if (action === 'copyendpoint') return copy(state.endpoint);
  if (action === 'onboard') return onboarding();
  if (action === 'onboard-done' || action === 'onboard-add') {
    await api('settings', 'PATCH', { onboarded: true });
    close();
    await refresh();
    if (action === 'onboard-add') add();
    return;
  }
  if (action === 'add') return add();
  if (action === 'install') {
    const m = await api('mcps', 'POST', { provider: id });
    await refresh();
    credential(m.id);
    return;
  }
  if (action === 'mcp') return mcp(id);
  if (action === 'credential') return credential(id);
  if (action === 'toggle') {
    const m = state.mcps.find(m => m.id === id);
    await api('mcps/' + id, 'PATCH', { on: !m.on });
    await refresh();
    if (modal.open) mcp(id);
    return;
  }
  if (action === 'publish') {
    const m = state.mcps.find(m => m.id === id),
      name = args.slice(1).join(':'),
      published = m.tools
        .filter(t => (t.name === name ? !t.published : t.published))
        .map(t => t.name);
    await api('mcps/' + id, 'PATCH', { published });
    await refresh();
    mcp(id);
    return;
  }
  if (action === 'sync') {
    await api('mcps/' + id + '/sync', 'POST');
    await refresh();
    mcp(id);
    return toast('Đã kết nối và đồng bộ tool');
  }
  if (action === 'disconnect')
    return confirmation(
      'Ngắt kết nối?',
      'Các tool liên quan sẽ ngừng khả dụng cho mọi agent.',
      'do-disconnect:' + id
    );
  if (action === 'do-disconnect') {
    await api('mcps/' + id + '/disconnect', 'POST');
    await refresh();
    mcp(id);
    return;
  }
  if (action === 'remove')
    return confirmation(
      'Gỡ MCP?',
      'Gỡ kết nối, credential và quyền liên quan; giữ lại nhật ký cũ.',
      'do-remove:' + id
    );
  if (action === 'do-remove') {
    await api('mcps/' + id, 'DELETE');
    close();
    return refresh();
  }
  if (action === 'agent') return agent(id);
  if (action === 'connect') return connect();
  if (action === 'revoke')
    return confirmation(
      'Thu hồi agent?',
      'Các token của agent bị vô hiệu hóa. Muốn kết nối lại cần xác thực hoặc tạo token mới.',
      'do-revoke:' + id
    );
  if (action === 'do-revoke') {
    await api('agents/' + id, 'PATCH', { status: 'revoked' });
    close();
    return refresh();
  }
  if (action === 'delete-agent')
    return confirmation(
      'Xóa agent đã thu hồi?',
      'Xóa khỏi danh sách và giữ nhật ký theo thời gian lưu đã cấu hình.',
      'do-delete-agent:' + id
    );
  if (action === 'do-delete-agent') {
    await api('agents/' + id, 'DELETE');
    close();
    return refresh();
  }
  if (action === 'log') return log(id);
  if (action === 'logtab') return log(modalContext.id, id);
  if (action === 'export') {
    const rows = logFilter(await api('logs'));
    download('gen-hub-audit.jsonl', rows.map(r => JSON.stringify(r)).join('\n'));
    return toast('Đã xuất ' + rows.length + ' bản ghi');
  }
  if (action === 'deny') {
    const r = await api('flows/' + id, 'POST', { approve: false });
    location.href = r.redirect;
    return;
  }
  if (action === 'admin-create') {
    show(
      'Tạo token trợ lý quản trị',
      'Xác thực lại bằng mật khẩu owner.',
      `<form id="admin-create"><label class="field">Mật khẩu owner<input class="input" type="password" name="password" required autocomplete="current-password"></label><button class="btn primary" type="submit">Xác nhận & tạo token</button></form>`,
      btn('Hủy', 'close')
    );
    return;
  }
  if (action === 'admin-revoke') {
    await api('admin-assistant', 'DELETE');
    await refresh();
    return toast('Đã thu hồi token trợ lý quản trị');
  }
  if (action === 'password') {
    show(
      'Đổi mật khẩu owner',
      'Sau khi đổi, mọi phiên quản trị sẽ đăng xuất.',
      `<form id="password"><label class="field">Mật khẩu hiện tại<input class="input" type="password" name="current" required autocomplete="current-password"></label><label class="field">Mật khẩu mới<input class="input" type="password" name="password" minlength="12" maxlength="256" required autocomplete="new-password"></label><label class="field">Nhập lại mật khẩu mới<input class="input" type="password" name="repeat" minlength="12" required autocomplete="new-password"></label><button class="btn primary" type="submit">Đổi mật khẩu</button></form>`,
      btn('Hủy', 'close')
    );
    return;
  }
}
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  el.disabled = true;
  const [a, ...args] = el.dataset.action.split(':');
  try {
    await act(a, args);
  } catch (err) {
    toast(err.message);
  } finally {
    el.disabled = false;
  }
});
document.addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target,
    b = Object.fromEntries(new FormData(f)),
    button = f.querySelector('[type=submit]');
  if (button) button.disabled = true;
  try {
    if (f.id === 'login') {
      const r = await api('login', 'POST', b);
      csrf = r.csrf;
      await refresh();
      if (route.startsWith('consent/')) await consent(route.slice(8));
      else if (!state.settings.onboarded) onboarding();
    }
    if (f.id === 'remote') {
      const m = await api('mcps', 'POST', {
        ...b,
        provider: 'remote',
        allowPrivate: !!b.allowPrivate
      });
      await refresh();
      credential(m.id);
    }
    if (f.id === 'credential') {
      await api('mcps/' + modalContext.id + '/credential', 'POST', b);
      await refresh();
      mcp(modalContext.id);
      toast('Kết nối thành công');
    }
    if (f.id === 'oauth') {
      const r = await api('mcps/' + modalContext.id + '/oauth', 'POST', b);
      location.href = r.url;
    }
    if (f.id === 'grants') {
      await api('agents/' + modalContext.id, 'PATCH', {
        name: b.name,
        permissions: new FormData(f).getAll('permissions')
      });
      close();
      await refresh();
      toast('Đã lưu tên và quyền');
    }
    if (f.id === 'manual-agent') {
      const r = await api('agents', 'POST', {
        name: b.name,
        permissions: new FormData(f).getAll('permissions')
      });
      await refresh();
      show(
        'Token đã được tạo',
        'Sao chép ngay; token sẽ không được hiển thị lại.',
        `<label class="field">Token riêng<textarea class="input mono" readonly rows="3">${esc(r.token)}</textarea></label><p class="footnote">Endpoint: ${esc(state.endpoint)}</p><pre class="json">${esc(JSON.stringify({ mcpServers: { 'gen-hub': { url: state.endpoint, headers: { Authorization: 'Bearer ' + r.token } } } }, null, 2))}</pre><p class="footnote">Hết hạn sau 90 ngày. Không chia sẻ cấu hình chứa token.</p>`,
        btn('Đã lưu token', 'close')
      );
    }
    if (f.id === 'consent') {
      const r = await api('flows/' + modalContext.id, 'POST', {
        approve: true,
        name: b.name,
        permissions: new FormData(f).getAll('permissions')
      });
      location.href = r.redirect;
    }
    if (f.id === 'test') {
      const [mcp, tool] = b.tool.split(':'),
        r = await api('test', 'POST', { agent: modalContext.id, mcp, tool });
      $('#test-result').innerHTML =
        `<div class="info">${I(r.allowed ? 'check' : 'lock')}<div><h3>${r.allowed ? 'Cho phép' : 'Không khả dụng'}</h3><p>${esc(r.reason)}</p></div></div>`;
    }
    if (f.id === 'settings') {
      await api('settings', 'PATCH', { name: b.name, retention: Number(b.retention) });
      await refresh();
      toast('Đã lưu cài đặt');
    }
    if (f.id === 'admin-create') {
      const result = await api('admin-assistant', 'POST', { password: b.password });
      f.reset();
      await refresh();
      show(
        'Token trợ lý quản trị đã tạo',
        'Sao chép ngay; không thể xem lại token sau khi đóng.',
        `<label class="field">Admin token<textarea class="input mono" readonly rows="3">${esc(result.token)}</textarea></label><p>Endpoint: <code>${esc(result.endpoint)}</code></p><pre class="json">${esc(JSON.stringify({ mcpServers: { 'gen-hub-admin': { url: result.endpoint, headers: { Authorization: 'Bearer ' + result.token } } } }, null, 2))}</pre><p class="footnote">Dùng Bearer token, không qua OAuth. Token có quyền quản trị và chỉ mất hiệu lực khi owner thu hồi.</p>`,
        btn('Đã lưu token', 'close')
      );
    }
    if (f.id === 'password') {
      if (b.password !== b.repeat) throw Error('Mật khẩu nhập lại không khớp');
      await api('password', 'POST', b);
      state = null;
      close();
      login();
      toast('Đã đổi mật khẩu, hãy đăng nhập lại');
    }
  } catch (err) {
    if (f.id === 'login') $('#login-error').textContent = err.message;
    else toast(err.message);
  } finally {
    if (button) button.disabled = false;
  }
});
function updateResults() {
  const el = $('#results');
  if (el)
    el.innerHTML =
      route === 'mcps' ? mcpResults() : route === 'agents' ? agentResults() : logTable(logFilter());
}
document.addEventListener('input', e => {
  if (e.target.name === 'url' && e.target.form?.id === 'remote')
    $('#remote-guide').innerHTML = connectionGuideHtml('remote', e.target.value);
  if (e.target.id === 'search') {
    filter = e.target.value;
    updateResults();
  }
});
document.addEventListener('change', e => {
  if (e.target.id === 'statusfilter') statusFilter = e.target.value;
  else if (e.target.id === 'agentfilter') agentFilter = e.target.value;
  else if (e.target.id === 'mcpfilter') mcpFilter = e.target.value;
  else if (e.target.id === 'timefilter') timeFilter = e.target.value;
  else return;
  updateResults();
});
window.addEventListener('hashchange', async () => {
  route = location.hash.slice(1) || 'overview';
  filter = '';
  statusFilter = 'all';
  agentFilter = 'all';
  mcpFilter = 'all';
  timeFilter = 'all';
  close();
  if (state) {
    render();
    if (route.startsWith('consent/'))
      try {
        await consent(route.slice(8));
      } catch (e) {
        toast(e.message);
      }
  }
});
boot();
