import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
import { createMonitor } from '../server/monitor.mjs';
import { HubError } from '../server/net.mjs';
import { createChatService } from '../server/llm.mjs';

import { seedMonitor } from './monitor-fixture.mjs';

test('Monitor effective access agrees with real tools/list across publication, grants and revocation', async t => {
  const x = await fixture(t);
  seedMonitor(x.hub.store);
  const worker = (
    await x.call('/api/agents', 'POST', { name: 'Access check', permissions: ['mcp-one:echo'] })
  ).data;
  const list = async () =>
    (
      await x.call(
        '/mcp',
        'POST',
        { jsonrpc: '2.0', id: 1, method: 'tools/list' },
        { Authorization: 'Bearer ' + worker.token }
      )
    ).data;
  const tool = async () =>
    (await x.call('/api/monitor')).data.tools.find(t => t.mcpId === 'mcp-one' && t.name === 'echo');
  assert.ok((await tool()).callableBy.includes(worker.id));
  assert.ok((await list()).result.tools.some(t => t.name === 'mcp-one__echo'));
  await x.call('/api/mcps/mcp-one', 'PATCH', { published: [] });
  assert.ok((await tool()).grantedTo.includes(worker.id), 'saved grant survives unpublishing');
  assert.ok(!(await tool()).callableBy.includes(worker.id));
  assert.ok(!(await list()).result.tools.some(t => t.name === 'mcp-one__echo'));
  await x.call('/api/mcps/mcp-one', 'PATCH', { published: ['echo'] });
  const record = x.hub.store.get('agent', worker.id);
  x.hub.store.put('agent', worker.id, { ...record, status: 'revoked' });
  assert.ok((await tool()).grantedTo.includes(worker.id));
  assert.ok(!(await tool()).callableBy.includes(worker.id));
  assert.ok(!(await list()).result?.tools, 'revoked agent cannot list tools');
});

test('Monitor filters totals and recent requests before limiting; missing tool names are audited', async t => {
  const x = await fixture(t);
  seedMonitor(x.hub.store);
  x.hub.store.audit('agent-two', 'mcp-two', 'echo', 'success', {}, {});
  for (let i = 0; i < 40; i++) x.hub.store.audit('agent-one', 'mcp-one', 'echo', 'success', {}, {});
  const selected = (await x.call('/api/monitor?actor=agent-two')).data;
  assert.equal(selected.totals.calls, 1);
  assert.equal(selected.recent.length, 1);
  assert.equal(selected.recent[0].actor, 'agent-two');
  const worker = (await x.call('/api/agents', 'POST', { name: 'Invalid call', permissions: [] }))
    .data;
  const response = await x.call(
    '/mcp',
    'POST',
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: { startsWith: 'invalid' } } },
    { Authorization: 'Bearer ' + worker.token }
  );
  assert.equal(response.data.error.code, -32602);
  assert.equal(x.hub.monitor.active().length, 0);
  assert.equal(x.hub.store.logs(1)[0].errorCategory, 'validation');
});

test('Monitor uses all retained calls, distinct IDs, real inventory and no credential/payload exposure', async t => {
  const x = await fixture(t);
  const s = x.hub.store;
  seedMonitor(s);
  s.put('vault', 'vault-one', {
    id: 'vault-one',
    name: 'Khóa riêng',
    secret: s.seal({ secret: 'never-reveal-this' })
  });
  for (let i = 0; i < 275; i++)
    s.audit(
      'agent-one',
      'mcp-one',
      'echo',
      'success',
      { text: 'nội dung riêng', token: 'never-reveal-this' },
      { ok: true },
      2
    );
  s.audit('agent-two', 'mcp-two', 'echo', 'success', { text: 'two' }, { ok: true }, 2);
  s.audit('owner', 'mcp-one', 'echo', 'success', {}, {});
  s.audit('system', 'hub', 'system.backup', 'success', {}, {});
  s.audit('agent-admin', 'mcp-one', 'echo', 'success', {}, {}, 1, '', {
    eventKind: 'admin_action',
    actorType: 'admin'
  });
  const a = (await x.call('/api/monitor')).data;
  assert.equal(a.totals.calls, 276);
  assert.equal(a.totals.tools, 6);
  assert.equal(a.totals.secrets, 1);
  assert.equal(a.agents.find(a => a.id === 'agent-one').calls, 275);
  assert.equal(a.agents.find(a => a.id === 'agent-two').calls, 1);
  assert.equal(a.tools.find(t => t.mcpId === 'mcp-one' && t.name === 'echo').retainedCalls, 275);
  assert.equal(a.recent.length, 30);
  assert.ok(a.totals.inputBytes > 0);
  assert.ok(!JSON.stringify(a).includes('never-reveal-this'));
  assert.ok(!JSON.stringify(a).includes('nội dung riêng'));
  s.put('mcp', 'mcp-one', { ...s.get('mcp', 'mcp-one'), on: false });
  const b = (await x.call('/api/monitor')).data;
  assert.equal(b.tools.filter(t => t.mcpId === 'mcp-one').length, 3);
  assert.ok(b.tools.filter(t => t.mcpId === 'mcp-one').every(t => !t.available));
  assert.equal((await x.call('/api/monitor?period=999')).status, 400);
  assert.equal((await fetch(x.origin + '/api/monitor')).status, 401);
  assert.equal((await fetch(x.origin + '/api/monitor/active')).status, 401);
  assert.equal((await fetch(x.origin + '/monitor.js')).status, 200);
  assert.equal((await fetch(x.origin + '/monitor.css')).status, 200);
  const count = s.db.prepare('SELECT COUNT(*) AS n FROM audit').get().n;
  await x.call('/api/monitor');
  await x.call('/api/monitor/active');
  assert.equal(
    s.db.prepare('SELECT COUNT(*) AS n FROM audit').get().n,
    count,
    'monitor reads must not self-inflate logs'
  );
});

test('Monitor tracks a real in-flight HTTP RPC and persists the completed timeline without duplicating the call', async t => {
  let release, entered;
  const started = new Promise(r => (entered = r)),
    gate = new Promise(r => (release = r));
  t.after(() => release());
  const x = await fixture(t, {
    call: async () => {
      entered();
      await gate;
      return { content: [{ type: 'text', text: 'finished' }] };
    }
  });
  seedMonitor(x.hub.store);
  const agent = await x.call('/api/agents', 'POST', {
    name: 'Worker',
    permissions: ['mcp-one:echo']
  });
  const pending = x.call(
    '/mcp',
    'POST',
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'mcp-one__echo', arguments: { text: 'private input' } }
    },
    { Authorization: 'Bearer ' + agent.data.token }
  );
  await started;
  const active = (await x.call('/api/monitor/active')).data.active;
  assert.equal(active.length, 1);
  assert.equal(active[0].phase, 'dispatch');
  assert.equal(active[0].state, 'running');
  assert.ok(!JSON.stringify(active).includes('private input'));
  release();
  assert.equal((await pending).data.result.content[0].text, 'finished');
  assert.equal((await x.call('/api/monitor/active')).data.active.length, 0);
  const logs = (await x.call('/api/logs?operationId=' + active[0].id)).data;
  assert.equal(logs.length, 1);
  assert.deepEqual(
    logs[0].timeline.map(x => x.phase),
    ['received', 'policy', 'dispatch', 'response', 'audit']
  );
  assert.equal(logs[0].operationId, active[0].id);
});

test('Denied permissions never dispatch; published toggles are effective; upstream failure completes with error', async t => {
  let calls = 0;
  const x = await fixture(t, {
    call: async () => {
      calls++;
      throw new HubError('Dịch vụ từ chối', 401);
    }
  });
  seedMonitor(x.hub.store);
  const agent = (await x.call('/api/agents', 'POST', { name: 'Worker', permissions: [] })).data;
  const rpc = () =>
    x.call(
      '/mcp',
      'POST',
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'mcp-one__echo', arguments: { text: 'hello' } }
      },
      { Authorization: 'Bearer ' + agent.token }
    );
  assert.ok((await rpc()).data.error);
  assert.equal(calls, 0);
  let log = x.hub.store.logs(1)[0];
  assert.equal(log.policyDecision, 'deny');
  assert.ok(!log.timeline.some(e => e.phase === 'dispatch'));
  await x.call('/api/agents/' + agent.id, 'PATCH', { permissions: ['mcp-one:echo'] });
  await x.call('/api/mcps/mcp-one', 'PATCH', { published: [] });
  assert.ok((await rpc()).data.error);
  assert.equal(calls, 0);
  await x.call('/api/mcps/mcp-one', 'PATCH', { published: ['echo'] });
  assert.equal((await rpc()).data.result.isError, true);
  assert.equal(calls, 1);
  log = x.hub.store.logs(1)[0];
  assert.equal(log.status, 'error');
  assert.equal(log.errorCategory, 'authentication');
  assert.equal((await x.call('/api/monitor/active')).data.active.length, 0);
});

test('Restart preserves unknown outcomes, legacy byte gaps, and missing timeline evidence', async t => {
  const x = await fixture(t);
  seedMonitor(x.hub.store);
  const op = x.hub.monitor.begin({ actor: 'agent-one', mcp: 'mcp-one', tool: 'echo' });
  op.phase('dispatch');
  const restarted = createMonitor(x.hub.store);
  assert.equal(restarted.active()[0].state, 'interrupted');
  x.hub.store.audit('agent-one', 'mcp-one', 'echo', 'success', {}, {});
  x.hub.store.db.exec('UPDATE audit SET inputBytes=NULL,outputBytes=NULL');
  const data = restarted.snapshot();
  assert.equal(data.totals.calls, 1);
  assert.equal(data.coverage.bytesMissing, 1);
  assert.equal(x.hub.store.logs(1)[0].timeline, undefined);
});

test('Chat context resolves selected record on server and contains neither raw values nor audit content', async t => {
  const x = await fixture(t);
  seedMonitor(x.hub.store);
  const id = Number(
    x.hub.store.audit(
      'agent-one',
      'mcp-one',
      'echo',
      'denied',
      { text: 'PRIVATE-DOCUMENT' },
      { secret: 'PRIVATE-KEY' },
      1,
      'Không được cấp quyền'
    ).lastInsertRowid
  );
  const context = x.hub.monitor.chatContext({ logId: id, actor: 'agent-one' });
  assert.equal(context.selected.request.policyDecision, 'deny');
  assert.equal(context.agents.length, 1);
  assert.equal(context.selected.request.id, id);
  assert.ok(!JSON.stringify(context).includes('PRIVATE-DOCUMENT'));
  assert.ok(!JSON.stringify(context).includes('PRIVATE-KEY'));
  assert.throws(() => x.hub.monitor.chatContext({ logId: '1 OR 1=1' }), /ID nhật ký/);
});

test('Configured assistant receives real Monitor context through the LLM transport', async t => {
  const x = await fixture(t);
  seedMonitor(x.hub.store);
  x.hub.store.audit('agent-one', 'mcp-one', 'echo', 'success', { text: 'PRIVATE-DOCUMENT' }, {});
  let prompt = '';
  const service = createChatService(x.hub.store, x.origin, {
    monitor: x.hub.monitor,
    transport: async (url, options) => {
      prompt = JSON.parse(options.body).messages[0].content;
      return {
        ok: true,
        status: 200,
        json: { choices: [{ message: { content: 'Đã ghi nhận một lượt gọi.' } }] },
        headers: {}
      };
    }
  });
  service.saveConfig({
    provider: 'openai',
    model: 'test-model',
    apiKey: 'synthetic-llm-credential'
  });
  const result = await service.chat({
    messages: [{ role: 'user', content: 'Agent này đang làm gì?' }],
    currentRoute: 'overview',
    monitorContext: { actor: 'agent-one' }
  });
  assert.match(prompt, /"calls":1/);
  assert.match(prompt, /"actor":"agent-one"/);
  assert.ok(!prompt.includes('PRIVATE-DOCUMENT'));
  assert.ok(!prompt.includes('synthetic-llm-credential'));
  assert.equal(result.message.content, 'Đã ghi nhận một lượt gọi.');
});
