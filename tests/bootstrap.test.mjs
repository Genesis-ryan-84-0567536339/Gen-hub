import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';

test('Bootstrap API: get defaults, update groups, validate and expose in state', async t => {
  const x = await fixture(t);

  // 1. Initial GET returns defaults
  const initRes = await x.call('/api/bootstrap');
  assert.equal(initRes.status, 200);
  assert.equal(Array.isArray(initRes.data.groups), true);
  assert.equal(initRes.data.groups.length, 4);
  assert.equal(initRes.data.groups[0].title, 'Kết nối nguồn chuẩn');

  // 2. Initial state includes bootstrap
  const stateRes = await x.call('/api/state');
  assert.equal(stateRes.status, 200);
  assert.ok(stateRes.data.bootstrap);
  assert.equal(stateRes.data.bootstrap.groups.length, 4);

  // 3. Validation: reject invalid payloads
  const bad1 = await x.call('/api/bootstrap', 'PATCH', { groups: 'not an array' });
  assert.equal(bad1.status, 400);

  const bad2 = await x.call('/api/bootstrap', 'PATCH', {
    groups: [{ title: '   ', steps: [] }]
  });
  assert.equal(bad2.status, 400);

  // 4. Update with custom groups
  const customGroups = [
    {
      id: 'grp-test1',
      title: 'Nhóm quy trình kiểm thử',
      steps: [
        {
          id: 'step-test1',
          title: 'Chạy unit test',
          content: 'Luôn chạy npm test trước khi commit code.'
        },
        {
          id: 'step-test2',
          title: 'Chạy UI test',
          content: 'Kiểm tra giao diện người dùng với npm run test:ui.'
        }
      ]
    }
  ];

  const updateRes = await x.call('/api/bootstrap', 'PATCH', { groups: customGroups });
  assert.equal(updateRes.status, 200);
  assert.equal(updateRes.data.groups.length, 1);
  assert.equal(updateRes.data.groups[0].title, 'Nhóm quy trình kiểm thử');
  assert.equal(updateRes.data.groups[0].steps.length, 2);
  assert.ok(updateRes.data.updated);

  // 5. Subsequent GET returns updated groups
  const getRes = await x.call('/api/bootstrap');
  assert.equal(getRes.status, 200);
  assert.equal(getRes.data.groups.length, 1);
  assert.equal(getRes.data.groups[0].title, 'Nhóm quy trình kiểm thử');

  // 6. Audit log contains bootstrap.update in store
  const logs = x.hub.store.logs(20);
  const auditLog = logs.find(l => l.tool === 'bootstrap.update');
  assert.ok(auditLog, 'Audit log must record bootstrap.update');
  assert.equal(auditLog.mcp, 'hub');
});

test('Bootstrap: create-brain requires a connected GitHub connector and seeds a minimal repo', async t => {
  const calls = [];
  // Envelope khớp đúng thật sự trả về bởi connectorService().call() cho các
  // provider REST thường: {content:[{type:'text', text: JSON}], isError}.
  const envelope = data => ({ content: [{ type: 'text', text: JSON.stringify(data) }], isError: false });
  const connector = {
    call: async (m, name, a) => {
      calls.push({ mcpId: m.id, name, args: a });
      if (name === 'create_repository')
        return envelope({
          name: a.name,
          full_name: 'owner-test/' + a.name,
          html_url: 'https://github.com/owner-test/' + a.name,
          owner: { login: 'owner-test' }
        });
      if (name === 'create_or_update_file') return envelope({ content: { path: a.path } });
      throw new Error('unexpected tool ' + name);
    }
  };
  const x = await fixture(t, connector);

  // 1. No GitHub connector connected yet -> clear error, no calls made
  const noConnRes = await x.call('/api/bootstrap/create-brain', 'POST', { name: 'Brain' });
  assert.equal(noConnRes.status, 400);
  assert.equal(calls.length, 0);

  // 2. Seed a connected GitHub connector
  x.hub.store.put('mcp', 'mcp-gh-test', {
    id: 'mcp-gh-test',
    provider: 'github',
    name: 'GitHub',
    on: true,
    status: 'connected',
    secret: x.hub.store.seal({ token: 'test-token' }),
    tools: []
  });

  const res = await x.call('/api/bootstrap/create-brain', 'POST', { name: 'Brain' });
  assert.equal(res.status, 200);
  assert.equal(res.data.url, 'https://github.com/owner-test/Brain');
  assert.equal(res.data.full_name, 'owner-test/Brain');

  // 3. Exact call order: create_repository once, then create_or_update_file for each seed file
  assert.equal(calls[0].name, 'create_repository');
  assert.equal(calls[0].args.name, 'Brain');
  const fileCalls = calls.slice(1);
  assert.equal(fileCalls.length, 3);
  assert(fileCalls.every(c => c.name === 'create_or_update_file'));
  assert.deepEqual(
    fileCalls.map(c => c.args.path).sort(),
    ['BOOTSTRAP.md', 'README.md', 'skills/index.yaml'].sort()
  );
  assert(fileCalls.every(c => c.args.owner === 'owner-test' && c.args.repo === 'Brain'));
});

test('Bootstrap: create-brain works with provider github-mcp (shapes captured from real production call)', async t => {
  const calls = [];
  const connector = {
    call: async (m, name, a) => {
      calls.push({ mcpId: m.id, name, args: a });
      // Shape thật đã xác nhận qua production: create_repository chỉ trả
      // {id, url} (không có owner/full_name như provider 'github' REST).
      if (name === 'create_repository')
        return {
          content: [
            { type: 'text', text: JSON.stringify({ id: '123', url: 'https://github.com/real-owner/' + a.name }) }
          ]
        };
      // create_or_update_file trả đúng object GitHub REST thật, không bọc gì thêm.
      if (name === 'create_or_update_file')
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ content: { name: a.path, path: a.path }, commit: { sha: 'abc' } })
            }
          ]
        };
      throw new Error('unexpected tool ' + name);
    }
  };
  const x = await fixture(t, connector);
  x.hub.store.put('mcp', 'mcp-gh-mcp-test', {
    id: 'mcp-gh-mcp-test',
    provider: 'github-mcp',
    name: 'GitHub MCP',
    on: true,
    status: 'connected',
    secret: x.hub.store.seal({ token: 'test-token' }),
    tools: []
  });

  const res = await x.call('/api/bootstrap/create-brain', 'POST', { name: 'Brain' });
  assert.equal(res.status, 200);
  assert.equal(res.data.url, 'https://github.com/real-owner/Brain');
  assert.equal(res.data.full_name, 'real-owner/Brain');
  const fileCalls = calls.slice(1);
  assert(fileCalls.every(c => c.args.owner === 'real-owner' && c.args.repo === 'Brain'));
});
