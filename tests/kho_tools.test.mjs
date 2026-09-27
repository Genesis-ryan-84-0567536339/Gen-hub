import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.mjs';
import { PREFIX_TABLE_MAP, khoFindById, khoFindByIdTool, loadTableIds, resolveRestBase, setMemoryTableIds } from '../server/kho-tools.mjs';
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

