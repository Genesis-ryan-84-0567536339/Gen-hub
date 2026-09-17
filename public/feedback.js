const esc = v =>
  String(v ?? '').replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

function fmt(iso) {
  return iso ? new Date(iso).toLocaleString('vi-VN') : '—';
}

function previewPayload(payload) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {});
  return text.length > 400 ? text.slice(0, 400) + '…' : text;
}

export function feedbackPage(data, detail, selectedId) {
  const projects = data?.projects || [];

  const projectList = `<div class="card cardpad" style="margin-bottom:20px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px"><h2 style="margin:0">Project</h2><button type="button" class="btn primary" data-action="feedback-new-project">Tạo project mới</button></div>${
    projects.length === 0
      ? '<p class="footnote">Chưa có project nào. Tạo 1 project cho mỗi app cần nhận report, rồi sinh ingest key để nhúng vào app đó.</p>'
      : `<table><thead><tr><th>Tên</th><th>Tạo lúc</th><th>Key còn hoạt động</th><th></th></tr></thead><tbody>${projects
          .map(
            p => `<tr>
              <td><strong>${esc(p.name)}</strong><br><small class="mono">${esc(p.id)}</small></td>
              <td>${fmt(p.created_at)}</td>
              <td>${p.activeKeyCount}</td>
              <td style="display:flex;gap:8px;justify-content:flex-end">
                <button type="button" class="btn small" data-action="feedback-select:${esc(p.id)}">${p.id === selectedId ? 'Đang xem' : 'Xem'}</button>
                <button type="button" class="btn small danger" data-action="feedback-delete-project:${esc(p.id)}">Xóa</button>
              </td>
            </tr>`
          )
          .join('')}</tbody></table>`
  }</div>`;

  if (!selectedId) return `<div class="pagehead"><div><h1>Feedback Inbox</h1><p class="subtitle">Report từ các app đã phát hành, gom về theo project.</p></div></div>${projectList}`;

  const project = projects.find(p => p.id === selectedId);
  const keys = detail?.keys || [];
  const reports = detail?.reports || [];

  const keysCard = `<div class="card cardpad" style="margin-bottom:20px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px"><h2 style="margin:0">Ingest key — ${esc(project?.name || selectedId)}</h2><button type="button" class="btn" data-action="feedback-create-key:${esc(selectedId)}">Tạo key mới</button></div><p class="footnote">Key nhúng vào source app phát hành công khai — ai đọc source cũng thấy được key này, đó là thiết kế chủ ý. Key chỉ làm được đúng 1 việc: gửi report mới vào đúng project này.</p>${
    keys.length === 0
      ? '<p class="footnote">Chưa có key nào.</p>'
      : `<table><thead><tr><th>Key ID</th><th>Tạo lúc</th><th>Dùng lần cuối</th><th>Trạng thái</th><th></th></tr></thead><tbody>${keys
          .map(
            k => `<tr>
              <td class="mono" style="font-size:11px">${esc(k.id.slice(0, 16))}…</td>
              <td>${fmt(k.created_at)}</td>
              <td>${fmt(k.last_used_at)}</td>
              <td>${k.revoked_at ? `<span class="badge gray">Đã thu hồi ${fmt(k.revoked_at)}</span>` : '<span class="badge">Hoạt động</span>'}</td>
              <td style="text-align:right">${k.revoked_at ? '' : `<button type="button" class="btn small danger" data-action="feedback-revoke-key:${esc(selectedId)}:${esc(k.id)}">Thu hồi</button>`}</td>
            </tr>`
          )
          .join('')}</tbody></table>`
  }</div>`;

  const reportsCard = `<div class="card cardpad"><h2 style="margin-top:0">Report gần đây</h2>${
    reports.length === 0
      ? '<p class="footnote">Chưa có report nào gửi về cho project này.</p>'
      : `<table><thead><tr><th>Thời gian</th><th>Nội dung</th></tr></thead><tbody>${reports
          .map(
            r => `<tr>
              <td class="mono" style="white-space:nowrap">${fmt(r.created_at)}</td>
              <td><pre class="json" style="margin:0;white-space:pre-wrap">${esc(previewPayload(r.payload))}</pre></td>
            </tr>`
          )
          .join('')}</tbody></table>`
  }</div>`;

  return `<div class="pagehead"><div><h1>Feedback Inbox</h1><p class="subtitle">Report từ các app đã phát hành, gom về theo project.</p></div><button class="btn" data-action="feedback-select:">← Danh sách project</button></div>${projectList}${keysCard}${reportsCard}`;
}
