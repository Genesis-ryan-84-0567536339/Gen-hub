import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';

async function makeProjectWithKey(x, name = 'demo-app') {
  const project = (await x.call('/api/feedback-projects', 'POST', { name })).data;
  const key = (await x.call(`/api/feedback-projects/${project.id}/keys`, 'POST')).data;
  return { project, key };
}

test('owner creates a feedback project and an app can submit a report with the ingest key', async t => {
  const x = await fixture(t);
  const { project, key } = await makeProjectWithKey(x);
  assert.ok(key.key.startsWith('fbk_'));

  const submit = await x.call(
    '/feedback/ingest',
    'POST',
    { message: 'App crashes on startup', app_version: '1.2.0' },
    { Authorization: 'Bearer ' + key.key, Cookie: '', 'X-CSRF-Token': '' }
  );
  assert.equal(submit.status, 201);
  assert.deepEqual(submit.data, { ok: true });

  const reports = await x.call(`/api/feedback-projects/${project.id}/reports`);
  assert.equal(reports.status, 200);
  assert.equal(reports.data.reports.length, 1);
  assert.equal(reports.data.reports[0].payload.message, 'App crashes on startup');
  assert.ok(reports.data.reports[0].created_at);
});

test('a valid owner session alone cannot submit a report — the endpoint only trusts the Bearer ingest key', async t => {
  const x = await fixture(t);
  await makeProjectWithKey(x);
  // x.call() sends the owner's real session cookie + CSRF by default; deliberately
  // omit any Authorization header to prove the session does not substitute for a key.
  const submit = await x.call('/feedback/ingest', 'POST', { message: 'hello' });
  assert.equal(submit.status, 401);
});

test('an unauthenticated caller with no key and no session gets 401, never treated as owner', async t => {
  const x = await fixture(t);
  const submit = await fetch(x.origin + '/feedback/ingest', {
    method: 'POST',
    headers: { Origin: x.origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'hello' })
  });
  assert.equal(submit.status, 401);
});

test('a revoked key is rejected immediately, without any action from the reporting app', async t => {
  const x = await fixture(t);
  const { project, key } = await makeProjectWithKey(x);
  const revoke = await x.call(`/api/feedback-projects/${project.id}/keys/${key.id}`, 'DELETE');
  assert.equal(revoke.status, 200);

  const submit = await x.call(
    '/feedback/ingest',
    'POST',
    { message: 'after revoke' },
    { Authorization: 'Bearer ' + key.key, Cookie: '', 'X-CSRF-Token': '' }
  );
  assert.equal(submit.status, 401);
});

test('an unknown/garbage key is rejected without leaking whether any project exists', async t => {
  const x = await fixture(t);
  const submit = await x.call(
    '/feedback/ingest',
    'POST',
    { message: 'hello' },
    { Authorization: 'Bearer fbk_totally-made-up', Cookie: '', 'X-CSRF-Token': '' }
  );
  assert.equal(submit.status, 401);
});

test('a key for project A cannot make its reports show up under project B — no cross-project leak', async t => {
  const x = await fixture(t);
  const a = await makeProjectWithKey(x, 'app-a');
  const b = await makeProjectWithKey(x, 'app-b');

  await x.call(
    '/feedback/ingest',
    'POST',
    { message: 'from app a' },
    { Authorization: 'Bearer ' + a.key.key, Cookie: '', 'X-CSRF-Token': '' }
  );

  const reportsA = await x.call(`/api/feedback-projects/${a.project.id}/reports`);
  const reportsB = await x.call(`/api/feedback-projects/${b.project.id}/reports`);
  assert.equal(reportsA.data.reports.length, 1);
  assert.equal(reportsB.data.reports.length, 0);
});

test('a report over 8KB is rejected with 413', async t => {
  const x = await fixture(t);
  const { key } = await makeProjectWithKey(x);
  const submit = await x.call(
    '/feedback/ingest',
    'POST',
    { message: 'x'.repeat(9000) },
    { Authorization: 'Bearer ' + key.key, Cookie: '', 'X-CSRF-Token': '' }
  );
  assert.equal(submit.status, 413);
});

test('exceeding the per-key rate limit returns 429', async t => {
  const x = await fixture(t);
  const { key } = await makeProjectWithKey(x);
  let sawRateLimited = false;
  for (let i = 0; i < 35; i++) {
    const submit = await x.call(
      '/feedback/ingest',
      'POST',
      { message: 'spam ' + i },
      { Authorization: 'Bearer ' + key.key, Cookie: '', 'X-CSRF-Token': '' }
    );
    if (submit.status === 429) {
      sawRateLimited = true;
      break;
    }
    assert.equal(submit.status, 201);
  }
  assert.ok(sawRateLimited, 'expected a 429 within 35 rapid submits (limit is 30/min)');
});

test('deleting a project removes its keys and reports; the ingest key stops working', async t => {
  const x = await fixture(t);
  const { project, key } = await makeProjectWithKey(x);
  await x.call(
    '/feedback/ingest',
    'POST',
    { message: 'before delete' },
    { Authorization: 'Bearer ' + key.key, Cookie: '', 'X-CSRF-Token': '' }
  );
  const del = await x.call(`/api/feedback-projects/${project.id}`, 'DELETE');
  assert.equal(del.status, 200);

  const submit = await x.call(
    '/feedback/ingest',
    'POST',
    { message: 'after delete' },
    { Authorization: 'Bearer ' + key.key, Cookie: '', 'X-CSRF-Token': '' }
  );
  assert.equal(submit.status, 401);
});
