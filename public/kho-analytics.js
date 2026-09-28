import { CHART_PALETTE, chartColor } from './audit-stats.js';

let echartsLoadingPromise = null;

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
            <a class="btn small" href="#kho" id="kho-analytics-switch-tab">Xem cấu hình Kho</a>
          </div>
        </div>
      </div>
    </div>
  `;

  containerEl.querySelector('#kho-analytics-retry')?.addEventListener('click', () => {
    renderKhoAnalytics(containerEl, queryParams);
  });
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
            <input type="date" id="filter-tu" class="input" style="min-height:34px; padding:4px 8px; width:135px; font-size:12px;" value="${currentQuery.tu || ''}">
          </div>
          <div style="display:flex; align-items:center; gap:6px;">
            <label style="font-size:12px; color:var(--muted)">Đến:</label>
            <input type="date" id="filter-den" class="input" style="min-height:34px; padding:4px 8px; width:135px; font-size:12px;" value="${currentQuery.den || ''}">
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
      <section class="card stat">
        <div class="statlabel"><span>Việc đang mở</span><span style="font-size:16px;">📋</span></div>
        <div class="statvalue">${kpi.viec_dang_mo}<small>đầu việc</small></div>
        <div class="statnote ${kpi.viec_dang_mo > 0 ? '' : 'positive'}">Trong tiến trình thực thi</div>
      </section>
      <section class="card stat">
        <div class="statlabel"><span>Việc P1 cấp bách</span><span style="font-size:16px;">🔥</span></div>
        <div class="statvalue" style="color:#b84646;">${kpi.viec_p1}<small>ưu tiên P1</small></div>
        <div class="statnote">${kpi.viec_p1 > 0 ? 'Cần tập trung giải quyết ngay' : 'Không có việc P1 nghẽn'}</div>
      </section>
      <section class="card stat">
        <div class="statlabel"><span>Xong trong tuần</span><span style="font-size:16px;">✅</span></div>
        <div class="statvalue" style="color:#28754f;">${kpi.xong_trong_tuan}<small>hoàn tất</small></div>
        <div class="statnote positive">7 ngày gần nhất</div>
      </section>
      <section class="card stat">
        <div class="statlabel"><span>Bài học mới trong tuần</span><span style="font-size:16px;">💡</span></div>
        <div class="statvalue" style="color:#467fba;">${kpi.bai_hoc_moi_trong_tuan}<small>bài học</small></div>
        <div class="statnote positive">Tích lũy từ thực tế</div>
      </section>
    </div>

    <!-- Khối 2: 2 Biểu đồ (Nhịp làm việc & Việc theo Dự án) -->
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(min(100%, 360px), 1fr)); gap:20px; margin-bottom:20px;">
      <section class="card cardpad">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <div>
            <h3 style="margin:0; font-size:14px;">1. Nhịp làm việc theo tuần</h3>
            <p class="footnote" style="margin:2px 0 0 0;">Việc hoàn thành (cột) và Việc tạo mới (đường)</p>
          </div>
        </div>
        <div id="chart-nhip-lam-viec" style="width:100%; height:280px;"></div>
      </section>

      <section class="card cardpad">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <div>
            <h3 style="margin:0; font-size:14px;">2. Việc theo Dự án × Trạng thái</h3>
            <p class="footnote" style="margin:2px 0 0 0;">Phân bố tiến độ công việc trên từng dự án</p>
          </div>
        </div>
        <div id="chart-viec-du-an" style="width:100%; height:280px;"></div>
      </section>
    </div>

    <!-- Khối 3: 2 Biểu đồ (Thời gian hoàn thành TB & Hiệu suất AI) -->
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(min(100%, 360px), 1fr)); gap:20px; margin-bottom:20px;">
      <section class="card cardpad">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <div>
            <h3 style="margin:0; font-size:14px;">3. Thời gian hoàn thành TB (ngày)</h3>
            <p class="footnote" style="margin:2px 0 0 0;">Số ngày trung bình từ tạo đến xong theo Dự án</p>
          </div>
        </div>
        <div id="chart-thoi-gian-tb" style="width:100%; height:280px;"></div>
      </section>

      <section class="card cardpad">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <div>
            <h3 style="margin:0; font-size:14px;">4. Hiệu suất Đội AI & Vận hành</h3>
            <p class="footnote" style="margin:2px 0 0 0;">Việc xong theo người làm & Lượt gọi tool (Audit)</p>
          </div>
        </div>
        <div id="chart-hieu-suat-ai" style="width:100%; height:280px;"></div>
      </section>
    </div>

    <!-- Khối 4: 2 Biểu đồ (Học tập & Lịch hoạt động Heatmap) -->
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(min(100%, 360px), 1fr)); gap:20px; margin-bottom:20px;">
      <section class="card cardpad">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <div>
            <h3 style="margin:0; font-size:14px;">5. Học tập (Bài học kinh nghiệm)</h3>
            <p class="footnote" style="margin:2px 0 0 0;">Phân loại theo Chủ đề và Mức độ thấu hiểu</p>
          </div>
        </div>
        <div id="chart-hoc-tap" style="width:100%; height:280px;"></div>
      </section>

      <section class="card cardpad">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <div>
            <h3 style="margin:0; font-size:14px;">6. Lịch hoạt động (90 ngày gần nhất)</h3>
            <p class="footnote" style="margin:2px 0 0 0;">Nhịp độ tương tác: Phiên làm việc + Việc xong + Lượt gọi Agent</p>
          </div>
        </div>
        <div id="chart-heatmap" style="width:100%; height:280px;"></div>
      </section>
    </div>

    <!-- Khối 5: 1 Biểu đồ Quyết định (Độ ổn định định hướng) -->
    <section class="card cardpad" style="margin-bottom:20px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <div>
          <h3 style="margin:0; font-size:14px;">7. Quyết định theo tháng & Độ ổn định định hướng</h3>
          <p class="footnote" style="margin:2px 0 0 0;">Số quyết định ban hành so với số quyết định bị thay thế</p>
        </div>
      </div>
      <div id="chart-quyet-dinh" style="width:100%; height:260px;"></div>
    </section>
  `;

  // Gắn sự kiện submit form bộ lọc
  const form = containerEl.querySelector('#kho-analytics-filter-form');
  form?.addEventListener('submit', e => {
    e.preventDefault();
    const tu = containerEl.querySelector('#filter-tu')?.value || '';
    const den = containerEl.querySelector('#filter-den')?.value || '';
    const du_an = containerEl.querySelector('#filter-du-an')?.value || '';
    renderKhoAnalytics(containerEl, { tu, den, du_an });
  });

  // Gắn sự kiện đặt lại
  containerEl.querySelector('#filter-reset')?.addEventListener('click', () => {
    renderKhoAnalytics(containerEl, {});
  });

  // Khởi tạo các biểu đồ ECharts
  initCharts(data, tokens);
}

function initCharts(data, tokens) {
  const { nhip_lam_viec, viec_theo_du_an, thoi_gian_hoan_thanh_tb, hieu_suat_doi_ai, hoc_tap, lich_hoat_dong, quyet_dinh } = data;

  // 1. Nhịp làm việc
  const elNhip = document.getElementById('chart-nhip-lam-viec');
  if (elNhip && window.echarts) {
    const chart = window.echarts.init(elNhip);
    const labels = (nhip_lam_viec || []).map(x => x.label || x.key);
    const xongData = (nhip_lam_viec || []).map(x => x.xong);
    const taoData = (nhip_lam_viec || []).map(x => x.tao);

    chart.setOption({
      tooltip: { trigger: 'axis' },
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
  }

  // 2. Việc theo Dự án x Trạng thái (Stacked Bar)
  const elViecDa = document.getElementById('chart-viec-du-an');
  if (elViecDa && window.echarts) {
    const chart = window.echarts.init(elViecDa);
    const daNames = (viec_theo_du_an || []).map(d => d.name);
    const choData = (viec_theo_du_an || []).map(d => d.cho);
    const dangLamData = (viec_theo_du_an || []).map(d => d.dang_lam);
    const choDuyetData = (viec_theo_du_an || []).map(d => d.cho_duyet);
    const xongData = (viec_theo_du_an || []).map(d => d.xong);

    chart.setOption({
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
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
  }

  // 3. Thời gian hoàn thành TB (ngày)
  const elThoiGian = document.getElementById('chart-thoi-gian-tb');
  if (elThoiGian && window.echarts) {
    const chart = window.echarts.init(elThoiGian);
    const daNames = (thoi_gian_hoan_thanh_tb || []).map(d => d.du_an_name);
    const daysData = (thoi_gian_hoan_thanh_tb || []).map(d => d.so_ngay_tb);

    chart.setOption({
      tooltip: {
        trigger: 'axis',
        formatter: params => {
          const p = params[0];
          return `<b>${p.name}</b><br/>Thời gian TB: <b>${p.value} ngày</b>`;
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
          label: { show: true, position: 'top', formatter: '{c}d', color: tokens.mutedColor }
        }
      ]
    });
  }

  // 4. Hiệu suất Đội AI (Việc xong & Audit calls)
  const elHieuSuat = document.getElementById('chart-hieu-suat-ai');
  if (elHieuSuat && window.echarts) {
    const chart = window.echarts.init(elHieuSuat);
    const viecXong = hieu_suat_doi_ai?.viec_xong || [];
    const names = viecXong.map(x => x.name);
    const counts = viecXong.map(x => x.count);

    chart.setOption({
      tooltip: { trigger: 'axis' },
      grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
      xAxis: {
        type: 'value',
        minInterval: 1,
        axisLabel: { color: tokens.mutedColor },
        splitLine: { lineStyle: { color: tokens.splitLineColor } }
      },
      yAxis: {
        type: 'category',
        data: names,
        axisLine: { lineStyle: { color: tokens.borderColor } },
        axisLabel: { color: tokens.mutedColor }
      },
      series: [
        {
          name: 'Việc hoàn thành',
          type: 'bar',
          data: counts,
          itemStyle: { color: '#28754f', borderRadius: [0, 4, 4, 0] },
          barMaxWidth: 24,
          label: { show: true, position: 'right', color: tokens.mutedColor }
        }
      ]
    });
  }

  // 5. Học tập (Bài học kinh nghiệm)
  const elHocTap = document.getElementById('chart-hoc-tap');
  if (elHocTap && window.echarts) {
    const chart = window.echarts.init(elHocTap);
    const chuDeData = hoc_tap?.theo_chu_de || [];

    chart.setOption({
      tooltip: { trigger: 'item', formatter: '{b}: <b>{c}</b> ({d}%)' },
      legend: { orient: 'vertical', left: 'left', textStyle: { color: tokens.mutedColor, fontSize: 11 } },
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
    });
  }

  // 6. Lịch hoạt động Heatmap
  const elHeatmap = document.getElementById('chart-heatmap');
  if (elHeatmap && window.echarts) {
    const chart = window.echarts.init(elHeatmap);
    const seriesData = lich_hoat_dong || [];
    const dates = seriesData.map(d => d[0]);
    const minDate = dates[0] || '2026-06-01';
    const maxDate = dates[dates.length - 1] || '2026-09-28';

    chart.setOption({
      tooltip: {
        formatter: p => `${p.value[0]}<br/>Điểm hoạt động: <b>${p.value[1]}</b>`
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
  }

  // 7. Quyết định theo tháng & Độ ổn định định hướng
  const elQuyetDinh = document.getElementById('chart-quyet-dinh');
  if (elQuyetDinh && window.echarts) {
    const chart = window.echarts.init(elQuyetDinh);
    const thangList = (quyet_dinh || []).map(q => q.thang);
    const hieuLucList = (quyet_dinh || []).map(q => q.hieu_luc);
    const thayTheList = (quyet_dinh || []).map(q => q.thay_the);
    const onDinhList = (quyet_dinh || []).map(q => q.ty_le_on_dinh);

    chart.setOption({
      tooltip: { trigger: 'axis' },
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
  }

  // Tự động resize biểu đồ khi thay đổi kích thước cửa sổ
  window.addEventListener('resize', () => {
    [elNhip, elViecDa, elThoiGian, elHieuSuat, elHocTap, elHeatmap, elQuyetDinh].forEach(el => {
      if (el && window.echarts) {
        const instance = window.echarts.getInstanceByDom(el);
        instance?.resize();
      }
    });
  });
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
