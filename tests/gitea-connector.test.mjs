import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connectorService } from '../server/connectors.mjs';
import { openStore } from '../server/store.mjs';
import { HubError } from '../server/net.mjs';

const fileArgs = {
  owner: 'owner', repo: 'repo', filepath: 'docs/new file.md',
  branch: 'feature/docs', message: 'Write file', content: 'Nội dung mới'
};
const filePath = '/api/v1/repos/owner/repo/contents/docs/new%20file.md';
const fileResult = {
  content: { name: 'new file.md', path: 'docs/new file.md', sha: 'new-sha' },
  commit: { sha: 'commit-sha', message: 'Write file' }
};
const collaboratorArgs = { owner: 'owner', repo: 'repo', collaborator: 'visitor' };

// Only the upstream HTTP server is fake: use the real connector, credential
// store, Gitea adapter and net.request (including JSON serialization/parsing).
async function upstream(t, responses) {
  const calls = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString();
    calls.push({
      method: req.method, path: req.url, authorization: req.headers.authorization,
      body: text ? JSON.parse(text) : undefined
    });
    const response = responses[calls.length - 1] || { status: 500 };
    res.writeHead(response.status, { 'Content-Type': 'application/json' });
    res.end(response.json === undefined ? undefined : JSON.stringify(response.json));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const dir = mkdtempSync(join(tmpdir(), 'genhub-gitea-connector-'));
  const store = openStore(dir);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const service = connectorService(store);
  const connector = {
    id: 'gitea-test', provider: 'gitea-mcp', auth: 'token', allowPrivate: true,
    url: `http://127.0.0.1:${server.address().port}`,
    secret: store.seal({ token: 'fixture-pat' })
  };
  return { calls, call: (name, args) => service.call(connector, name, args) };
}

for (const exists of [false, true]) {
  test(`connectorService creates/updates file: GET ${exists ? '200 → PUT' : '404 → POST'}`, async t => {
    const x = await upstream(t, [
      { status: exists ? 200 : 404, json: exists ? { sha: 'old-sha' } : { message: 'Not found' } },
      { status: exists ? 200 : 201, json: fileResult }
    ]);
    const result = await x.call('create_or_update_file', fileArgs);
    assert.equal(result.isError, false);
    assert.deepEqual(JSON.parse(result.content[0].text), fileResult);
    assert.deepEqual(x.calls, [
      { method: 'GET', path: filePath + '?ref=feature%2Fdocs', authorization: 'token fixture-pat', body: undefined },
      {
        method: exists ? 'PUT' : 'POST', path: filePath, authorization: 'token fixture-pat',
        body: {
          message: fileArgs.message, content: Buffer.from(fileArgs.content).toString('base64'),
          branch: fileArgs.branch, ...(exists ? { sha: 'old-sha' } : {})
        }
      }
    ]);
  });
}

for (const status of [404, 204]) {
  test(`connectorService check_collaborator handles HTTP ${status}`, async t => {
    const x = await upstream(t, [{ status }]);
    const result = await x.call('check_collaborator', collaboratorArgs);
    assert.equal(result.isError, false);
    assert.deepEqual(JSON.parse(result.content[0].text), {
      is_collaborator: status === 204, user: 'visitor'
    });
    assert.deepEqual(x.calls.map(({ method, path }) => ({ method, path })), [
      { method: 'GET', path: '/api/v1/repos/owner/repo/collaborators/visitor' }
    ]);
  });
}

for (const status of [403, 429]) {
  for (const phase of ['file lookup', 'file create', 'file update', 'collaborator lookup']) {
    test(`connectorService rejects HTTP ${status} during ${phase}`, async t => {
      const responses = [];
      if (phase === 'file create') responses.push({ status: 404 });
      if (phase === 'file update') responses.push({ status: 200, json: { sha: 'old-sha' } });
      responses.push({ status, json: { message: 'upstream-private-detail' } });
      const x = await upstream(t, responses);
      const collaborator = phase === 'collaborator lookup';
      await assert.rejects(
        x.call(collaborator ? 'check_collaborator' : 'create_or_update_file', collaborator ? collaboratorArgs : fileArgs),
        err => {
          assert.ok(err instanceof HubError);
          assert.equal(err.status, status === 403 ? 403 : 502);
          assert.equal(err.upstreamStatus, status);
          assert.match(err.message, new RegExp(String(status)));
          assert.doesNotMatch(err.message, /upstream-private-detail/);
          return true;
        }
      );
      assert.deepEqual(x.calls.map(c => c.method),
        phase === 'file create' ? ['GET', 'POST'] : phase === 'file update' ? ['GET', 'PUT'] : ['GET']);
    });
  }
}

test('connectorService keeps an unhandled Gitea 404 as an error', async t => {
  const x = await upstream(t, [{ status: 404 }]);
  await assert.rejects(x.call('get_repository', { owner: 'owner', repo: 'missing' }), err => {
    assert.ok(err instanceof HubError);
    assert.equal(err.status, 404);
    assert.equal(err.upstreamStatus, 404);
    return true;
  });
  assert.equal(x.calls.length, 1);
});
