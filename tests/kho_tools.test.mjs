import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { PREFIX_TABLE_MAP, khoFindById, khoFindByIdTool, khoTomTat, khoTomTatTool, KHO_TOOLS, loadTableIds, resolveRestBase, setMemoryTableIds } from '../server/kho-tools.mjs';
import { checkToolPermissions, isKhoConnector } from '../server/connectors.mjs';

test('kho-tools: validates prefix-to-table mapping for all 8 tables', () => {
  assert.equal(PREFIX_TABLE_MAP.DA, 'Dự án');
  assert.equal(PREFIX_TABLE_MAP.VIEC, 'Việc');
  assert.equal(PREFIX_TABLE_MAP.PHIEN, 'Phiên');
  assert.equal(PREFIX_TABLE_MAP.QD, 'Quyết định');
  assert.equal(PREFIX_TABLE_MAP.BAI, 'Bài học');
  assert.equal(PREFIX_TABLE_MAP.TT, 'Tri thức');
  assert.equal(PREFIX_TABLE_MAP.TS, 'Tài sản');
  assert.equal(PREFIX_TABLE_MAP.KHOA, 'Chỉ mục khóa');
  assert.equal(Object.keys(PREFIX_TABLE_MAP).length, 8);
});

test('kho-tools: loads table_ids mapping from schema export', () => {
  const tableIds = loadTableIds();
  // If tableIds exists in environment or disk
  if (tableIds) {
    for (const prefix of ['DA', 'VIEC', 'PHIEN', 'QD', 'BAI', 'TT', 'TS', 'KHOA']) {
      assert.equal(typeof tableIds[prefix], 'number');
    }
  }
});

test('kho-tools: khoFindById rejects when table mapping is missing without hardcoded fallback', async () => {
  setMemoryTableIds(false);
  try {
    await assert.rejects(
      () => khoFindById(
        { id: 'VIEC-12' },
        { url: 'http://kho:80', request: async () => {} }
      ),
      err => {
        assert.equal(err.status, 503);
        assert.ok(err.message.includes('Chưa có dữ liệu ánh xạ bảng Kho Ryan') || err.message.includes('kho-schema'));
        return true;
      }
    );
  } finally {
    setMemoryTableIds(null);
  }
});

test('kho-tools: resolves REST base correctly from real-world MCP URLs and config', () => {
  // Real MCP URL with custom stream path and query params
  assert.equal(
    resolveRestBase({ url: 'https://kho.genos.top/api/mcp/v1/workspace/1/stream?key=xyz123' }),
    'https://kho.genos.top'
  );
  // Docker internal host (default port 80 is normalized by URL parser)
  assert.equal(
    resolveRestBase({ url: 'http://kho:80/mcp/sse' }),
    'http://kho'
  );
  // Custom port preserved
  assert.equal(
    resolveRestBase({ url: 'http://localhost:3001/mcp/sse' }),
    'http://localhost:3001'
  );
  // Explicit restUrl overrides MCP URL completely
  assert.equal(
    resolveRestBase({ url: 'https://some-tunnel.example.com/mcp', restUrl: 'http://kho:80' }),
    'http://kho:80'
  );
  // Empty context defaults to http://kho:80
  assert.equal(
    resolveRestBase({}),
    'http://kho:80'
  );
});

test('kho-tools: khoFindById rejects invalid ID format or invalid prefix', async () => {
  await assert.rejects(
    () => khoFindById({ id: '' }, { url: 'http://kho:80' }),
    /Mã ID không hợp lệ/
  );
  await assert.rejects(
    () => khoFindById({ id: 'UNKNOWN-12' }, { url: 'http://kho:80' }),
    /Tiền tố 'UNKNOWN' không thuộc 8 bảng của Kho Ryan/
  );
  await assert.rejects(
    () => khoFindById({ id: 'VIEC_12' }, { url: 'http://kho:80' }),
    /Mã ID không hợp lệ/
  );
});

test('kho-tools: khoFindById fetches row using direct table_id without calling applications/tables API', async () => {
  const mockCalls = [];
  const fakeRequest = async (url, opts) => {
    mockCalls.push({ url, opts });
    if (url === 'https://kho.genos.top/api/database/rows/table/2/12/?user_field_names=true') {
      return {
        body: {
          id: 12,
          'Tiêu đề': 'Nghiệm thu Kho Ryan',
          'Trạng thái': 'Đang làm',
          'Ngày tạo': '2026-09-27',
          'Mã ID': 'VIEC-12'
        }
      };
    }
    throw new Error('Unexpected call: ' + url);
  };

  // Real MCP URL with nested query parameters
  const realMcpUrl = 'https://kho.genos.top/api/mcp/v1/workspace/99/sse?access_token=secret_mcp';
  const res = await khoFindById(
    { id: 'VIEC-12' },
    {
      url: realMcpUrl,
      token: 'db-token-abc',
      tableIds: { VIEC: 2 },
      allowPrivate: true,
      request: fakeRequest
    }
  );

  // Assert exactly 1 request was made directly to the row endpoint (no applications or table listings!)
  assert.equal(mockCalls.length, 1);
  assert.equal(mockCalls[0].url, 'https://kho.genos.top/api/database/rows/table/2/12/?user_field_names=true');
  assert.equal(mockCalls[0].opts.headers.Authorization, 'Token db-token-abc');

  assert.equal(res.isError, false);
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.id, 'VIEC-12');
  assert.equal(parsed.table, 'Việc');
  assert.equal(parsed.data['Tiêu đề'], 'Nghiệm thu Kho Ryan');
  assert.equal(parsed.data['Ngày tạo'], '2026-09-27');
});

test('kho-tools: isKhoConnector requires explicit flags or kho-ryan name and rejects generic substring matches', () => {
  // Generic remote connectors with "kho" in name or URL MUST NOT be recognized as Kho
  const unrelated1 = { provider: 'remote', name: 'Kho dữ liệu hình ảnh', url: 'https://storage.example.com/mcp' };
  const unrelated2 = { provider: 'remote', name: 'Dịch vụ lưu trữ', url: 'https://example.com/kho-service' };
  const unrelated3 = { provider: 'github-mcp', name: 'GitHub' };
  assert.equal(isKhoConnector(unrelated1), false);
  assert.equal(isKhoConnector(unrelated2), false);
  assert.equal(isKhoConnector(unrelated3), false);

  // Connectors with explicit kind: 'kho', khoRestUrl, isKho: true, or name: 'kho-ryan' ARE recognized
  const explicitKind = { provider: 'remote', name: 'Baserow Kho', kind: 'kho', url: 'http://kho:80/mcp' };
  const explicitRestUrl = { provider: 'remote', name: 'My Kho', khoRestUrl: 'http://kho:80', url: 'http://kho:80/mcp' };
  const explicitFlag = { provider: 'remote', name: 'Kho Ryan', isKho: true, url: 'http://kho:80/mcp' };
  const explicitName = { provider: 'remote', name: 'kho-ryan', url: 'http://kho:80/mcp' };
  const explicitNameCaps = { provider: 'remote', name: 'Kho-Ryan', url: 'http://kho:80/mcp' };

  assert.equal(isKhoConnector(explicitKind), true);
  assert.equal(isKhoConnector(explicitRestUrl), true);
  assert.equal(isKhoConnector(explicitFlag), true);
  assert.equal(isKhoConnector(explicitName), true);
  assert.equal(isKhoConnector(explicitNameCaps), true);
});

test('kho-tools: checkToolPermissions handles remote MCP tools', () => {
  const m = { provider: 'remote', name: 'Kho Ryan', kind: 'kho' };
  const tools = [
    { name: 'list_rows', description: 'List rows' },
    khoFindByIdTool
  ];
  const checked = checkToolPermissions(m, tools);
  assert.equal(checked.length, 2);
  assert.equal(checked[0].permission.status, 'unknown');
  assert.equal(checked[1].permission.status, 'ok');
});

test('kho-tools: Hub API saves and reads back kind, isKho, and khoRestUrl flags', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'genhub-kho-store-'));
  const store = openStore(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const connectorData = {
    id: 'mcp-99999',
    name: 'Kho Ryan',
    provider: 'remote',
    kind: 'kho',
    isKho: true,
    khoRestUrl: 'http://kho:80',
    url: 'https://kho.genos.top/api/mcp/',
    allowPrivate: true
  };
  store.put('mcp', connectorData.id, connectorData);

  const retrieved = store.get('mcp', 'mcp-99999');
  assert.ok(retrieved);
  assert.equal(retrieved.kind, 'kho');
  assert.equal(retrieved.isKho, true);
  assert.equal(retrieved.khoRestUrl, 'http://kho:80');
  assert.equal(isKhoConnector(retrieved), true);
});

test('kho-tools: khoList, khoCreate, khoUpdate, khoSearch handle REST operations', async () => {
  const mockCalls = [];
  const fakeRequest = async (url, opts) => {
    mockCalls.push({ url, opts });
    if (opts.method === 'GET' && url.includes('/api/database/rows/table/2/?')) {
      return {
        body: {
          count: 1,
          results: [{ id: 1, 'Tiêu đề': 'Task 1', 'Mã ID': 'VIEC-1' }]
        }
      };
    }
    if (opts.method === 'POST' && url.includes('/api/database/rows/table/2/')) {
      return {
        body: {
          id: 5,
          'Tiêu đề': 'New Task',
          'Mã ID': 'VIEC-5'
        }
      };
    }
    if (opts.method === 'PATCH' && url.includes('/api/database/rows/table/2/5/')) {
      return {
        body: {
          id: 5,
          'Tiêu đề': 'Updated Task',
          'Mã ID': 'VIEC-5'
        }
      };
    }
    return { body: { count: 0, results: [] } };
  };

  const { khoList, khoCreate, khoUpdate, khoSearch } = await import('../server/kho-tools.mjs');
  const ctx = {
    restUrl: 'http://kho:80',
    token: 'test-token',
    tableIds: { VIEC: 2, DA: 1, PHIEN: 3, QD: 4, BAI: 5, TT: 6, TS: 7, KHOA: 8 },
    request: fakeRequest
  };

  // 1. khoList
  const listRes = await khoList({ bang: 'Việc', filter: 'Task' }, ctx);
  assert.equal(listRes.isError, false);
  const parsedList = JSON.parse(listRes.content[0].text);
  assert.equal(parsedList.bang, 'Việc');
  assert.equal(parsedList.tong_so, 1);

  // 2. khoCreate
  const createRes = await khoCreate({ bang: 'Việc', fields: { 'Tiêu đề': 'New Task' } }, ctx);
  assert.equal(createRes.isError, false);
  const parsedCreate = JSON.parse(createRes.content[0].text);
  assert.equal(parsedCreate.id, 'VIEC-5');

  // 3. khoUpdate
  const updateRes = await khoUpdate({ id: 'VIEC-5', fields: { 'Tiêu đề': 'Updated Task' } }, ctx);
  assert.equal(updateRes.isError, false);
  const parsedUpdate = JSON.parse(updateRes.content[0].text);
  assert.equal(parsedUpdate.id, 'VIEC-5');

  // 4. khoSearch
  const searchRes = await khoSearch({ text: 'Task', bang: 'Việc' }, ctx);
  assert.equal(searchRes.isError, false);
  const parsedSearch = JSON.parse(searchRes.content[0].text);
  assert.equal(parsedSearch.tu_khoa, 'Task');
});

test('kho-tools: khoCreate and khoUpdate return isError: true on Baserow validation error or rejection', async () => {
  const { khoCreate, khoUpdate } = await import('../server/kho-tools.mjs');

  // Simulated Baserow error response when validation fails
  const validationErrorPayload = {
    error: 'ERROR_REQUEST_BODY_VALIDATION',
    detail: {
      'Trọng tâm': [
        {
          error: 'Must be a valid boolean.',
          code: 'invalid'
        }
      ]
    }
  };

  const fakeRequestValidationFail = async () => ({
    status: 400,
    json: validationErrorPayload
  });

  const ctx = {
    restUrl: 'http://kho:80',
    token: 'test-token',
    tableIds: { DA: 1, VIEC: 2 },
    request: fakeRequestValidationFail
  };

  // 1. Test khoCreate with invalid fields (e.g. boolean field passed as string)
  const createRes = await khoCreate(
    { bang: 'Dự án', fields: { 'Tên': 'test', 'Trọng tâm': 'Có' } },
    ctx
  );
  assert.equal(createRes.isError, true);
  assert.ok(Array.isArray(createRes.content));
  const createText = createRes.content[0].text;
  assert.ok(!createText.includes('DA-undefined'), 'Must not contain DA-undefined');
  assert.ok(!createText.includes('Đã tạo thành công'), 'Must not report success');
  const parsedCreateErr = JSON.parse(createText);
  assert.equal(parsedCreateErr.error, 'ERROR_REQUEST_BODY_VALIDATION');
  assert.ok(parsedCreateErr.detail['Trọng tâm']);

  // 2. Test khoUpdate with invalid fields
  const updateRes = await khoUpdate(
    { id: 'DA-1', fields: { 'Trọng tâm': 'Có' } },
    ctx
  );
  assert.equal(updateRes.isError, true);
  const updateText = updateRes.content[0].text;
  assert.ok(!updateText.includes('Đã cập nhật bản ghi'), 'Must not report success');
  const parsedUpdateErr = JSON.parse(updateText);
  assert.equal(parsedUpdateErr.error, 'ERROR_REQUEST_BODY_VALIDATION');
  assert.ok(parsedUpdateErr.detail['Trọng tâm']);
});

test('kho-tools: khoList and khoGet handle upstream Baserow HTTP errors', async () => {
  const { khoList, khoGet } = await import('../server/kho-tools.mjs');

  const fake500Request = async () => ({
    status: 500,
    json: { error: 'ERROR_INTERNAL', detail: 'Database server error' }
  });

  const ctx = {
    restUrl: 'http://kho:80',
    token: 'test-token',
    tableIds: { DA: 1 },
    request: fake500Request
  };

  const listRes = await khoList({ bang: 'Dự án' }, ctx);
  assert.equal(listRes.isError, true);
  const parsedListErr = JSON.parse(listRes.content[0].text);
  assert.equal(parsedListErr.error, 'ERROR_INTERNAL');

  const getRes = await khoGet({ id: 'DA-1' }, ctx);
  assert.equal(getRes.isError, true);
  const parsedGetErr = JSON.parse(getRes.content[0].text);
  assert.equal(parsedGetErr.error, 'ERROR_INTERNAL');
});

test('kho-tools: khoSearch returns isError: true when all tables fail and collects loi on partial failure', async () => {
  const { khoSearch } = await import('../server/kho-tools.mjs');

  const allFailRequest = async () => ({
    status: 502,
    json: { error: 'ERROR_UPSTREAM', detail: 'Baserow unreachable' }
  });

  const ctxAllFail = {
    restUrl: 'http://kho:80',
    token: 'test-token',
    tableIds: { DA: 1, VIEC: 2, PHIEN: 3, QD: 4, BAI: 5, TT: 6, TS: 7, KHOA: 8 },
    request: allFailRequest
  };

  // 1. All tables fail -> returns isError: true with list of errors
  const resAllFail = await khoSearch({ text: 'test' }, ctxAllFail);
  assert.equal(resAllFail.isError, true);
  const parsedAllFail = JSON.parse(resAllFail.content[0].text);
  assert.ok(parsedAllFail.thong_bao.includes('toàn bộ 6 bảng đều gặp lỗi'));
  assert.equal(parsedAllFail.loi.length, 6);

  // 2. Single table search fails -> isError: true
  const partialRequest = async url => {
    if (url.includes('/api/database/rows/table/1/')) {
      return {
        status: 200,
        json: {
          count: 1,
          results: [{ id: 10, 'Tên': 'Dự án Alpha', 'Mã ID': 'DA-10' }]
        }
      };
    }
    return {
      status: 500,
      json: { error: 'ERROR_INTERNAL', detail: 'Table failure' }
    };
  };

  const ctxPartial = {
    restUrl: 'http://kho:80',
    token: 'test-token',
    tableIds: { DA: 1, VIEC: 2, PHIEN: 3, QD: 4, BAI: 5, TT: 6, TS: 7, KHOA: 8 },
    request: partialRequest
  };

  const resSingleFail = await khoSearch({ text: 'Alpha', bang: 'Việc' }, ctxPartial);
  assert.equal(resSingleFail.isError, true);
  const parsedSingleFail = JSON.parse(resSingleFail.content[0].text);
  assert.equal(parsedSingleFail.loi.length, 1);
  assert.equal(parsedSingleFail.loi[0].bang, 'Việc');

  // 3. Partial failure across all 6 tables (1 table succeeds, 5 tables fail) -> isError: false with results and loi array
  const resPartial = await khoSearch({ text: 'Alpha' }, ctxPartial);
  assert.equal(resPartial.isError, false);
  const parsedPartial = JSON.parse(resPartial.content[0].text);
  assert.equal(parsedPartial.so_ket_qua, 1);
  assert.equal(parsedPartial.ket_qua[0].id, 'DA-10');
  assert.equal(parsedPartial.loi.length, 5);
});

test('kho-tools: KHO_TOOLS includes khoTomTatTool with correct schema and annotations', () => {
  const tool = KHO_TOOLS.find(t => t.name === 'kho_tom_tat');
  assert.ok(tool, 'kho_tom_tat must be present in KHO_TOOLS');
  assert.equal(tool.name, 'kho_tom_tat');
  assert.equal(tool.annotations?.readOnlyHint, true);
  assert.equal(tool.annotations?.destructiveHint, false);
  assert.equal(tool.inputSchema?.properties?.so_phien?.type, 'integer');
});

test('kho-tools: khoTomTat successfully aggregates and formats core data', async () => {
  const tableIds = { PHIEN: 101, VIEC: 102, QD: 103, DA: 104 };
  const fakeData = {
    101: [
      { id: 1, 'Mã ID': 'PHIEN-1', 'Ngày': '2026-09-27', 'Chủ đề': 'Phiên 1', 'Việc tiếp': 'A'.repeat(500), 'Cảnh báo': 'Cảnh báo 1' },
      { id: 2, 'Mã ID': 'PHIEN-2', 'Ngày': '2026-09-28', 'Chủ đề': 'Phiên 2', 'Việc tiếp': 'Việc tiếp 2', 'Cảnh báo': 'B'.repeat(500) },
      { id: 3, 'Mã ID': 'PHIEN-3', 'Ngày': '2026-09-28', 'Chủ đề': 'Phiên 3 (mới hơn)', 'Việc tiếp': 'Việc tiếp 3', 'Cảnh báo': 'Cảnh báo 3' }
    ],
    102: [
      { id: 1, 'Mã ID': 'VIEC-1', 'Tiêu đề': 'Việc đã xong', 'Trạng thái': 'Xong', 'Ưu tiên': 'P1', 'Người làm': 'Ryan' },
      { id: 2, 'Mã ID': 'VIEC-2', 'Tiêu đề': 'Việc P3', 'Trạng thái': 'Đang làm', 'Ưu tiên': 'P3', 'Người làm': 'Claude' },
      { id: 3, 'Mã ID': 'VIEC-3', 'Tiêu đề': 'Việc P1', 'Trạng thái': { value: 'Chờ' }, 'Ưu tiên': { value: 'P1' }, 'Người làm': 'agy' },
      { id: 4, 'Mã ID': 'VIEC-4', 'Tiêu đề': 'Việc P2', 'Trạng thái': 'Đang làm', 'Ưu tiên': 'P2', 'Người làm': 'Ryan' }
    ],
    103: [
      { id: 1, 'Mã ID': 'QD-1', 'Nội dung': 'Quyết định hết hiệu lực', 'Trạng thái': 'Hết hiệu lực' },
      { id: 2, 'Mã ID': 'QD-2', 'Nội dung': 'Quyết định bị thay thế', 'Trạng thái': 'Bị thay thế' },
      { id: 3, 'Mã ID': 'QD-3', 'Nội dung': 'D'.repeat(200), 'Trạng thái': 'Có hiệu lực' }
    ],
    104: [
      { id: 1, 'Mã ID': 'DA-1', 'Tên': 'Dự án không trọng tâm', 'Trọng tâm': false },
      { id: 2, 'Mã ID': 'DA-2', 'Tên': 'Dự án trọng tâm 1', 'Trọng tâm': true },
      { id: 3, 'Mã ID': 'DA-3', 'Tên': 'Dự án trọng tâm 2', 'Trọng tâm': 'Có' }
    ]
  };

  const fakeRequest = async (url, opts) => {
    // Check authorization header format
    assert.equal(opts.headers?.Authorization, 'Token secret-token-xyz');
    for (const [tId, rows] of Object.entries(fakeData)) {
      if (url.includes(`/api/database/rows/table/${tId}/`)) {
        return {
          status: 200,
          body: {
            count: rows.length,
            next: null,
            results: rows
          }
        };
      }
    }
    return { status: 404, body: { error: 'Not found' } };
  };

  const ctx = {
    restUrl: 'http://kho:80',
    token: 'secret-token-xyz',
    tableIds,
    request: fakeRequest
  };

  // Test default so_phien = 1
  const res = await khoTomTat({}, ctx);
  assert.equal(res.isError, false);
  const data = JSON.parse(res.content[0].text);

  // 1. Phien gan nhat: so_phien default 1 -> should pick PHIEN-3 (same date 2026-09-28, id 3 > id 2)
  assert.equal(data.phien_gan_nhat.length, 1);
  assert.equal(data.phien_gan_nhat[0].id, 'PHIEN-3');
  assert.equal(data.phien_gan_nhat[0].chu_de, 'Phiên 3 (mới hơn)');

  // 2. Việc đang mở: không chứa VIEC-1 (Xong), thứ tự P1 -> P2 -> P3
  assert.equal(data.viec_dang_mo.length, 3);
  assert.equal(data.viec_dang_mo[0].id, 'VIEC-3'); // P1
  assert.equal(data.viec_dang_mo[0].uu_tien, 'P1');
  assert.equal(data.viec_dang_mo[1].id, 'VIEC-4'); // P2
  assert.equal(data.viec_dang_mo[1].uu_tien, 'P2');
  assert.equal(data.viec_dang_mo[2].id, 'VIEC-2'); // P3
  assert.equal(data.viec_dang_mo[2].uu_tien, 'P3');

  // 3. Quyết định hiệu lực: chỉ lấy QD-3, cắt nội dung <= 160 ký tự kèm …
  assert.equal(data.quyet_dinh_hieu_luc.length, 1);
  assert.equal(data.quyet_dinh_hieu_luc[0].id, 'QD-3');
  assert.equal(data.quyet_dinh_hieu_luc[0].noi_dung_ngan.length, 160);
  assert.ok(data.quyet_dinh_hieu_luc[0].noi_dung_ngan.endsWith('…'));

  // 4. Dự án trọng tâm: chỉ DA-2 và DA-3, chỉ có id + ten
  assert.equal(data.du_an_trong_tam.length, 2);
  assert.deepEqual(data.du_an_trong_tam, [
    { id: 'DA-2', ten: 'Dự án trọng tâm 1' },
    { id: 'DA-3', ten: 'Dự án trọng tâm 2' }
  ]);

  // Test so_phien = 2
  const res2 = await khoTomTat({ so_phien: 2 }, ctx);
  const data2 = JSON.parse(res2.content[0].text);
  assert.equal(data2.phien_gan_nhat.length, 2);
  assert.equal(data2.phien_gan_nhat[0].id, 'PHIEN-3');
  assert.equal(data2.phien_gan_nhat[1].id, 'PHIEN-2');
  // Check truncation of canh_bao in PHIEN-2 <= 200 chars and ends with …
  assert.equal(data2.phien_gan_nhat[1].canh_bao.length, 200);
  assert.ok(data2.phien_gan_nhat[1].canh_bao.endsWith('…'));

  // Test so_phien > 5 clamps to 5, so_phien < 1 clamps to 1
  const resMax = await khoTomTat({ so_phien: 10 }, ctx);
  const dataMax = JSON.parse(resMax.content[0].text);
  assert.equal(dataMax.phien_gan_nhat.length, 3); // Only 3 total in fakeData

  const resMin = await khoTomTat({ so_phien: 0 }, ctx);
  const dataMin = JSON.parse(resMin.content[0].text);
  assert.equal(dataMin.phien_gan_nhat.length, 1); // Clamp to min 1

  const resNeg = await khoTomTat({ so_phien: -3 }, ctx);
  const dataNeg = JSON.parse(resNeg.content[0].text);
  assert.equal(dataNeg.phien_gan_nhat.length, 1); // Clamp to min 1
});

test('kho-tools: khoTomTat treats empty/null Trạng thái as open task', async () => {
  const tableIds = { PHIEN: 101, VIEC: 102, QD: 103, DA: 104 };
  const fakeData = {
    101: [{ id: 1, 'Mã ID': 'PHIEN-1', 'Ngày': '2026-09-28', 'Chủ đề': 'P1', 'Việc tiếp': '', 'Cảnh báo': '' }],
    102: [
      { id: 1, 'Mã ID': 'VIEC-1', 'Tiêu đề': 'Task with null status', 'Trạng thái': null, 'Ưu tiên': 'P1' },
      { id: 2, 'Mã ID': 'VIEC-2', 'Tiêu đề': 'Task with empty status', 'Trạng thái': '', 'Ưu tiên': 'P2' },
      { id: 3, 'Mã ID': 'VIEC-3', 'Tiêu đề': 'Task completed', 'Trạng thái': 'Xong', 'Ưu tiên': 'P1' }
    ],
    103: [],
    104: []
  };

  const fakeRequest = async url => {
    for (const [tId, rows] of Object.entries(fakeData)) {
      if (url.includes(`/api/database/rows/table/${tId}/`)) {
        return { status: 200, body: { count: rows.length, next: null, results: rows } };
      }
    }
    return { status: 404, body: { error: 'Not found' } };
  };

  const res = await khoTomTat({}, { restUrl: 'http://kho:80', token: 'token', tableIds, request: fakeRequest });
  assert.equal(res.isError, false);
  const data = JSON.parse(res.content[0].text);
  // VIEC-1 and VIEC-2 should be included because null/empty status is considered open
  assert.equal(data.viec_dang_mo.length, 2);
  assert.equal(data.viec_dang_mo[0].id, 'VIEC-1');
  assert.equal(data.viec_dang_mo[1].id, 'VIEC-2');
});

test('kho-tools: khoTomTat handles multi-page pagination', async () => {
  const tableIds = { PHIEN: 101, VIEC: 102, QD: 103, DA: 104 };
  const page1 = [
    { id: 1, 'Mã ID': 'VIEC-1', 'Tiêu đề': 'Task 1', 'Trạng thái': 'Đang làm', 'Ưu tiên': 'P1' }
  ];
  const page2 = [
    { id: 2, 'Mã ID': 'VIEC-2', 'Tiêu đề': 'Task 2', 'Trạng thái': 'Đang làm', 'Ưu tiên': 'P2' }
  ];

  const fakeRequest = async url => {
    if (url.includes('/api/database/rows/table/102/')) {
      if (url.includes('page=1')) {
        return { status: 200, body: { count: 2, next: 'http://kho/page=2', results: page1 } };
      }
      if (url.includes('page=2')) {
        return { status: 200, body: { count: 2, next: null, results: page2 } };
      }
    }
    return { status: 200, body: { count: 0, next: null, results: [] } };
  };

  const res = await khoTomTat({}, { restUrl: 'http://kho:80', token: 'token', tableIds, request: fakeRequest });
  assert.equal(res.isError, false);
  const data = JSON.parse(res.content[0].text);
  assert.equal(data.viec_dang_mo.length, 2);
  assert.equal(data.viec_dang_mo[0].id, 'VIEC-1');
  assert.equal(data.viec_dang_mo[1].id, 'VIEC-2');
});

test('kho-tools: khoTomTat hard budget guard guarantees output length <= 3000 chars with 20 long tasks + 5 long sessions', async () => {
  const tableIds = { PHIEN: 101, VIEC: 102, QD: 103, DA: 104 };
  const longText = 'A'.repeat(600);

  // Generate 5 long sessions
  const phienRows = Array.from({ length: 5 }, (_, i) => ({
    id: i + 1,
    'Mã ID': `PHIEN-${i + 1}`,
    'Ngày': `2026-09-2${i}`,
    'Chủ đề': `Chủ đề phiên rất dài ${longText.slice(0, 100)}`,
    'Việc tiếp': `Việc tiếp rất dài ${longText}`,
    'Cảnh báo': `Cảnh báo rất dài ${longText}`
  }));

  // Generate 25 tasks (should take max 20)
  const viecRows = Array.from({ length: 25 }, (_, i) => ({
    id: i + 1,
    'Mã ID': `VIEC-${i + 1}`,
    'Tiêu đề': `Tiêu đề việc rất dài ${longText.slice(0, 120)}`,
    'Trạng thái': 'Đang làm',
    'Ưu tiên': i % 3 === 0 ? 'P1' : i % 3 === 1 ? 'P2' : 'P3',
    'Người làm': 'Claude và agy'
  }));

  // Generate 20 decisions
  const qdRows = Array.from({ length: 20 }, (_, i) => ({
    id: i + 1,
    'Mã ID': `QD-${i + 1}`,
    'Nội dung': `Quyết định quy định rất dài ${longText}`,
    'Trạng thái': 'Hiệu lực'
  }));

  // Generate 15 projects
  const daRows = Array.from({ length: 15 }, (_, i) => ({
    id: i + 1,
    'Mã ID': `DA-${i + 1}`,
    'Tên': `Dự án chiến lược trọng tâm ${longText.slice(0, 100)}`,
    'Trọng tâm': true
  }));

  const fakeData = { 101: phienRows, 102: viecRows, 103: qdRows, 104: daRows };

  const fakeRequest = async url => {
    for (const [tId, rows] of Object.entries(fakeData)) {
      if (url.includes(`/api/database/rows/table/${tId}/`)) {
        return { status: 200, body: { count: rows.length, next: null, results: rows } };
      }
    }
    return { status: 404, body: { error: 'Not found' } };
  };

  const res = await khoTomTat({ so_phien: 5 }, { restUrl: 'http://kho:80', token: 'token', tableIds, request: fakeRequest });
  assert.equal(res.isError, false);
  const textOutput = res.content[0].text;
  // Output MUST be strictly <= 3000 chars!
  assert.ok(textOutput.length <= 3000, `Output length (${textOutput.length}) must be <= 3000 chars`);
  const parsed = JSON.parse(textOutput);
  // Must have pruned or marked bi_cat
  assert.equal(parsed.bi_cat, true);
});

test('kho-tools: khoTomTat strips secret token when upstream only returns detail (no error key)', async () => {
  const tableIds = { PHIEN: 101, VIEC: 102, QD: 103, DA: 104 };
  const secretToken = 'super-secret-unique-token-abc123xyz';

  const detailOnlyFailRequest = async url => {
    if (url.includes('/api/database/rows/table/102/')) {
      return {
        status: 502,
        body: { detail: `Authentication failure upstream with token ${secretToken}` }
      };
    }
    return { status: 200, body: { count: 0, next: null, results: [] } };
  };

  const ctx = {
    restUrl: 'http://kho:80',
    token: secretToken,
    tableIds,
    request: detailOnlyFailRequest
  };

  const res = await khoTomTat({}, ctx);
  assert.equal(res.isError, true);
  const outputText = res.content[0].text;
  assert.ok(outputText.includes('Lỗi tóm tắt Kho Ryan'));
  // Secret token must NEVER appear anywhere in the output!
  assert.equal(outputText.includes(secretToken), false, 'Secret token must be completely stripped');
  assert.ok(outputText.includes('[REDACTED]'));
});




