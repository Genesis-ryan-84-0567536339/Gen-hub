import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';

test('connector autoPublish: default false, cleanMcp inclusion, PATCH and audit', async t => {
  const x = await fixture(t);

  // 1. Tạo connector mới -> mặc định autoPublish là false
  const addRes = await x.call('/api/mcps', 'POST', {
    provider: 'remote',
    name: 'Remote Service',
    url: 'https://example.com/mcp'
  });
  assert.equal(addRes.status, 201);
  const mid = addRes.data.id;
  assert.equal(addRes.data.autoPublish, false);

  // cleanMcp trả về qua /api/state cũng có autoPublish: false
  const stateRes = await x.call('/api/state');
  const found = stateRes.data.mcps.find(m => m.id === mid);
  assert(found);
  assert.equal(found.autoPublish, false);

  // 2. PATCH autoPublish = true
  const patchRes = await x.call('/api/mcps/' + mid, 'PATCH', { autoPublish: true });
  assert.equal(patchRes.status, 200);
  assert.equal(patchRes.data.autoPublish, true);

  // Kiểm tra lưu vào store
  const stored = x.hub.store.get('mcp', mid);
  assert.equal(stored.autoPublish, true);

  // Kiểm tra audit log
  const auditList = x.hub.store.logs(50);
  const updateAuditMeta = auditList.find(a => a.tool === 'mcp.update' && a.mcp === mid);
  assert(updateAuditMeta);
  const updateAudit = x.hub.store.log(updateAuditMeta.id);
  assert.equal(updateAudit.input?.autoPublish, true);

  // 3. PATCH autoPublish = false
  const patchRes2 = await x.call('/api/mcps/' + mid, 'PATCH', { autoPublish: false });
  assert.equal(patchRes2.status, 200);
  assert.equal(patchRes2.data.autoPublish, false);
  assert.equal(x.hub.store.get('mcp', mid).autoPublish, false);
});

test('admin assistant: connector_update supports autoPublish', async t => {
  const x = await fixture(t);

  // Tạo admin assistant token
  const adminRes = await x.call('/api/admin-assistant', 'POST', { password: 'owner-password-123' });
  assert.equal(adminRes.status, 201);
  const adminToken = adminRes.data.token;

  // Tạo connector
  const addRes = await x.call('/api/mcps', 'POST', {
    provider: 'remote',
    name: 'Remote MCP',
    url: 'https://example.com/mcp'
  });
  const mid = addRes.data.id;
  assert.equal(addRes.data.autoPublish, false);

  // Gọi connector_update với autoPublish: true qua /mcp/admin
  const rpcRes = await x.call(
    '/mcp/admin',
    'POST',
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'connector_update',
        arguments: { id: mid, autoPublish: true }
      }
    },
    { Cookie: '', 'X-CSRF-Token': '', Authorization: 'Bearer ' + adminToken }
  );
  assert.equal(rpcRes.status, 200);
  assert.equal(rpcRes.data.result.isError, false);

  // Kiểm tra connector đã cập nhật autoPublish: true
  const stateRes = await x.call('/api/state');
  const mcp = stateRes.data.mcps.find(m => m.id === mid);
  assert.equal(mcp.autoPublish, true);

  // Gọi connector_update để tắt lại autoPublish
  const rpcRes2 = await x.call(
    '/mcp/admin',
    'POST',
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'connector_update',
        arguments: { id: mid, autoPublish: false }
      }
    },
    { Cookie: '', 'X-CSRF-Token': '', Authorization: 'Bearer ' + adminToken }
  );
  assert.equal(rpcRes2.status, 200);
  assert.equal(rpcRes2.data.result.isError, false);
  const mcpAfter = x.hub.store.get('mcp', mid);
  assert.equal(mcpAfter.autoPublish, false);
});

test('sync: tool publication follows autoPublish for standard connectors', async t => {
  let mockTools = [
    {
      name: 'read_items',
      description: 'Read only tool',
      inputSchema: { type: 'object' },
      annotations: { readOnlyHint: true }
    },
    {
      name: 'delete_items',
      description: 'Write/destructive tool',
      inputSchema: { type: 'object' },
      annotations: { readOnlyHint: false }
    }
  ];

  const x = await fixture(t, {
    sync: async () => mockTools,
    call: async () => ({ content: [{ type: 'text', text: 'ok' }] })
  });

  // Tạo connector thường
  const addRes = await x.call('/api/mcps', 'POST', {
    provider: 'remote',
    name: 'Standard Remote',
    url: 'https://example.com/mcp'
  });
  const mid = addRes.data.id;

  // 1. Sync lần 1 khi autoPublish = false (mặc định)
  const sync1 = await x.call('/api/mcps/' + mid + '/sync', 'POST');
  assert.equal(sync1.status, 200);
  const readTool1 = sync1.data.tools.find(t => t.name === 'read_items');
  const writeTool1 = sync1.data.tools.find(t => t.name === 'delete_items');
  assert.equal(readTool1.published, true, 'read tool should be published by default');
  assert.equal(writeTool1.published, false, 'write tool should be hidden by default when autoPublish is false');

  // Đổi trạng thái read_items thành false bằng PATCH published
  await x.call('/api/mcps/' + mid, 'PATCH', { published: [] });
  const checkMcp = x.hub.store.get('mcp', mid);
  assert.equal(checkMcp.tools.find(t => t.name === 'read_items').published, false);

  // 2. Bật autoPublish = true
  await x.call('/api/mcps/' + mid, 'PATCH', { autoPublish: true });

  // Thêm một tool mới vào upstream
  mockTools.push({
    name: 'update_items',
    description: 'New write tool',
    inputSchema: { type: 'object' }
    // Không có annotations hoặc readOnlyHint: false
  });

  // Sync lần 2 khi autoPublish = true
  const sync2 = await x.call('/api/mcps/' + mid + '/sync', 'POST');
  assert.equal(sync2.status, 200);

  // Tool cũ (read_items) đã có trong old và có published: false -> PHẢI GIỮ NGUYÊN false!
  const readTool2 = sync2.data.tools.find(t => t.name === 'read_items');
  assert.equal(readTool2.published, false, 'existing tool must preserve its previous published state');

  // Tool cũ (delete_items) đã có trong old và có published: false -> GIỮ NGUYÊN false!
  const writeTool2 = sync2.data.tools.find(t => t.name === 'delete_items');
  assert.equal(writeTool2.published, false, 'existing tool must preserve its previous published state');

  // Tool MỚI (update_items) chưa có trong old -> PHẢI ĐƯỢC TỰ ĐỘNG PUBLISH vì autoPublish === true
  const newTool = sync2.data.tools.find(t => t.name === 'update_items');
  assert.equal(newTool.published, true, 'new tool must be auto-published when autoPublish is true');
});

test('legacy connector record without autoPublish field returns autoPublish: false in cleanMcp', async t => {
  const x = await fixture(t);
  // Giả lập một bản ghi connector cũ trong store không có trường autoPublish
  x.hub.store.put('mcp', 'legacy_mcp', {
    id: 'legacy_mcp',
    name: 'Legacy Service',
    provider: 'remote',
    on: true,
    tools: []
  });

  const stateRes = await x.call('/api/state');
  const legacy = stateRes.data.mcps.find(m => m.id === 'legacy_mcp');
  assert(legacy);
  assert.equal(legacy.autoPublish, false);
});

test('kho connector maintains its own rule (always published for new tools) regardless of autoPublish', async t => {
  let mockTools = [
    {
      name: 'kho_tool_one',
      description: 'Kho tool',
      inputSchema: { type: 'object' },
      annotations: { readOnlyHint: false }
    }
  ];

  const x = await fixture(t, {
    sync: async () => mockTools,
    call: async () => ({ content: [{ type: 'text', text: 'ok' }] })
  });

  // Tạo kho connector
  const addRes = await x.call('/api/mcps', 'POST', {
    provider: 'remote',
    name: 'kho-ryan',
    url: 'https://example.com/kho',
    isKho: true
  });
  const mid = addRes.data.id;
  assert.equal(addRes.data.autoPublish, false);

  // Sync khi autoPublish = false, nhưng vì là Kho connector nên tool mới vẫn được published: true
  const syncRes = await x.call('/api/mcps/' + mid + '/sync', 'POST');
  assert.equal(syncRes.status, 200);
  const tool = syncRes.data.tools.find(t => t.name === 'kho_tool_one');
  assert.equal(tool.published, true, 'kho connector tools must be published by default');
});
