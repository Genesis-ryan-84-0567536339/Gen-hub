import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
import { formatNotification, getNotifications, timeAgo } from '../public/notifications.js';

test('Issue #29: formatNotification correctly transforms audit logs into notifications', () => {
  const state = {
    owner: 'ryan',
    agents: [
      { id: 'agent-1', name: 'Claude Agent' },
      { id: 'agent-2', name: 'Codex Agent' }
    ],
    mcps: [
      { id: 'mcp-1', name: 'GitHub MCP' },
      { id: 'mcp-2', name: 'Drive MCP' }
    ]
  };

  // 1. Agent lifecycle
  const nAgentCreate = formatNotification(
    {
      id: 1,
      created: '2026-09-10T07:00:00.000Z',
      actor: 'owner',
      mcp: 'hub',
      tool: 'agent.create',
      status: 'success',
      input: { name: 'Astra Web' }
    },
    state
  );
  assert.equal(nAgentCreate.title, 'Agent mới kết nối');
  assert.ok(nAgentCreate.message.includes('Astra Web'));
  assert.equal(nAgentCreate.target, '#agents');
  assert.equal(nAgentCreate.level, 'info');
  assert.equal(nAgentCreate.icon, 'bot');

  const nAgentRemove = formatNotification(
    {
      id: 2,
      created: '2026-09-10T07:05:00.000Z',
      actor: 'owner',
      mcp: 'hub',
      tool: 'agent.remove',
      status: 'success',
      input: { id: 'agent-2', name: 'Codex Agent' }
    },
    state
  );
  assert.equal(nAgentRemove.title, 'Đã xóa agent');
  assert.ok(nAgentRemove.message.includes('Codex Agent'));
  assert.equal(nAgentRemove.target, '#agents');
  assert.equal(nAgentRemove.level, 'warn');

  const nAgentRevoke = formatNotification(
    {
      id: 3,
      created: '2026-09-10T07:10:00.000Z',
      actor: 'owner',
      mcp: 'hub',
      tool: 'agent.update',
      status: 'success',
      input: { id: 'agent-1', status: 'revoked' }
    },
    state
  );
  assert.equal(nAgentRevoke.title, 'Thu hồi agent');
  assert.ok(nAgentRevoke.message.includes('Claude Agent'));
  assert.equal(nAgentRevoke.level, 'warn');

  // 2. Connector lifecycle
  const nConnectorConn = formatNotification(
    {
      id: 4,
      created: '2026-09-10T07:15:00.000Z',
      actor: 'owner',
      mcp: 'mcp-1',
      tool: 'connection.authorize',
      status: 'success'
    },
    state
  );
  assert.equal(nConnectorConn.title, 'Connector đã kết nối');
  assert.ok(nConnectorConn.message.includes('GitHub MCP'));
  assert.equal(nConnectorConn.target, '#mcps');
  assert.equal(nConnectorConn.level, 'info');

  const nConnectorDisconn = formatNotification(
    {
      id: 5,
      created: '2026-09-10T07:20:00.000Z',
      actor: 'owner',
      mcp: 'mcp-1',
      tool: 'connection.disconnect',
      status: 'success'
    },
    state
  );
  assert.equal(nConnectorDisconn.title, 'Connector ngắt kết nối');
  assert.equal(nConnectorDisconn.level, 'warn');
  assert.equal(nConnectorDisconn.target, '#mcps');

  const nMcpSync = formatNotification(
    {
      id: 6,
      created: '2026-09-10T07:22:00.000Z',
      actor: 'owner',
      mcp: 'mcp-2',
      tool: 'mcp.sync',
      status: 'success',
      output: { toolCount: 4 }
    },
    state
  );
  assert.equal(nMcpSync.title, 'Đồng bộ connector');
  assert.ok(nMcpSync.message.includes('4 tool'));

  // 3. Vault operations
  const nVaultReadSuccess = formatNotification(
    {
      id: 7,
      created: '2026-09-10T07:25:00.000Z',
      actor: 'agent-1',
      mcp: 'vault',
      tool: 'vault.read',
      status: 'success',
      input: { id: 'OPENAI_API_KEY' }
    },
    state
  );
  assert.equal(nVaultReadSuccess.title, 'Secret được truy cập');
  assert.ok(nVaultReadSuccess.message.includes('Claude Agent'));
  assert.ok(nVaultReadSuccess.message.includes('OPENAI_API_KEY'));
  assert.equal(nVaultReadSuccess.target, '#vault');
  assert.equal(nVaultReadSuccess.level, 'security');

  const nVaultReadDenied = formatNotification(
    {
      id: 8,
      created: '2026-09-10T07:26:00.000Z',
      actor: 'agent-2',
      mcp: 'vault',
      tool: 'vault.read',
      status: 'denied',
      input: { id: 'PROD_DB_SECRET' }
    },
    state
  );
  assert.equal(nVaultReadDenied.title, 'Từ chối đọc secret');
  assert.equal(nVaultReadDenied.level, 'error');

  // 4. Security PIN & settings
  const nPinFailed = formatNotification(
    {
      id: 9,
      created: '2026-09-10T07:28:00.000Z',
      actor: 'owner',
      mcp: 'hub',
      tool: 'security.pin_check',
      status: 'denied',
      input: { operation: 'agent.remove' }
    },
    state
  );
  assert.equal(nPinFailed.title, 'Nhập sai mã PIN');
  assert.equal(nPinFailed.level, 'error');
  assert.equal(nPinFailed.target, '#settings');

  // 5. Tool call error vs success
  const nToolCallError = formatNotification(
    {
      id: 10,
      created: '2026-09-10T07:30:00.000Z',
      actor: 'agent-1',
      mcp: 'mcp-1',
      tool: 'create_issue',
      status: 'error',
      reason: 'Validation failed'
    },
    state
  );
  assert.equal(nToolCallError.title, 'Tool call lỗi');
  assert.ok(nToolCallError.message.includes('Validation failed'));
  assert.equal(nToolCallError.level, 'error');
  assert.equal(nToolCallError.target, '#audit');

  const nToolCallSuccess = formatNotification(
    {
      id: 11,
      created: '2026-09-10T07:32:00.000Z',
      actor: 'agent-1',
      mcp: 'mcp-1',
      tool: 'search_repositories',
      status: 'success'
    },
    state
  );
  assert.equal(nToolCallSuccess.title, 'Lượt gọi tool: search_repositories');
  assert.equal(nToolCallSuccess.level, 'normal');
  assert.equal(nToolCallSuccess.target, '#audit');
});

test('Issue #29: getNotifications tracks unread count based on lastRead timestamp', () => {
  const logs = [
    { id: 1, created: '2026-09-10T07:00:00.000Z', actor: 'owner', tool: 'mcp.add' },
    { id: 2, created: '2026-09-10T07:10:00.000Z', actor: 'owner', tool: 'agent.create' },
    { id: 3, created: '2026-09-10T07:20:00.000Z', actor: 'owner', tool: 'vault.create' }
  ];

  // If lastRead is 0 (never read before), all logs are unread
  const res1 = getNotifications(logs, {}, 0);
  assert.equal(res1.notifications.length, 3);
  assert.equal(res1.unreadCount, 3);
  // Sorted newest first: id 3, 2, 1
  assert.equal(res1.notifications[0].id, 3);
  assert.equal(res1.notifications[1].id, 2);
  assert.equal(res1.notifications[2].id, 1);

  // If lastRead is after log 1 but before log 2
  const readAfter1 = Date.parse('2026-09-10T07:05:00.000Z');
  const res2 = getNotifications(logs, {}, readAfter1);
  assert.equal(res2.unreadCount, 2);
  assert.equal(res2.notifications[0].unread, true); // id 3
  assert.equal(res2.notifications[1].unread, true); // id 2
  assert.equal(res2.notifications[2].unread, false); // id 1

  // If lastRead is after all logs
  const readAfterAll = Date.parse('2026-09-10T07:30:00.000Z');
  const res3 = getNotifications(logs, {}, readAfterAll);
  assert.equal(res3.unreadCount, 0);
  assert.ok(res3.notifications.every(n => n.unread === false));
});

test('Issue #29: timeAgo formats relative times accurately in Vietnamese', () => {
  const now = Date.parse('2026-09-10T12:00:00.000Z');

  assert.equal(timeAgo(now - 5000, now), 'Vừa xong');
  assert.equal(timeAgo(now - 45000, now), '45 giây trước');
  assert.equal(timeAgo(now - 120000, now), '2 phút trước');
  assert.equal(timeAgo(now - 7200000, now), '2 giờ trước');
  assert.equal(timeAgo(now - 172800000, now), '2 ngày trước');
  assert.equal(timeAgo('invalid', now), 'Vừa xong');
});

test('Issue #29: GET /notifications.js is served with JavaScript mime type', async t => {
  const x = await fixture(t);
  const res = await fetch(x.origin + '/notifications.js');
  assert.equal(res.status, 200);
  assert.ok(res.headers.get('content-type')?.includes('text/javascript'));
  const text = await res.text();
  assert.ok(text.includes('formatNotification'));
  assert.ok(text.includes('getNotifications'));
});
