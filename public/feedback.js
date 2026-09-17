import { chartColor } from './audit-stats.js';

const esc = v =>
  String(v ?? '').replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

const CATEGORY_LABELS = {
  bug: 'Lỗi',
  feature_request: 'Yêu cầu tính năng',
  complaint: 'Phàn nàn',
  praise: 'Khen',
  other: 'Khác'
};
const SEVERITY_LABELS = { low: 'Thấp', medium: 'Trung bình', high: 'Cao', critical: 'Nghiêm trọng' };
const SEVERITY_BADGE = { low: 'gray', medium: '', high: 'warn', critical: 'red' };
const STATUS_LABELS = { open: 'Chưa xử lý', fixed: 'Đã fix', wontfix: 'Không làm' };
const STATUS_BADGE = { open: 'warn', fixed: '', wontfix: 'gray' };

function fmt(iso) {
  return iso ? new Date(iso).toLocaleString('vi-VN') : '—';
}

function previewPayload(payload) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {});
  return text.length > 400 ? text.slice(0, 400) + '…' : text;
}

// A horizontal bar list — same idea as the overview chart, sized to a small
// fixed set of categories rather than a time series, so plain divs with a
// computed width read more clearly here than the SVG donut/pie helpers.
function barList(entries, colorOffset = 0) {
  const max = Math.max(1, ...entries.map(e => e.count));
  return `<div style="display:flex;flex-direction:column;gap:9px">${entries
    .map((e, i) => {
      const pct = Math.round((e.count / max) * 100);
      return `<div style="display:flex;align-items:center;gap:10px">
        <span style="min-width:130px;font-size:12px;color:var(--muted)">${esc(e.label)}</span>
        <div style="flex:1;background:#eef1ee;border-radius:5px;height:16px;overflow:hidden">
          <div style="width:${pct}%;height:100%;background:${chartColor(i + colorOffset)};border-radius:5px"></div>
        </div>
        <strong style="min-width:28px;text-align:right;font-size:12px">${e.count}</strong>
      </div>`;
    })
    .join('')}</div>`;
}

function statsSection(groups) {
  if (groups.length === 0) return '';
  const byCategory = Object.entries(
    groups.reduce((acc, g) => ((acc[g.category] = (acc[g.category] || 0) + g.report_count), acc), {})
  ).map(([category, count]) => ({ label: CATEGORY_LABELS[category] || category, count }));
  const severityTotals = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const g of groups) for (const s of Object.keys(severityTotals)) severityTotals[s] += g.severity_counts?.[s] || 0;
  const bySeverity = Object.entries(severityTotals).map(([s, count]) => ({ label: SEVERITY_LABELS[s], count }));
  const statusTotals = { open: 0, fixed: 0, wontfix: 0 };
  for (const g of groups) statusTotals[g.engineer_status] = (statusTotals[g.engineer_status] || 0) + 1;
  const byStatus = Object.entries(statusTotals).map(([s, count]) => ({ label: STATUS_LABELS[s], count }));

  return `<div class="dashboardgrid" style="margin-bottom:20px">
    <div class="card cardpad"><h2 style="margin-top:0">Theo loại feedback</h2>${barList(byCategory, 0)}</div>
    <div class="card cardpad"><h2 style="margin-top:0">Theo mức độ nghiêm trọng</h2>${barList(bySeverity, 3)}</div>
    <div class="card cardpad"><h2 style="margin-top:0">Theo trạng thái xử lý (số nhóm)</h2>${barList(byStatus, 6)}</div>
  </div>`;
}

function groupsSection(projectId, groups) {
  return `<div class="card cardpad" style="margin-bottom:20px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <h2 style="margin:0">Nhóm feedback đã phân loại</h2>
      <button type="button" class="btn" data-action="feedback-classify-now:${esc(projectId)}">Tổng hợp ngay</button>
    </div>
    <p class="footnote">Tự động tổng hợp mỗi 24h từ report thô bằng AI (cần cấu hình model trong Cài đặt). Mỗi nhóm = 1 loại feedback trong project này.</p>
    ${
      groups.length === 0
        ? '<p class="footnote">Chưa có nhóm nào — bấm "Tổng hợp ngay" hoặc chờ chu kỳ tự động kế tiếp (cần đã cấu hình AI trong Cài đặt).</p>'
        : `<table><thead><tr><th>Loại</th><th>Số report</th><th>Mức độ</th><th>Gần nhất</th><th>Quan tâm</th><th>Xử lý</th><th>Ghi chú kỹ sư</th></tr></thead><tbody>${groups
            .map(g => {
              const worstSeverity = ['critical', 'high', 'medium', 'low'].find(s => g.severity_counts?.[s] > 0);
              return `<tr>
                <td><strong>${esc(CATEGORY_LABELS[g.category] || g.category)}</strong>${(g.example_summaries || [])[0] ? `<br><small class="footnote" style="margin:2px 0 0">${esc(g.example_summaries[0])}</small>` : ''}</td>
                <td>${g.report_count}</td>
                <td>${worstSeverity ? `<span class="badge ${SEVERITY_BADGE[worstSeverity]}">${esc(SEVERITY_LABELS[worstSeverity])}</span>` : '<span class="badge gray">—</span>'}</td>
                <td class="mono" style="white-space:nowrap">${fmt(g.latest_report_at)}</td>
                <td><button type="button" class="btn small ${g.owner_flagged ? 'primary' : ''}" data-action="feedback-toggle-flag:${esc(g.id)}:${g.owner_flagged ? '0' : '1'}">${g.owner_flagged ? '★ Đang quan tâm' : '☆ Đánh dấu'}</button></td>
                <td><span class="badge ${STATUS_BADGE[g.engineer_status]}">${esc(STATUS_LABELS[g.engineer_status] || g.engineer_status)}</span></td>
                <td style="max-width:220px;white-space:normal">${esc(g.engineer_notes) || '<span class="footnote">—</span>'}</td>
              </tr>`;
            })
            .join('')}</tbody></table>`
    }
  </div>`;
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
  const groups = detail?.groups || [];

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

  const reportsCard = `<div class="card cardpad"><h2 style="margin-top:0">Report gần đây (thô)</h2>${
    reports.length === 0
      ? '<p class="footnote">Chưa có report nào gửi về cho project này.</p>'
      : `<table><thead><tr><th>Thời gian</th><th>Loại</th><th>Mức độ</th><th>Tóm tắt / nội dung</th></tr></thead><tbody>${reports
          .map(
            r => `<tr>
              <td class="mono" style="white-space:nowrap">${fmt(r.created_at)}</td>
              <td>${r.category ? `<span class="badge gray">${esc(CATEGORY_LABELS[r.category] || r.category)}</span>` : '<span class="footnote">Chưa phân loại</span>'}</td>
              <td>${r.severity ? `<span class="badge ${SEVERITY_BADGE[r.severity]}">${esc(SEVERITY_LABELS[r.severity])}</span>` : ''}</td>
              <td>${r.summary ? `<strong>${esc(r.summary)}</strong><br>` : ''}<pre class="json" style="margin:6px 0 0;white-space:pre-wrap">${esc(previewPayload(r.payload))}</pre></td>
            </tr>`
          )
          .join('')}</tbody></table>`
  }</div>`;

  return `<div class="pagehead"><div><h1>Feedback Inbox</h1><p class="subtitle">Report từ các app đã phát hành, gom về theo project.</p></div><button class="btn" data-action="feedback-select:">← Danh sách project</button></div>${projectList}${statsSection(groups)}${groupsSection(selectedId, groups)}${keysCard}${reportsCard}`;
}
