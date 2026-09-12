import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
import { openStore } from '../server/store.mjs';
import { auditStats, payloadBytes } from '../public/audit-stats.js';

const rpc = (x, token, method, params = {}, admin = false) =>
  x.call(
    admin ? '/mcp/admin' : '/mcp',
    'POST',
    { jsonrpc: '2.0', id: 1, method, params },
    { Cookie: '', 'X-CSRF-Token': '', Authorization: 'Bearer ' + token }
  );

test('Issue #27: agent metadata persists, validates atomically and initializes only its authenticated agent', async t => {
  const x = await fixture(t);
  const create = body => x.call('/api/agents', 'POST', { name: 'Agent', ...body });
  const a = (await create({ description: ' Mô tả ', instructions: ' Hướng dẫn riêng\nDòng hai ' }))
    .data;
  const b = (await create({})).data;
  const initialize = token => rpc(x, token, 'initialize');
  assert.ok((await initialize(a.token)).data.result.instructions.endsWith('Hướng dẫn riêng\nDòng hai'));
  assert.ok(
    (await initialize(b.token)).data.result.instructions.endsWith(
      'Chỉ sử dụng các công cụ được owner cấp quyền.'
    )
  );
  for (const [key, max] of [
    ['description', 2000],
    ['instructions', 16000]
  ]) {
    for (const value of [null, 12, {}, 'x'.repeat(max + 1)]) {
      assert.equal((await create({ [key]: value })).status, 400);
      assert.equal(
        (await x.call('/api/agents/' + a.id, 'PATCH', { name: 'Do not save', [key]: value }))
          .status,
        400
      );
    }
    assert.equal(
      (await x.call('/api/agents/' + a.id, 'PATCH', { [key]: 'x'.repeat(max) })).status,
      200
    );
  }
  assert.equal(x.hub.store.get('agent', a.id).name, 'Agent');
  assert.equal(
    (
      await x.call(
        '/api/agents/' + a.id,
        'PATCH',
        { description: 'mới', instructions: 'riêng' },
        { 'X-CSRF-Token': 'bad' }
      )
    ).status,
    403
  );
  await x.call('/api/agents/' + a.id, 'PATCH', { description: 'mới', instructions: 'riêng' });
  const reopened = openStore(x.dir);
  assert.equal(reopened.get('agent', a.id).description, 'mới');
  assert.equal(reopened.get('agent', a.id).instructions, 'riêng');
  reopened.close();
  // Existing OAuth/legacy records need no migration and can also receive custom instructions.
  const legacy = x.hub.store.get('agent', b.id);
  delete legacy.description;
  delete legacy.instructions;
  legacy.client = 'oauth-client';
  x.hub.store.put('agent', b.id, legacy);
  assert.ok(
    (await initialize(b.token)).data.result.instructions.endsWith(
      'Chỉ sử dụng các công cụ được owner cấp quyền.'
    )
  );
  await x.call('/api/agents/' + a.id, 'PATCH', { instructions: ' \n ', description: '' });
  assert.ok(
    (await initialize(a.token)).data.result.instructions.endsWith(
      'Chỉ sử dụng các công cụ được owner cấp quyền.'
    )
  );
  assert.equal((await initialize('invalid')).status, 401);
});

test('Issue #27: API and admin audit filters run before limits; secret reads remain redacted and isolated', async t => {
  const x = await fixture(t);
  const add = (actor, mcp, tool, input = {}) =>
    x.hub.store.audit(actor, mcp, tool, 'success', input, { text: 'Xin chào', token: 'sensitive' });
  add('agent-a', 'mcp-a', 'read', { q: 'cũ' });
  const first = x.hub.store.logs(1)[0];
  for (let i = 0; i < 205; i++) add('agent-b', 'mcp-b', 'read');
  add('agent-a', 'mcp-a', 'write');
  const fetchLogs = filters => x.call('/api/logs?' + new URLSearchParams(filters));
  const filtered = await fetchLogs({ actor: 'agent-a', mcp: 'mcp-a', tool: 'read', limit: 1 });
  assert.deepEqual(
    filtered.data.map(l => l.id),
    [first.id]
  );
  assert.equal(filtered.data[0].output.token, '[REDACTED]');
  assert.equal((await fetchLogs({ actor: "' OR 1=1 --" })).data.length, 0);
  add('agent-a', 'vault', 'vault.read', { id: 'secret-a' });
  add('owner', 'vault', 'vault.update', { id: 'secret-a' });
  for (let i = 0; i < 10; i++) add('agent-b', 'vault', 'vault.read', { id: 'secret-b' });
  const reads = (await fetchLogs({ secret: 'secret-a', limit: 1 })).data;
  assert.equal(reads.length, 1);
  assert.equal(reads[0].actor, 'agent-a');
  assert.equal(reads[0].tool, 'vault.read');
  assert.equal((await fetchLogs({ secret: 'secret-a', actor: 'agent-b' })).data.length, 0);
  assert.equal((await fetchLogs({ since: '2999-01-01T00:00:00Z' })).data.length, 0);
  for (const filters of [
    { since: 'bad' },
    { limit: 5001 },
    { limit: 0 },
    { limit: 1.5 },
    { actor: '' }
  ])
    assert.equal((await fetchLogs(filters)).status, 400);
  assert.equal(
    (await x.call('/api/logs?actor=agent-a', 'GET', undefined, { Cookie: '' })).status,
    401
  );
  const admin = (await x.call('/api/admin-assistant', 'POST', { password: 'owner-password-123' }))
    .data;
  const response = await rpc(
    x,
    admin.token,
    'tools/call',
    { name: 'audit_list', arguments: { actor: 'agent-a', mcp: 'mcp-a', tool: 'read', limit: 1 } },
    true
  );
  assert.equal(response.data.result.isError, false);
  assert.deepEqual(
    JSON.parse(response.data.result.content[0].text).map(l => l.id),
    [first.id]
  );
  const update = await rpc(
    x,
    admin.token,
    'tools/call',
    {
      name: 'agent_create',
      arguments: { name: 'Admin-created', description: 'Mô tả', instructions: 'Riêng' }
    },
    true
  );
  const agent = JSON.parse(update.data.result.content[0].text);
  assert.ok((await rpc(x, agent.token, 'initialize')).data.result.instructions.endsWith('Riêng'));
});

test('Issue #27: statistics count calls and UTF-8 redacted JSON bytes in full GMT+7 time buckets', () => {
  const now = Date.parse('2026-09-10T06:30:00Z');
  const log = (created, extra = {}) => ({
    created,
    actor: 'agent-a',
    mcp: 'mcp-a',
    tool: 'read',
    input: { q: 'Tiếng Việt 🔑' },
    output: { token: '[REDACTED]' },
    ...extra
  });
  const logs = [
    log('2026-09-03T06:30:00Z'),
    log('2026-09-10T05:00:00Z'),
    log('2026-09-10T06:00:00Z', { tool: 'write', status: 'denied' }),
    log('2026-09-10T06:00:00Z', { mcp: 'mcp-b' }),
    log('2026-09-10T06:00:00Z', { actor: 'owner' }),
    log('2026-09-10T06:00:00Z', { actor: 'admin-assistant:x' }),
    log('2026-09-10T06:00:00Z', { mcp: 'hub' }),
    log('2026-09-03T06:29:59Z'),
    log('2026-09-10T06:30:01Z')
  ];
  const stats = auditStats(logs, 168, now);
  assert.equal(
    stats.buckets.reduce((n, b) => n + b.count, 0),
    4
  );
  assert.equal(stats.tools.length, 3);
  const last = stats.buckets.at(-1);
  assert.equal(last.start, Date.parse('2026-09-09T17:00:00Z'));
  assert.equal(last.count, 3);
  const row = last.tools.get('mcp-a / read');
  assert.equal(row.input, Buffer.byteLength(JSON.stringify(logs[0].input)));
  assert.equal(row.output, Buffer.byteLength(JSON.stringify(logs[0].output)));
  assert.equal(payloadBytes(undefined), 0);
  assert.equal(payloadBytes(null), 4);
  const hourly = auditStats([log(new Date(now - 24 * 3600000).toISOString())], 24, now);
  assert.equal(hourly.buckets[0].count, 1);
  assert.equal(auditStats([], 24, now).tools.length, 0);
});
