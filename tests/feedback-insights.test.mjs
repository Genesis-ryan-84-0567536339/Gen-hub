import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';

async function seedProjectWithReports(x, messages) {
  const project = (await x.call('/api/feedback-projects', 'POST', { name: 'demo-app' })).data;
  const key = (await x.call(`/api/feedback-projects/${project.id}/keys`, 'POST')).data;
  for (const message of messages) {
    const r = await x.call(
      '/feedback/ingest',
      'POST',
      { message },
      { Authorization: 'Bearer ' + key.key, Cookie: '', 'X-CSRF-Token': '' }
    );
    assert.equal(r.status, 201);
  }
  return project;
}

// x.call() (the test HTTP client) and dispatchLlmCall() share the same
// globalThis.fetch, so a mock installed for the fake LLM must pass real
// requests to the local test server straight through, or every x.call()
// made while the mock is active gets swallowed too.
function mockLlm(x, t, classify) {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (url, opts) => {
    if (typeof url === 'string' && url.startsWith(x.origin)) return originalFetch(url, opts);
    const body = JSON.parse(opts.body);
    const items = JSON.parse(body.messages.at(-1).content);
    return new Response(
      JSON.stringify({ choices: [{ message: { role: 'assistant', content: classify(items) } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };
}

test('classify-now with no LLM configured is a graceful no-op, never fabricates a category', async t => {
  const x = await fixture(t);
  const project = await seedProjectWithReports(x, ['App crashes on launch']);
  const r = await x.call(`/api/feedback-projects/${project.id}/classify-now`, 'POST');
  assert.equal(r.status, 200);
  assert.equal(r.data.reason, 'llm_not_configured');
  assert.equal(r.data.classified, 0);
  const groups = await x.call('/api/feedback-groups?project_id=' + project.id);
  assert.equal(groups.data.groups.length, 0);
});

test('classifying reports groups them by category and preserves triage state across re-runs', async t => {
  const x = await fixture(t);
  await x.call('/api/llm', 'PATCH', { provider: 'openai', model: 'gpt-4o', apiKey: 'test-key' });
  const project = await seedProjectWithReports(x, [
    'App crashes when opening a large file',
    'Please add dark mode',
    'App crashes when opening a large file, again'
  ]);

  // 2 crash reports classify as bugs, 1 dark-mode request classifies as a feature request.
  mockLlm(x, t, items =>
    JSON.stringify(
      items.map(({ id, text }) => ({
        id,
        category: text.includes('dark mode') ? 'feature_request' : 'bug',
        severity: text.includes('dark mode') ? 'low' : 'high',
        summary: text.includes('dark mode') ? 'Yêu cầu dark mode' : 'App crash khi mở file lớn'
      }))
    )
  );

  const run1 = await x.call(`/api/feedback-projects/${project.id}/classify-now`, 'POST');
  assert.equal(run1.status, 200);
  assert.equal(run1.data.classified, 3);

  const groups = (await x.call('/api/feedback-groups?project_id=' + project.id)).data.groups;
  const bugGroup = groups.find(g => g.category === 'bug');
  const featureGroup = groups.find(g => g.category === 'feature_request');
  assert.equal(bugGroup.report_count, 2);
  assert.equal(bugGroup.severity_counts.high, 2);
  assert.equal(featureGroup.report_count, 1);

  // Owner marks the bug group as worth a look.
  const flagged = await x.call(`/api/feedback-groups/${bugGroup.id}`, 'PATCH', { owner_flagged: true });
  assert.equal(flagged.status, 200);
  assert.equal(flagged.data.owner_flagged, true);

  // The owner cannot smuggle engineer fields through their own route.
  const rejected = await x.call(`/api/feedback-groups/${bugGroup.id}`, 'PATCH', {
    owner_flagged: true,
    engineer_status: 'fixed'
  });
  assert.equal(rejected.status, 400);

  // A brand new report of an existing category re-classifies and recomputes
  // the group without erasing the owner's flag.
  const key2 = (await x.call(`/api/feedback-projects/${project.id}/keys`, 'POST')).data;
  await x.call(
    '/feedback/ingest',
    'POST',
    { message: 'App crashes when opening a large file, one more time' },
    { Authorization: 'Bearer ' + key2.key, Cookie: '', 'X-CSRF-Token': '' }
  );
  const run2 = await x.call(`/api/feedback-projects/${project.id}/classify-now`, 'POST');
  assert.equal(run2.data.classified, 1);
  const groupsAfter = (await x.call('/api/feedback-groups?project_id=' + project.id)).data.groups;
  const bugGroupAfter = groupsAfter.find(g => g.category === 'bug');
  assert.equal(bugGroupAfter.report_count, 3);
  assert.equal(bugGroupAfter.owner_flagged, true, 'owner flag must survive a recompute');
});

test('a malformed LLM response leaves reports pending instead of corrupting them', async t => {
  const x = await fixture(t);
  await x.call('/api/llm', 'PATCH', { provider: 'openai', model: 'gpt-4o', apiKey: 'test-key' });
  const project = await seedProjectWithReports(x, ['Something broke']);
  mockLlm(x, t, () => 'this is not json');

  const run = await x.call(`/api/feedback-projects/${project.id}/classify-now`, 'POST');
  assert.equal(run.data.classified, 0);
  assert.equal(run.data.reason, 'error');
  const groups = (await x.call('/api/feedback-groups?project_id=' + project.id)).data.groups;
  assert.equal(groups.length, 0);
});

test('any connected agent can read feedback groups and mark one fixed via MCP, but cannot touch the owner flag', async t => {
  const x = await fixture(t);
  await x.call('/api/llm', 'PATCH', { provider: 'openai', model: 'gpt-4o', apiKey: 'test-key' });
  const project = await seedProjectWithReports(x, ['App crashes on launch']);
  mockLlm(x, t, items =>
    JSON.stringify(items.map(({ id }) => ({ id, category: 'bug', severity: 'critical', summary: 'Crash khi mở app' })))
  );
  await x.call(`/api/feedback-projects/${project.id}/classify-now`, 'POST');
  const groupId = (await x.call('/api/feedback-groups?project_id=' + project.id)).data.groups[0].id;

  const agentRes = await x.call('/api/agents', 'POST', { name: 'Engineer bot', permissions: [] });
  assert.equal(agentRes.status, 201);
  const headers = { Authorization: 'Bearer ' + agentRes.data.token };
  const rpc = (method, params = {}) => x.call('/mcp', 'POST', { jsonrpc: '2.0', id: 1, method, params }, headers);

  const list = await rpc('tools/list');
  assert.ok(list.data.result.tools.some(t => t.name === 'feedback__list_groups'));
  assert.ok(list.data.result.tools.some(t => t.name === 'feedback__update_group'));

  const groupsViaMcp = JSON.parse((await rpc('tools/call', { name: 'feedback__list_groups', arguments: {} })).data.result.content[0].text);
  assert.equal(groupsViaMcp.groups[0].id, groupId);

  const updated = await rpc('tools/call', {
    name: 'feedback__update_group',
    arguments: { group_id: groupId, status: 'fixed', notes: 'Đã fix null pointer ở màn hình chính.' }
  });
  assert.equal(updated.data.result.isError, false);
  const parsedUpdate = JSON.parse(updated.data.result.content[0].text);
  assert.equal(parsedUpdate.engineer_status, 'fixed');
  assert.equal(parsedUpdate.owner_flagged, false, 'agent must never be able to set the owner-only flag');

  // additionalProperties:false on the tool schema rejects an attempt to sneak owner_flagged in.
  const smuggle = await rpc('tools/call', {
    name: 'feedback__update_group',
    arguments: { group_id: groupId, status: 'fixed', notes: '', owner_flagged: true }
  });
  assert.equal(smuggle.data.result.isError, true);

  const rawReports = await rpc('tools/call', { name: 'feedback__list_reports', arguments: { group_id: groupId } });
  const parsedReports = JSON.parse(rawReports.data.result.content[0].text);
  assert.equal(parsedReports.reports.length, 1);
  assert.equal(parsedReports.reports[0].payload.message, 'App crashes on launch');
});
