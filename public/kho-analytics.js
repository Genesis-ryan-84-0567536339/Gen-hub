import { CHART_PALETTE, chartColor } from './audit-stats.js';

let echartsLoadingPromise = null;
let resizeListenerAttached = false;
let currentKhoMetadata = null;

export function ensureEchartsLoaded() {
  if (window.echarts) return Promise.resolve(window.echarts);
  if (echartsLoadingPromise) return echartsLoadingPromise;

  echartsLoadingPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/vendor/echarts.min.js';
    script.async = true;
    script.onload = () => resolve(window.echarts);
    script.onerror = () => reject(new Error('Không thể tải thư viện ECharts từ /vendor/echarts.min.js'));
    document.head.appendChild(script);
  });
  return echartsLoadingPromise;
}

export function isDarkTheme() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function getThemeTokens() {
  const dark = isDarkTheme();
  return {
    textColor: dark ? '#e2ebe5' : '#172922',
    mutedColor: dark ? '#899e91' : '#54655b',
    borderColor: dark ? '#2a3a32' : '#e5eae7',
    splitLineColor: dark ? '#22322a' : '#f0f4f1',
    cardBg: dark ? '#18241f' : '#ffffff',
    tooltipBg: dark ? '#111a16' : '#ffffff'
  };
}

export async function renderKhoAnalytics(containerEl, queryParams = {}) {
  containerEl.innerHTML = `
    <div style="padding: 40px 20px; text-align: center; color: var(--muted)">
      <div style="display:inline-block; width: 24px; height: 24px; border: 3px solid var(--line); border-top-color: var(--green); border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
      <p style="margin-top: 12px; font-size: 13px;">Đang tải và tổng hợp số liệu Kho Ryan…</p>
    </div>
    <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
  `;

  try {
    await ensureEchartsLoaded();

    const qs = new URLSearchParams();
    if (queryParams.tu) qs.set('tu', queryParams.tu);
    if (queryParams.den) qs.set('den', queryParams.den);
    if (queryParams.du_an) qs.set('du_an', queryParams.du_an);

    const res = await fetch(`/api/kho/analytics?${qs.toString()}`);
    const data = await res.json();

    if (!res.ok || data.error) {
      const errMsg = data.error || `HTTP ${res.status}`;
      renderError(containerEl, errMsg, queryParams);
      return;
    }

    currentKhoMetadata = data.metadata || {};
    renderDashboard(containerEl, data, queryParams);
  } catch (err) {
    renderError(containerEl, err.message, queryParams);
  }
}

function renderError(containerEl, message, queryParams) {
  containerEl.innerHTML = `
    <div class="pending dangerzone" style="background:#fff6f6; border:1px solid #ebc2c2; padding:20px; border-radius:8px; margin-bottom:24px;">
      <div style="display:flex; align-items:flex-start; gap:12px;">
        <span style="font-size:20px;">⚠️</span>
        <div>
          <b style="color:#a83232; font-size:14px;">Lỗi kết nối hoặc đồng bộ dữ liệu Kho Ryan</b>
          <p style="color:#6d3b3b; font-size:12px; margin-top:6px; line-height:1.6;">
            Hệ thống không thể tải số liệu phân tích từ Baserow. Không hiển thị số liệu 0 giả mạo (theo bài học BAI-3).
          </p>
          <p class="mono" style="color:#882222; font-size:12px; margin-top:8px; background:#faeded; padding:6px 10px; border-radius:4px;">
            ${escapeHtml(message)}
          </p>
          <div style="margin-top:14px; display:flex; gap:10px;">
            <button class="btn small primary" id="kho-analytics-retry">Thử lại</button>
            <button class="btn small" type="button" id="kho-analytics-switch-tab">Xem cấu hình Kho</button>
          </div>
        </div>
      </div>
    </div>
  `;

  containerEl.querySelector('#kho-analytics-retry')?.addEventListener('click', () => {
    renderKhoAnalytics(containerEl, queryParams);
  });

  containerEl.querySelector('#kho-analytics-switch-tab')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('switch-kho-subtab', { detail: 'config' }));
  });
}

function safeInitChart(el) {
  if (!el || !window.echarts) return null;
  const existing = window.echarts.getInstanceByDom(el);
  if (existing) {
    existing.dispose();
  }
  return window.echarts.init(el);
}

function openBaserowDrillDown(prefix) {
  const tableId = currentKhoMetadata?.table_ids?.[prefix];
  const baseUrl = currentKhoMetadata?.kho_url || 'https://kho.genos.top';
  if (tableId && baseUrl) {
    window.open(`${baseUrl.replace(/\/+$/, '')}/database/${tableId}/table/${tableId}`, '_blank', 'noopener,noreferrer');
  } else if (baseUrl) {
    window.open(baseUrl, '_blank', 'noopener,noreferrer');
  }
}

function renderDashboard(containerEl, data, currentQuery) {
  const { kpi, nhip_lam_viec, viec_theo_du_an, thoi_gian_hoan_thanh_tb, hieu_suat_doi_ai, hoc_tap, lich_hoat_dong, quyet_dinh, metadata } = data;
  const tokens = getThemeTokens();
  const khoUrl = metadata?.kho_url || 'https://kho.genos.top';

  const daOptions = (viec_theo_du_an || [])
    .filter(d => d.id !== 0)
    .map(d => `<option value="${escapeHtml(d.name)}" ${currentQuery.du_an === d.name ? 'selected' : ''}>${escapeHtml(d.name)}</option>`)
    .join('');

  containerEl.innerHTML = `
    <!-- Thanh điều khiển và Bộ lọc -->
    <section class="card cardpad" style="margin-bottom:20px; padding:16px 20px;">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:14px;">
        <div style="display:flex; align-items:center; gap:10px;">
          <h3 style="margin:0; font-size:15px;">Bộ lọc thống kê</h3>
          ${metadata?.cache_hit ? '<span class="badge info" title="Dữ liệu lưu tạm 5 phút để tải tức thì">Bộ nhớ tạm (Cache)</span>' : '<span class="badge" style="background:#e8f4ec;color:#28754f">Dữ liệu mới</span>'}
        </div>
        <form id="kho-analytics-filter-form" style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
          <div style="display:flex; align-items:center; gap:6px;">
            <label style="font-size:12px; color:var(--muted)">Từ:</label>
            <input type="date" id="filter-tu" class="input" style="min-height:34px; padding:4px 8px; width:135px; font-size:12px;" value="${escapeHtml(currentQuery.tu || '')}">
          </div>
          <div style="display:flex; align-items:center; gap:6px;">
            <label style="font-size:12px; color:var(--muted)">Đến:</label>
            <input type="date" id="filter-den" class="input" style="min-height:34px; padding:4px 8px; width:135px; font-size:12px;" value="${escapeHtml(currentQuery.den || '')}">
          </div>
          <div style="display:flex; align-items:center; gap:6px;">
            <label style="font-size:12px; color:var(--muted)">Dự án:</label>
            <select id="filter-du-an" class="input filter" style="min-height:34px; padding:4px 8px; font-size:12px;">
              <option value="">-- Tất cả dự án --</option>
              ${daOptions}
            </select>
          </div>
          <button type="submit" class="btn small primary">Áp dụng</button>
          <button type="button" id="filter-reset" class="btn small">Đặt lại</button>
          <a class="btn small" href="${escapeHtml(khoUrl)}" target="_blank" rel="noopener noreferrer" title="Mở trực tiếp Baserow">Mở Baserow ↗</a>
        </form>
      </div>
    </section>

    <!-- Khối 1: Ô KPI (4 thẻ số lớn) -->
    <div class="stats" style="margin-bottom:20px;">
      <section class="card stat" style="cursor:pointer;" id="kpi-card-viec" title="Bấm để mở bảng Việc trong Baserow">
        <div class="statlabel"><span>Việc đang mở</span><span style="font-size:16px;">📋</span></div>
        <div class="statvalue">${kpi.viec_dang_mo}<small>đầu việc</small></div>
        <div class="statnote ${kpi.viec_dang_mo > 0 ? '' : 'positive'}">Trong tiến trình thực thi ↗</div>
      </section>
      <section class="card stat" style="cursor:pointer;" id="kpi-card-p1" title="Bấm để mở bảng Việc trong Baserow">
        <div class="statlabel"><span>Việc P1 cấp bách</span><span style="font-size:16px;">🔥</span></div>
        <div class="statvalue" style="color:#b84646;">${kpi.viec_p1}<small>ưu tiên P1</small></div>
        <div class="statnote">${kpi.viec_p1 > 0 ? 'Cần tập trung giải quyết ngay ↗' : 'Không có việc P1 nghẽn'}</div>
      </section>
      <section class="card stat" style="cursor:pointer;" id="kpi-card-xong" title="Bấm để mở bảng Việc trong Baserow">
        <div class="statlabel"><span>Xong trong tuần</span><span style="font-size:16px;">✅</span></div>
        <div class="statvalue" style="color:#28754f;">${kpi.xong_trong_tuan}<small>hoàn tất</small></div>
        <div class="statnote positive">7 ngày gần nhất ↗</div>
      </section>
      <section class="card stat" style="cursor:pointer;" id="kpi-card-baihoc" title="Bấm để mở bảng Bài học trong Baserow">
        <div class="statlabel"><span>Bài học mới trong tuần</span><span style="font-size:16px;">💡</span></div>
        <div class="statvalue" style="color:#467fba;">${kpi.bai_hoc_moi_trong_tuan}<small>bài học</small></div>
        <div class="statnote positive">Tích lũy từ thực tế ↗</div>
      </section>
    </div>

    <!-- Khối 2: 2 Biểu đồ (Nhịp làm việc & Việc theo Dự án) -->
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(min(100%, 360px), 1fr)); gap:20px; margin-bottom:20px;">
      <section class="card cardpad">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <div>
            <h3 style="margin:0; font-size:14px;">1. Nhịp làm việc theo tuần</h3>
            <p class="footnote" style="margin:2px 0 0 0;">Việc hoàn thành (cột) và Việc tạo mới (đường) · Bấm để drill-down ↗</p>
          </div>
        </div>
        <div id="chart-nhip-lam-viec" style="width:100%; height:280px; cursor:pointer;"></div>
      </section>

      <section class="card cardpad">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <div>
            <h3 style="margin:0; font-size:14px;">2. Việc theo Dự án × Trạng thái</h3>
            <p class="footnote" style="margin:2px 0 0 0;">Phân bố tiến độ công việc trên từng dự án · Bấm để drill-down ↗</p>
          </div>
        </div>
        <div id="chart-viec-du-an" style="width:100%; height:280px; cursor:pointer;"></div>
      </section>
    </div>

    <!-- Khối 3: 2 Biểu đồ (Thời gian hoàn thành TB & Hiệu suất AI) -->
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(min(100%, 360px), 1fr)); gap:20px; margin-bottom:20px;">
      <section class="card cardpad">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <div>
            <h3 style="margin:0; font-size:14px;">3. Thời gian hoàn thành TB (ngày)</h3>
            <p class="footnote" style="margin:2px 0 0 0;">Số ngày trung bình từ tạo đến xong theo Dự án · Bấm để drill-down ↗</p>
          </div>
        </div>
        <div id="chart-thoi-gian-tb" style="width:100%; height:280px; cursor:pointer;"></div>
      </section>

      <section class="card cardpad">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <div>
            <h3 style="margin:0; font-size:14px;">4. Hiệu suất Đội AI & Vận hành</h3>
            <p class="footnote" style="margin:2px 0 0 0;">Việc xong theo người làm & Lượt gọi tool (Audit) · Bấm để drill-down ↗</p>
          </div>
        </div>
        <div id="chart-hieu-suat-ai" style="width:100%; height:280px; cursor:pointer;"></div>
      </section>
    </div>

    <!-- Khối 4: 2 Biểu đồ (Học tập & Lịch hoạt động Heatmap) -->
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(min(100%, 360px), 1fr)); gap:20px; margin-bottom:20px;">
      <section class="card cardpad">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; flex-wrap:wrap; gap:8px;">
          <div>
            <h3 style="margin:0; font-size:14px;">5. Học tập (Bài học kinh nghiệm)</h3>
            <p class="footnote" style="margin:2px 0 0 0;">3 chiều spec 4b: Chủ đề, Mức độ & Tích lũy · Bấm để drill-down ↗</p>
          </div>
          <div style="display:flex; gap:4px;" id="hoc-tap-view-toggle">
            <button type="button" class="btn small primary" data-mode="chude" style="padding:2px 8px; font-size:11px;">Chủ đề</button>
            <button type="button" class="btn small" data-mode="muc" style="padding:2px 8px; font-size:11px;">Mức</button>
            <button type="button" class="btn small" data-mode="tichluy" style="padding:2px 8px; font-size:11px;">Tích lũy</button>
          </div>
        </div>
        <div id="chart-hoc-tap" style="width:100%; height:280px; cursor:pointer;"></div>
      </section>

      <section class="card cardpad">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <div>
            <h3 style="margin:0; font-size:14px;">6. Lịch hoạt động (90 ngày gần nhất)</h3>
            <p class="footnote" style="margin:2px 0 0 0;">Phiên làm việc (+3) + Việc xong (+2) + Agent (+1) · Bấm để drill-down ↗</p>
          </div>
        </div>
        <div id="chart-heatmap" style="width:100%; height:280px; cursor:pointer;"></div>
      </section>
    </div>

    <!-- Khối 5: 1 Biểu đồ Quyết định (Độ ổn định định hướng) -->
    <section class="card cardpad" style="margin-bottom:20px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <div>
          <h3 style="margin:0; font-size:14px;">7. Quyết định theo tháng & Độ ổn định định hướng</h3>
          <p class="footnote" style="margin:2px 0 0 0;">Số quyết định ban hành so với số quyết định bị thay thế · Bấm để drill-down ↗</p>
        </div>
      </div>
      <div id="chart-quyet-dinh" style="width:100%; height:260px; cursor:pointer;"></div>
    </section>
  `;

  // Gắn sự kiện click mở Baserow trên KPI cards
  containerEl.querySelector('#kpi-card-viec')?.addEventListener('click', () => openBaserowDrillDown('VIEC'));
  containerEl.querySelector('#kpi-card-p1')?.addEventListener('click', () => openBaserowDrillDown('VIEC'));
  containerEl.querySelector('#kpi-card-xong')?.addEventListener('click', () => openBaserowDrillDown('VIEC'));
  containerEl.querySelector('#kpi-card-baihoc')?.addEventListener('click', () => openBaserowDrillDown('BAI'));

  // Gắn sự kiện submit form bộ lọc
  const form = containerEl.querySelector('#kho-analytics-filter-form');
  form?.addEventListener('submit', e => {
    e.preventDefault();
    const tu = containerEl.querySelector('#filter-tu')?.value || '';
    const den = containerEl.querySelector('#filter-den')?.value || '';
    const du_an = containerEl.querySelector('#filter-du-an')?.value || '';
    const newQuery = { tu, den, du_an };
    window.dispatchEvent(new CustomEvent('update-kho-analytics-query', { detail: newQuery }));
    renderKhoAnalytics(containerEl, newQuery);
  });

  // Gắn sự kiện đặt lại
  containerEl.querySelector('#filter-reset')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('update-kho-analytics-query', { detail: {} }));
    renderKhoAnalytics(containerEl, {});
  });

  // Khởi tạo các biểu đồ ECharts
  initCharts(data, tokens, containerEl);
}

function initCharts(data, tokens, containerEl) {
  const { nhip_lam_viec, viec_theo_du_an, thoi_gian_hoan_thanh_tb, hieu_suat_doi_ai, hoc_tap, lich_hoat_dong, quyet_dinh } = data;

  // 1. Nhịp làm việc
  const elNhip = document.getElementById('chart-nhip-lam-viec');
  if (elNhip && window.echarts) {
    const chart = safeInitChart(elNhip);
    const labels = (nhip_lam_viec || []).map(x => x.label || x.key);
    const xongData = (nhip_lam_viec || []).map(x => x.xong);
    const taoData = (nhip_lam_viec || []).map(x => x.tao);

    chart?.setOption({
      tooltip: {
        trigger: 'axis',
        formatter: params => {
          let s = `<b>Tuần ${escapeHtml(params[0]?.name || '')}</b><br/>`;
          for (const p of params) {
            s += `${p.marker} ${escapeHtml(p.seriesName)}: <b>${p.value}</b><br/>`;
          }
          s += `<span style="font-size:11px;color:#899e91">Bấm để mở bảng Việc trong Baserow ↗</span>`;
          return s;
        }
      },
      legend: { data: ['Việc xong', 'Việc tạo mới'], textStyle: { color: tokens.textColor } },
      grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
      xAxis: {
        type: 'category',
        data: labels,
        axisLine: { lineStyle: { color: tokens.borderColor } },
        axisLabel: { color: tokens.mutedColor, fontSize: 11 }
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
        axisLabel: { color: tokens.mutedColor },
        splitLine: { lineStyle: { color: tokens.splitLineColor } }
      },
      series: [
        {
          name: 'Việc xong',
          type: 'bar',
          data: xongData,
          itemStyle: { color: '#28754f', borderRadius: [4, 4, 0, 0] },
          barMaxWidth: 30
        },
        {
          name: 'Việc tạo mới',
          type: 'line',
          data: taoData,
          itemStyle: { color: '#467fba' },
          lineStyle: { width: 2.5 },
          smooth: true
        }
      ]
    });
    chart?.on('click', () => openBaserowDrillDown('VIEC'));
  }

  // 2. Việc theo Dự án x Trạng thái (Stacked Bar)
  const elViecDa = document.getElementById('chart-viec-du-an');
  if (elViecDa && window.echarts) {
    const chart = safeInitChart(elViecDa);
    const daNames = (viec_theo_du_an || []).map(d => d.name);
    const choData = (viec_theo_du_an || []).map(d => d.cho);
    const dangLamData = (viec_theo_du_an || []).map(d => d.dang_lam);
    const choDuyetData = (viec_theo_du_an || []).map(d => d.cho_duyet);
    const xongData = (viec_theo_du_an || []).map(d => d.xong);

    chart?.setOption({
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: params => {
          let s = `<b>${escapeHtml(params[0]?.name || '')}</b><br/>`;
          let total = 0;
          for (const p of params) {
            total += Number(p.value || 0);
            s += `${p.marker} ${escapeHtml(p.seriesName)}: <b>${p.value}</b><br/>`;
          }
          s += `Tổng cộng: <b>${total}</b> đầu việc<br/>`;
          s += `<span style="font-size:11px;color:#899e91">Bấm để mở bảng Việc trong Baserow ↗</span>`;
          return s;
        }
      },
      legend: { data: ['Chờ', 'Đang làm', 'Chờ duyệt', 'Xong'], textStyle: { color: tokens.textColor } },
      grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
      xAxis: {
        type: 'category',
        data: daNames,
        axisLine: { lineStyle: { color: tokens.borderColor } },
        axisLabel: { color: tokens.mutedColor, interval: 0, rotate: daNames.length > 5 ? 25 : 0 }
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
        axisLabel: { color: tokens.mutedColor },
        splitLine: { lineStyle: { color: tokens.splitLineColor } }
      },
      series: [
        { name: 'Chờ', type: 'bar', stack: 'total', data: choData, itemStyle: { color: '#b87324' } },
        { name: 'Đang làm', type: 'bar', stack: 'total', data: dangLamData, itemStyle: { color: '#467fba' } },
        { name: 'Chờ duyệt', type: 'bar', stack: 'total', data: choDuyetData, itemStyle: { color: '#9164b0' } },
        { name: 'Xong', type: 'bar', stack: 'total', data: xongData, itemStyle: { color: '#28754f' } }
      ]
    });
    chart?.on('click', () => openBaserowDrillDown('VIEC'));
  }

  // 3. Thời gian hoàn thành TB (ngày)
  const elThoiGian = document.getElementById('chart-thoi-gian-tb');
  if (elThoiGian && window.echarts) {
    const chart = safeInitChart(elThoiGian);
    const daNames = (thoi_gian_hoan_thanh_tb || []).map(d => d.du_an_name);
    const daysData = (thoi_gian_hoan_thanh_tb || []).map(d => (d.so_ngay_tb !== null ? d.so_ngay_tb : null));

    chart?.setOption({
      tooltip: {
        trigger: 'axis',
        formatter: params => {
          const p = params[0];
          const valStr = p.value !== null && p.value !== undefined ? `<b>${p.value} ngày</b>` : '<i>Chưa có việc hoàn thành đủ ngày</i>';
          return `<b>${escapeHtml(p.name)}</b><br/>Thời gian TB: ${valStr}<br/><span style="font-size:11px;color:#899e91">Bấm để mở bảng Việc trong Baserow ↗</span>`;
        }
      },
      grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
      xAxis: {
        type: 'category',
        data: daNames,
        axisLine: { lineStyle: { color: tokens.borderColor } },
        axisLabel: { color: tokens.mutedColor, interval: 0, rotate: daNames.length > 5 ? 25 : 0 }
      },
      yAxis: {
        type: 'value',
        name: 'Ngày',
        axisLabel: { color: tokens.mutedColor },
        splitLine: { lineStyle: { color: tokens.splitLineColor } }
      },
      series: [
        {
          type: 'bar',
          data: daysData,
          itemStyle: { color: '#27878b', borderRadius: [4, 4, 0, 0] },
          barMaxWidth: 35,
          label: {
            show: true,
            position: 'top',
            formatter: p => (p.value !== null && p.value !== undefined ? `${p.value}d` : '—'),
            color: tokens.mutedColor
          }
        }
      ]
    });
    chart?.on('click', () => openBaserowDrillDown('VIEC'));
  }

  // 4. Hiệu suất Đội AI (Việc xong & Audit calls)
  const elHieuSuat = document.getElementById('chart-hieu-suat-ai');
  if (elHieuSuat && window.echarts) {
    const chart = safeInitChart(elHieuSuat);
    const viecXong = hieu_suat_doi_ai?.viec_xong || [];
    const auditData = hieu_suat_doi_ai?.audit || [];

    // Hợp nhất danh sách tên tác nhân
    const allActorsSet = new Set();
    viecXong.forEach(x => allActorsSet.add(x.name));
    auditData.forEach(x => allActorsSet.add(x.agent));
    const allActors = Array.from(allActorsSet);

    const viecCounts = allActors.map(name => {
      const found = viecXong.find(x => x.name === name);
      return found ? found.count : 0;
    });

    const auditCounts = allActors.map(name => {
      const found = auditData.find(x => x.agent === name);
      return found ? found.count : 0;
    });

    chart?.setOption({
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: params => {
          let s = `<b>${escapeHtml(params[0]?.name || '')}</b><br/>`;
          for (const p of params) {
            s += `${p.marker} ${escapeHtml(p.seriesName)}: <b>${p.value}</b><br/>`;
          }
          s += `<span style="font-size:11px;color:#899e91">Bấm để mở bảng Việc trong Baserow ↗</span>`;
          return s;
        }
      },
      legend: { data: ['Việc hoàn thành', 'Lượt gọi tool (Audit)'], textStyle: { color: tokens.textColor } },
      grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
      xAxis: {
        type: 'value',
        minInterval: 1,
        axisLabel: { color: tokens.mutedColor },
        splitLine: { lineStyle: { color: tokens.splitLineColor } }
      },
      yAxis: {
        type: 'category',
        data: allActors,
        axisLine: { lineStyle: { color: tokens.borderColor } },
        axisLabel: { color: tokens.mutedColor }
      },
      series: [
        {
          name: 'Việc hoàn thành',
          type: 'bar',
          data: viecCounts,
          itemStyle: { color: '#28754f', borderRadius: [0, 4, 4, 0] },
          barMaxWidth: 20
        },
        {
          name: 'Lượt gọi tool (Audit)',
          type: 'bar',
          data: auditCounts,
          itemStyle: { color: '#467fba', borderRadius: [0, 4, 4, 0] },
          barMaxWidth: 20
        }
      ]
    });
    chart?.on('click', () => openBaserowDrillDown('VIEC'));
  }

  // 5. Học tập (Bài học kinh nghiệm - 3 chế độ: Chủ đề, Mức, Tích lũy)
  const elHocTap = document.getElementById('chart-hoc-tap');
  if (elHocTap && window.echarts) {
    const chart = safeInitChart(elHocTap);
    const chuDeData = hoc_tap?.theo_chu_de || [];
    const mucData = hoc_tap?.theo_muc || [];
    const tichLuyData = hoc_tap?.tich_luy || [];

    function setHocTapMode(mode) {
      if (mode === 'chude') {
        chart?.setOption({
          tooltip: {
            trigger: 'item',
            formatter: p => `${escapeHtml(p.name)}: <b>${p.value}</b> (${p.percent}%)<br/><span style="font-size:11px;color:#899e91">Bấm để mở bảng Bài học ↗</span>`
          },
          legend: { orient: 'vertical', left: 'left', textStyle: { color: tokens.mutedColor, fontSize: 11 } },
          xAxis: { show: false },
          yAxis: { show: false },
          series: [
            {
              name: 'Chủ đề',
              type: 'pie',
              radius: ['45%', '72%'],
              center: ['65%', '50%'],
              avoidLabelOverlap: false,
              itemStyle: { borderRadius: 6, borderColor: tokens.cardBg, borderWidth: 2 },
              label: { show: false },
              data: chuDeData.map((x, i) => ({
                name: x.name,
                value: x.value,
                itemStyle: { color: chartColor(i) }
              }))
            }
          ]
        }, true);
      } else if (mode === 'muc') {
        chart?.setOption({
          tooltip: {
            trigger: 'item',
            formatter: p => `Mức <b>${escapeHtml(p.name)}</b>: <b>${p.value}</b> bài học (${p.percent}%)<br/><span style="font-size:11px;color:#899e91">Bấm để mở bảng Bài học ↗</span>`
          },
          legend: { orient: 'vertical', left: 'left', textStyle: { color: tokens.mutedColor, fontSize: 11 } },
          xAxis: { show: false },
          yAxis: { show: false },
          series: [
            {
              name: 'Mức độ',
              type: 'pie',
              radius: ['45%', '72%'],
              center: ['65%', '50%'],
              itemStyle: { borderRadius: 6, borderColor: tokens.cardBg, borderWidth: 2 },
              label: { show: false },
              data: mucData.map((x, i) => ({
                name: x.name,
                value: x.value,
                itemStyle: {
                  color: x.name === 'Thành thạo' ? '#28754f' : x.name === 'Đã hiểu' ? '#467fba' : '#b87324'
                }
              }))
            }
          ]
        }, true);
      } else if (mode === 'tichluy') {
        const dates = tichLuyData.map(x => x.moc || x.date);
        const counts = tichLuyData.map(x => x.count);
        chart?.setOption({
          tooltip: {
            trigger: 'axis',
            formatter: params => {
              const p = params[0];
              return `Mốc <b>${escapeHtml(p.name)}</b><br/>Tích lũy: <b>${p.value} bài học</b><br/><span style="font-size:11px;color:#899e91">Bấm để mở bảng Bài học ↗</span>`;
            }
          },
          legend: { show: false },
          grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
          xAxis: {
            show: true,
            type: 'category',
            data: dates,
            axisLine: { lineStyle: { color: tokens.borderColor } },
            axisLabel: { color: tokens.mutedColor, fontSize: 11 }
          },
          yAxis: {
            show: true,
            type: 'value',
            minInterval: 1,
            axisLabel: { color: tokens.mutedColor },
            splitLine: { lineStyle: { color: tokens.splitLineColor } }
          },
          series: [
            {
              name: 'Bài học tích lũy',
              type: 'line',
              data: counts,
              itemStyle: { color: '#28754f' },
              lineStyle: { width: 3 },
              areaStyle: {
                color: new window.echarts.graphic.LinearGradient(0, 0, 0, 1, [
                  { offset: 0, color: 'rgba(40, 117, 79, 0.35)' },
                  { offset: 1, color: 'rgba(40, 117, 79, 0.02)' }
                ])
              },
              smooth: true
            }
          ]
        }, true);
      }
    }

    setHocTapMode('chude');
    chart?.on('click', () => openBaserowDrillDown('BAI'));

    const toggleBtns = containerEl.querySelectorAll('#hoc-tap-view-toggle button');
    toggleBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        toggleBtns.forEach(b => b.classList.remove('primary'));
        btn.classList.add('primary');
        const mode = btn.dataset.mode || 'chude';
        setHocTapMode(mode);
      });
    });
  }

  // 6. Lịch hoạt động Heatmap
  const elHeatmap = document.getElementById('chart-heatmap');
  if (elHeatmap && window.echarts) {
    const chart = safeInitChart(elHeatmap);
    const seriesData = lich_hoat_dong || [];
    const dates = seriesData.map(d => d[0]);
    const minDate = dates[0] || '2026-06-01';
    const maxDate = dates[dates.length - 1] || '2026-09-28';

    chart?.setOption({
      tooltip: {
        formatter: p => `${escapeHtml(p.value[0])}<br/>Điểm hoạt động: <b>${p.value[1]}</b><br/><span style="font-size:11px;color:#899e91">Bấm để mở bảng Phiên ↗</span>`
      },
      visualMap: {
        min: 0,
        max: 12,
        calculable: false,
        orient: 'horizontal',
        left: 'center',
        bottom: 5,
        inRange: { color: ['#eaf3ed', '#a8d5b5', '#489f6d', '#28754f', '#14462d'] },
        textStyle: { color: tokens.mutedColor }
      },
      calendar: {
        top: 25,
        left: 30,
        right: 20,
        cellSize: ['auto', 14],
        range: [minDate, maxDate],
        itemStyle: { borderWidth: 1.5, borderColor: tokens.cardBg },
        yearLabel: { show: false },
        dayLabel: { color: tokens.mutedColor, nameMap: 'vi' },
        monthLabel: { color: tokens.mutedColor, nameMap: 'vi' }
      },
      series: [
        {
          type: 'heatmap',
          coordinateSystem: 'calendar',
          data: seriesData
        }
      ]
    });
    chart?.on('click', () => openBaserowDrillDown('PHIEN'));
  }

  // 7. Quyết định theo tháng & Độ ổn định định hướng
  const elQuyetDinh = document.getElementById('chart-quyet-dinh');
  if (elQuyetDinh && window.echarts) {
    const chart = safeInitChart(elQuyetDinh);
    const thangList = (quyet_dinh || []).map(q => q.thang);
    const hieuLucList = (quyet_dinh || []).map(q => q.hieu_luc);
    const thayTheList = (quyet_dinh || []).map(q => q.thay_the);
    const onDinhList = (quyet_dinh || []).map(q => q.ty_le_on_dinh);

    chart?.setOption({
      tooltip: {
        trigger: 'axis',
        formatter: params => {
          let s = `<b>Tháng: ${escapeHtml(params[0]?.name || '')}</b><br/>`;
          for (const p of params) {
            s += `${p.marker} ${escapeHtml(p.seriesName)}: <b>${p.value}${p.seriesName.includes('%') ? '%' : ''}</b><br/>`;
          }
          s += `<span style="font-size:11px;color:#899e91">Bấm để mở bảng Quyết định trong Baserow ↗</span>`;
          return s;
        }
      },
      legend: { data: ['Hiệu lực', 'Bị thay thế', 'Độ ổn định (%)'], textStyle: { color: tokens.textColor } },
      grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
      xAxis: {
        type: 'category',
        data: thangList,
        axisLine: { lineStyle: { color: tokens.borderColor } },
        axisLabel: { color: tokens.mutedColor }
      },
      yAxis: [
        {
          type: 'value',
          name: 'Số quyết định',
          minInterval: 1,
          axisLabel: { color: tokens.mutedColor },
          splitLine: { lineStyle: { color: tokens.splitLineColor } }
        },
        {
          type: 'value',
          name: 'Tỷ lệ %',
          min: 0,
          max: 100,
          axisLabel: { formatter: '{value}%', color: tokens.mutedColor },
          splitLine: { show: false }
        }
      ],
      series: [
        { name: 'Hiệu lực', type: 'bar', data: hieuLucList, itemStyle: { color: '#28754f' }, barMaxWidth: 30 },
        { name: 'Bị thay thế', type: 'bar', data: thayTheList, itemStyle: { color: '#bd5266' }, barMaxWidth: 30 },
        { name: 'Độ ổn định (%)', type: 'line', yAxisIndex: 1, data: onDinhList, itemStyle: { color: '#b87324' }, smooth: true }
      ]
    });
    chart?.on('click', () => openBaserowDrillDown('QD'));
  }

  // Quản lý resize một lần duy nhất
  if (!resizeListenerAttached) {
    resizeListenerAttached = true;
    window.addEventListener('resize', () => {
      const ids = [
        'chart-nhip-lam-viec',
        'chart-viec-du-an',
        'chart-thoi-gian-tb',
        'chart-hieu-suat-ai',
        'chart-hoc-tap',
        'chart-heatmap',
        'chart-quyet-dinh'
      ];
      ids.forEach(id => {
        const el = document.getElementById(id);
        if (el && window.echarts) {
          const inst = window.echarts.getInstanceByDom(el);
          inst?.resize();
        }
      });
    });
  }
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
