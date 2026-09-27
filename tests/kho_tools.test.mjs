import test from 'node:test';
import assert from 'node:assert/strict';
import { PREFIX_TABLE_MAP, khoFindById, khoFindByIdTool } from '../server/kho-tools.mjs';
import { checkToolPermissions } from '../server/connectors.mjs';

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

test('kho-tools: khoFindById successfully fetches row from Baserow API', async () => {
  const mockCalls = [];
  const fakeRequest = async (url, opts) => {
    mockCalls.push({ url, opts });
    if (url.includes('/api/applications/')) {
      return { body: [{ id: 101, name: 'Kho Ryan', type: 'database' }] };
    }
    if (url.includes('/api/database/tables/database/101/')) {
      return {
        body: [
          { id: 201, name: 'Dự án' },
          { id: 202, name: 'Việc' }
        ]
      };
    }
    if (url.includes('/api/database/rows/table/202/12/')) {
      return {
        body: {
          id: 12,
          'Tiêu đề': 'Nghiệm thu Kho Ryan',
          'Trạng thái': 'Đang làm',
          'Mã ID': 'VIEC-12'
        }
      };
    }
    throw new Error('Not found: ' + url);
  };

  const res = await khoFindById(
    { id: 'VIEC-12' },
    { url: 'http://kho:80/api/mcp/', token: 'test-token', allowPrivate: true, request: fakeRequest }
  );

  assert.equal(res.isError, false);
  assert.ok(Array.isArray(res.content));
  const parsed = JSON.parse(res.content[0].text);
  assert.equal(parsed.id, 'VIEC-12');
  assert.equal(parsed.table, 'Việc');
  assert.equal(parsed.data['Tiêu đề'], 'Nghiệm thu Kho Ryan');
});

test('kho-tools: checkToolPermissions handles remote MCP tools', () => {
  const m = { provider: 'remote', name: 'Kho Ryan' };
  const tools = [
    { name: 'list_rows', description: 'List rows' },
    khoFindByIdTool
  ];
  const checked = checkToolPermissions(m, tools);
  assert.equal(checked.length, 2);
  assert.equal(checked[0].permission.status, 'unknown');
  assert.equal(checked[1].permission.status, 'ok');
});
