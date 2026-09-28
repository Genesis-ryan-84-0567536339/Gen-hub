import { readFileSync } from 'node:fs';
import {
  extractData,
  isHttpError,
  buildHeaders,
  loadTableIds,
  resolveRestBase
} from './kho-tools.mjs';
import { isKhoConnector } from './connectors.mjs';
import { HubError } from './net.mjs';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 phút theo spec 4b
let memoryCache = {
  timestamp: 0,
  data: null
};

let inFlightFetchPromise = null;

export function invalidateCache() {
  memoryCache = { timestamp: 0, data: null };
}

/**
 * Định dạng ngày theo giờ Việt Nam (Asia/Ho_Chi_Minh) dạng YYYY-MM-DD
 */
export function toVNYearMonthDay(dateInput) {
  if (!dateInput) return null;
  const d = typeof dateInput === 'number' || typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(d);
}

/**
 * Định dạng tháng theo giờ Việt Nam dạng YYYY-MM
 */
export function toVNYearMonth(dateInput) {
  const ymd = toVNYearMonthDay(dateInput);
  return ymd ? ymd.slice(0, 7) : null;
}

/**
 * Tính số tuần ISO 8601 (bắt đầu Thứ Hai, kết thúc Chủ Nhật) theo giờ VN
 */
export function getISOWeekInfo(dateInput) {
  const ymd = toVNYearMonthDay(dateInput);
  if (!ymd) return null;
  const [year, month, day] = ymd.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = (d.getUTCDay() + 6) % 7; // 0 = Monday, 6 = Sunday

  // Ngày Thứ Hai bắt đầu tuần
  const monday = new Date(d.getTime() - dayOfWeek * 86400000);
  const mondayLabel = `${String(monday.getUTCDate()).padStart(2, '0')}/${String(monday.getUTCMonth() + 1).padStart(2, '0')}`;

  // Đưa về Thứ Năm của tuần để tính tuần ISO
  const thursday = new Date(monday.getTime() + 3 * 86400000);
  const thursdayYear = thursday.getUTCFullYear();
  const firstJan = new Date(Date.UTC(thursdayYear, 0, 1));
  const firstJanDay = (firstJan.getUTCDay() + 6) % 7;
  const firstThursday = new Date(Date.UTC(thursdayYear, 0, 1 + ((3 - firstJanDay + 7) % 7)));
  const weekNum = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / 604800000);
  const key = `${thursdayYear}-W${String(weekNum).padStart(2, '0')}`;

  return { key, label: mondayLabel, weekNum, year: thursdayYear };
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

  function matchesDuAn(record, fieldName = 'Dự án') {
    if (!filterDuAn) return true;
    const projects = Array.isArray(record[fieldName]) ? record[fieldName] : [];
    return projects.some(p => {
      const pId = String(p.id ?? '').toLowerCase().trim();
      const pVal = String(p.value ?? '').toLowerCase().trim();
      return (
        pId === filterDuAn ||
        `da-${pId}` === filterDuAn ||
        pVal === filterDuAn
      );
    });
  }

  function inDateRange(dateStr) {
    if (!filterTu && !filterDen) return true;
    if (!dateStr) return false;
    const d = toVNYearMonthDay(dateStr);
    if (!d) return false;
    if (filterTu && d < filterTu) return false;
    if (filterDen && d > filterDen) return false;
    return true;
  }

  // 1. Phân loại Việc theo Dự án
  const viecByDuAn = viec.filter(v => matchesDuAn(v, 'Dự án'));

  // Việc trong khoảng thời gian lọc (dựa vào Ngày tạo hoặc Ngày xong)
  const filteredViec = viecByDuAn.filter(v => {
    if (!filterTu && !filterDen) return true;
    const dTao = v['Ngày tạo'] ? toVNYearMonthDay(v['Ngày tạo']) : null;
    const dXong = v['Ngày xong'] ? toVNYearMonthDay(v['Ngày xong']) : null;
    if (!dTao && !dXong) return false;
    if (filterTu) {
      const latest = dXong || dTao;
      if (latest < filterTu) return false;
    }
    if (filterDen) {
      const earliest = dTao || dXong;
      if (earliest > filterDen) return false;
    }
    return true;
  });

  // Lọc các bảng khác theo bộ lọc thời gian và dự án
  const filteredPhien = phien.filter(p => {
    if (!matchesDuAn(p, 'Dự án')) return false;
    const d = p['Ngày'] ? toVNYearMonthDay(p['Ngày']) : null;
    return inDateRange(d);
  });

  const filteredQd = qd.filter(q => {
    if (!matchesDuAn(q, 'Dự án')) return false;
    const d = q['Ngày'] ? toVNYearMonthDay(q['Ngày']) : null;
    return inDateRange(d);
  });

  const filteredBai = bai.filter(b => {
    if (!matchesDuAn(b, 'Dự án')) return false;
    let d = b['Ngày tạo'] ? toVNYearMonthDay(b['Ngày tạo']) : null;
    if (!d) {
      const bPhien = Array.isArray(b['Phiên']) ? b['Phiên'][0] : null;
      if (bPhien) {
        const matchPhien = phien.find(p => p.id === bPhien.id || p['Mã ID'] === bPhien.value);
        d = matchPhien?.['Ngày'] ? toVNYearMonthDay(matchPhien['Ngày']) : null;
      }
    }
    return inDateRange(d);
  });

  const filteredAuditLogs = auditLogs.filter(log => {
    const d = log.created ? toVNYearMonthDay(log.created) : null;
    return inDateRange(d);
  });

  // Mốc 7 ngày gần nhất (tính từ now - 6 ngày đến today) theo giờ VN
  const startDate7d = toVNYearMonthDay(now - 6 * 86400000);
  const todayStr = toVNYearMonthDay(now);

  // 1. Ô KPI: Việc đang mở · Việc P1 · Xong trong tuần · Bài học mới trong tuần
  const viecDangMo = viecByDuAn.filter(v => {
    const st = typeof v['Trạng thái'] === 'object' ? v['Trạng thái']?.value : v['Trạng thái'];
    return st && st !== 'Xong';
  });

  const viecP1 = viecByDuAn.filter(v => {
    const prio = typeof v['Ưu tiên'] === 'object' ? v['Ưu tiên']?.value : v['Ưu tiên'];
    const st = typeof v['Trạng thái'] === 'object' ? v['Trạng thái']?.value : v['Trạng thái'];
    return prio === 'P1' && st !== 'Xong';
  });

  const xongTrongTuan = viecByDuAn.filter(v => {
    const st = typeof v['Trạng thái'] === 'object' ? v['Trạng thái']?.value : v['Trạng thái'];
    const dXong = v['Ngày xong'] ? toVNYearMonthDay(v['Ngày xong']) : null;
    return st === 'Xong' && dXong && dXong >= startDate7d && dXong <= todayStr;
  });

  const baiHocMoiTrongTuan = bai.filter(b => {
    if (!matchesDuAn(b, 'Dự án')) return false;
    let d = b['Ngày tạo'] ? toVNYearMonthDay(b['Ngày tạo']) : null;
    if (!d) {
      const bPhien = Array.isArray(b['Phiên']) ? b['Phiên'][0] : null;
      if (bPhien) {
        const matchPhien = phien.find(p => p.id === bPhien.id || p['Mã ID'] === bPhien.value);
        d = matchPhien?.['Ngày'] ? toVNYearMonthDay(matchPhien['Ngày']) : null;
      }
    }
    return d && d >= startDate7d && d <= todayStr;
  });

  const kpi = {
    viec_dang_mo: viecDangMo.length,
    viec_p1: viecP1.length,
    xong_trong_tuan: xongTrongTuan.length,
    bai_hoc_moi_trong_tuan: baiHocMoiTrongTuan.length,
    tong_du_an: da.length,
    tong_viec: filteredViec.length,
    tong_bai_hoc: filteredBai.length,
    tong_tri_thuc: tt.length,
    tong_phien: filteredPhien.length,
    tong_quyet_dinh: filteredQd.length
  };

  // 2. Nhịp làm việc: Việc xong mỗi tuần (cột) + Việc tạo mới (đường)
  const weekBuckets = new Map();
  const nowYmd = toVNYearMonthDay(now);
  const [ny, nm, nd] = nowYmd.split('-').map(Number);
  const currentMon = new Date(Date.UTC(ny, nm - 1, nd));
  const currentDayOfWeek = (currentMon.getUTCDay() + 6) % 7;
  const currentMondayTime = currentMon.getTime() - currentDayOfWeek * 86400000;

  for (let i = 7; i >= 0; i--) {
    const mondayTime = currentMondayTime - i * 7 * 86400000;
    const wInfo = getISOWeekInfo(mondayTime);
    if (wInfo && !weekBuckets.has(wInfo.key)) {
      weekBuckets.set(wInfo.key, { key: wInfo.key, label: wInfo.label, xong: 0, tao: 0 });
    }
  }

  for (const v of filteredViec) {
    const dTao = v['Ngày tạo'] ? toVNYearMonthDay(v['Ngày tạo']) : null;
    const dXong = v['Ngày xong'] ? toVNYearMonthDay(v['Ngày xong']) : null;
    const st = typeof v['Trạng thái'] === 'object' ? v['Trạng thái']?.value : v['Trạng thái'];

    if (dTao) {
      const wkTao = getISOWeekInfo(dTao)?.key;
      if (wkTao && weekBuckets.has(wkTao)) {
        weekBuckets.get(wkTao).tao++;
      }
    }
    if (st === 'Xong' && dXong) {
      const wkXong = getISOWeekInfo(dXong)?.key;
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
    else target.cho++;
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
          so_ngay_tb: null,
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

  const agentAuditMap = new Map();
  for (const log of filteredAuditLogs) {
    const actor = log.actor ? String(log.actor).trim() : '';
    if (!actor || actor === 'owner' || actor === 'system' || actor === 'unauthenticated' || actor.startsWith('admin-assistant:')) {
      continue;
    }
    if (log.mcp === 'hub' || !log.tool) continue;
    agentAuditMap.set(actor, (agentAuditMap.get(actor) || 0) + 1);
  }

  const auditTheoAgent = Array.from(agentAuditMap.entries()).map(([agent, count]) => ({
    agent,
    count
  })).sort((a, b) => b.count - a.count);

  // 6. Học tập (Bài học): Tích lũy theo thời gian, theo Chủ đề, theo Mức
  const chuDeMap = new Map();
  const mucMap = new Map();

  for (const b of filteredBai) {
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

  // Tích lũy bài học theo ngày thực tế (không hardcode)
  const dateCountMap = new Map();
  for (const b of filteredBai) {
    let d = b['Ngày tạo'] ? toVNYearMonthDay(b['Ngày tạo']) : null;
    if (!d) {
      const bPhien = Array.isArray(b['Phiên']) ? b['Phiên'][0] : null;
      if (bPhien) {
        const matchPhien = phien.find(p => p.id === bPhien.id || p['Mã ID'] === bPhien.value);
        d = matchPhien?.['Ngày'] ? toVNYearMonthDay(matchPhien['Ngày']) : null;
      }
    }
    if (d) {
      dateCountMap.set(d, (dateCountMap.get(d) || 0) + 1);
    }
  }

  const sortedDates = Array.from(dateCountMap.keys()).sort();
  let cumulative = 0;
  const baiHocTichLuy = sortedDates.map(d => {
    cumulative += dateCountMap.get(d);
    const [y, m, day] = d.split('-');
    return {
      moc: `${day}/${m}/${y}`,
      date: d,
      count: cumulative
    };
  });

  // 7. Lịch hoạt động kiểu GitHub (Heatmap ngày từ Phiên + audit)
  // Gom hoạt động 90 ngày gần nhất theo giờ VN
  const heatmapMap = new Map();
  for (let i = 89; i >= 0; i--) {
    const d = toVNYearMonthDay(now - i * 86400000);
    if (d) heatmapMap.set(d, 0);
  }

  for (const p of filteredPhien) {
    const d = p['Ngày'] ? toVNYearMonthDay(p['Ngày']) : null;
    if (d && heatmapMap.has(d)) {
      heatmapMap.set(d, heatmapMap.get(d) + 3);
    }
  }

  for (const v of filteredViec) {
    const st = typeof v['Trạng thái'] === 'object' ? v['Trạng thái']?.value : v['Trạng thái'];
    if (st === 'Xong' && v['Ngày xong']) {
      const d = toVNYearMonthDay(v['Ngày xong']);
      if (d && heatmapMap.has(d)) {
        heatmapMap.set(d, heatmapMap.get(d) + 2);
      }
    }
  }

  for (const log of filteredAuditLogs) {
    const actor = log.actor ? String(log.actor).trim() : '';
    if (!actor || actor === 'owner' || actor === 'system' || actor === 'unauthenticated' || actor.startsWith('admin-assistant:') || log.mcp === 'hub' || !log.tool) {
      continue;
    }
    if (log.created) {
      const d = toVNYearMonthDay(log.created);
      if (d && heatmapMap.has(d)) {
        heatmapMap.set(d, heatmapMap.get(d) + 1);
      }
    }
  }

  const lichHoatDong = Array.from(heatmapMap.entries()).map(([ngay, diem]) => [ngay, diem]);

  // 8. Quyết định theo tháng + số quyết định bị thay thế
  const qdThangMap = new Map();
  for (const q of filteredQd) {
    const ym = q['Ngày'] ? toVNYearMonth(q['Ngày']) : null;
    const d = ym || 'Không rõ ngày';
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

async function doFetchRawKhoData(store) {
  const mcps = store.list('mcp') || [];
  const khoMcp = mcps.find(isKhoConnector);

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
    throw new HubError(
      'Chưa cấu hình API Token cho Kho Ryan. Vui lòng cập nhật secret trong MCP connector kho-ryan.',
      503
    );
  }

  const tableIds = loadTableIds();
  if (!tableIds || typeof tableIds !== 'object') {
    throw new HubError(
      'Chưa có file ánh xạ bảng Kho Ryan (kho_table_ids.json). Vui lòng chạy "python3 scripts/manage.py kho-schema" để đồng bộ.',
      503
    );
  }

  const restBase = resolveRestBase({ restUrl: khoMcp.khoRestUrl, url: khoMcp.url });
  const headers = buildHeaders(token);

  async function fetchTable(tableId, name) {
    if (!tableId) {
      throw new HubError(`Thiếu cấu hình table_id cho bảng '${name}' trong Kho Ryan`, 503);
    }
    let page = 1;
    const allResults = [];
    while (true) {
      const url = `${restBase}/api/database/rows/table/${tableId}/?user_field_names=true&size=200&page=${page}`;
      let res, rawText, parsed;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        res = await fetch(url, { headers, signal: controller.signal });
        clearTimeout(timeoutId);
        rawText = await res.text();
      } catch (netErr) {
        throw new HubError(`Không thể kết nối tới Baserow bảng '${name}': ${netErr.message}`, 502);
      }
      try {
        parsed = JSON.parse(rawText);
      } catch {
        parsed = { raw: rawText };
      }
      if (isHttpError(res, parsed)) {
        throw new HubError(
          `Lỗi từ Baserow bảng '${name}': ${parsed?.error || parsed?.detail || `HTTP ${res.status}`}`,
          502
        );
      }
      const results = parsed?.results;
      if (!Array.isArray(results)) {
        throw new HubError(`Dữ liệu bảng '${name}' từ Baserow không hợp lệ`, 502);
      }
      allResults.push(...results);
      if (!parsed.next || allResults.length >= (parsed.count ?? allResults.length) || results.length === 0) {
        break;
      }
      page++;
      if (page > 100) break; // Guard tối đa 20.000 bản ghi
    }
    return allResults;
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

  return {
    da,
    viec,
    phien,
    qd,
    bai,
    tt,
    tableIds,
    restBase
  };
}

/**
 * Đọc dữ liệu từ Baserow REST API có cache 5 phút và gộp in-flight requests
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

  if (inFlightFetchPromise) {
    const data = await inFlightFetchPromise;
    return { data, cacheHit: true };
  }

  inFlightFetchPromise = (async () => {
    try {
      const data = await doFetchRawKhoData(store);
      memoryCache = {
        timestamp: Date.now(),
        data
      };
      return data;
    } finally {
      inFlightFetchPromise = null;
    }
  })();

  const data = await inFlightFetchPromise;
  return { data, cacheHit: false };
}

/**
 * Controller endpoint: GET /api/kho/analytics?tu=&den=&du_an=
 */
export async function getKhoAnalytics(store, query = {}) {
  const { data, cacheHit } = await fetchRawKhoData(store);

  // Lấy audit logs từ SQLite store (3 tháng gần nhất để đo hiệu suất đội AI và heatmap)
  let auditLogs = [];
  if (store.db) {
    try {
      auditLogs = store.db
        .prepare(
          "SELECT actor, mcp, tool, status, created FROM audit WHERE created >= datetime('now', '-90 days') AND tool IS NOT NULL AND tool != '' AND mcp != 'hub' ORDER BY created DESC"
        )
        .all();
    } catch (err) {
      throw new HubError(`Lỗi truy vấn nhật ký audit: ${err.message}`, 500);
    }
  }

  const result = aggregateKhoAnalytics({
    ...data,
    auditLogs,
    query
  });

  // Tìm URL công khai của Kho
  let publicKhoUrl = process.env.BASEROW_PUBLIC_URL || '';
  if (!publicKhoUrl) {
    try {
      const installConfig = JSON.parse(readFileSync('/etc/gen-hub/install.json', 'utf-8'));
      if (installConfig.kho_domain) {
        publicKhoUrl = `https://${installConfig.kho_domain}`;
      } else if (installConfig.domain) {
        publicKhoUrl = `https://kho.${installConfig.domain}`;
      }
    } catch {
      // ignore
    }
  }
  if (!publicKhoUrl) {
    publicKhoUrl = data.restBase;
  }

  return {
    ...result,
    metadata: {
      generated_at: new Date().toISOString(),
      cache_hit: cacheHit,
      kho_url: publicKhoUrl,
      table_ids: data.tableIds
    }
  };
}
