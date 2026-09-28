import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import {
  aggregateKhoAnalytics,
  fetchRawKhoData,
  getKhoAnalytics,
  invalidateCache
} from '../server/kho-analytics.mjs';
import { setMemoryTableIds } from '../server/kho-tools.mjs';

const mockDa = [
  { id: 1, 'Tên': 'Gen-hub', 'Mã ID': 'DA-1', 'Trạng thái': { value: 'Đang chạy' } },
  { id: 2, 'Tên': 'Brain', 'Mã ID': 'DA-2', 'Trạng thái': { value: 'Đang chạy' } },
  { id: 3, 'Tên': 'Wa-heo', 'Mã ID': 'DA-3', 'Trạng thái': { value: 'Tạm dừng' } }
];

const mockViec = [
  {
    id: 1,
    'Tiêu đề': 'Nghiệm thu tích hợp Kho Ryan',
    'Mã ID': 'VIEC-1',
    'Trạng thái': { value: 'Xong' },
    'Ưu tiên': { value: 'P1' },
    'Người làm': 'Claude Code',
    'Ngày tạo': '2026-09-20',
    'Ngày xong': '2026-09-27',
    'Dự án': [{ id: 1, value: 'Gen-hub' }]
  },
  {
    id: 2,
    'Tiêu đề': 'Đồng bộ Tri thức vào Kho',
    'Mã ID': 'VIEC-2',
    'Trạng thái': { value: 'Xong' },
    'Ưu tiên': { value: 'P1' },
    'Người làm': 'agy',
    'Ngày tạo': '2026-09-25',
    'Ngày xong': '2026-09-28',
    'Dự án': [{ id: 2, value: 'Brain' }]
  },
  {
    id: 3,
    'Tiêu đề': 'Backup Kho và khôi phục thử',
    'Mã ID': 'VIEC-3',
    'Trạng thái': { value: 'Xong' },
    'Ưu tiên': { value: 'P1' },
    'Người làm': 'agy',
    'Ngày tạo': '2026-09-26',
    'Ngày xong': '2026-09-28',
    'Dự án': [{ id: 1, value: 'Gen-hub' }]
  },
  {
    id: 4,
    'Tiêu đề': 'Trang Kho Thống kê',
    'Mã ID': 'VIEC-4',
    'Trạng thái': { value: 'Đang làm' },
    'Ưu tiên': { value: 'P2' },
    'Người làm': 'agy',
    'Ngày tạo': '2026-09-28',
    'Ngày xong': null,
    'Dự án': [{ id: 1, value: 'Gen-hub' }]
  },
  {
    id: 5,
    'Tiêu đề': 'Tối ưu UI di động',
    'Mã ID': 'VIEC-5',
    'Trạng thái': { value: 'Chờ' },
    'Ưu tiên': { value: 'P1' },
    'Người làm': 'Codex',
    'Ngày tạo': '2026-09-28',
    'Ngày xong': null,
    'Dự án': [{ id: 3, value: 'Wa-heo' }]
  }
];

const mockPhien = [
  { id: 1, 'Mã ID': 'PHIEN-1', 'Ngày': '2026-09-27', 'Chủ đề': 'Khởi động Kho' },
  { id: 2, 'Mã ID': 'PHIEN-2', 'Ngày': '2026-09-28', 'Chủ đề': 'Nghiệm thu Kho' }
];

const mockQd = [
  { id: 1, 'Mã ID': 'QD-1', 'Nội dung': 'Dùng Baserow', 'Ngày': '2026-09-27', 'Trạng thái': { value: 'Hiệu lực' } },
  { id: 2, 'Mã ID': 'QD-2', 'Nội dung': 'Cổng nhãn PR', 'Ngày': '2026-09-27', 'Trạng thái': { value: 'Thay thế bởi QD-3' } },
  { id: 3, 'Mã ID': 'QD-3', 'Nội dung': 'Bỏ cổng nhãn PR từ 28/09', 'Ngày': '2026-09-28', 'Trạng thái': { value: 'Hiệu lực' } }
];

const mockBai = [
  { id: 1, 'Khái niệm': 'Postgres volume restore', 'Chủ đề': { value: 'DevOps' }, 'Mức': { value: 'Thành thạo' }, 'Ngày tạo': '2026-09-28' },
  { id: 2, 'Khái niệm': 'Cloudflare WAF 1010', 'Chủ đề': { value: 'Bảo mật' }, 'Mức': { value: 'Đã hiểu' }, 'Ngày tạo': '2026-09-28' },
  { id: 3, 'Khái niệm': 'PR Governance Check', 'Chủ đề': { value: 'Git' }, 'Mức': { value: 'Thành thạo' }, 'Ngày tạo': '2026-09-27' },
  { id: 4, 'Khái niệm': 'ECharts bundle', 'Chủ đề': { value: 'Sản phẩm' }, 'Mức': { value: 'Mới' }, 'Ngày tạo': '2026-09-28' }
];

const mockTt = [
  { id: 1, 'Tên': 'ryan-profile' },
  { id: 2, 'Tên': 'ryan-core' },
  { id: 3, 'Tên': 'ryan-profile-builder' }
];

const mockAuditLogs = [
  { actor: 'claude-code', mcp: 'kho-ryan', tool: 'kho_get', status: 'success', created: '2026-09-28T10:00:00Z' },
  { actor: 'claude-code', mcp: 'kho-ryan', tool: 'kho_update', status: 'success', created: '2026-09-28T10:05:00Z' },
  { actor: 'agy', mcp: 'kho-ryan', tool: 'kho_create', status: 'success', created: '2026-09-28T10:10:00Z' },
  { actor: 'brain-dong-bo-tri-thuc', mcp: 'kho-ryan', tool: 'kho_update', status: 'success', created: '2026-09-28T10:15:00Z' },
  { actor: 'owner', mcp: 'hub', tool: 'save', status: 'success', created: '2026-09-28T10:20:00Z' } // Không tính vào audit AI
];

test('kho-analytics: aggregateKhoAnalytics calculates correct KPI cards', () => {
  const now = Date.parse('2026-09-28T12:00:00Z');
  const res = aggregateKhoAnalytics({
    da: mockDa,
    viec: mockViec,
    phien: mockPhien,
    qd: mockQd,
    bai: mockBai,
    tt: mockTt,
    auditLogs: mockAuditLogs,
    now
  });

  // Việc đang mở: VIEC-4 (Đang làm), VIEC-5 (Chờ) -> 2 việc
  assert.equal(res.kpi.viec_dang_mo, 2);
  // Việc P1: VIEC-1 (Xong), VIEC-2 (Xong), VIEC-3 (Xong), VIEC-5 (Chờ) -> VIEC-5 mở
  assert.equal(res.kpi.viec_p1, 1);
  // Xong trong tuần: VIEC-1 (27/09), VIEC-2 (28/09), VIEC-3 (28/09) -> 3 việc
  assert.equal(res.kpi.xong_trong_tuan, 3);
  // Bài học mới trong tuần: 4 bài học
  assert.equal(res.kpi.bai_hoc_moi_trong_tuan, 4);
  assert.equal(res.kpi.tong_du_an, 3);
  assert.equal(res.kpi.tong_viec, 5);
  assert.equal(res.kpi.tong_bai_hoc, 4);
});

test('kho-analytics: aggregateKhoAnalytics filters by project (du_an)', () => {
  const now = Date.parse('2026-09-28T12:00:00Z');
  const res = aggregateKhoAnalytics({
    da: mockDa,
    viec: mockViec,
    phien: mockPhien,
    qd: mockQd,
    bai: mockBai,
    tt: mockTt,
    auditLogs: mockAuditLogs,
    query: { du_an: 'Gen-hub' },
    now
  });

  // Chỉ có 3 việc thuộc Gen-hub: VIEC-1, VIEC-3, VIEC-4
  assert.equal(res.kpi.tong_viec, 3);
  assert.equal(res.kpi.viec_dang_mo, 1); // VIEC-4
  assert.equal(res.kpi.xong_trong_tuan, 2); // VIEC-1, VIEC-3
});

test('kho-analytics: aggregateKhoAnalytics filters by date range (tu, den)', () => {
  const now = Date.parse('2026-09-28T12:00:00Z');
  const res = aggregateKhoAnalytics({
    da: mockDa,
    viec: mockViec,
    phien: mockPhien,
    qd: mockQd,
    bai: mockBai,
    tt: mockTt,
    auditLogs: mockAuditLogs,
    query: { tu: '2026-09-28', den: '2026-09-28' },
    now
  });

  // Chỉ các việc tạo hoặc xong vào 28/09
  // VIEC-2 (xong 28/09), VIEC-3 (xong 28/09), VIEC-4 (tạo 28/09), VIEC-5 (tạo 28/09)
  assert.equal(res.kpi.tong_viec, 4);
});

test('kho-analytics: calculates stacked bar distribution (Việc theo Dự án x Trạng thái)', () => {
  const res = aggregateKhoAnalytics({
    da: mockDa,
    viec: mockViec,
    phien: mockPhien,
    qd: mockQd,
    bai: mockBai,
    tt: mockTt,
    auditLogs: mockAuditLogs
  });

  const genhub = res.viec_theo_du_an.find(d => d.name === 'Gen-hub');
  assert.ok(genhub);
  assert.equal(genhub.xong, 2);
  assert.equal(genhub.dang_lam, 1);
  assert.equal(genhub.tong, 3);

  const brain = res.viec_theo_du_an.find(d => d.name === 'Brain');
  assert.ok(brain);
  assert.equal(brain.xong, 1);
  assert.equal(brain.tong, 1);
});

test('kho-analytics: calculates average completion time by project', () => {
  const res = aggregateKhoAnalytics({
    da: mockDa,
    viec: mockViec,
    phien: mockPhien,
    qd: mockQd,
    bai: mockBai,
    tt: mockTt,
    auditLogs: mockAuditLogs
  });

  const genhub = res.thoi_gian_hoan_thanh_tb.find(d => d.du_an_name === 'Gen-hub');
  assert.ok(genhub);
  // VIEC-1: 20 -> 27 = 7 ngày. VIEC-3: 26 -> 28 = 2 ngày. TB = (7 + 2) / 2 = 4.5 ngày.
  assert.equal(genhub.so_ngay_tb, 4.5);
  assert.equal(genhub.so_viec_tinh, 2);

  const brain = res.thoi_gian_hoan_thanh_tb.find(d => d.du_an_name === 'Brain');
  assert.ok(brain);
  // VIEC-2: 25 -> 28 = 3 ngày. TB = 3 ngày.
  assert.equal(brain.so_ngay_tb, 3.0);
  assert.equal(brain.so_viec_tinh, 1);
});

test('kho-analytics: measures AI team performance from done tasks and audit logs', () => {
  const res = aggregateKhoAnalytics({
    da: mockDa,
    viec: mockViec,
    phien: mockPhien,
    qd: mockQd,
    bai: mockBai,
    tt: mockTt,
    auditLogs: mockAuditLogs
  });

  // Việc xong: agy = 2 (VIEC-2, VIEC-3), Claude Code = 1 (VIEC-1)
  const agy = res.hieu_suat_doi_ai.viec_xong.find(x => x.name === 'agy');
  assert.ok(agy);
  assert.equal(agy.count, 2);

  const claude = res.hieu_suat_doi_ai.viec_xong.find(x => x.name === 'Claude Code');
  assert.ok(claude);
  assert.equal(claude.count, 1);

  // Audit calls: claude-code = 2, agy = 1, brain-dong-bo-tri-thuc = 1. Loại bỏ owner.
  assert.equal(res.hieu_suat_doi_ai.audit.length, 3);
  const auditClaude = res.hieu_suat_doi_ai.audit.find(a => a.agent === 'claude-code');
  assert.equal(auditClaude.count, 2);
});

test('kho-analytics: aggregates learning lessons and decisions stability', () => {
  const res = aggregateKhoAnalytics({
    da: mockDa,
    viec: mockViec,
    phien: mockPhien,
    qd: mockQd,
    bai: mockBai,
    tt: mockTt,
    auditLogs: mockAuditLogs
  });

  // Bài học theo chủ đề
  assert.equal(res.hoc_tap.theo_chu_de.length, 4);
  // Quyết định: tháng 2026-09 có 3 quyết định, 2 hiệu lực, 1 thay thế -> 66.7%
  assert.equal(res.quyet_dinh.length, 1);
  assert.equal(res.quyet_dinh[0].hieu_luc, 2);
  assert.equal(res.quyet_dinh[0].thay_the, 1);
  assert.equal(res.quyet_dinh[0].ty_le_on_dinh, 66.7);

  // Heatmap: có dải ngày
  assert.ok(res.lich_hoat_dong.length > 0);
  const day28 = res.lich_hoat_dong.find(([d]) => d === '2026-09-28');
  assert.ok(day28);
  // Ngày 28 có: 1 phiên (3đ) + 2 việc xong (4đ) + 4 tool calls (4đ) = 11 điểm
  assert.equal(day28[1], 11);
});

test('kho-analytics: fetchRawKhoData throws HubError 503 when kho connector is missing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'genhub-test-analytics-'));
  const store = openStore(dir);
  invalidateCache();

  try {
    await assert.rejects(
      () => fetchRawKhoData(store),
      err => {
        assert.equal(err.status, 503);
        assert.ok(err.message.includes('kho-ryan'));
        return true;
      }
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('kho-analytics: serves vendor/echarts.min.js and kho-analytics.js static files correctly', async t => {
  const { createServer } = await import('node:http');
  const { createHub } = await import('../server/app.mjs');
  const { passwordHash } = await import('../server/store.mjs');

  const probe = createServer();
  await new Promise(r => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise(r => probe.close(r));

  const dir = mkdtempSync(join(tmpdir(), 'genhub-static-'));
  const origin = `http://127.0.0.1:${port}`;
  const hub = createHub({ dir, origin });
  hub.store.put('owner', 'main', { username: 'ryan', password: passwordHash('long-password-123') });
  await new Promise(r => hub.server.listen(port, '127.0.0.1', r));

  t.after(async () => {
    await new Promise(r => hub.server.close(r));
    hub.store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  // Kiểm tra phục vụ /vendor/echarts.min.js
  const rEcharts = await fetch(`${origin}/vendor/echarts.min.js`);
  assert.equal(rEcharts.status, 200);
  assert.ok(rEcharts.headers.get('content-type')?.includes('javascript'));
  const echartsText = await rEcharts.text();
  assert.ok(echartsText.length > 10000);
  assert.ok(echartsText.includes('Apache'));

  // Kiểm tra phục vụ /kho-analytics.js
  const rKhoJs = await fetch(`${origin}/kho-analytics.js`);
  assert.equal(rKhoJs.status, 200);
  assert.ok(rKhoJs.headers.get('content-type')?.includes('javascript'));
  const khoJsText = await rKhoJs.text();
  assert.ok(khoJsText.includes('renderKhoAnalytics'));
});

test('kho-analytics: GET /api/kho/analytics returns 200 and structured data with mock Baserow upstream', async t => {
  const { createServer } = await import('node:http');
  const { createHub } = await import('../server/app.mjs');
  const { passwordHash } = await import('../server/store.mjs');
  const { setMemoryTableIds } = await import('../server/kho-tools.mjs');

  // Khởi tạo mock server giả lập Baserow REST API
  const fakeBaserow = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname.includes('/table/101/')) {
      // DA
      return res.end(JSON.stringify({ results: mockDa }));
    }
    if (u.pathname.includes('/table/102/')) {
      // VIEC
      return res.end(JSON.stringify({ results: mockViec }));
    }
    if (u.pathname.includes('/table/103/')) {
      // PHIEN
      return res.end(JSON.stringify({ results: mockPhien }));
    }
    if (u.pathname.includes('/table/104/')) {
      // QD
      return res.end(JSON.stringify({ results: mockQd }));
    }
    if (u.pathname.includes('/table/105/')) {
      // BAI
      return res.end(JSON.stringify({ results: mockBai }));
    }
    if (u.pathname.includes('/table/106/')) {
      // TT
      return res.end(JSON.stringify({ results: mockTt }));
    }
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  await new Promise(r => fakeBaserow.listen(0, '127.0.0.1', r));
  const baserowPort = fakeBaserow.address().port;
  t.after(() => new Promise(r => fakeBaserow.close(r)));

  // Cài đặt mapping memory table IDs
  setMemoryTableIds({
    DA: 101,
    VIEC: 102,
    PHIEN: 103,
    QD: 104,
    BAI: 105,
    TT: 106,
    TS: 107,
    KHOA: 108
  });
  t.after(() => setMemoryTableIds(null));

  // Khởi tạo Hub
  const probe = createServer();
  await new Promise(r => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise(r => probe.close(r));

  const dir = mkdtempSync(join(tmpdir(), 'genhub-kho-api-'));
  const origin = `http://127.0.0.1:${port}`;
  const hub = createHub({ dir, origin });

  hub.store.put('owner', 'main', { username: 'ryan', password: passwordHash('mật-khẩu-dài-123') });

  // Đăng ký MCP connector kho-ryan
  const sealed = hub.store.seal({ token: 'test-token-baserow' });
  hub.store.put('mcp', 'kho-ryan', {
    id: 'kho-ryan',
    name: 'kho-ryan',
    provider: 'remote',
    kind: 'kho',
    isKho: true,
    url: `http://127.0.0.1:${baserowPort}`,
    khoRestUrl: `http://127.0.0.1:${baserowPort}`,
    secret: sealed
  });

  await new Promise(r => hub.server.listen(port, '127.0.0.1', r));
  t.after(async () => {
    await new Promise(r => hub.server.close(r));
    hub.store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  invalidateCache();

  // Đăng nhập owner lấy session cookie
  const loginRes = await fetch(`${origin}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ username: 'ryan', password: 'mật-khẩu-dài-123' })
  });
  assert.equal(loginRes.status, 200);
  const cookie = loginRes.headers.get('set-cookie')?.split(';')[0];
  const loginData = await loginRes.json();
  const csrf = loginData.csrf;
  assert.ok(cookie);

  // Gọi GET /api/kho/analytics
  const res = await fetch(`${origin}/api/kho/analytics`, {
    headers: {
      Cookie: cookie,
      Origin: origin,
      'X-CSRF-Token': csrf
    }
  });
  assert.equal(res.status, 200);
  const json = await res.json();

  assert.equal(typeof json.kpi, 'object');
  assert.equal(json.kpi.tong_du_an, 3);
  assert.equal(json.kpi.tong_viec, 5);
  assert.equal(json.kpi.viec_dang_mo, 2);
  assert.ok(Array.isArray(json.nhip_lam_viec));
  assert.ok(Array.isArray(json.viec_theo_du_an));
  assert.ok(Array.isArray(json.thoi_gian_hoan_thanh_tb));
  assert.ok(Array.isArray(json.hieu_suat_doi_ai.viec_xong));
  assert.ok(Array.isArray(json.hoc_tap.theo_chu_de));
  assert.ok(Array.isArray(json.lich_hoat_dong));
  assert.ok(Array.isArray(json.quyet_dinh));
  assert.equal(typeof json.metadata, 'object');
  assert.equal(json.metadata.cache_hit, false);

  // Gọi lần 2 kiểm tra cache_hit: true
  const res2 = await fetch(`${origin}/api/kho/analytics`, {
    headers: {
      Cookie: cookie,
      Origin: origin,
      'X-CSRF-Token': csrf
    }
  });
  assert.equal(res2.status, 200);
  const json2 = await res2.json();
  assert.equal(json2.metadata.cache_hit, true);
});


