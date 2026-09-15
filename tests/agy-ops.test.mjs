import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AGY_SESSIONS,
  createAgyOps
} from '../server/agy-ops.mjs';
import { catalog } from '../server/catalog.mjs';
import { checkToolPermissions, connectorService } from '../server/connectors.mjs';
import { canCallTool } from '../server/tool-access.mjs';
import { HubError } from '../server/net.mjs';
import { openStore } from '../server/store.mjs';

function fixtureStore(t) {
  const dir = mkdtempSync(join(tmpdir(), 'genhub-agy-ops-'));
  const store = openStore(dir);
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return store;
}

test('Agy Ops rejects unknown sessions before child_process is called', async () => {
  const calls = [];
  const ops = createAgyOps({
    execFile: async (...args) => {
      calls.push(args);
      return { stdout: '' };
    },
    sleep: async () => {}
  });

  for (const operation of [
    () => ops.sessionAlive('attacker-controlled; touch /tmp/pwned'),
    () => ops.paneContent('../other-session'),
    () => ops.sessionStatus(''),
    () => ops.dispatch('unknown', 'brief')
  ]) {
    await assert.rejects(operation, error => error instanceof HubError && /không hợp lệ/.test(error.message));
  }
  assert.deepEqual(calls, []);
});

test('Agy Ops status and dispatch use execFile argument arrays without a shell', async () => {
  const calls = [];
  const writes = [];
  const pane = 'đang nghỉ\nAsk Codex to do anything\n';
  const ops = createAgyOps({
    execFile: async (file, args) => {
      calls.push({ file, args });
      if (args[0] === 'capture-pane') return { stdout: pane };
      if (args[0] === 'display-message') return { stdout: '/tmp/codex-session\n' };
      return { stdout: '' };
    },
    writeFile: async (...args) => writes.push(args),
    sleep: async () => {}
  });

  assert.deepEqual(await ops.sessionStatus('codex-astra'), {
    session: 'codex-astra', alive: true, idle: true, snippet: pane.trim()
  });
  const longBrief = `Phần một\n\n${'nội dung '.repeat(60)}`;
  await ops.dispatch('codex-astra', longBrief);
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], '/tmp/codex-session/DISPATCH_BRIEF.md');
  assert.equal(writes[0][1], longBrief.trim());
  assert.deepEqual(calls.at(-2), {
    file: 'tmux',
    args: [
      'send-keys', '-t', 'codex-astra', '-l', '--',
      'Doc ky file DISPATCH_BRIEF.md trong thu muc hien tai roi bat dau lam theo do.'
    ]
  });
  assert.deepEqual(calls.at(-1), { file: 'tmux', args: ['send-keys', '-t', 'codex-astra', 'Enter'] });
  assert(calls.every(call => call.file === 'tmux' && Array.isArray(call.args)));
});

test('Agy Ops queue CRUD preserves explicit and default order', t => {
  const store = fixtureStore(t);
  const ops = createAgyOps();
  const first = ops.queueTask(store, {
    session: 'agy-colamacbook', title: 'Việc sau', brief: 'Làm sau', order: 8
  });
  const second = ops.queueTask(store, {
    session: 'agy-colabotmac', title: 'Việc tự nối', brief: 'Làm kế tiếp'
  });
  const early = ops.queueTask(store, {
    session: 'codex-astra', title: 'Việc trước', brief: 'Làm trước', order: 2
  });

  assert.deepEqual(ops.listTasks(store).map(task => task.order), [2, 8, 9]);
  assert.deepEqual(ops.listTasks(store, { session: 'agy-colabotmac' }).map(task => task.id), [second.id]);
  const dispatched = ops.setTaskStatus(store, first.id, 'dispatched', 'Đã gửi');
  assert.equal(dispatched.status, 'dispatched');
  assert.match(dispatched.dispatched_at, /^\d{4}-/);
  assert.equal(dispatched.note, 'Đã gửi');
  const done = ops.setTaskStatus(store, first.id, 'done');
  assert.match(done.done_at, /^\d{4}-/);
  assert.deepEqual(ops.deleteTask(store, early.id), { id: early.id, deleted: true });
  assert.equal(ops.listTasks(store).length, 2);
  assert.throws(() => ops.queueTask(store, {
    session: 'not-allowed', title: 'Không hợp lệ', brief: 'Không được lưu'
  }), HubError);
});

test('auto dispatch sends only the first queued task when a session is idle', async t => {
  const store = fixtureStore(t);
  const calls = [];
  const ops = createAgyOps({
    execFile: async (file, args) => {
      calls.push({ file, args });
      if (args[0] === 'capture-pane') return { stdout: 'Agy prompt rảnh\n' };
      return { stdout: '' };
    },
    sleep: async () => {}
  });
  const first = ops.queueTask(store, {
    session: 'agy-colamacbook', title: 'Một', brief: 'Brief một'
  });
  const second = ops.queueTask(store, {
    session: 'agy-colamacbook', title: 'Hai', brief: 'Brief hai'
  });

  const result = await ops.autoDispatchTick(store);
  assert.equal(result.find(row => row.session === 'agy-colamacbook').status, 'dispatched');
  assert.equal(store.get('agy_task', first.id).status, 'dispatched');
  assert.equal(store.get('agy_task', second.id).status, 'queued');
  assert(calls.some(call => call.args[0] === 'send-keys' && call.args.includes('Brief một')));
  assert(!calls.some(call => call.args.includes('Brief hai')));
});

test('Agy Ops catalog permissions remain gated by publication and per-agent grant', () => {
  const definition = catalog.find(item => item.id === 'agy-ops');
  assert(definition);
  assert.equal(definition.auth, 'none');
  assert.deepEqual(Object.keys(AGY_SESSIONS), [
    'agy-colamacbook', 'agy-colabotmac', 'agy-genesiscorpos', 'codex-astra'
  ]);
  assert.deepEqual(definition.tools.map(tool => tool.name), [
    'list_sessions', 'get_status', 'dispatch', 'queue_task', 'list_tasks',
    'set_task_status', 'delete_task', 'auto_dispatch_tick'
  ]);
  const evaluated = checkToolPermissions({ provider: 'agy-ops' }, definition.tools);
  assert(evaluated.every(tool => tool.permission.status === 'ok'));
  assert(evaluated.every(tool => tool.permission.reason === 'Khả dụng (local)'));

  const mcp = { id: 'mcp-agy', on: true, status: 'connected' };
  const tool = { name: 'list_sessions', published: true };
  assert.equal(canCallTool({ status: 'active', permissions: [] }, mcp, tool), false);
  assert.equal(
    canCallTool({ status: 'active', permissions: ['mcp-agy:list_sessions'] }, mcp, tool),
    true
  );
  assert.equal(
    canCallTool({ status: 'active', permissions: ['mcp-agy:list_sessions'] }, mcp, { ...tool, published: false }),
    false
  );
});

test('connectorService routes Agy Ops calls locally through the shared store', async t => {
  const store = fixtureStore(t);
  const service = connectorService(store);
  const mcp = { id: 'mcp-agy', provider: 'agy-ops', auth: 'none' };
  const queued = await service.call(mcp, 'queue_task', {
    session: 'agy-colamacbook', title: 'Qua connector', brief: 'Không gọi mạng'
  });
  const task = JSON.parse(queued.content[0].text);
  assert.equal(task.status, 'queued');
  const listed = await service.call(mcp, 'list_tasks', {});
  assert.deepEqual(JSON.parse(listed.content[0].text).map(row => row.id), [task.id]);
});
