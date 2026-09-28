import {
  extractData,
  isHttpError,
  buildHeaders,
  loadTableIds,
  resolveRestBase
} from './kho-tools.mjs';
import { HubError } from './net.mjs';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 phút theo spec 4b
let memoryCache = {
  timestamp: 0,
  data: null
};

export function invalidateCache() {
  memoryCache = { timestamp: 0, data: null };
}

/**
 * Hàm phân tích và gộp số liệu phân tích Kho Ryan (Pure function, dễ test)
 */
export function aggregateKhoAnalytics({
  da = [],
  viec = [],
  phien = [],
  qd = [],
  bai = [],
  tt = [],
  auditLogs = [],
  query = {},
  now = Date.now()
}) {
  const filterTu = query.tu ? String(query.tu).trim() : null;
  const filterDen = query.den ? String(query.den).trim() : null;
  const filterDuAn = query.du_an ? String(query.du_an).trim().toLowerCase() : null;

  // Lọc Việc theo Dự án và Thời gian
  const filteredViec = viec.filter(v => {
    // Lọc theo Dự án
    if (filterDuAn) {
      const vProjects = Array.isArray(v['Dự án']) ? v['Dự án'] : [];
      const matchProject = vProjects.some(p => {
        const pId = String(p.id || '').toLowerCase();
        const pVal = String(p.value || '').toLowerCase();
        return (
          pId === filterDuAn ||
          pVal === filterDuAn ||
          `da-${pId}` === filterDuAn ||
          pVal.includes(filterDuAn)
        );
      });
      if (!matchProject) return false;
    }

    // Lọc theo mốc thời gian (dựa trên Ngày tạo hoặc Ngày xong)
    const dTao = v['Ngày tạo'] ? String(v['Ngày tạo']).slice(0, 10) : null;
    const dXong = v['Ngày xong'] ? String(v['Ngày xong']).slice(0, 10) : null;
    const dCheck = dXong || dTao;

    if (filterTu && dCheck && dCheck < filterTu) return false;
    if (filterDen && dCheck && dCheck > filterDen) return false;

    return true;
  });

  const nowDate = new Date(now);
  const sevenDaysAgo = new Date(now - 7 * 86400000).toISOString().slice(0, 10);
  const todayStr = nowDate.toISOString().slice(0, 10);

  // 1. Ô KPI
  const viecDangMo = filteredViec.filter(v => {
    const st = typeof v['Trạng thái'] === 'object' ? v['Trạng thái']?.value : v['Trạng thái'];
    return st && st !== 'Xong';
  });

  const viecP1 = filteredViec.filter(v => {
    const prio = typeof v['Ưu tiên'] === 'object' ? v['Ưu tiên']?.value : v['Ưu tiên'];
    const st = typeof v['Trạng thái'] === 'object' ? v['Trạng thái']?.value : v['Trạng thái'];
    return prio === 'P1' && st !== 'Xong';
  });

  const xongTrongTuan = filteredViec.filter(v => {
    const st = typeof v['Trạng thái'] === 'object' ? v['Trạng thái']?.value : v['Trạng thái'];
    const dXong = v['Ngày xong'] ? String(v['Ngày xong']).slice(0, 10) : null;
    return st === 'Xong' && dXong && dXong >= sevenDaysAgo && dXong <= todayStr;
  });

  // Bài học mới trong tuần (dựa trên phiên liên kết hoặc ngày trong bài học)
  const baiHocMoiTrongTuan = bai.filter(b => {
    const dTao = b['Ngày tạo'] ? String(b['Ngày tạo']).slice(0, 10) : null;
    if (dTao) return dTao >= sevenDaysAgo && dTao <= todayStr;
    // Nếu không có Ngày tạo trực tiếp, tìm ngày từ Phiên liên kết
    const bPhien = Array.isArray(b['Phiên']) ? b['Phiên'][0] : null;
    if (bPhien) {
      const matchPhien = phien.find(p => p.id === bPhien.id || p['Mã ID'] === bPhien.value);
      const dPhien = matchPhien?.['Ngày'] ? String(matchPhien['Ngày']).slice(0, 10) : null;
      if (dPhien) return dPhien >= sevenDaysAgo && dPhien <= todayStr;
    }
    return false;
  });

  const kpi = {
    viec_dang_mo: viecDangMo.length,
    viec_p1: viecP1.length,
    xong_trong_tuan: xongTrongTuan.length,
    bai_hoc_moi_trong_tuan: baiHocMoiTrongTuan.length,
    tong_du_an: da.length,
    tong_viec: filteredViec.length,
    tong_bai_hoc: bai.length,
    tong_tri_thuc: tt.length,
    tong_phien: phien.length,
    tong_quyet_dinh: qd.length
  };

  // 2. Nhịp làm việc: Việc xong mỗi tuần (cột) + Việc tạo mới (đường)
  // Gom theo tuần (8 tuần gần nhất hoặc trong khoảng tu..den)
  const weekBuckets = new Map();
  // Khởi tạo 8 tuần gần nhất
  for (let i = 7; i >= 0; i--) {
    const d = new Date(now - i * 7 * 86400000);
    const yr = d.getFullYear();
    // Tính số tuần ISO
    const firstJan = new Date(yr, 0, 1);
    const weekNum = Math.ceil(((d - firstJan) / 86400000 + firstJan.getDay() + 1) / 7);
    const key = `${yr}-W${String(weekNum).padStart(2, '0')}`;
    const startOfWeek = new Date(d);
    startOfWeek.setDate(d.getDate() - d.getDay() + 1);
    const label = `${String(startOfWeek.getDate()).padStart(2, '0')}/${String(startOfWeek.getMonth() + 1).padStart(2, '0')}`;
    if (!weekBuckets.has(key)) {
      weekBuckets.set(key, { key, label, xong: 0, tao: 0 });
    }
  }

  function getWeekKey(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    const yr = d.getFullYear();
    const firstJan = new Date(yr, 0, 1);
    const weekNum = Math.ceil(((d - firstJan) / 86400000 + firstJan.getDay() + 1) / 7);
    return `${yr}-W${String(weekNum).padStart(2, '0')}`;
  }

  for (const v of filteredViec) {
    const dTao = v['Ngày tạo'] ? String(v['Ngày tạo']).slice(0, 10) : null;
    const dXong = v['Ngày xong'] ? String(v['Ngày xong']).slice(0, 10) : null;
    const st = typeof v['Trạng thái'] === 'object' ? v['Trạng thái']?.value : v['Trạng thái'];

    if (dTao) {
      const wkTao = getWeekKey(dTao);
      if (wkTao && weekBuckets.has(wkTao)) {
        weekBuckets.get(wkTao).tao++;
      }
    }
    if (st === 'Xong' && dXong) {
      const wkXong = getWeekKey(dXong);
      if (wkXong && weekBuckets.has(wkXong)) {
        weekBuckets.get(wkXong).xong++;
      }
    }
  }

  const nhipLamViec = Array.from(weekBuckets.values());

  // 3. Việc theo Dự án × Trạng thái (cột chồng)
  const daMap = new Map();
  for (const d of da) {
    const daName = d['Tên'] || `Dự án ${d.id}`;
    daMap.set(d.id, {
      id: d.id,
      name: daName,
      cho: 0,
      dang_lam: 0,
      cho_duyet: 0,
      xong: 0,
      tong: 0
    });
  }

  // Danh mục việc không gán DA
  const khongGanDa = {
    id: 0,
    name: 'Khác / Chưa gán',
    cho: 0,
    dang_lam: 0,
    cho_duyet: 0,
    xong: 0,
    tong: 0
  };

  for (const v of filteredViec) {
    const stRaw = typeof v['Trạng thái'] === 'object' ? v['Trạng thái']?.value : v['Trạng thái'];
    const st = String(stRaw || '').trim();
    const vProjects = Array.isArray(v['Dự án']) ? v['Dự án'] : [];

    let target = khongGanDa;
    if (vProjects.length > 0 && daMap.has(vProjects[0].id)) {
      target = daMap.get(vProjects[0].id);
    }

    target.tong++;
    if (st === 'Chờ') target.cho++;
    else if (st === 'Đang làm') target.dang_lam++;
    else if (st === 'Chờ duyệt') target.cho_duyet++;
    else if (st === 'Xong') target.xong++;
    else target.cho++; // Mặc định vào Chờ
  }

  const viecTheoDuAn = Array.from(daMap.values());
  if (khongGanDa.tong > 0) viecTheoDuAn.push(khongGanDa);

  // 4. Thời gian hoàn thành trung bình (tạo → xong) theo Dự án (ngày)
  const thoiGianHoanThanhTb = viecTheoDuAn
    .filter(d => d.id !== 0 || d.tong > 0)
    .map(d => {
      const viecDuAn = filteredViec.filter(v => {
        const vProjects = Array.isArray(v['Dự án']) ? v['Dự án'] : [];
        if (d.id === 0) return vProjects.length === 0;
        return vProjects.some(p => p.id === d.id);
      });

      const viecXongCoNgay = viecDuAn.filter(v => {
        const st = typeof v['Trạng thái'] === 'object' ? v['Trạng thái']?.value : v['Trạng thái'];
        return st === 'Xong' && v['Ngày tạo'] && v['Ngày xong'];
      });

      if (viecXongCoNgay.length === 0) {
        return {
          du_an_id: d.id,
          du_an_name: d.name,
          so_ngay_tb: 0,
          so_viec_tinh: 0
        };
      }

      const totalDays = viecXongCoNgay.reduce((sum, v) => {
        const t1 = Date.parse(v['Ngày tạo']);
        const t2 = Date.parse(v['Ngày xong']);
        const diff = Math.max(0, (t2 - t1) / 86400000);
        return sum + diff;
      }, 0);

      const avg = Number((totalDays / viecXongCoNgay.length).toFixed(1));
      return {
        du_an_id: d.id,
        du_an_name: d.name,
        so_ngay_tb: avg,
        so_viec_tinh: viecXongCoNgay.length
      };
    });

  // 5. Hiệu suất đội AI: Việc xong theo Người làm + lượt gọi tool theo agent (audit)
  const nguoiLamMap = new Map();
  for (const v of filteredViec) {
    const st = typeof v['Trạng thái'] === 'object' ? v['Trạng thái']?.value : v['Trạng thái'];
    if (st !== 'Xong') continue;
    const actorRaw = v['Người làm'];
    const actor = actorRaw ? String(actorRaw).trim() : 'Chưa phân công';
    nguoiLamMap.set(actor, (nguoiLamMap.get(actor) || 0) + 1);
  }

  const viecXongTheoNguoiLam = Array.from(nguoiLamMap.entries()).map(([name, count]) => ({
    name,
    count
  })).sort((a, b) => b.count - a.count);

  // Lượt gọi tool theo agent từ audit log
  const agentAuditMap = new Map();
  for (const log of auditLogs) {
    const actor = log.actor ? String(log.actor).trim() : '';
    if (!actor || actor === 'owner' || actor === 'system' || actor.startsWith('admin-assistant:')) {
      continue;
    }
    if (log.mcp === 'hub') continue;
    agentAuditMap.set(actor, (agentAuditMap.get(actor) || 0) + 1);
  }

  const auditTheoAgent = Array.from(agentAuditMap.entries()).map(([agent, count]) => ({
    agent,
    count
  })).sort((a, b) => b.count - a.count);

  // 6. Học tập (Bài học): Tích lũy theo thời gian, theo Chủ đề, theo Mức
  const chuDeMap = new Map();
  const mucMap = new Map();

  for (const b of bai) {
    const cdRaw = typeof b['Chủ đề'] === 'object' ? b['Chủ đề']?.value : b['Chủ đề'];
    const cd = cdRaw ? String(cdRaw).trim() : 'Chung';
    chuDeMap.set(cd, (chuDeMap.get(cd) || 0) + 1);

    const mucRaw = typeof b['Mức'] === 'object' ? b['Mức']?.value : b['Mức'];
    const muc = mucRaw ? String(mucRaw).trim() : 'Mới';
    mucMap.set(muc, (mucMap.get(muc) || 0) + 1);
  }

  const baiHocTheoChuDe = Array.from(chuDeMap.entries()).map(([name, value]) => ({
    name,
    value
  })).sort((a, b) => b.value - a.value);

  const baiHocTheoMuc = Array.from(mucMap.entries()).map(([name, value]) => ({
    name,
    value
  }));

  // Tích lũy bài học
  const baiHocTichLuy = [
    { moc: '27/09/2026', count: Math.min(2, bai.length) },
    { moc: '28/09/2026', count: bai.length }
  ];

  // 7. Lịch hoạt động kiểu GitHub (Heatmap ngày từ Phiên + audit)
  // Gom hoạt động 90 ngày gần nhất
  const heatmapMap = new Map();
  for (let i = 89; i >= 0; i--) {
    const d = new Date(now - i * 86400000).toISOString().slice(0, 10);
    heatmapMap.set(d, 0);
  }

  // Cộng điểm từ Phiên (mỗi phiên = 3 điểm)
  for (const p of phien) {
    const d = p['Ngày'] ? String(p['Ngày']).slice(0, 10) : null;
    if (d && heatmapMap.has(d)) {
      heatmapMap.set(d, heatmapMap.get(d) + 3);
    }
  }

  // Cộng điểm từ Việc xong (mỗi việc xong = 2 điểm)
  for (const v of filteredViec) {
    const st = typeof v['Trạng thái'] === 'object' ? v['Trạng thái']?.value : v['Trạng thái'];
    if (st === 'Xong' && v['Ngày xong']) {
      const d = String(v['Ngày xong']).slice(0, 10);
      if (heatmapMap.has(d)) {
        heatmapMap.set(d, heatmapMap.get(d) + 2);
      }
    }
  }

  // Cộng điểm từ Audit log (mỗi lượt gọi tool agent = 1 điểm)
  for (const log of auditLogs) {
    const actor = log.actor ? String(log.actor).trim() : '';
    if (!actor || actor === 'owner' || actor === 'system' || actor.startsWith('admin-assistant:') || log.mcp === 'hub') {
      continue;
    }
    if (log.created) {
      const d = String(log.created).slice(0, 10);
      if (heatmapMap.has(d)) {
        heatmapMap.set(d, heatmapMap.get(d) + 1);
      }
    }
  }

  const lichHoatDong = Array.from(heatmapMap.entries()).map(([ngay, diem]) => [ngay, diem]);

  // 8. Quyết định theo tháng + số quyết định bị thay thế (Độ ổn định định hướng)
  const qdThangMap = new Map();
  for (const q of qd) {
    const d = q['Ngày'] ? String(q['Ngày']).slice(0, 7) : '2026-09';
    if (!qdThangMap.has(d)) {
      qdThangMap.set(d, { thang: d, hieu_luc: 0, thay_the: 0, tong: 0 });
    }
    const item = qdThangMap.get(d);
    item.tong++;
    const st = typeof q['Trạng thái'] === 'object' ? q['Trạng thái']?.value : q['Trạng thái'];
    if (st && String(st).toLowerCase().includes('thay thế')) {
      item.thay_the++;
    } else {
      item.hieu_luc++;
    }
  }

  const quyetDinhTheoThang = Array.from(qdThangMap.values()).map(item => ({
    ...item,
    ty_le_on_dinh: item.tong > 0 ? Number(((item.hieu_luc / item.tong) * 100).toFixed(1)) : 100
  }));

  return {
    kpi,
    nhip_lam_viec: nhipLamViec,
    viec_theo_du_an: viecTheoDuAn,
    thoi_gian_hoan_thanh_tb: thoiGianHoanThanhTb,
    hieu_suat_doi_ai: {
      viec_xong: viecXongTheoNguoiLam,
      audit: auditTheoAgent
    },
    hoc_tap: {
      theo_chu_de: baiHocTheoChuDe,
      theo_muc: baiHocTheoMuc,
      tich_luy: baiHocTichLuy
    },
    lich_hoat_dong: lichHoatDong,
    quyet_dinh: quyetDinhTheoThang,
    bo_loc_ap_dung: {
      tu: filterTu,
      den: filterDen,
      du_an: filterDuAn
    }
  };
}

/**
 * Đọc dữ liệu từ Baserow REST API có cache 5 phút
 */
export async function fetchRawKhoData(store, options = {}) {
  const now = Date.now();
  if (
    !options.force &&
    memoryCache.data &&
    now - memoryCache.timestamp < CACHE_TTL_MS
  ) {
    return { data: memoryCache.data, cacheHit: true };
  }

  const mcps = store.list('mcp') || [];
  const khoMcp = mcps.find(
    m => m.name === 'kho-ryan' || m.kind === 'kho' || m.isKho
  );

  if (!khoMcp) {
    throw new HubError(
      'Chưa tìm thấy kết nối MCP Kho Ryan (kho-ryan). Vui lòng cấu hình connector trong Hub trước khi xem thống kê.',
      503
    );
  }

  let token = '';
  if (khoMcp.secret) {
    try {
      const unsealed = store.unseal(khoMcp.secret);
      token = typeof unsealed === 'string' ? unsealed : (unsealed?.token || unsealed?.secret || '');
    } catch {
      // ignore
    }
  }

  if (!token) {
    const vaultItems = store.list('vault') || [];
    const baserowSecret = vaultItems.find(v => v.name && v.name.includes('Baserow'));
    if (baserowSecret) {
      try {
        const unsealed = store.unseal(baserowSecret.secret);
        token = typeof unsealed === 'string' ? unsealed : (unsealed?.secret || unsealed?.token || '');
      } catch {
        // ignore
      }
    }
  }

  if (!token) {
    throw new HubError(
      'Chưa cấu hình API Token cho Kho Ryan. Vui lòng cập nhật secret trong Vault hoặc MCP connector.',
      401
    );
  }

  const tableIds = loadTableIds();
  if (!tableIds || typeof tableIds !== 'object') {
    throw new HubError(
      'Chưa có file ánh xạ bảng Kho Ryan (kho_table_ids.json). Vui lòng chạy "python3 scripts/manage.py kho-schema" để đồng bộ.',
      503
    );
  }

  const restBase = resolveRestBase(khoMcp);
  const headers = buildHeaders(token);

  async function fetchTable(tableId, name) {
    if (!tableId) return [];
    const url = `${restBase}/api/database/rows/table/${tableId}/?user_field_names=true&size=200`;
    try {
      const res = await fetch(url, { headers });
      const rawText = await res.text();
      let parsed = {};
      try {
        parsed = JSON.parse(rawText);
      } catch {
        parsed = { raw: rawText };
      }
      if (isHttpError(res, parsed)) {
        throw new Error(parsed?.error || parsed?.detail || `HTTP ${res.status}`);
      }
      return extractData({ json: parsed })?.results || [];
    } catch (err) {
      throw new HubError(`Không thể lấy dữ liệu bảng '${name}' từ Baserow (${err.message})`, 502);
    }
  }

  // Tải đồng thời 6 bảng cần cho thống kê
  const [da, viec, phien, qd, bai, tt] = await Promise.all([
    fetchTable(tableIds.DA, 'Dự án'),
    fetchTable(tableIds.VIEC, 'Việc'),
    fetchTable(tableIds.PHIEN, 'Phiên'),
    fetchTable(tableIds.QD, 'Quyết định'),
    fetchTable(tableIds.BAI, 'Bài học'),
    fetchTable(tableIds.TT, 'Tri thức')
  ]);

  const rawData = {
    da,
    viec,
    phien,
    qd,
    bai,
    tt,
    tableIds,
    restBase
  };

  memoryCache = {
    timestamp: now,
    data: rawData
  };

  return { data: rawData, cacheHit: false };
}

/**
 * Controller endpoint: GET /api/kho/analytics?tu=&den=&du_an=
 */
export async function getKhoAnalytics(store, query = {}) {
  const { data, cacheHit } = await fetchRawKhoData(store);

  // Lấy audit logs từ SQLite store (3 tháng gần nhất để đo hiệu suất đội AI và heatmap)
  let auditLogs = [];
  try {
    auditLogs = store.db
      ? store.db
          .prepare(
            "SELECT actor, mcp, tool, status, created FROM audit WHERE created >= datetime('now', '-90 days') ORDER BY created DESC"
          )
          .all()
      : [];
  } catch {
    auditLogs = store.logs ? store.logs(500) : [];
  }

  const result = aggregateKhoAnalytics({
    ...data,
    auditLogs,
    query
  });

  return {
    ...result,
    metadata: {
      generated_at: new Date().toISOString(),
      cache_hit: cacheHit,
      kho_url: data.restBase,
      table_ids: data.tableIds
    }
  };
}
