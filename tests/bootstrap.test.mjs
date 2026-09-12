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
