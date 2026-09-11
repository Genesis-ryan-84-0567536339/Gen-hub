const esc = v =>
  String(v ?? '').replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

export function kanbanCards(data, filter = '', { repo = '', agent = '' } = {}) {
  const q = filter.trim().toLowerCase();
  const repoFilter = repo.trim().toLowerCase();
  const agentFilter = agent.trim().toLowerCase();

  const rows = (data?.issues || []).filter(i => {
    if (repoFilter && (i.repo || '').toLowerCase() !== repoFilter) return false;
    if (agentFilter) {
      const matchAssignee = (i.assignees || []).some(a => a.toLowerCase() === agentFilter);
      const matchLabel = (i.labels || []).some(l => l.toLowerCase() === `agent:${agentFilter}`);
      if (!matchAssignee && !matchLabel) return false;
    }
    if (q) {
      const text = [i.repo || '', i.number, i.title, ...i.labels, ...i.assignees]
        .join(' ')
        .toLowerCase();
      if (!text.includes(q)) return false;
    }
    return true;
  });

  return `<div class="kanban-board">${(
    data?.columns || ['Backlog', 'Ready', 'In Progress', 'Review', 'Done']
  )
    .map(column => {
      const items = rows.filter(i => i.column === column);
      const isDone = column === 'Done';
      const archiveBtn = isDone
        ? `<div style="margin-bottom:10px"><button class="btn small" data-action="kanban-archive-done" style="width:100%" ${items.length === 0 ? 'disabled' : ''}>Chuyển lưu trữ toàn bộ cột Done</button></div>`
        : '';
      return `<section class="kanban-column" data-column="${esc(column)}"><h2>${esc(column)} <span class="badge gray">${items.length}</span></h2>${archiveBtn}${items.map(i => `<article class="kanban-card">${i.repo ? `<div style="margin-bottom:6px"><span class="badge gray mono" style="font-size:11px">${esc(i.repo)}</span></div>` : ''}<a href="${esc(i.url)}" target="_blank" rel="noopener noreferrer"><span class="mono">#${i.number}</span> ${esc(i.title)}</a><div class="kanban-labels">${i.labels.map(l => `<span class="badge gray">${esc(l)}</span>`).join('')}</div>${i.assignees.length ? `<p class="footnote">Phụ trách: ${i.assignees.map(esc).join(', ')}</p>` : ''}</article>`).join('') || '<p class="footnote">Chưa có issue phù hợp.</p>'}</section>`;
    })
    .join('')}</div>`;
}

export function kanbanPage(data, mcps, filter = '', { repo = '', agent = '' } = {}) {
  const config = data?.config || {
    repository: 'Genesis-ryan-84-0567536339/Gen-hub',
    connectorId: ''
  };
  const sources = mcps.filter(m => ['github', 'github-mcp', 'gitea-mcp'].includes(m.provider));
  const activeMcp = mcps.find(m => m.id === config.connectorId);
  const isGitea = activeMcp?.provider === 'gitea-mcp';

  const allIssues = data?.issues || [];
  const repos = [...new Set(allIssues.map(i => i.repo).filter(Boolean))].sort();
  const agents = [
    ...new Set(
      allIssues.flatMap(i => [
        ...(i.assignees || []),
        ...(i.labels || [])
          .filter(l => l.toLowerCase().startsWith('agent:'))
          .map(l => l.slice(6).trim())
      ]).filter(Boolean)
    )
  ].sort();

  const subtitle = isGitea
    ? 'Tất cả issue từ Gitea · chỉ đọc'
    : config.connectorId
      ? `Issue từ ${esc(config.repository)} · chỉ đọc`
      : 'Chưa cấu hình nguồn issue';
  const archivedCount = config.archived?.length || 0;
  const archivedNote = archivedCount > 0
    ? `<p class="footnote">Đã lưu trữ: <strong>${archivedCount}</strong> issue hoàn thành (ẩn khỏi bảng).</p>`
    : '';

  return `<div class="pagehead"><div><h1>Kanban</h1><p class="subtitle">${subtitle}</p></div><button class="btn" data-action="kanban-refresh">Đồng bộ</button></div><details class="card cardpad" ${data?.configured ? '' : 'open'}><summary>Cấu hình nguồn issue</summary><form id="kanban-config" style="margin-top:20px"><label class="field">Connector<select name="connectorId" id="kanban-connector-select" required><option value="">Chọn connector</option>${sources.map(m => `<option value="${esc(m.id)}" ${m.id === config.connectorId ? 'selected' : ''} data-provider="${esc(m.provider)}">${esc(m.name)} · ${esc(m.id)}${m.status === 'connected' && m.on ? '' : ' (chưa sẵn sàng)'}</option>`).join('')}</select></label><div id="kanban-repo-group" style="${isGitea ? 'display:none' : ''}"><label class="field">Repo GitHub<input class="input" name="repository" id="kanban-repo-input" value="${esc(config.repository)}" placeholder="owner/repository" ${isGitea ? '' : 'required'} maxlength="140"></label></div><p class="footnote">Nguồn Gitea tự động đọc toàn bộ repo được cấp quyền. Nguồn GitHub đồng bộ repo được chỉ định.</p><button type="submit" class="btn primary">Lưu nguồn & đồng bộ</button></form></details><p class="footnote">Tự đồng bộ mỗi 2 phút khi đang mở bảng. Nhãn Status: Backlog / Ready / In Progress / Review / Done quyết định cột; issue đã đóng vào Done. Không có nhãn trạng thái thì vào Backlog. Nhãn agent:* chỉ xác định người xử lý.</p>${data?.error ? `<p class="errorline" role="status">${esc(data.error)}${data.fetchedAt ? ' · Đang hiển thị bản dữ liệu cũ.' : ''}</p>` : ''}${data?.truncated ? '<p class="info">Đã chạm giới hạn phân trang; bảng có thể chưa bao gồm toàn bộ issue.</p>' : ''}<p class="footnote">${data?.fetchedAt ? 'Đồng bộ thành công: ' + esc(new Date(data.fetchedAt).toLocaleString('vi-VN')) : data ? 'Chưa đồng bộ thành công.' : 'Đang tải bảng…'}</p>${archivedNote}<div class="kanban-filters" style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:16px"><label class="field" style="flex:2;min-width:200px;margin-bottom:0">Tìm issue, nhãn hoặc người phụ trách<input id="search" class="input" value="${esc(filter)}" placeholder="Tìm trên bảng (từ khóa, #số, repo...)"></label>${repos.length > 1 ? `<label class="field" style="flex:1;min-width:140px;margin-bottom:0">Lọc theo repo<select id="kanban-filter-repo"><option value="">Tất cả repo (${repos.length})</option>${repos.map(r => `<option value="${esc(r)}" ${r === repo ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></label>` : ''}${agents.length > 0 ? `<label class="field" style="flex:1;min-width:140px;margin-bottom:0">Lọc theo agent<select id="kanban-filter-agent"><option value="">Tất cả agent</option>${agents.map(a => `<option value="${esc(a)}" ${a === agent ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select></label>` : ''}</div><div id="results">${kanbanCards(data, filter, { repo, agent })}</div>`;
}
