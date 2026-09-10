const esc = v =>
  String(v ?? '').replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
export function kanbanCards(data, filter = '') {
  const q = filter.trim().toLowerCase();
  const rows = (data?.issues || []).filter(i =>
    [i.number, i.title, ...i.labels, ...i.assignees].join(' ').toLowerCase().includes(q)
  );
  return `<div class="kanban-board">${(
    data?.columns || ['Backlog', 'Ready', 'In Progress', 'Review', 'Done']
  )
    .map(column => {
      const items = rows.filter(i => i.column === column);
      return `<section class="kanban-column"><h2>${esc(column)} <span class="badge gray">${items.length}</span></h2>${items.map(i => `<article class="kanban-card"><a href="${esc(i.url)}" target="_blank" rel="noopener noreferrer"><span class="mono">#${i.number}</span> ${esc(i.title)}</a><div class="kanban-labels">${i.labels.map(l => `<span class="badge gray">${esc(l)}</span>`).join('')}</div>${i.assignees.length ? `<p class="footnote">Phụ trách: ${i.assignees.map(esc).join(', ')}</p>` : ''}</article>`).join('') || '<p class="footnote">Chưa có issue phù hợp.</p>'}</section>`;
    })
    .join('')}</div>`;
}
export function kanbanPage(data, mcps, filter = '') {
  const config = data?.config || {
    repository: 'Genesis-ryan-84-0567536339/Gen-hub',
    connectorId: ''
  };
  const sources = mcps.filter(m => ['github', 'github-mcp'].includes(m.provider));
  return `<div class="pagehead"><div><h1>Kanban</h1><p class="subtitle">Issue từ ${esc(config.repository)} · chỉ đọc</p></div><button class="btn" data-action="kanban-refresh">Đồng bộ</button></div><details class="card cardpad" ${data?.configured ? '' : 'open'}><summary>Cấu hình nguồn issue</summary><form id="kanban-config" style="margin-top:20px"><label class="field">Repo GitHub<input class="input" name="repository" value="${esc(config.repository)}" placeholder="owner/repository" required maxlength="140"></label><label class="field">Connector<select name="connectorId" required><option value="">Chọn connector GitHub</option>${sources.map(m => `<option value="${esc(m.id)}" ${m.id === config.connectorId ? 'selected' : ''}>${esc(m.name)} · ${esc(m.id)}${m.status === 'connected' && m.on ? '' : ' (chưa sẵn sàng)'}</option>`).join('')}</select></label><p class="footnote">Dùng quyền đọc issue của connector đã kết nối. Có thể thêm GitHub REST hoặc GitHub MCP trong MCP & kết nối.</p><button type="submit" class="btn primary">Lưu nguồn & đồng bộ</button></form></details><p class="footnote">Tự đồng bộ mỗi 2 phút khi đang mở bảng. Nhãn Status: Backlog / Ready / In Progress / Review / Done quyết định cột; issue đã đóng vào Done. Không có nhãn trạng thái thì vào Backlog. Nhãn agent:* chỉ xác định người xử lý.</p>${data?.error ? `<p class="errorline" role="status">${esc(data.error)}${data.fetchedAt ? ' · Đang hiển thị bản dữ liệu cũ.' : ''}</p>` : ''}${data?.truncated ? '<p class="info">Đã chạm giới hạn 20 trang; bảng chưa bao gồm toàn bộ issue của repo.</p>' : ''}<p class="footnote">${data?.fetchedAt ? 'Đồng bộ thành công: ' + esc(new Date(data.fetchedAt).toLocaleString('vi-VN')) : data ? 'Chưa đồng bộ thành công.' : 'Đang tải bảng…'}</p><label class="field">Tìm issue, nhãn hoặc người phụ trách<input id="search" class="input" value="${esc(filter)}" placeholder="Tìm trên bảng"></label><div id="results">${kanbanCards(data, filter)}</div>`;
}
