import { kanbanPage, kanbanCards } from './kanban.js';
import { auditStats, isToolCall, pieArc } from './audit-stats.js';
import { connectionGuide } from './connection-guides.js';
import { getNotifications, timeAgo } from './notifications.js';
import { normalizeSettings } from './settings.js';
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
  file: 'M6 3h8l4 4v14H6zM14 3v5h4M9 12h6m-6 4h6',
  bell: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0',
  chevron: 'm6 9 6 6 6-6'
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
  vault: 'Kho bí mật',
  audit: 'Nhật ký',
  kanban: 'Kanban',
  settings: 'Cài đặt'
};
let state = null,
  csrf = '',
  route = (location.hash.slice(1) || 'overview').split('?')[0],
  modalContext = {},
  modalVersion = 0,
  filter = '',
  statusFilter = 'all',
  agentFilter = 'all',
  mcpFilter = 'all',
  timeFilter = 'all';
const selected = { agents: null, mcps: null, vault: null, settings: 'general' };
const detailTabs = { agents: 'info', mcps: 'info', vault: 'info', settings: 'info' };
let activity = new Map(),
  activityHours = 168;
let auditLogs = [],
  auditCursor = null,
  auditHasMore = false,
  auditLoading = false,
  auditError = null,
  auditFetchGen = 0,
  auditDebounceTimer = null;
let auditExact = {};
const logDetailCache = new Map();
let notifOpen = false,
  notifSnapshotTime = 0;
const notifStorageKey = () => 'genhub_notifs_read_' + (state?.owner || 'owner');
const getNotifLastRead = () => {
  try {
    const v = localStorage.getItem(notifStorageKey());
    return v ? parseInt(v, 10) : 0;
  } catch {
    return 0;
  }
};
const setNotifLastRead = (ts = Date.now()) => {
  try {
    localStorage.setItem(notifStorageKey(), String(ts));
  } catch {}
};
function renderNotifDropdown() {
  const lastRead = notifSnapshotTime || getNotifLastRead();
  const { notifications, unreadCount } = getNotifications(state?.logs, state, lastRead);
  const recent = notifications.slice(0, 20);

  return `<div class="notif-dropdown" role="region" aria-label="Danh sách thông báo">
    <div class="notif-head">
      <h3>${I('bell')}Thông báo ${unreadCount > 0 ? `<span class="badge warn">${unreadCount} mới</span>` : ''}</h3>
      ${unreadCount > 0 ? `<button type="button" class="textbutton" data-action="mark-notifs-read">Đánh dấu đã đọc</button>` : ''}
    </div>
    <div class="notif-list" role="list">
      ${
        recent.length
          ? recent
              .map(
                n =>
                  `<a href="${esc(n.target)}" class="notif-item ${n.unread ? 'unread' : ''}" data-action="click-notif:${esc(n.target)}" role="listitem">
                    <div class="notif-icon-wrap ${esc(n.level)}">${I(n.icon)}</div>
                    <div class="notif-content">
                      <div class="notif-top">
                        <span class="notif-title">${esc(n.title)}</span>
                        <span class="notif-time">${esc(timeAgo(n.timestamp))}</span>
                      </div>
                      <div class="notif-body">${esc(n.message)}</div>
                    </div>
                    ${n.unread ? '<span class="notif-unread-dot" title="Chưa đọc"></span>' : ''}
                  </a>`
              )
              .join('')
          : `<div class="notif-empty"><p>Chưa có biến động hoặc hoạt động nào.</p></div>`
      }
    </div>
    <div class="notif-foot">
      <a href="#audit" data-action="click-notif:#audit">Xem toàn bộ trong Nhật ký →</a>
    </div>
  </div>`;
}
const modal = $('#modal');
modal.addEventListener('cancel', e => {
  e.preventDefault();
  close();
});
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
  return `<span class="serviceicon ${esc(m.provider === 'github-mcp' ? 'github' : m.provider || 'files')}">${['github', 'github-mcp'].includes(m.provider) ? 'G' : m.provider === 'drive' ? I('file') : m.provider === 'slack' ? '#' : m.provider === 'figma' ? 'F' : I('plug')}</span>`;
}
function formatVersion(iso) {
  if (!iso) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    hour12: false
  })
    .formatToParts(new Date(iso))
    .reduce((o, p) => ((o[p.type] = p.value), o), {});
  return `${parts.day}${parts.month}${parts.year}.${parts.hour}`;
}
function shortSha(sha) {
  if (!sha || typeof sha !== 'string') return '';
  return sha.length > 7 ? sha.slice(0, 7) : sha;
}
let updateBannerDismissed = false;
function renderUpdateBanner() {
  const u = state?.update;
  if (!u) return '';

  const seenKey = 'genhub_seen_revision_' + state.owner;
  const seenRev = localStorage.getItem(seenKey);

  if (seenRev && u.revision && seenRev !== u.revision && !updateBannerDismissed) {
    const shortCurrent = shortSha(u.revision);
    const shortPrev = shortSha(u.previousRevision || seenRev);
    const timeStr = u.updatedAt ? timeAgo(u.updatedAt) : '';
    return `<div class="update-banner updated" role="status">
      <div class="banner-msg">
        <span class="serviceicon files" style="width:30px;height:30px;font-size:15px">${I('shield')}</span>
        <div>
          <strong>Gen-hub vừa được tự động cập nhật lên phiên bản <code>${esc(shortCurrent)}</code></strong>${timeStr ? ` <span class="muted">(${esc(timeStr)})</span>` : ''}.
          <p class="footnote" style="margin:2px 0 0">Phiên bản trước đó: <code>${esc(shortPrev)}</code>.</p>
        </div>
      </div>
      <div class="banner-actions">
        <button class="btn small" data-action="dismiss-update-banner">Đã hiểu</button>
      </div>
    </div>`;
  }

  if (!seenRev && u.revision) {
    localStorage.setItem(seenKey, u.revision);
  }

  if (u.hasUpdate && !updateBannerDismissed) {
    const shortLatest = shortSha(u.latestRevision);
    const ciText =
      u.ciStatus === 'success'
        ? 'Đã qua kiểm tra CI · sẽ tự động cập nhật trong chu kỳ tiếp theo'
        : u.ciStatus === 'pending'
          ? 'Đang kiểm tra CI trên GitHub'
          : 'Sẽ tự động cập nhật khi CI hoàn tất';
    return `<div class="update-banner available" role="status">
      <div class="banner-msg">
        <span class="serviceicon" style="width:30px;height:30px;font-size:15px;color:#a06a19;background:#fff6e5;border-color:#fce4ba">${I('activity')}</span>
        <div>
          <strong>Có bản cập nhật mới trên GitHub (<code>${esc(shortLatest)}</code>)</strong>${u.latestCommitMessage ? `: ${esc(u.latestCommitMessage)}` : ''}
          <p class="footnote" style="margin:2px 0 0">${ciText}.</p>
        </div>
      </div>
      <div class="banner-actions">
        <button class="btn small" data-action="check-update">${I('refresh')} Kiểm tra lại</button>
      </div>
    </div>`;
  }

  return '';
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
  close();
  renderChat();
  $('#app').innerHTML =
    `<main class="loginwrap"><div class="loginbrand"><span class="brandmark">g</span>gen-hub</div><section class="card cardpad"><h1>Chào mừng trở lại</h1><p class="subtitle">Đăng nhập để quản lý không gian công cụ.</p><form id="login" style="margin-top:28px"><label class="field">Tài khoản owner<input class="input" name="username" autocomplete="username" required autofocus></label><label class="field">Mật khẩu<input class="input" name="password" type="password" autocomplete="current-password" required></label><p class="errorline" id="login-error">${esc(error)}</p><button class="btn primary" type="submit" style="width:100%">Đăng nhập</button></form><p class="footnote">Tài khoản được tạo trong bước cài đặt trên terminal.</p></section></main>`;
}
let kanbanData = null,
  kanbanGeneration = 0;
async function loadKanban() {
  const generation = ++kanbanGeneration;
  try {
    const data = await api('kanban');
    if (generation !== kanbanGeneration || !state || route !== 'kanban') return;
    kanbanData = data;
    render();
  } catch (e) {
    if (generation !== kanbanGeneration || !state || route !== 'kanban') return;
    kanbanData = { configured: false, issues: [], error: e.message };
    render();
  }
}
setInterval(() => {
  if (
    state &&
    route === 'kanban' &&
    !document.hidden &&
    !document.activeElement?.closest('#kanban-config')
  )
    loadKanban();
}, 120000);
async function refresh() {
  state = await api('state');
  if (state?.settings) state.settings = normalizeSettings(state.settings);
  if (route === 'kanban') await loadKanban();
  if (route === 'audit') {
    parseAuditHash();
    await fetchAuditLogs();
  }
  activity = new Map();
  render();
  renderChat();
}
let chatOpen = false,
  chatMessages = [],
  chatLoading = false;

const CHAT_WIDTH_MIN = 300,
  CHAT_WIDTH_MAX = 720,
  CHAT_WIDTH_DEFAULT = 380;
function loadChatWidth() {
  try {
    const saved = Number(localStorage.getItem('genhub_chat_width'));
    if (Number.isFinite(saved) && saved >= CHAT_WIDTH_MIN && saved <= CHAT_WIDTH_MAX) return saved;
  } catch {}
  return CHAT_WIDTH_DEFAULT;
}
function saveChatWidth(width) {
  try {
    localStorage.setItem('genhub_chat_width', String(width));
  } catch {}
}
function setChatWidth(width) {
  const clamped = Math.min(
    CHAT_WIDTH_MAX,
    Math.max(CHAT_WIDTH_MIN, Math.min(width, window.innerWidth - 40))
  );
  document.documentElement.style.setProperty('--chat-width', clamped + 'px');
  return clamped;
}
function startChatResize(startEvent) {
  startEvent.preventDefault();
  const startX = startEvent.clientX;
  const startWidth =
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--chat-width')) ||
    CHAT_WIDTH_DEFAULT;
  document.body.classList.add('chat-rail-dragging');
  startEvent.target.classList.add('active');
  let finalWidth = startWidth;
  const onMove = e => {
    finalWidth = setChatWidth(startWidth + (startX - e.clientX));
  };
  const onUp = () => {
    document.body.classList.remove('chat-rail-dragging');
    startEvent.target.classList.remove('active');
    saveChatWidth(finalWidth);
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}
setChatWidth(loadChatWidth());

function executeClientTool(name, args = {}) {
  if (name === 'navigate') {
    const routeTarget = String(args.route || '').trim();
    if (
      !/^(overview|mcps|agents|vault|audit|kanban|settings)(:([a-zA-Z0-9_-]{1,64}))?$/.test(
        routeTarget
      )
    ) {
      console.warn('Blocked invalid navigation route:', routeTarget);
      return;
    }
    const [base, sub] = routeTarget.split(':');
    if (sub && base === 'settings') {
      selected.settings = sub;
    } else if (sub && (base === 'mcps' || base === 'agents' || base === 'vault')) {
      selected[base] = sub;
    }
    location.hash = routeTarget;
  } else if (name === 'open_modal') {
    const kind = String(args.kind || '').trim();
    const id = args.id ? String(args.id).trim() : undefined;
    const allowedModals = [
      'add',
      'connect',
      'onboard',
      'credential',
      'password',
      'pin-setup',
      'admin-create',
      'vault-new',
      'vault-edit'
    ];
    if (!allowedModals.includes(kind)) {
      console.warn('Blocked disallowed modal kind:', kind);
      return;
    }
    if (id && !/^[a-zA-Z0-9_-]{1,64}$/.test(id)) {
      console.warn('Blocked invalid modal id:', id);
      return;
    }
    if (/^(do-|delete|remove|disconnect|revoke|reveal)/i.test(kind)) {
      console.warn('Safety blocked destructive action in chat tool:', kind);
      return;
    }
    act(kind, id ? [id] : []);
  } else if (name === 'highlight') {
    const selector = String(args.selector || '').trim();
    if (!selector || selector.length > 120) return;
    if (/<|>|javascript:|expression\(|url\(|data:/i.test(selector)) return;
    const applyHighlight = () => {
      try {
        const elements = document.querySelectorAll(selector);
        if (elements && elements.length > 0) {
          elements.forEach(el => {
            el.classList.add('chat-highlight-pulse');
            setTimeout(() => el.classList.remove('chat-highlight-pulse'), 4000);
          });
          elements[0].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      } catch (err) {
        console.warn('Invalid selector for highlight:', selector, err);
      }
    };
    applyHighlight();
    setTimeout(applyHighlight, 120);
  }
}

function formatChatMarkdown(text) {
  return esc(text)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}

function renderToolBadges(toolCalls) {
  if (!Array.isArray(toolCalls) || !toolCalls.length) return '';
  return toolCalls
    .map(tc => {
      if (tc.name === 'navigate') {
        return `<div class="chat-action-badge">${I('arrow')} Đã chuyển tới: <code>${esc(tc.arguments?.route)}</code></div>`;
      }
      if (tc.name === 'open_modal') {
        return `<div class="chat-action-badge">${I('plug')} Đã mở: <code>${esc(tc.arguments?.kind)}</code></div>`;
      }
      if (tc.name === 'highlight') {
        return `<div class="chat-action-badge">${I('shield')} Đã khoanh vùng: <code>${esc(tc.arguments?.selector)}</code></div>`;
      }
      return '';
    })
    .join('');
}

function renderChat() {
  const dock = $('#chat-dock');
  if (!dock) return;
  if (!state) {
    dock.classList.add('hidden');
    return;
  }
  dock.classList.remove('hidden');

  if (!chatOpen) {
    dock.className = 'chat-dock closed';
    document.body.classList.remove('chat-rail-open');
    dock.innerHTML = `<button type="button" class="chat-toggle-btn" data-action="chat-toggle" aria-label="Mở Trợ lý Gen-hub" title="Trợ lý ảo Gen-hub">${I('bot')}</button>`;
    return;
  }

  dock.className = 'chat-dock open';
  document.body.classList.add('chat-rail-open');
  const isConfigured = !!state.llm?.configured;
  const subtitle = isConfigured
    ? `${esc(state.llm.provider)} · ${esc(state.llm.model)}`
    : 'Chưa cấu hình LLM';

  let bodyContent = '';
  if (!isConfigured) {
    bodyContent = `<div class="chat-unconfigured">
      <div class="avatar-bot" style="width:40px;height:40px;border-radius:10px;background:var(--accent);color:#14201e;display:grid;place-items:center;margin:0 auto 12px">${I('bot')}</div>
      <h3>Chưa cấu hình LLM</h3>
      <p>Trợ lý cần kết nối OpenAI, Anthropic, Gemini hoặc Ollama để định hướng và khoanh vùng giao diện.</p>
      <button type="button" class="btn primary small" data-action="chat-go-settings">Cấu hình ngay trong Cài đặt</button>
    </div>`;
  } else if (chatMessages.length === 0) {
    bodyContent = `<div class="chat-welcome">
      <div class="inline" style="gap:8px;margin-bottom:8px">
        <div class="avatar-bot" style="width:26px;height:26px;border-radius:6px;background:var(--accent);color:#14201e;display:grid;place-items:center">${I('bot')}</div>
        <strong>Xin chào!</strong>
      </div>
      <p>Tôi có thể giúp bạn điều hướng các trang, tìm kiếm MCP, mở tính năng hoặc hướng dẫn thao tác trên Gen-hub.</p>
      <div class="chat-chips">
        <button type="button" class="chat-chip" data-action="chat-quick:Dẫn tôi đến trang MCP & kết nối">Quản lý MCP</button>
        <button type="button" class="chat-chip" data-action="chat-quick:Làm sao để kết nối Agent mới?">Kết nối Agent</button>
        <button type="button" class="chat-chip" data-action="chat-quick:Dẫn tôi đến Cài đặt bảo mật">Cài đặt bảo mật</button>
        <button type="button" class="chat-chip" data-action="chat-quick:Đi tới trang Nhật ký hoạt động">Xem nhật ký</button>
      </div>
    </div>`;
  } else {
    bodyContent = chatMessages
      .map(m => {
        if (m.role === 'user') {
          return `<div class="chat-msg user"><div class="chat-bubble">${esc(m.content)}</div></div>`;
        }
        return `<div class="chat-msg assistant">
          <div class="chat-bubble">
            <div>${formatChatMarkdown(m.content)}</div>
            ${renderToolBadges(m.tool_calls)}
          </div>
        </div>`;
      })
      .join('');

    if (chatLoading) {
      bodyContent += `<div class="chat-msg assistant loading"><div class="chat-bubble"><span class="dot"></span> Trợ lý đang xử lý…</div></div>`;
    }
  }

  dock.innerHTML = `<div class="chat-panel" role="region" aria-label="Khung chat trợ lý">
    <div class="chat-resize-handle" aria-hidden="true" title="Kéo để đổi chiều rộng"></div>
    <div class="chat-head">
      <div class="chat-head-title">
        <span class="avatar-bot">${I('bot')}</span>
        <div>
          <span>Trợ lý Gen-hub</span>
          <span class="chat-head-sub">${subtitle}</span>
        </div>
      </div>
      <div class="chat-head-actions">
        ${chatMessages.length ? `<button type="button" class="iconbutton" data-action="chat-clear" aria-label="Xóa lịch sử chat" title="Xóa lịch sử">${I('refresh')}</button>` : ''}
        <button type="button" class="iconbutton" data-action="chat-toggle" aria-label="Thu nhỏ chat" title="Thu nhỏ">${I('close')}</button>
      </div>
    </div>
    <div class="chat-body" id="chat-body">${bodyContent}</div>
    <div class="chat-foot">
      <form class="chat-form" id="chat-form">
        <input type="text" id="chat-input" class="input" placeholder="${isConfigured ? 'Hỏi hoặc yêu cầu điều hướng…' : 'Cần cấu hình LLM trước khi chat'}" ${!isConfigured || chatLoading ? 'disabled' : ''} autocomplete="off">
        <button type="submit" class="btn primary" aria-label="Gửi" ${!isConfigured || chatLoading ? 'disabled' : ''}>${I('arrow')}</button>
      </form>
    </div>
  </div>`;

  const body = dock.querySelector('#chat-body');
  if (body) body.scrollTop = body.scrollHeight;
  const handle = dock.querySelector('.chat-resize-handle');
  if (handle) handle.addEventListener('mousedown', startChatResize);
}

async function sendChatMessage(text) {
  if (!text || !text.trim() || chatLoading) return;
  const userMsg = { role: 'user', content: text.trim() };
  chatMessages.push(userMsg);
  chatLoading = true;
  renderChat();

  try {
    const res = await api('chat', 'POST', {
      messages: chatMessages.slice(-15),
      currentRoute: route
    });

    if (res.message) {
      chatMessages.push(res.message);
      if (Array.isArray(res.message.tool_calls)) {
        for (const tc of res.message.tool_calls) {
          executeClientTool(tc.name, tc.arguments);
        }
      }
    }
  } catch (err) {
    chatMessages.push({
      role: 'assistant',
      content: 'Lỗi: ' + (err.message || 'Không thể liên lạc với trợ lý'),
      tool_calls: []
    });
  } finally {
    chatLoading = false;
    renderChat();
  }
}
async function boot() {
  try {
    const s = await api('session');
    csrf = s.csrf;
    await refresh();
    if (route.startsWith('gitea/')) {
      location.assign('/oidc/owner/resume?flow=' + encodeURIComponent(route.slice(6)));
      return;
    }
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
  const { unreadCount } = getNotifications(state.logs, state, getNotifLastRead());
  $('#app').innerHTML =
    `<div class="mobileoverlay" data-action="menu"></div><aside class="sidebar"><a class="brand" href="#overview"><span class="brandmark">g</span>gen-hub</a><div class="workspace"><span class="avatar">${esc(state.owner[0].toUpperCase())}</span><div><b>${esc(state.settings.name)}</b><small>Không gian cá nhân</small></div></div><div class="navlabel">Không gian quản lý</div><nav class="nav">${Object.keys(
      names
    )
      .map(
        (k, i) =>
          `<a href="#${k}" class="${r === k ? 'active' : ''}" ${r === k ? 'aria-current="page"' : ''}>${I(['grid', 'plug', 'bot', 'lock', 'activity', 'grid', 'settings'][i])}${names[k]}</a>`
      )
      .join(
        ''
      )}</nav><div class="sidebottom"><div class="health"><b><span class="dot"></span>Hub đang hoạt động</b><p>Linux · Gen-hub ${state.update?.updatedAt ? 'v' + formatVersion(state.update.updatedAt) : 'v0.1.0'}${state.update?.revision ? ` <span class="mono" title="${esc(state.update.revision)}">(${shortSha(state.update.revision)})</span>` : ''}${state.update?.hasUpdate ? ' <span class="badge warn" style="font-size:10px;padding:1px 5px">Bản mới</span>' : ''}</p></div><div class="profile"><span class="avatar">${esc(state.owner[0].toUpperCase())}</span><div class="spacer"><b>${esc(state.owner)}</b><small>Chủ sở hữu</small></div><button class="iconbutton" data-action="logout" aria-label="Đăng xuất">${I('logout')}</button></div></div></aside><div class="shell"><header class="topbar"><div class="crumb"><button class="iconbutton mobilemenu" data-action="menu" aria-label="Menu">${I('menu')}</button><span>Không gian cá nhân</span><span>/</span><strong>${names[r]}</strong></div><div class="actions">${btn('Hướng dẫn', 'onboard', 'small', 'info')}<div class="notif-wrapper"><button type="button" class="iconbutton notif-btn" data-action="toggle-notifs" aria-label="Thông báo" aria-haspopup="true" aria-expanded="${notifOpen}">${I('bell')}${unreadCount > 0 ? `<span class="notif-badge">${unreadCount > 99 ? '99+' : unreadCount}</span>` : ''}</button>${notifOpen ? renderNotifDropdown() : ''}</div><button class="iconbutton" data-action="refresh" aria-label="Làm mới">${I('refresh')}</button></div></header><main class="main"><div class="demo"><span>${I('lock')}${esc(new URL(state.origin).host)}</span><span>Dữ liệu từ Hub của bạn · ${new Date().toLocaleTimeString('vi-VN')}</span></div>${r === 'overview' ? overview() : r === 'mcps' ? mcps() : r === 'agents' ? agents() : r === 'vault' ? vaultPage() : r === 'audit' ? auditPage() : r === 'kanban' ? kanbanPage(kanbanData, state.mcps, filter) : settings()}<footer class="bottomcaption"><span>GEN-HUB / Không gian công cụ của bạn</span><span>Tiếng Việt · GMT+7</span></footer></main></div>`;
  document.title = names[r] + ' · Gen-hub';
  positionDetailContent();
}
function smallPie(title, entries, unit) {
  const colors = [
    '#28754f',
    '#467fba',
    '#b87324',
    '#9164b0',
    '#bd5266',
    '#27878b',
    '#6d7333',
    '#77614c'
  ];
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (!total)
    return `<div class="pie-mini"><h4>${esc(title)}</h4><p class="footnote">Chưa có dữ liệu.</p></div>`;
  let frac = 0;
  const slices = entries
    .map(([label, value], i) => {
      const f = value / total,
        d = pieArc(100, 100, 80, 48, frac, frac + f),
        pct = (f * 100).toFixed(1);
      frac += f;
      return `<path class="pie-slice" d="${d}" fill="${colors[i % colors.length]}" stroke="#fff" stroke-width="2"><title>${esc(label + ': ' + value.toLocaleString('vi-VN') + ' ' + unit + ' (' + pct + '%)')}</title></path>`;
    })
    .join('');
  const legend = entries
    .map(([label, value], i) => {
      const pct = ((value / total) * 100).toFixed(1);
      return `<div class="pie-legend-item"><span class="pie-legend-label"><i style="background:${colors[i % colors.length]}"></i>${esc(label)}</span><span class="pie-legend-value"><strong>${value.toLocaleString('vi-VN')}</strong> (${pct}%)</span></div>`;
    })
    .join('');
  return `<div class="pie-mini"><h4>${esc(title)}</h4><svg class="pie-chart" viewBox="0 0 200 200" role="img" aria-label="${esc(title)}"><g>${slices}</g><text x="100" y="96" text-anchor="middle" class="pie-total">${total.toLocaleString('vi-VN')}</text><text x="100" y="112" text-anchor="middle" class="pie-total-label">${esc(unit)}</text></svg><div class="pie-legend">${legend}</div></div>`;
}
function overview() {
  const logs = state.logs,
    day = v =>
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(v)),
    today = day(Date.now()),
    calls = logs.filter(l => isToolCall(l) && day(l.created) === today),
    connected = state.mcps.filter(m => m.status === 'connected').length,
    tools = state.mcps.reduce(
      (s, m) =>
        s + (m.on && m.status === 'connected' ? m.tools.filter(t => t.published).length : 0),
      0
    );
  const stats12h = auditStats(logs, 12, Date.now());
  const byKey = new Map();
  for (const b of stats12h.buckets)
    for (const [key, row] of b.tools) {
      const r = byKey.get(key) || { count: 0, bytes: 0 };
      r.count += row.count;
      r.bytes += row.input + row.output;
      byKey.set(key, r);
    }
  const mcpName = id => (id === 'vault' ? 'Vault' : state.mcps.find(m => m.id === id)?.name || id);
  const byMcpCalls = new Map(),
    byMcpBytes = new Map(),
    byToolCalls = new Map();
  for (const [key, row] of byKey) {
    const [mid, ...rest] = key.split(' / '),
      mName = mcpName(mid),
      tName = mName + ' / ' + rest.join(' / ');
    byMcpCalls.set(mName, (byMcpCalls.get(mName) || 0) + row.count);
    byMcpBytes.set(mName, (byMcpBytes.get(mName) || 0) + row.bytes);
    byToolCalls.set(tName, (byToolCalls.get(tName) || 0) + row.count);
  }
  const sortDesc = m => [...m.entries()].sort((a, b) => b[1] - a[1]);
  return (
    head(
      'Tổng quan',
      'Mọi kết nối. Một nơi kiểm soát.',
      btn('Kiểm tra cập nhật', 'check-update', 'small', 'refresh') +
        btn('Kết nối agent', 'connect', '', 'link') +
        btn('Thêm MCP', 'add', 'primary', 'plus')
    ) +
    renderUpdateBanner() +
    `<section class="card endpointbar"><span class="endpointbar-label">${I('link')}Một endpoint cho mọi agent</span><div class="codecopy"><code>${esc(state.endpoint)}</code><button class="iconbutton" data-action="copyendpoint" aria-label="Sao chép">${I('copy')}</button></div><span class="endpointbar-sub">Chỉ tool bạn cấp mới được agent thấy và dùng.</span>${btn('Hướng dẫn kết nối', 'connect', 'small', 'arrow')}</section><section class="stats">${[
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
      )}</section><section class="card" style="margin-bottom:22px"><div class="cardhead"><h2>Hoạt động công cụ</h2><span class="badge gray">12 giờ gần đây</span></div><div class="cardpad"><div class="pie-row">${smallPie('MCP theo lượt gọi', sortDesc(byMcpCalls), 'lượt')}${smallPie('Tool theo lượt gọi', sortDesc(byToolCalls), 'lượt')}${smallPie('MCP theo dung lượng', sortDesc(byMcpBytes), 'byte')}</div>${!byKey.size ? '<p class="footnote">Chưa có lượt gọi công cụ trong 12 giờ qua.</p>' : '<p class="footnote">Dung lượng tính theo byte JSON input/output đã redact (không phải token LLM).</p>'}</div></section><section class="card" style="margin-bottom:22px"><div class="cardhead"><h2>Kết nối cần chú ý</h2>${btn('Quản lý MCP', 'go:mcps', 'small')}</div><div class="cardpad">${
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
    `<div class="toolbar">${searchInput('Tìm MCP…')}</div><div id="results">${mcpResults()}</div>`
  );
}
function mcpResults() {
  return entityResults('mcps');
}
function agents() {
  return (
    head(
      'Agent & quyền',
      'Cấp công cụ riêng cho từng agent; thu hồi ngay khi cần.',
      btn('Kết nối agent', 'connect', 'primary', 'plus')
    ) +
    `<div class="toolbar">${searchInput('Tìm agent…')}</div><div id="results">${agentResults()}</div>`
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
  return entityResults('agents');
}
function positionDetailContent() {
  document.querySelectorAll('.stats-scroll').forEach(chart => {
    chart.scrollLeft = chart.scrollWidth;
  });
  const active = document.querySelector('.detail-tabs [aria-selected="true"]');
  if (active) {
    const tabs = active.parentElement;
    tabs.scrollLeft = Math.max(
      0,
      active.offsetLeft - tabs.offsetLeft + active.offsetWidth - tabs.clientWidth
    );
  }
}
function selectEntity(kind, id) {
  if (kind !== 'settings' && !state[kind]?.some(row => row.id === id)) return;
  if (selected[kind] !== id) detailTabs[kind] = 'info';
  selected[kind] = id;
  close();
  if (route !== kind) location.hash = kind;
  else render();
}
function entityResults(kind) {
  const rows = state[kind].filter(row =>
    (row.name + ' ' + (row.notes || '') + ' ' + row.id).toLowerCase().includes(filter.toLowerCase())
  );
  if (!rows.some(row => row.id === selected[kind])) {
    selected[kind] = rows[0]?.id || null;
    detailTabs[kind] = 'info';
  }
  const list = rows
    .map(
      row =>
        `<button class="entity-row ${row.id === selected[kind] ? 'selected' : ''}" data-action="select:${kind}:${esc(row.id)}" ${row.id === selected[kind] ? 'aria-current="true"' : ''}><strong>${esc(row.name)}${kind === 'agents' && row.isAdmin ? ' <span class="badge warn" style="font-size:10px;padding:2px 5px">Admin</span>' : ''}</strong><span class="mono">${kind === 'agents' ? '#' + esc(shortAgentId(row)) : esc(row.id)}</span><span>${kind === 'vault' ? date(row.updated) : badge(row.status)}</span></button>`
    )
    .join('');
  return `<div class="entity-layout"><aside class="card entity-list" aria-label="Danh sách ${names[kind]}"><div class="cardhead"><h2>${rows.length} mục</h2></div>${list || '<p class="empty">Không có mục phù hợp.</p>'}</aside><section class="card entity-detail" id="entity-detail" aria-label="Chi tiết mục đang chọn">${entityDetail(kind)}</section></div>`;
}
function entityDetail(kind) {
  const row = state[kind].find(row => row.id === selected[kind]);
  if (!row)
    return '<div class="empty"><h3>Chưa có mục được chọn</h3><p>Thêm mục mới hoặc thay đổi tìm kiếm.</p></div>';
  const tabs = [
    ['info', 'Thông tin'],
    [
      kind === 'agents' ? 'grants' : kind === 'mcps' ? 'tools' : 'sharing',
      kind === 'agents' ? 'Phân quyền' : kind === 'mcps' ? 'Tool' : 'Quyền đọc'
    ],
    ['logs', kind === 'vault' ? 'Nhật ký đọc secret' : 'Nhật ký sử dụng']
  ];
  if (kind !== 'vault') tabs.push(['stats', 'Thống kê']);
  const current = detailTabs[kind];
  const content = ['logs', 'stats'].includes(current)
    ? activityPanel(kind, row.id, current)
    : kind === 'agents'
      ? current === 'info'
        ? agentInfo(row)
        : agentPermissions(row)
      : kind === 'mcps'
        ? current === 'info'
          ? connectorInfo(row)
          : connectorTools(row)
        : vaultDetail(row, current);
  return `<div class="cardhead"><div><h2>${esc(row.name)}${kind === 'agents' && row.isAdmin ? ' <span class="badge warn">Trợ lý quản trị</span>' : ''}</h2><p class="mono">${esc(row.id)}</p></div></div><div class="cardpad">${tabBar(tabs, current)}<div role="tabpanel" id="detail-panel" aria-labelledby="detail-tab-${current}">${content}</div></div>`;
}
function tabBar(tabs, current) {
  return `<div class="tabs detail-tabs" role="tablist" aria-label="Chi tiết">${tabs.map(([key, label]) => `<button type="button" role="tab" id="detail-tab-${key}" aria-controls="detail-panel" aria-selected="${current === key}" tabindex="${current === key ? 0 : -1}" class="tab ${current === key ? 'active' : ''}" data-action="detail-tab:${key}">${label}</button>`).join('')}</div>`;
}
function agentInfo(a) {
  return `<dl class="detailgrid"><div><dt>ID</dt><dd>${esc(a.id)}</dd></div><div><dt>Ngày tạo</dt><dd>${date(a.created)}</dd></div><div><dt>Trạng thái</dt><dd>${badge(a.status)}</dd></div><div><dt>Lần gọi gần nhất</dt><dd>${date(a.last)}</dd></div><div><dt>Vai trò</dt><dd>${a.isAdmin ? '<span class="badge warn">Trợ lý quản trị (Admin Assistant)</span>' : '<span class="badge gray">Agent thường</span>'}</dd></div><div><dt>Client</dt><dd>${esc(a.client || 'OAuth')}</dd></div>${a.tokenExpires ? `<div><dt>Hạn token</dt><dd>${date(a.tokenExpires)}</dd></div>` : ''}</dl><form id="agent-info" data-id="${esc(a.id)}"><label class="field">Tên gợi nhớ<input class="input" name="name" value="${esc(a.name)}" required maxlength="80"></label><label class="field">Mô tả (tùy chọn)<textarea class="input" name="description" rows="3" maxlength="2000">${esc(a.description || '')}</textarea></label><label class="field">Instruction bootstrap riêng (tùy chọn)<textarea class="input" name="instructions" rows="7" maxlength="16000" placeholder="Chỉ sử dụng các công cụ được owner cấp quyền.">${esc(a.instructions || '')}</textarea><small>Agent này nhận hướng dẫn trong response initialize khi kết nối /mcp. Để trống để dùng hướng dẫn mặc định.</small></label><button class="btn primary" type="submit">Lưu thông tin</button></form>`;
}
function vaultDetail(s, tab) {
  if (tab === 'sharing')
    return `<form id="vault-share" data-id="${esc(s.id)}">${sharingFields(state.agents.filter(a => a.status === 'active' && a.permissions.includes('vault:' + s.id)).map(a => a.id))}<button class="btn primary" type="submit">Lưu quyền đọc</button></form>`;
  return `<dl class="detailgrid"><div><dt>Ngày tạo</dt><dd>${date(s.created)}</dd></div><div><dt>Cập nhật</dt><dd>${date(s.updated)}</dd></div></dl><form id="vault-save" data-id="${esc(s.id)}"><label class="field">Tên gợi nhớ<input class="input" name="name" value="${esc(s.name)}" maxlength="80" required></label><label class="field">Ghi chú (tùy chọn)<textarea class="input" name="notes" rows="2" maxlength="2000" placeholder="Mô tả mục đích, hạn dùng, ghi chú nội bộ…">${esc(s.notes || '')}</textarea></label><label class="field">Giá trị mới (để trống để giữ nguyên)<textarea class="input mono" name="secret" rows="3" maxlength="65536" autocomplete="off" spellcheck="false"></textarea></label><button class="btn primary" type="submit">Lưu thay đổi</button></form><div class="divider"></div><div class="actions">${btn('Xem giá trị…', 'vault-reveal:' + s.id)}${btn('Xóa secret', 'vault-delete:' + s.id, 'danger')}</div>`;
}
function activityPanel(kind, id, tab) {
  const key = kind + ':' + id;
  let entry = activity.get(key);
  if (!entry) {
    entry = { now: Date.now() };
    activity.set(key, entry);
    const params = new URLSearchParams({
      [kind === 'agents' ? 'actor' : kind === 'mcps' ? 'mcp' : 'secret']: id,
      since: new Date(entry.now - activityHours * 3600000).toISOString(),
      limit: '5000'
    });
    api('logs?' + params)
      .then(rows => {
        entry.rows = Array.isArray(rows) ? rows : rows.rows || [];
      })
      .catch(error => {
        entry.error = error.message;
      })
      .finally(() => {
        if (
          state &&
          activity.get(key) === entry &&
          route === kind &&
          selected[kind] === id &&
          ['logs', 'stats'].includes(detailTabs[kind])
        ) {
          const panel = $('#entity-detail');
          if (panel) {
            panel.innerHTML = entityDetail(kind);
            positionDetailContent();
          }
        }
      });
  }
  const controls = `<div class="toolbar"><label>Khoảng thời gian<select id="activity-hours" aria-label="Khoảng thời gian">${options(
    [
      [24, '24 giờ qua'],
      [168, '7 ngày qua'],
      [720, '30 ngày qua'],
      [2160, '90 ngày qua']
    ],
    activityHours
  )}</select></label>${btn('Làm mới nhật ký', 'activity-reload', 'small', 'refresh')}</div>`;
  if (entry.error) return controls + `<p class="errorline" role="alert">${esc(entry.error)}</p>`;
  if (!entry.rows) return controls + '<p role="status">Đang tải nhật ký…</p>';
  const note = `<p class="footnote">${entry.rows.length} bản ghi phù hợp trong ${activityHours / 24} ngày qua, tối đa 5.000 bản ghi mới nhất, theo thời hạn lưu nhật ký của Hub.${entry.rows.length === 5000 ? ' Đã chạm giới hạn; biểu đồ có thể thiếu dữ liệu cũ hơn. Hãy chọn khoảng thời gian ngắn hơn.' : ''}</p>`;
  return (
    controls + (tab === 'logs' ? logTable(entry.rows) : statsCharts(entry.rows, entry.now)) + note
  );
}
function statsCharts(logs, now) {
  const { buckets, tools, step } = auditStats(logs, activityHours, now);
  if (!tools.length)
    return '<div class="empty"><h3>Chưa có lượt gọi tool</h3><p>Biểu đồ sẽ xuất hiện khi agent gọi tool trong khoảng thời gian này.</p></div>';
  const colors = [
    '#28754f',
    '#467fba',
    '#b87324',
    '#9164b0',
    '#bd5266',
    '#27878b',
    '#6d7333',
    '#77614c'
  ];
  const color = key => colors[tools.indexOf(key) % colors.length];
  const label = value =>
    new Date(value).toLocaleString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      day: '2-digit',
      month: '2-digit',
      ...(step === 3600000 ? { hour: '2-digit' } : {})
    });
  const toolLabel = key => {
    const [id, ...rest] = key.split(' / ');
    return (state.mcps.find(m => m.id === id)?.name || id) + ' / ' + rest.join(' / ');
  };
  const legend = `<div class="stats-legend">${tools.map(key => `<span><i style="background:${color(key)}"></i>${esc(toolLabel(key))}</span>`).join('')}</div>`;
  const toolCounts = new Map(tools.map(key => [key, 0]));
  let totalCalls = 0;
  for (const bucket of buckets) {
    for (const [key, row] of bucket.tools) {
      if (toolCounts.has(key)) {
        toolCounts.set(key, toolCounts.get(key) + row.count);
        totalCalls += row.count;
      }
    }
  }
  let currentFrac = 0;
  const slices = [];
  for (const key of tools) {
    const count = toolCounts.get(key) || 0;
    if (!count) continue;
    const frac = totalCalls ? count / totalCalls : 0;
    const pathD = pieArc(100, 100, 80, 48, currentFrac, currentFrac + frac);
    const pct = (frac * 100).toFixed(1);
    slices.push(
      `<path class="pie-slice" d="${pathD}" fill="${color(key)}" stroke="#fff" stroke-width="2"><title>${esc(toolLabel(key) + ': ' + count + ' lượt (' + pct + '%)')}</title></path>`
    );
    currentFrac += frac;
  }
  const pieChart = `<svg class="pie-chart" viewBox="0 0 200 200" width="180" height="180" role="img" aria-label="Biểu đồ tròn tỷ lệ loại tool"><g class="pie-slices">${slices.join('')}</g><text x="100" y="96" text-anchor="middle" class="pie-total">${totalCalls.toLocaleString('vi-VN')}</text><text x="100" y="112" text-anchor="middle" class="pie-total-label">lượt gọi</text></svg>`;
  const pieLegend = `<div class="pie-legend">${tools
    .map(key => {
      const count = toolCounts.get(key) || 0;
      const pct = totalCalls ? ((count / totalCalls) * 100).toFixed(1) : '0.0';
      return `<div class="pie-legend-item"><span class="pie-legend-label"><i style="background:${color(key)}"></i>${esc(toolLabel(key))}</span><span class="pie-legend-value"><strong>${count.toLocaleString('vi-VN')}</strong> (${pct}%)</span></div>`;
    })
    .join('')}</div>`;
  const ratio = `<div class="pie-wrap">${pieChart}${pieLegend}</div>`;
  const max = Math.max(
    1,
    ...buckets.flatMap(bucket => [...bucket.tools.values()].flatMap(row => [row.input, row.output]))
  );
  const payload = buckets
    .map(
      bucket =>
        `<div class="stats-column" style="width:${Math.max(64, tools.length * 10)}px"><div class="payload-group">${tools
          .map(key => {
            const row = bucket.tools.get(key) || { input: 0, output: 0 };
            return ['input', 'output']
              .map(
                field =>
                  `<div class="payload-bar payload-${field}" style="height:${(row[field] / max) * 100}%;background:${color(key)}" title="${esc(label(bucket.start) + ' · ' + toolLabel(key) + ' · ' + field + ': ' + row[field] + ' byte')}"></div>`
              )
              .join('');
          })
          .join('')}</div><small>${esc(label(bucket.start))}</small></div>`
    )
    .join('');
  const table = `<details class="stats-data"><summary>Xem số liệu theo thời gian và tool</summary><div class="tablewrap"><table><thead><tr><th>Thời gian (GMT+7)</th><th>Tool</th><th>Lượt gọi</th><th>Tỷ lệ</th><th>Input (byte)</th><th>Output (byte)</th></tr></thead><tbody>${buckets.flatMap(bucket => [...bucket.tools].map(([key, row]) => `<tr><td>${esc(label(bucket.start))}</td><td>${esc(toolLabel(key))}</td><td>${row.count}</td><td>${((row.count / bucket.count) * 100).toFixed(1)}%</td><td>${row.input}</td><td>${row.output}</td></tr>`)).join('')}</tbody></table></div></details>`;
  return `<section class="audit-chart"><h3>Tỷ lệ loại tool đã gọi</h3><p class="footnote">Tỷ lệ phần trăm theo tổng lượt gọi tool trong khoảng thời gian đã chọn (gồm thành công, lỗi và bị từ chối).</p>${ratio}</section><section class="audit-chart"><h3>Kích thước payload theo tool và thời gian</h3><p class="footnote">Tổng byte JSON UTF-8 của input/output đã redact; không phải token LLM hoặc byte mạng. Thang đo: 0–${max.toLocaleString('vi-VN')} byte. Input: đậm · Output: nhạt. Vault chỉ có metadata audit, không chứa giá trị secret.</p><div class="stats-scroll" role="img" aria-label="Biểu đồ byte input và output; số liệu đầy đủ ở bảng bên dưới"><div class="stats-plot">${payload}</div></div>${legend}</section>${table}`;
}

function options(rows, current) {
  return rows
    .map(
      ([v, l]) => `<option value="${esc(v)}" ${v === current ? 'selected' : ''}>${esc(l)}</option>`
    )
    .join('');
}
function syncAuditHash() {
  if (route !== 'audit') return;
  const p = new URLSearchParams();
  if (filter.trim()) p.set('q', filter.trim());
  if (statusFilter !== 'all') p.set('status', statusFilter);
  if (agentFilter !== 'all') p.set('actor', agentFilter);
  if (mcpFilter !== 'all') p.set('mcp', mcpFilter);
  if (timeFilter !== 'all') p.set('time', timeFilter);
  for (const [key, value] of Object.entries(auditExact)) p.set(key, value);
  const qs = p.toString();
  const target = '#audit' + (qs ? '?' + qs : '');
  if (location.hash !== target) {
    history.replaceState(null, '', target);
  }
}

function parseAuditHash() {
  auditExact = {};
  const hash = location.hash.slice(1);
  const qIdx = hash.indexOf('?');
  if (qIdx !== -1) {
    const search = new URLSearchParams(hash.slice(qIdx + 1));
    for (const key of [
      'since',
      'before',
      'until',
      'tool',
      'eventKind',
      'actorType',
      'errorCategory',
      'policyDecision',
      'outcome'
    ]) {
      if (search.has(key)) auditExact[key] = search.get(key);
    }
    filter = search.get('q') || '';
    statusFilter = search.get('status') || 'all';
    agentFilter = search.get('actor') || 'all';
    mcpFilter = search.get('mcp') || search.get('connector') || 'all';
    timeFilter = search.get('time') || 'all';
  } else {
    filter = '';
    statusFilter = 'all';
    agentFilter = 'all';
    mcpFilter = 'all';
    timeFilter = 'all';
  }
}

function buildAuditQueryParams(extra = {}) {
  const params = new URLSearchParams(auditExact);
  if (statusFilter !== 'all') params.set('status', statusFilter);
  if (agentFilter !== 'all') params.set('actor', agentFilter);
  if (mcpFilter !== 'all') params.set('mcp', mcpFilter);
  if (timeFilter !== 'all') {
    params.set('since', new Date(Date.now() - Number(timeFilter) * 3600000).toISOString());
  }
  if (filter.trim()) {
    const q = filter.trim();
    if (/^\d+$/.test(q)) {
      params.set('id', q);
    } else {
      params.set('q', q);
    }
  }
  for (const [k, v] of Object.entries(extra)) {
    if (v !== undefined && v !== null) params.set(k, String(v));
  }
  return params;
}

async function fetchAuditLogs(cursor = null, append = false) {
  if (route !== 'audit') return;
  const gen = ++auditFetchGen;
  auditLoading = true;
  if (!append) {
    auditLogs = [];
    auditCursor = null;
    auditHasMore = false;
    auditError = null;
  }
  renderAuditResults();

  const params = buildAuditQueryParams({
    paginate: 'true',
    includePayload: 'false',
    limit: 50,
    ...(cursor ? { cursor } : {})
  });

  try {
    const res = await api('logs?' + params);
    if (gen !== auditFetchGen) return;
    const newRows = Array.isArray(res) ? res : res.rows || [];
    if (append) {
      auditLogs = auditLogs.concat(newRows);
    } else {
      auditLogs = newRows;
    }
    auditCursor = res.nextCursor ?? null;
    auditHasMore = !!res.hasMore;
    auditLoading = false;
    auditError = null;
  } catch (err) {
    if (gen !== auditFetchGen) return;
    auditLoading = false;
    auditError = err.message;
  }
  renderAuditResults();
}

function renderAuditResultsHtml() {
  if (auditError) {
    return `<p class="errorline" role="alert">${esc(auditError)}</p>`;
  }
  if (auditLoading && !auditLogs.length) {
    return '<p role="status" style="padding:24px;text-align:center">Đang tải nhật ký…</p>';
  }
  const table = logTable(auditLogs);
  const pagination = auditHasMore
    ? `<div style="padding:16px;text-align:center">${btn(auditLoading ? 'Đang tải…' : 'Tải thêm nhật ký', 'load-more-logs', 'secondary')}</div>`
    : '';
  return table + pagination;
}

function renderAuditResults() {
  const el = $('#results');
  if (el && route === 'audit') {
    el.innerHTML = renderAuditResultsHtml();
  }
}

function logFilter(logs = state?.logs || []) {
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
  const initialHtml =
    auditLogs.length || auditLoading || auditError
      ? renderAuditResultsHtml()
      : logTable(state?.logs ? logFilter() : []);
  return (
    head(
      'Nhật ký',
      'Input, output và quyết định cấp quyền của từng lượt gọi.',
      btn('Xuất JSONL', 'export-jsonl', '', 'download') +
      btn('Xuất CSV', 'export-csv', '', 'download')
    ) +
    `${Object.keys(auditExact).length ? `<p class="footnote">Bộ lọc từ Tổng quan: ${esc(new URLSearchParams(auditExact).toString())} · <a href="#audit">Xóa bộ lọc</a></p>` : ''}<div class="toolbar">${searchInput('Tìm tool, actor hoặc ID…')}<div class="actions"><select id="statusfilter" class="filter" aria-label="Kết quả">${options(
      [
        ['all', 'Tất cả kết quả'],
        ['success', 'Thành công'],
        ['denied', 'Bị từ chối'],
        ['error', 'Có lỗi']
      ],
      statusFilter
    )}</select><select id="agentfilter" class="filter" aria-label="Agent">${options([['all', 'Tất cả agent'], ['owner', 'Owner'], ...[...new Set((state?.logs || []).filter(l => l.actor.startsWith('admin-assistant:')).map(l => l.actor))].map(actor => [actor, 'Trợ lý quản trị #' + actor.slice(-8)]), ...(state?.agents || []).map(a => [a.id, a.name])], agentFilter)}</select><select id="mcpfilter" class="filter" aria-label="MCP">${options([['all', 'Tất cả MCP'], ['hub', 'Hub'], ...(state?.mcps || []).map(m => [m.id, m.name])], mcpFilter)}</select><select id="timefilter" class="filter" aria-label="Thời gian">${options(
      [
        ['all', 'Tất cả thời gian'],
        ['1', 'Giờ qua'],
        ['24', '24 giờ qua'],
        ['168', '7 ngày qua']
      ],
      timeFilter
    )}</select></div></div><div class="card" id="results">${initialHtml}</div><p class="footnote">Phân trang con trỏ (cursor) truy vấn trực tiếp từ máy chủ. Xuất JSONL/CSV dùng đúng bộ lọc đang chọn, lấy toàn bộ kết quả (tối đa 50.000 bản ghi). Trường credential luôn được ẩn.</p>`
  );
}

function logTable(rows) {
  return rows.length
    ? `<div class="tablewrap"><table><thead><tr><th>Thời gian</th><th>Người thực hiện</th><th>Công cụ / Thao tác</th><th>Kết quả</th><th>Xử lý</th><th></th></tr></thead><tbody>${rows.map(l => `<tr><td>${date(l.created)}</td><td>${esc(l.actor === 'owner' ? state.owner : state.agents.find(a => a.id === l.actor)?.name || l.actor)}</td><td><div class="mono">${esc(l.tool)}</div><div class="sub">${esc(state.mcps.find(m => m.id === l.mcp)?.name || 'Hub')} · #${l.id}</div></td><td>${badge(l.status)}<small class="sub operations-id">${esc(l.errorCategory || l.eventKind || 'Chưa phân loại')}${l.classification === 'legacy' ? ' · lịch sử' : ''}</small></td><td class="mono">${l.latencyMeasured ? l.latency + ' ms' : 'N/A'}</td><td>${btn('Chi tiết', 'log:' + l.id, 'small')}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty"><h3>Chưa có nhật ký phù hợp</h3><p>Thay đổi bộ lọc hoặc bắt đầu sử dụng Hub.</p></div>';
}
function vaultGrantRows(selected) {
  if (!state.vault.length) return '';
  return `<div class="toolgroup"><div class="toolgrouphead"><h3>Kho bí mật · quyền đọc từng secret</h3><p class="footnote">Agent được cấp sẽ nhận giá trị thật. Chỉ chọn secret agent cần.</p></div>${state.vault.map(s => `<label class="toolrow"><div><b>${esc(s.name)}</b><p class="mono">${esc(s.id)}</p></div><input type="checkbox" name="permissions" value="vault:${esc(s.id)}" ${selected.includes('vault:' + s.id) ? 'checked' : ''}></label>`).join('')}</div>`;
}
function vaultPage() {
  return (
    head(
      'Kho bí mật',
      'Lưu secret độc lập và cấp quyền đọc cho từng agent.',
      btn('Thêm secret', 'vault-new', 'primary', 'plus')
    ) +
    `<div class="toolbar">${searchInput('Tìm secret…')}</div><div id="results">${entityResults('vault')}</div>`
  );
}
function sharingFields(selected = []) {
  return `<label class="field">Chia sẻ<select name="sharing">${options(
    [
      ['private', 'Riêng tư — không agent nào'],
      ['selected', 'Chọn từng agent'],
      ['all-active', 'Cấp cho tất cả agent đang hoạt động']
    ],
    selected.length ? 'selected' : 'private'
  )}</select></label><div data-sharing-agents ${selected.length ? '' : 'hidden'}>${
    state.agents
      .filter(a => a.status === 'active')
      .map(
        a =>
          `<label class="toolrow"><div><b>${esc(a.name)}</b><p class="mono">#${esc(shortAgentId(a))}</p></div><input type="checkbox" name="agents" value="${esc(a.id)}" ${selected.includes(a.id) ? 'checked' : ''}></label>`
      )
      .join('') || '<p class="footnote">Chưa có agent hoạt động.</p>'
  }</div><p class="footnote">“Tất cả” chỉ cấp cho agent hiện có tại lúc lưu; agent mới sau này vẫn cần được cấp riêng. Lưu chia sẻ thay thế danh sách đọc của secret này.</p>`;
}
function vaultEditor(id) {
  if (id) return selectEntity('vault', id);
  modalContext = { kind: 'vault' };
  show(
    'Thêm secret',
    'Giá trị được mã hóa tại Hub.',
    `<form id="vault-save"><label class="field">Tên gợi nhớ<input class="input" name="name" maxlength="80" required></label><label class="field">Ghi chú (tùy chọn)<textarea class="input" name="notes" rows="2" maxlength="2000" placeholder="Mô tả mục đích, hạn dùng, ghi chú nội bộ…"></textarea></label><label class="field">Giá trị secret<textarea class="input mono" name="secret" rows="3" maxlength="65536" autocomplete="off" spellcheck="false" required></textarea></label>${sharingFields()}<button class="btn primary" type="submit">Tạo secret</button></form>`,
    btn('Đóng', 'close')
  );
}
function pinSettings() {
  return `<section class="card cardpad" style="margin-top:24px"><h2>PIN xác nhận thao tác xóa</h2><p class="footnote">${state.security.pinConfigured ? 'Đã đặt PIN.' : 'Chưa đặt PIN.'} Dùng khi xóa agent, MCP, secret hoặc ngắt kết nối. Năm lần nhập sai liên tiếp sẽ khóa thử PIN trong 15 phút.</p>${btn(state.security.pinConfigured ? 'Đổi / đặt lại PIN' : 'Đặt PIN', 'pin-setup', '', 'lock')}</section>`;
}
function systemUpdatesSettings() {
  const u = state.update || {};
  const shortCur = shortSha(u.revision) || 'Môi trường phát triển';
  const shortLatest = shortSha(u.latestRevision);
  const curDateStr = u.updatedAt ? `${timeAgo(u.updatedAt)} (${date(u.updatedAt)})` : '—';
  const checkedDateStr = u.checkedAt
    ? `${timeAgo(u.checkedAt)} (${date(u.checkedAt)})`
    : 'Chưa kiểm tra';

  let statusBadge = '';
  if (u.hasUpdate) {
    statusBadge = `<span class="badge warn">Có bản mới: ${esc(shortLatest)}</span>`;
  } else if (u.error) {
    statusBadge = `<span class="badge red">Lỗi kết nối GitHub</span>`;
  } else {
    statusBadge = `<span class="badge">Đang dùng bản mới nhất</span>`;
  }

  return `<h2>Cập nhật hệ thống</h2><p class="footnote">Gen-hub tự động kiểm tra định kỳ mỗi 30 phút và tự cập nhật khi commit mới trên main đã qua CI.</p><div style="margin:16px 0">${statusBadge}</div><div class="divider"></div><div class="detailgrid"><div><dt>Phiên bản đang chạy</dt><dd>${u.updatedAt ? esc('v' + formatVersion(u.updatedAt)) + ' · ' : ''}<code title="${esc(u.revision || '')}">${esc(shortCur)}</code></dd></div><div><dt>Cập nhật lần gần nhất</dt><dd>${esc(curDateStr)}</dd></div><div><dt>Kiểm tra GitHub gần nhất</dt><dd>${esc(checkedDateStr)}</dd></div><div><dt>Bản mới nhất trên main</dt><dd>${u.latestRevision ? `<code title="${esc(u.latestRevision)}">${esc(shortLatest)}</code>` : '—'}</dd></div></div>${u.latestCommitMessage ? `<div style="margin-bottom:18px"><p class="footnote" style="margin-bottom:4px">Thông điệp commit mới nhất trên GitHub:</p><blockquote style="margin:0;padding:8px 12px;background:#f7faf7;border-left:3px solid #28754f;border-radius:4px;font-size:12px">${esc(u.latestCommitMessage)}</blockquote></div>` : ''}${u.error ? `<p class="errorline" style="margin-bottom:18px">${esc(u.error)}</p>` : ''}${u.nextRetryAt ? `<p class="footnote">Thử lại từ: ${date(u.nextRetryAt)}</p>` : ''}<div class="actions" style="margin-top:20px">${btn('Kiểm tra cập nhật ngay', 'check-update', 'primary', 'refresh')}</div>`;
}
function llmSettings() {
  const cfg = state.llm || {};
  return `<h2>Trợ lý chat & LLM (BYOC)</h2>
    <p class="footnote" style="margin-bottom:20px">Kết nối mô hình ngôn ngữ lớn để trợ lý có thể trả lời câu hỏi, định hướng các trang và khoanh vùng tính năng trực quan. Khóa API được mã hóa an toàn trên máy chủ Gen-hub, không bao giờ gửi về trình duyệt hay xuất hiện trong nhật ký.</p>
    <form id="llm-config">
      <label class="field">Nhà cung cấp (Provider)
        <select name="provider" id="llm-provider" required>
          <option value="openai" ${cfg.provider === 'openai' ? 'selected' : ''}>OpenAI / Tương thích OpenAI</option>
          <option value="anthropic" ${cfg.provider === 'anthropic' ? 'selected' : ''}>Anthropic Claude</option>
          <option value="gemini" ${cfg.provider === 'gemini' ? 'selected' : ''}>Google Gemini</option>
          <option value="ollama" ${cfg.provider === 'ollama' ? 'selected' : ''}>Ollama (Local)</option>
        </select>
      </label>
      <label class="field">Mô hình (Model)
        <input class="input" name="model" id="llm-model" value="${esc(cfg.model || '')}" placeholder="vd: gpt-4o, claude-3-5-sonnet-20241022, gemini-1.5-flash, llama3.2" required maxlength="100">
        <small>Tên model do nhà cung cấp hỗ trợ.</small>
      </label>
      <label class="field">Base URL (tùy chọn)
        <input class="input" name="baseUrl" id="llm-baseurl" value="${esc(cfg.baseUrl || '')}" placeholder="Mặc định theo provider hoặc http://localhost:11434" maxlength="256">
        <small>Để trống nếu dùng endpoint mặc định. Với Ollama, nhập http://localhost:11434.</small>
      </label>
      <label class="field">Khóa API (API Key)
        <input class="input" type="password" name="apiKey" id="llm-apikey" autocomplete="new-password" placeholder="${cfg.hasKey ? 'Đã lưu API key (để trống nếu không đổi)' : 'Nhập API key của bạn'}">
        <small>${cfg.hasKey ? 'API key đang được mã hóa an toàn. Chỉ nhập nếu muốn thay đổi key mới.' : 'Bắt buộc với OpenAI, Anthropic, Gemini. Không bắt buộc với Ollama.'}</small>
      </label>
      <div class="actions" style="margin-top:24px">
        <button class="btn primary" type="submit">Lưu cấu hình LLM</button>
        <button class="btn" type="button" data-action="llm-test">${I('refresh')} Kiểm tra kết nối</button>
      </div>
    </form>
    ${cfg.configured ? `<div class="divider"></div><p class="footnote">Trạng thái: <strong>Đã cấu hình</strong> (${esc(cfg.provider)} · ${esc(cfg.model)})${cfg.updatedAt ? ` · Cập nhật: ${date(cfg.updatedAt)}` : ''}</p>` : ''}`;
}
function settings() {
  const s = normalizeSettings(state.settings);
  const groups = [
    ['general', 'Không gian cá nhân'],
    ['security', 'Bảo mật'],
    ['llm', 'Trợ lý chat & LLM'],
    ['assistant', 'Trợ lý quản trị'],
    ['updates', 'Cập nhật hệ thống']
  ];
  const group = selected.settings;
  const tab = detailTabs.settings;
  const tabs =
    group === 'general'
      ? [
          ['info', 'Thông tin'],
          ['endpoint', 'Domain & endpoint']
        ]
      : [['info', 'Thông tin']];
  const content =
    group === 'security'
      ? `<h2>Bảo mật</h2><p class="footnote">Agent mới luôn cần owner duyệt. Credential được mã hóa tại Hub.</p><div class="divider"></div>${btn('Đổi mật khẩu owner', 'password', '', 'lock')}${pinSettings()}`
      : group === 'llm'
        ? llmSettings()
        : group === 'assistant'
          ? adminAssistantSettings()
          : group === 'updates'
            ? systemUpdatesSettings()
            : tab === 'endpoint'
              ? `<h2>Domain & endpoint</h2><p class="footnote" style="margin-bottom:20px">${esc(state.origin)}</p><div class="codecopy"><code>${esc(state.endpoint)}</code><button class="iconbutton" data-action="copyendpoint" aria-label="Sao chép">${I('copy')}</button></div><p class="footnote">Domain, DNS, Caddy và tunnel được thiết lập bằng TUI. Dùng lệnh gen-hub status trên máy để xem dịch vụ.</p><div class="divider"></div><p class="jsonlabel">OAuth callback cho dịch vụ</p><code class="mono">${esc(state.origin)}/oauth/callback</code>`
              : `<h2>Không gian cá nhân</h2><form id="settings" style="margin-top:23px"><label class="field">Tên Hub<input class="input" name="name" value="${esc(s.name)}" required maxlength="60"></label><label class="field">Lưu nhật ký<select name="retention">${options(
                  [
                    [7, '7 ngày'],
                    [30, '30 ngày'],
                    [90, '90 ngày']
                  ],
                  s.effectiveRetentionDays
                )}</select></label><button class="btn primary" type="submit">Lưu thay đổi</button></form><div class="divider"></div><h3>Bắt đầu sử dụng</h3><p class="footnote">Thêm MCP, kết nối và cấp quyền agent.</p>${btn('Mở hướng dẫn', 'onboard', '', 'info')}`;
  return (
    head('Cài đặt', 'Thông tin Hub, truy cập và nhật ký.') +
    `<div class="entity-layout"><aside class="card entity-list" aria-label="Nhóm cài đặt">${groups.map(([key, label]) => `<button class="entity-row ${group === key ? 'selected' : ''}" data-action="select:settings:${key}" ${group === key ? 'aria-current="true"' : ''}><strong>${label}</strong></button>`).join('')}</aside><section class="card entity-detail cardpad">${tabBar(tabs, tab)}<div role="tabpanel" id="detail-panel" aria-labelledby="detail-tab-${tab}">${content}</div></section></div>`
  );
}
function adminAssistantSettings() {
  const a = state.adminAssistant || {};
  const adminAgents = (state.agents || []).filter(ag => ag.isAdmin && ag.status === 'active');
  return `<section class="card cardpad" style="margin-top:24px"><h2>Trợ lý AI quản trị</h2><p class="footnote">Quyền quản trị toàn bộ Hub như owner. Để kết nối trợ lý (như Claude Code hoặc agent MCP), thêm endpoint bên dưới vào client; khi duyệt trên trình duyệt, tick "Cấp quyền Trợ lý quản trị" và nhập mật khẩu owner để xác nhận.</p><div class="codecopy"><code>${esc(a.endpoint || state.origin + '/mcp/admin')}</code><button class="iconbutton" data-action="copyendpoint:admin" aria-label="Sao chép">${I('copy')}</button></div><div class="divider"></div><h3>Agent quản trị đang hoạt động (${adminAgents.length})</h3>${adminAgents.length ? `<div class="entity-list" style="margin-top:12px">${adminAgents.map(ag => `<div class="listrow"><div><b>${esc(ag.name)}</b> <span class="mono">#${esc(shortAgentId(ag))}</span><p class="footnote">Tạo: ${date(ag.created)} · Dùng gần nhất: ${date(ag.last)}</p></div><div class="actions">${btn('Quản lý agent', 'select:agents:' + ag.id, 'small')}</div></div>`).join('')}</div>` : '<p class="footnote">Chưa có agent nào được cấp quyền quản trị qua OAuth.</p>'}${a.active && !adminAgents.length ? `<div class="divider"></div><p>Token quản trị riêng cũ: Đang hoạt động · #${esc(a.id ? a.id.slice(-8) : '')}</p>${btn('Thu hồi token trợ lý', 'admin-revoke', 'danger')}` : ''}</section>`;
}
function show(title, sub, body, footer = '', sheet = false) {
  modalVersion++;
  clearTimeout(window.vaultRevealTimer);
  modal.className = sheet ? 'sheet' : '';
  modal.innerHTML = `<div class="modalhead"><div><h2>${title}</h2><p>${sub}</p></div><button class="iconbutton" data-action="close" aria-label="Đóng">${I('close')}</button></div><div class="modalbody">${body}</div>${footer ? `<div class="modalfooter">${footer}</div>` : ''}`;
  if (!modal.open) modal.showModal();
}
function close() {
  modalVersion++;
  clearTimeout(window.vaultRevealTimer);
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
  return selectEntity('mcps', id);
}
function connectorInfo(m) {
  const id = m.id;
  return `<dl class="detailgrid"><div><dt>ID</dt><dd>${esc(id)}</dd></div><div><dt>Ngày tạo</dt><dd>${date(m.created)}</dd></div></dl><form id="connector-info" data-id="${esc(id)}"><label class="field">Tên gợi nhớ<input class="input" name="name" value="${esc(m.name)}" maxlength="60" required></label><button class="btn primary" type="submit">Lưu thông tin</button></form><div class="divider"></div><div class="mcpdetailtop">${logo(m)}<div><h3>${esc(m.name)}</h3><p>${esc(m.description)}</p></div><span class="spacer"></span>${badge(m.status)}</div><div class="actions">${btn('Kết nối / xác thực', 'credential:' + id, 'small', 'link')}${btn('Đồng bộ tool', 'sync:' + id, 'small', 'refresh')}${m.hasCredential ? btn('Ngắt kết nối', 'disconnect:' + id, 'danger small') : ''}</div>${m.lastError ? `<p class="errorline" style="margin-top:15px">${esc(m.lastError)}</p>` : ''}<div class="settingsrow"><div><h3>Cung cấp MCP</h3><p>${m.on ? 'MCP đang được bật' : 'Tạm dừng cho tất cả agent'}</p></div>${sw(m.on, 'toggle:' + id, 'Cung cấp MCP')}</div><p class="footnote">Đồng bộ lần gần nhất: ${date(m.syncedAt)}</p><div class="divider"></div>${btn('Gỡ MCP khỏi Hub', 'remove:' + id, 'danger small')}`;
}
function toolPermissionBadge(p) {
  if (!p || p.status === 'ok') {
    return `<span class="badge" title="Khả dụng">Khả dụng</span>`;
  }
  if (p.status === 'missing') {
    return `<span class="badge warn" title="${esc(p.reason || 'Thiếu quyền')}">${esc(p.reason || 'Thiếu quyền')}</span>`;
  }
  return `<span class="badge gray" title="${esc(p.reason || 'Không xác định được')}">Không xác định</span>`;
}
function connectorTools(m) {
  const id = m.id;
  return `<div class="actions">${btn('Đồng bộ tool', 'sync:' + id, 'small', 'refresh')}</div><div class="divider"></div><div class="toolgroup">${m.tools.map(t => `<div class="toolrow"><div><b>${esc(t.name)}</b><p title="${esc(t.description || '')}">${esc(t.description)}</p></div><div class="inline">${toolPermissionBadge(t.permission)}<span class="badge ${t.annotations?.readOnlyHint ? 'gray' : 'warn'}">${t.annotations?.readOnlyHint ? 'Đọc' : 'Ghi / khác'}</span>${sw(t.published, 'publish:' + id + ':' + t.name, 'Công bố ' + t.name)}</div></div>`).join('') || '<div class="empty">Kết nối rồi đồng bộ danh sách tool.</div>'}</div>`;
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
  const urlField =
    m.provider === 'gitea-mcp'
      ? `<label class="field">URL Gitea API<input class="input" name="url" value="${esc(m.url || 'http://gitea:3000/api/v1')}" placeholder="http://gitea:3000/api/v1"></label>`
      : '';
  const tokenForm =
    m.provider === 'drive'
      ? ''
      : `<div class="divider"></div><h3>${m.auth === 'none' ? 'Kết nối không xác thực' : 'Kết nối bằng token'}</h3>${m.auth === 'none' ? `<p class="footnote">Endpoint: ${esc(m.url)}</p>${btn('Kiểm tra & đồng bộ', 'sync:' + id, 'primary')}` : `<form id="credential" style="margin-top:18px">${urlField}<label class="field">${['telegram', 'discord'].includes(m.provider) ? 'Bot token' : 'Access token'}<input class="input" name="token" type="password" required autocomplete="new-password"></label><button class="btn primary" type="submit">Lưu & kiểm tra kết nối</button></form>`}`;
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
function updateGrantCounts(container = document) {
  const groups = container.querySelectorAll('details.toolgroup, .toolgroup');
  for (const g of groups) {
    const mcpId = g.dataset.mcp;
    if (!mcpId) continue;
    const allBoxes = g.querySelectorAll('input[name="permissions"]');
    const checkedBoxes = g.querySelectorAll('input[name="permissions"]:checked');
    const badge = g.querySelector('.grant-count');
    if (badge) {
      badge.textContent = `${checkedBoxes.length}/${allBoxes.length} tool đã cấp`;
    }
  }
}
function setGrantSelection(mcpId, mode) {
  const form =
    document.querySelector('#modal[open] form') ||
    document.querySelector('#grants, #manual-agent, #consent') ||
    document;
  const selector =
    mcpId && mcpId !== 'all'
      ? `input[name="permissions"][data-mcp="${mcpId}"]`
      : `input[name="permissions"]`;
  const checkboxes = form.querySelectorAll(selector);

  for (const chk of checkboxes) {
    if (chk.disabled) continue;
    if (mode === 'all') {
      chk.checked = true;
    } else if (mode === 'none') {
      chk.checked = false;
    } else if (mode === 'basic') {
      chk.checked = chk.dataset.readonly === 'true';
    }
  }
  updateGrantCounts(form);
}
function grantRows(selected) {
  if (!state.mcps.length && !state.vault.length) {
    return '<div class="info">Thêm MCP hoặc secret trước khi cấp quyền.</div>';
  }
  const totalMcpTools = state.mcps.reduce(
    (sum, m) =>
      sum + m.tools.filter(t => t.published || selected.includes(m.id + ':' + t.name)).length,
    0
  );
  const globalToolbar =
    totalMcpTools > 0
      ? `<div class="grant-toolbar"><div class="footnote" style="font-weight:500;margin:0">Thao tác nhanh cho tất cả connector:</div><div class="actions" style="gap:6px"><button type="button" class="btn small" data-action="grant-all:all">Cấp quyền toàn bộ</button><button type="button" class="btn small" data-action="grant-basic:all">Cấp quyền cơ bản</button><button type="button" class="btn small" data-action="grant-none:all">Thu hồi toàn bộ</button><button type="button" class="textbutton" data-action="grant-toggle-expand" style="margin-left:6px">Mở / Thu gọn tất cả</button></div></div>`
      : '';

  const mcpGroups = state.mcps
    .map(m => {
      const visibleTools = m.tools.filter(
        t => t.published || selected.includes(m.id + ':' + t.name)
      );
      const totalCount = visibleTools.length;
      const grantedCount = visibleTools.filter(t => selected.includes(m.id + ':' + t.name)).length;
      const actionsHtml =
        totalCount > 0
          ? `<div class="grant-actions"><button type="button" class="btn small" data-action="grant-all:${esc(m.id)}">Cấp quyền toàn bộ</button><button type="button" class="btn small" data-action="grant-basic:${esc(m.id)}">Cấp quyền cơ bản</button><button type="button" class="btn small" data-action="grant-none:${esc(m.id)}">Thu hồi toàn bộ</button></div>`
          : '';
      const toolRowsHtml =
        totalCount > 0
          ? visibleTools
              .map(t => {
                const isReadOnly = t.annotations?.readOnlyHint === true;
                return `<label class="toolrow"><div><b>${esc(t.name)}</b><p title="${esc(t.description || '')}">${esc(t.description)}${!t.published ? ' · Chưa công bố' : ''}</p></div><div class="inline">${toolPermissionBadge(t.permission)}<input type="checkbox" name="permissions" value="${esc(m.id + ':' + t.name)}" data-mcp="${esc(m.id)}" data-readonly="${isReadOnly ? 'true' : 'false'}" ${selected.includes(m.id + ':' + t.name) ? 'checked' : ''} ${!t.published ? 'disabled' : ''}></div></label>`;
              })
              .join('')
          : '<p class="footnote" style="padding:15px">Chưa công bố tool.</p>';

      return `<details class="toolgroup" data-mcp="${esc(m.id)}"><summary class="toolgrouphead"><div class="inline">${logo(m)}<div><h3>${esc(m.name)}</h3><p class="sub">${m.on ? '' : 'MCP tạm dừng · '}${m.status === 'connected' ? 'Đã kết nối' : 'Kết nối chưa sẵn sàng'}</p></div></div><div class="inline"><span class="badge gray grant-count" data-mcp="${esc(m.id)}">${grantedCount}/${totalCount} tool đã cấp</span><span class="chevron" aria-hidden="true">${I('chevron')}</span></div></summary><div class="toolgroupbody">${actionsHtml}${toolRowsHtml}</div></details>`;
    })
    .join('');

  return globalToolbar + mcpGroups + vaultGrantRows(selected);
}
function agent(id) {
  return selectEntity('agents', id);
}
function agentPermissions(a) {
  const id = a.id;
  const adminNotice = a.isAdmin
    ? `<div class="info" style="margin-bottom:18px">${I('shield')}<div><b>Trợ lý quản trị</b><p>Agent này có toàn quyền quản trị Gen-hub qua endpoint <code>${esc(state.endpoint)}/admin</code>. Quyền tool bên dưới chỉ áp dụng khi agent gọi endpoint <code>${esc(state.endpoint)}</code> thông thường.</p></div></div>`
    : '';
  return `${adminNotice}<div class="inline" style="margin-bottom:22px">${badge(a.status)}<span class="muted">${a.effective} tool khả dụng</span></div><form id="grants" data-id="${esc(id)}">${grantRows(a.permissions)}<div class="actions"><button class="btn primary" type="submit">Lưu quyền</button>${a.status === 'active' ? btn('Thu hồi agent', 'revoke:' + id, 'danger') : btn('Xóa agent', 'delete-agent:' + id, 'danger')}</div></form><div class="divider"></div><h3>Kiểm tra quyền đã lưu</h3><form id="test" data-id="${esc(id)}" style="margin-top:18px"><label class="field">Chọn tool<select name="tool">${state.mcps.flatMap(m => m.tools.map(t => `<option value="${esc(m.id + ':' + t.name)}">${esc(m.name)} / ${esc(t.name)}</option>`)).join('')}${state.vault.map(s => `<option value="vault:${esc(s.id)}">Vault / ${esc(s.name)}</option>`).join('')}</select></label><button class="btn" type="submit">Kiểm tra quyền</button><div id="test-result" style="margin-top:16px"></div></form>`;
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
  const isAdminFlow = f.resource?.endsWith('/mcp/admin');
  show(
    'Duyệt kết nối agent',
    esc(f.name),
    `<div class="info">${I('shield')}Client yêu cầu sử dụng Gen-hub. Chỉ chọn tool bạn muốn cấp.</div><p class="footnote" style="margin-bottom:20px">Sau khi duyệt, quay về: ${esc(f.redirect_uri)}</p><form id="consent"><label class="field">Tên gợi nhớ cho agent<input class="input" name="name" value="${esc(f.name)}" maxlength="80" placeholder="Ví dụ: Claude trên laptop"></label><p class="footnote">Tên gợi ý do client tự khai báo; bạn có thể sửa. Mỗi agent còn có ID riêng trong danh sách.</p><div class="card cardpad" style="margin:20px 0;border:1px solid var(--line);background:var(--bg)"><div style="display:flex;align-items:center;gap:12px"><input type="checkbox" id="consent-admin" name="is_admin" value="true" ${isAdminFlow ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--amber)"><div><label for="consent-admin" style="font-weight:600;cursor:pointer;color:var(--ink)">Cấp quyền Trợ lý quản trị (Admin Assistant)</label><p class="footnote" style="margin-top:3px">Cho phép agent quản trị toàn bộ Gen-hub qua endpoint /mcp/admin. Bắt buộc nhập lại mật khẩu owner để xác nhận.</p></div></div><div id="consent-admin-password-block" style="${isAdminFlow ? '' : 'display:none;'}margin-top:16px;padding-top:16px;border-top:1px solid var(--line)"><label class="field" style="margin-bottom:0">Mật khẩu owner (bắt buộc khi cấp quyền quản trị)<input class="input" type="password" name="admin_password" autocomplete="current-password" placeholder="Nhập mật khẩu owner để xác nhận"></label></div></div>${grantRows([])}<div class="actions">${btn('Từ chối', 'deny:' + flow, 'danger')}<button class="btn primary" type="submit">Duyệt & cấp quyền</button></div></form>`,
    '',
    true
  );
  const chk = $('#consent-admin');
  const pwdBlock = $('#consent-admin-password-block');
  if (chk && pwdBlock) {
    chk.addEventListener('change', () => {
      pwdBlock.style.display = chk.checked ? 'block' : 'none';
      if (chk.checked) {
        pwdBlock.querySelector('input')?.focus();
      }
    });
  }
}
async function log(id, tab = 'input') {
  modalContext = { kind: 'log', id, tab };
  let l =
    logDetailCache.get(Number(id)) ||
    [...(state?.logs || []), ...[...activity.values()].flatMap(v => v.rows || [])].find(
      x => String(x.id) === String(id) && x.input !== undefined
    );
  if (!l) {
    show(
      'Chi tiết nhật ký',
      '#' + id,
      '<div style="padding:24px;text-align:center"><p role="status">Đang tải chi tiết…</p></div>',
      btn('Đóng', 'close'),
      true
    );
    try {
      l = await api('logs/' + id);
      logDetailCache.set(Number(id), l);
    } catch (err) {
      return show(
        'Chi tiết nhật ký',
        '#' + id,
        `<p class="errorline">${esc(err.message)}</p>`,
        btn('Đóng', 'close'),
        true
      );
    }
  } else {
    logDetailCache.set(Number(id), l);
  }
  const data =
    tab === 'input'
      ? l.input
      : tab === 'output'
        ? l.output
        : {
            policyDecision: l.policyDecision?.toUpperCase() || 'Chưa phân loại',
            outcome: l.outcome || 'Chưa phân loại',
            eventKind: l.eventKind || 'Chưa phân loại',
            actorType: l.actorType || 'Chưa phân loại',
            errorCategory: l.errorCategory || (l.outcome === 'success' ? '—' : 'Chưa phân loại'),
            classification: l.classification,
            operationId: l.operationId,
            phases: l.phases,
            reason: l.reason,
            actor: l.actor,
            mcp: l.mcp,
            tool: l.tool
          };
  show(
    'Chi tiết nhật ký',
    '#' + l.id,
    `<div class="inline" style="justify-content:space-between;margin-bottom:22px"><span class="mono">${esc(l.tool)}</span>${badge(l.status)}</div><dl class="detailgrid"><div><dt>Thời điểm</dt><dd>${date(l.created)}</dd></div><div><dt>Thời gian xử lý</dt><dd>${l.latencyMeasured ? l.latency + ' ms' : 'N/A · chưa đo'}</dd></div><div><dt>Người thực hiện</dt><dd>${esc(l.actor === 'owner' ? state?.owner : state?.agents.find(a => a.id === l.actor)?.name || l.actor)}</dd></div><div><dt>MCP</dt><dd>${esc(state?.mcps.find(m => m.id === l.mcp)?.name || (l.mcp === 'hub' ? 'Hub' : l.mcp))}</dd></div></dl><div class="tabs">${[
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
  const needsPin = /^(do-remove|do-delete-agent|do-disconnect|do-vault-delete):/.test(action);
  if (needsPin && !state.security.pinConfigured) {
    show(
      'Đặt PIN trước khi tiếp tục',
      'PIN bảo vệ thao tác xóa dữ liệu.',
      '<p>Vào Cài đặt để đặt PIN riêng bằng mật khẩu owner, sau đó thử lại thao tác.</p>',
      btn('Cài đặt PIN', 'pin-setup', 'primary')
    );
    return;
  }
  show(
    title,
    'Thao tác sẽ áp dụng ngay trên Hub.',
    `<p>${detail}</p>${needsPin ? '<label class="field">PIN xác nhận<input id="confirm-pin" class="input" type="password" inputmode="numeric" minlength="4" maxlength="12" autocomplete="off" required></label>' : ''}`,
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
async function act(action, args, el = null) {
  const id = args[0];
  if (action === 'select') return selectEntity(id, args[1]);
  if (action === 'detail-tab') {
    detailTabs[route] = id;
    render();
    document.querySelector(`#detail-tab-${id}`)?.focus();
    return;
  }
  if (action === 'activity-reload') {
    activity.delete(route + ':' + selected[route]);
    return render();
  }
  if (action === 'grant-all') {
    setGrantSelection(args[0] || 'all', 'all');
    return;
  }
  if (action === 'grant-basic') {
    setGrantSelection(args[0] || 'all', 'basic');
    return;
  }
  if (action === 'grant-none') {
    setGrantSelection(args[0] || 'all', 'none');
    return;
  }
  if (action === 'grant-toggle-expand') {
    const form =
      document.querySelector('#modal[open] form') ||
      document.querySelector('#grants, #manual-agent, #consent') ||
      document;
    const detailsList = Array.from(form.querySelectorAll('details.toolgroup'));
    const anyClosed = detailsList.some(d => !d.open);
    for (const d of detailsList) d.open = anyClosed;
    return;
  }
  if (action === 'vault-new') return vaultEditor();
  if (action === 'vault-edit') return vaultEditor(id);
  if (action === 'vault-reveal')
    return confirmation(
      'Hiển thị giá trị secret?',
      'Giá trị thật sẽ xuất hiện trong hộp thoại tối đa 60 giây. Lượt đọc được ghi nhật ký.',
      'do-vault-reveal:' + id
    );
  if (action === 'do-vault-reveal') {
    const version = modalVersion;
    const r = await api('vault/' + id + '/read', 'POST');
    if (version !== modalVersion || !modal.open) return;
    modalContext = {};
    show(
      'Giá trị secret',
      'Tự đóng sau 60 giây. Lượt đọc đã được ghi nhật ký.',
      `<textarea id="vault-value" class="input mono" readonly rows="4">${esc(r.secret)}</textarea>`,
      btn('Sao chép', 'vault-copy') + btn('Ẩn ngay', 'close')
    );
    window.vaultRevealTimer = setTimeout(close, 60000);
    return;
  }
  if (action === 'vault-copy') {
    const field = $('#vault-value');
    try {
      await navigator.clipboard.writeText(field.value);
      toast('Đã sao chép');
    } catch {
      field.select();
      toast('Chọn và sao chép giá trị bằng bàn phím');
    }
    return;
  }
  if (action === 'vault-delete')
    return confirmation(
      'Xóa secret?',
      'Xóa giá trị và mọi quyền đọc liên quan; giữ nhật ký. Không thể thu hồi các bản sao agent đã đọc trước đó.',
      'do-vault-delete:' + id
    );
  if (action === 'do-vault-delete') {
    await api('vault/' + id, 'DELETE', { pin: $('#confirm-pin')?.value });
    close();
    return refresh();
  }
  if (action === 'pin-setup') {
    show(
      'Đặt PIN xác nhận',
      'Nhập mật khẩu owner để đặt hoặc khôi phục PIN riêng.',
      `<form id="pin-setup"><label class="field">Mật khẩu owner<input class="input" type="password" name="password" autocomplete="current-password" required></label><label class="field">PIN mới (4–12 chữ số)<input class="input" type="password" name="pin" inputmode="numeric" pattern="[0-9]{4,12}" autocomplete="new-password" required></label><label class="field">Nhập lại PIN<input class="input" type="password" name="repeat" inputmode="numeric" pattern="[0-9]{4,12}" autocomplete="new-password" required></label><button type="submit" class="btn primary">Lưu PIN</button></form>`,
      btn('Hủy', 'close')
    );
    return;
  }
  if (action === 'dismiss-update-banner') {
    if (state?.update?.revision) {
      localStorage.setItem('genhub_seen_revision_' + state.owner, state.update.revision);
    }
    updateBannerDismissed = true;
    render();
    return;
  }
  if (action === 'check-update') {
    toast('Đang kiểm tra bản cập nhật mới từ GitHub…');
    try {
      const res = await api('check-update', 'POST');
      await refresh();
      if (res.hasUpdate) {
        toast(`Có bản cập nhật mới: ${shortSha(res.latestRevision)}`);
      } else if (res.error) {
        toast(`Lưu ý: ${res.error}`);
      } else {
        toast('Gen-hub đang ở phiên bản mới nhất.');
      }
    } catch (err) {
      toast(err.message || 'Không thể kiểm tra cập nhật');
    }
    return;
  }
  if (action === 'kanban-refresh') return loadKanban();
  if (action === 'kanban-archive-done') {
    const res = await api('kanban/archive-done', 'POST');
    kanbanData = null;
    await loadKanban();
    return toast(`Đã chuyển lưu trữ ${res?.archivedCount ?? 0} issue cột Done`);
  }
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
  if (action === 'copyendpoint') {
    const isExplicitAdmin = id === 'admin';
    const codeText = el?.closest('.codecopy')?.querySelector('code')?.textContent?.trim();
    if (isExplicitAdmin) {
      const adminEndpoint =
        state.adminAssistant?.endpoint ||
        (state.origin ? state.origin + '/mcp/admin' : '/mcp/admin');
      return copy(codeText || adminEndpoint);
    }
    return copy(codeText || state.endpoint);
  }
  if (action === 'copytoken') return copy(modalContext.token);
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
    await api('mcps/' + id + '/disconnect', 'POST', { pin: $('#confirm-pin')?.value });
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
    await api('mcps/' + id, 'DELETE', { pin: $('#confirm-pin')?.value });
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
    await api('agents/' + id, 'DELETE', { pin: $('#confirm-pin')?.value });
    close();
    return refresh();
  }
  if (action === 'log') return log(id);
  if (action === 'logtab') return log(modalContext.id, id);
  if (action === 'load-more-logs') return fetchAuditLogs(auditCursor, true);
  if (action === 'export-jsonl' || action === 'export-csv') {
    const format = action === 'export-csv' ? 'csv' : 'jsonl';
    const params = buildAuditQueryParams({ format });
    const url = '/api/logs/export?' + params;
    let resp;
    try {
      resp = await fetch(url, {
        headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) }
      });
    } catch (e) {
      return toast('Lỗi kết nối khi xuất nhật ký');
    }
    if (!resp.ok) {
      let msg = 'Xuất thất bại';
      try { const d = await resp.json(); msg = d.error || msg; } catch {}
      return toast(msg);
    }
    const body = await resp.text();
    const truncated = resp.headers.get('X-Export-Truncated') === 'true';
    const totalRows = Number(resp.headers.get('X-Export-Total-Rows') || 0);
    const ts = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
    const filename = `gen-hub-audit-${ts}.${format}`;
    const mimeType = format === 'csv' ? 'text/csv' : 'application/x-ndjson';
    const u = URL.createObjectURL(new Blob([body], { type: mimeType }));
    const a = document.createElement('a');
    a.href = u;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
    if (truncated) {
      toast(`Đã xuất ${totalRows.toLocaleString()} bản ghi (bị cắt tại giới hạn 50.000 — hãy thu hẹp bộ lọc để lấy đầy đủ)`);
    } else {
      toast(`Đã xuất ${totalRows.toLocaleString()} bản ghi`);
    }
    return;
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
  if (action === 'toggle-notifs') {
    notifOpen = !notifOpen;
    if (notifOpen) {
      notifSnapshotTime = getNotifLastRead();
      setNotifLastRead(Date.now());
    }
    render();
    return;
  }
  if (action === 'mark-notifs-read') {
    setNotifLastRead(Date.now());
    notifSnapshotTime = Date.now();
    render();
    return;
  }
  if (action === 'click-notif') {
    notifOpen = false;
    const target = args.join(':');
    if (target) location.hash = target;
    return;
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
  if (action === 'llm-test') {
    const form = $('#llm-config');
    const provider = form?.querySelector('[name="provider"]')?.value || state.llm?.provider;
    const model = form?.querySelector('[name="model"]')?.value || state.llm?.model;
    const baseUrl = form?.querySelector('[name="baseUrl"]')?.value || state.llm?.baseUrl;
    const apiKey = form?.querySelector('[name="apiKey"]')?.value || '';
    toast('Đang kiểm tra kết nối với LLM…');
    try {
      const res = await api('llm/test', 'POST', { provider, model, baseUrl, apiKey });
      if (res.ok) {
        toast(res.message || 'Kết nối LLM thành công!');
      } else {
        toast('Lỗi kết nối: ' + (res.error || 'Không thành công'));
      }
    } catch (err) {
      toast('Lỗi kết nối: ' + err.message);
    }
    return;
  }
  if (action === 'chat-toggle') {
    chatOpen = !chatOpen;
    renderChat();
    if (chatOpen) {
      setTimeout(() => {
        const input = $('#chat-input');
        if (input && !input.disabled) input.focus();
        const body = $('#chat-body');
        if (body) body.scrollTop = body.scrollHeight;
      }, 50);
    }
    return;
  }
  if (action === 'chat-clear') {
    chatMessages = [];
    renderChat();
    return;
  }
  if (action === 'chat-quick') {
    const text = args.join(':');
    if (text) sendChatMessage(text);
    return;
  }
  if (action === 'chat-go-settings') {
    selected.settings = 'llm';
    location.hash = 'settings';
    render();
    setTimeout(() => {
      const form = $('#llm-config');
      if (form) {
        form.classList.add('chat-highlight-pulse');
        setTimeout(() => form.classList.remove('chat-highlight-pulse'), 4000);
      }
    }, 100);
    return;
  }
}
document.addEventListener('click', async e => {
  if (notifOpen && !e.target.closest('.notif-wrapper')) {
    notifOpen = false;
    render();
  }
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  el.disabled = true;
  const [a, ...args] = el.dataset.action.split(':');
  try {
    await act(a, args, el);
  } catch (err) {
    toast(err.message);
  } finally {
    el.disabled = false;
  }
});
document.addEventListener('change', e => {
  if (e.target.matches('input[name="permissions"]')) {
    updateGrantCounts(e.target.closest('form') || document);
  }
});
document.addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target,
    b = Object.fromEntries(new FormData(f)),
    button = f.querySelector('[type=submit]');
  if (button) button.disabled = true;
  try {
    if (f.id === 'pin-setup') {
      if (b.pin !== b.repeat) throw Error('PIN nhập lại không khớp');
      await api('security/pin', 'POST', { password: b.password, pin: b.pin });
      f.reset();
      close();
      await refresh();
      toast('Đã lưu PIN');
    }
    if (f.id === 'vault-save') {
      const id = f.dataset.id;
      const data = {
        name: b.name,
        notes: b.notes ?? '',
        ...(!id || b.secret ? { secret: b.secret } : {})
      };
      if (!id)
        Object.assign(data, { sharing: b.sharing, agents: new FormData(f).getAll('agents') });
      await api('vault' + (id ? '/' + id : ''), id ? 'PATCH' : 'POST', data);
      f.reset();
      close();
      await refresh();
      toast('Đã lưu secret');
    }
    if (f.id === 'vault-share') {
      await api('vault/' + f.dataset.id + '/grants', 'POST', {
        sharing: b.sharing,
        agents: new FormData(f).getAll('agents')
      });
      close();
      await refresh();
      toast('Đã lưu quyền đọc secret');
    }
    if (f.id === 'kanban-config') {
      const selectedMcp = (state?.mcps || []).find(m => m.id === b.connectorId);
      const isGitea = selectedMcp?.provider === 'gitea-mcp';
      const repository = isGitea ? '' : (b.repository || '').trim();
      await api('kanban', 'PATCH', { repository, connectorId: b.connectorId });
      kanbanData = null;
      await loadKanban();
      toast('Đã lưu nguồn Kanban');
    }
    if (f.id === 'login') {
      const r = await api('login', 'POST', b);
      csrf = r.csrf;
      await refresh();
      if (route.startsWith('gitea/')) {
        location.assign('/oidc/owner/resume?flow=' + encodeURIComponent(route.slice(6)));
        return;
      }
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
      const id = modalContext.id;
      await api('mcps/' + id + '/credential', 'POST', b);
      await refresh();
      mcp(id);
      toast('Kết nối thành công');
    }
    if (f.id === 'oauth') {
      const r = await api('mcps/' + modalContext.id + '/oauth', 'POST', b);
      location.href = r.url;
    }
    if (f.id === 'agent-info') {
      await api('agents/' + f.dataset.id, 'PATCH', b);
      await refresh();
      toast('Đã lưu thông tin agent');
    }
    if (f.id === 'connector-info') {
      await api('mcps/' + f.dataset.id, 'PATCH', b);
      await refresh();
      toast('Đã lưu thông tin MCP');
    }
    if (f.id === 'grants') {
      await api('agents/' + f.dataset.id, 'PATCH', {
        permissions: new FormData(f).getAll('permissions')
      });
      close();
      await refresh();
      toast('Đã lưu quyền');
    }
    if (f.id === 'manual-agent') {
      const r = await api('agents', 'POST', {
        name: b.name,
        permissions: new FormData(f).getAll('permissions')
      });
      await refresh();
      modalContext = { kind: 'token', token: r.token };
      show(
        'Token đã được tạo',
        'Sao chép ngay; token sẽ không được hiển thị lại.',
        `<label class="field">Token riêng</label><div style="display:flex;gap:8px;align-items:flex-start"><textarea class="input mono" readonly rows="3" style="flex:1">${esc(r.token)}</textarea><button type="button" class="iconbutton" data-action="copytoken" aria-label="Sao chép">${I('copy')}</button></div><p class="footnote">Endpoint: ${esc(state.endpoint)}</p><pre class="json">${esc(JSON.stringify({ mcpServers: { 'gen-hub': { url: state.endpoint, headers: { Authorization: 'Bearer ' + r.token } } } }, null, 2))}</pre><p class="footnote">Hết hạn sau 90 ngày. Không chia sẻ cấu hình chứa token.</p>`,
        btn('Đã lưu token', 'close')
      );
    }
    if (f.id === 'consent') {
      const formData = new FormData(f);
      const isAdmin = formData.get('is_admin') === 'true';
      const password = formData.get('admin_password');
      if (isAdmin && !password) {
        toast('Vui lòng nhập mật khẩu owner để cấp quyền quản trị');
        return;
      }
      const r = await api('flows/' + modalContext.id, 'POST', {
        approve: true,
        name: b.name,
        permissions: formData.getAll('permissions'),
        isAdmin,
        password: isAdmin ? password : undefined
      });
      location.href = r.redirect;
    }
    if (f.id === 'test') {
      const [mcp, tool] = b.tool.split(':'),
        r = await api('test', 'POST', { agent: f.dataset.id, mcp, tool });
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
      modalContext = { kind: 'token', token: result.token };
      show(
        'Token trợ lý quản trị đã tạo',
        'Sao chép ngay; không thể xem lại token sau khi đóng.',
        `<label class="field">Admin token</label><div style="display:flex;gap:8px;align-items:flex-start"><textarea class="input mono" readonly rows="3" style="flex:1">${esc(result.token)}</textarea><button type="button" class="iconbutton" data-action="copytoken" aria-label="Sao chép">${I('copy')}</button></div><p>Endpoint: <code>${esc(result.endpoint)}</code></p><pre class="json">${esc(JSON.stringify({ mcpServers: { 'gen-hub-admin': { url: result.endpoint, headers: { Authorization: 'Bearer ' + result.token } } } }, null, 2))}</pre><p class="footnote">Dùng Bearer token, không qua OAuth. Token có quyền quản trị và chỉ mất hiệu lực khi owner thu hồi.</p>`,
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
    if (f.id === 'llm-config') {
      const data = {
        provider: b.provider,
        model: b.model.trim(),
        baseUrl: b.baseUrl ? b.baseUrl.trim() : '',
        ...(b.apiKey ? { apiKey: b.apiKey.trim() } : {})
      };
      await api('llm', 'PATCH', data);
      await refresh();
      toast('Đã lưu cấu hình LLM trợ lý');
    }
    if (f.id === 'chat-form') {
      const input = $('#chat-input');
      if (input && input.value.trim()) {
        const text = input.value.trim();
        input.value = '';
        sendChatMessage(text);
      }
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
  if (el) {
    const repoFilter = $('#kanban-filter-repo')?.value || '';
    const agentFilter = $('#kanban-filter-agent')?.value || '';
    el.innerHTML =
      route === 'kanban'
        ? kanbanCards(kanbanData, filter, { repo: repoFilter, agent: agentFilter })
        : ['mcps', 'agents', 'vault'].includes(route)
          ? entityResults(route)
          : route === 'audit'
            ? renderAuditResultsHtml()
            : logTable(logFilter());
  }
}
document.addEventListener('input', e => {
  if (e.target.name === 'url' && e.target.form?.id === 'remote')
    $('#remote-guide').innerHTML = connectionGuideHtml('remote', e.target.value);
  if (e.target.id === 'search') {
    filter = e.target.value;
    if (route === 'audit') {
      clearTimeout(auditDebounceTimer);
      auditDebounceTimer = setTimeout(() => {
        syncAuditHash();
        fetchAuditLogs();
      }, 250);
    } else {
      updateResults();
    }
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && notifOpen) {
    notifOpen = false;
    render();
    return;
  }
  if (!e.target.matches('.detail-tabs [role=tab]')) return;
  const tabs = [...e.target.parentElement.querySelectorAll('[role=tab]')];
  const index = tabs.indexOf(e.target);
  const next =
    e.key === 'ArrowRight'
      ? (index + 1) % tabs.length
      : e.key === 'ArrowLeft'
        ? (index + tabs.length - 1) % tabs.length
        : e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? tabs.length - 1
            : -1;
  if (next < 0) return;
  e.preventDefault();
  tabs[next].click();
});
document.addEventListener('change', e => {
  if (e.target.id === 'kanban-connector-select') {
    const opt = e.target.selectedOptions[0];
    const prov = opt?.dataset?.provider;
    const group = $('#kanban-repo-group');
    const input = $('#kanban-repo-input');
    if (group && input) {
      if (prov === 'gitea-mcp') {
        group.style.display = 'none';
        input.removeAttribute('required');
      } else {
        group.style.display = '';
        input.setAttribute('required', '');
      }
    }
    return;
  }
  if (e.target.id === 'kanban-filter-repo' || e.target.id === 'kanban-filter-agent') {
    updateResults();
    return;
  }
  if (e.target.id === 'activity-hours') {
    activityHours = Number(e.target.value);
    activity = new Map();
    render();
    return;
  }
  if (e.target.name === 'sharing') {
    e.target.form.querySelector('[data-sharing-agents]').hidden = e.target.value !== 'selected';
    return;
  }
  if (e.target.id === 'statusfilter') statusFilter = e.target.value;
  else if (e.target.id === 'agentfilter') agentFilter = e.target.value;
  else if (e.target.id === 'mcpfilter') mcpFilter = e.target.value;
  else if (e.target.id === 'timefilter') {
    timeFilter = e.target.value;
    delete auditExact.since;
    delete auditExact.before;
    delete auditExact.until;
  } else return;
  if (route === 'audit') {
    syncAuditHash();
    fetchAuditLogs();
  } else {
    updateResults();
  }
});
window.addEventListener('hashchange', async () => {
  const rawHash = location.hash.slice(1) || 'overview';
  const [hashRoute] = rawHash.split('?');
  route = hashRoute;
  kanbanGeneration++;
  if (state && route === 'kanban') loadKanban();
  if (route === 'audit') {
    parseAuditHash();
  } else {
    filter = '';
    statusFilter = 'all';
    agentFilter = 'all';
    mcpFilter = 'all';
    timeFilter = 'all';
  }
  close();
  if (state) {
    render();
    if (route === 'audit') {
      fetchAuditLogs();
    }
    if (route.startsWith('gitea/')) {
      location.assign('/oidc/owner/resume?flow=' + encodeURIComponent(route.slice(6)));
      return;
    }
    if (route.startsWith('consent/'))
      try {
        await consent(route.slice(8));
      } catch (e) {
        toast(e.message);
      }
  }
});
boot();
