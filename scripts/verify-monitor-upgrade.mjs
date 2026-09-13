// Run against an isolated checkout of the release currently installed, never production data:
// node scripts/verify-monitor-upgrade.mjs /path/to/previous-release
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { createHub as upgraded } from '../server/app.mjs';
import { passwordHash } from '../server/store.mjs';

if (!process.argv[2]) throw Error('Cần đường dẫn checkout phiên bản trước');
const baseline = await import(pathToFileURL(join(resolve(process.argv[2]), 'server/app.mjs')));
const dir = mkdtempSync(join(tmpdir(), 'genhub-upgrade-acceptance-'));
const probe = createServer();
await new Promise(r => probe.listen(0, '127.0.0.1', r));
const port = probe.address().port;
await new Promise(r => probe.close(r));
const origin = 'http://127.0.0.1:' + port;
const connector = {
  call: async (m, t, args) => ({ content: [{ type: 'text', text: args.text }] })
};
let hub,
  cookie = '',
  csrf = '';
async function start(factory) {
  hub = factory({
    dir,
    origin,
    connector,
    fetchFn: async () => {
      throw Error('Offline upgrade test');
    }
  });
  await new Promise(r => hub.server.listen(port, '127.0.0.1', r));
}
async function stop() {
  await new Promise(r => hub.server.close(r));
  hub.store.close();
  hub = null;
}
async function api(path, method = 'GET', body, headers = {}) {
  const r = await fetch(origin + path, {
    method,
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      // Each restart replaces the HTTP server on the same port; do not reuse a closed socket.
      Connection: 'close',
      Cookie: cookie,
      'X-CSRF-Token': csrf,
      ...headers
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  return { status: r.status, headers: r.headers, data: await r.json() };
}
try {
  await start(baseline.createHub);
  hub.store.put('owner', 'main', {
    username: 'upgrade-owner',
    password: passwordHash('upgrade-password-123')
  });
  hub.store.put('settings', 'main', { onboarded: true });
  const bootstrapRecord = {
    groups: [
      {
        id: 'group-upgrade',
        title: 'Quy trình riêng',
        steps: [
          {
            id: 'step-upgrade',
            title: 'Nghiệm thu',
            content: 'Đọc kết quả kiểm thử trước khi duyệt.'
          }
        ]
      }
    ],
    updated: '2026-09-12T00:00:00.000Z'
  };
  hub.store.put('bootstrap', 'main', bootstrapRecord);
  hub.store.put('mcp', 'mcp-00001', {
    id: 'mcp-00001',
    name: 'Existing MCP',
    on: true,
    status: 'connected',
    provider: 'remote',
    auth: 'token',
    secret: hub.store.seal({ token: 'synthetic-old-credential' }),
    tools: [
      {
        name: 'echo',
        published: true,
        inputSchema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text']
        }
      }
    ]
  });
  hub.store.put('vault', 'vault-00001', {
    id: 'vault-00001',
    name: 'Existing vault',
    secret: hub.store.seal({ secret: 'synthetic-old-vault' })
  });
  const login = await api('/api/login', 'POST', {
    username: 'upgrade-owner',
    password: 'upgrade-password-123'
  });
  cookie = login.headers.get('set-cookie').split(';')[0];
  csrf = login.data.csrf;
  const agent = (
    await api('/api/agents', 'POST', {
      name: 'Existing Worker',
      permissions: ['mcp-00001:echo', 'vault:vault-00001']
    })
  ).data;
  const pending = {
    id: 'pending-oauth',
    mcp: 'mcp-00001',
    verifier: 'synthetic-pending-verifier',
    expires: Date.now() + 3600000
  };
  const initialize = async () =>
    (
      await api(
        '/mcp',
        'POST',
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'upgrade-check', version: '1' }
          }
        },
        { Authorization: 'Bearer ' + agent.token }
      )
    ).data.result.instructions;
  const beforeInstructions = await initialize();
  hub.store.put('oauthstate', pending.id, pending);
  const key = readFileSync(join(dir, 'master.key'));
  const encrypted = hub.store.get('mcp', 'mcp-00001').secret;
  const rpc = async text => {
    const r = await api(
      '/mcp',
      'POST',
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'mcp-00001__echo', arguments: { text } }
      },
      { Authorization: 'Bearer ' + agent.token }
    );
    assert.equal(r.status, 200);
    assert.equal(r.data.result.content[0].text, text);
  };
  await rpc('before upgrade');
  const oldPayload = hub.store.db
    .prepare("SELECT payload FROM audit WHERE tool='echo' ORDER BY id LIMIT 1")
    .get().payload;
  await stop();
  await start(upgraded);
  assert.equal((await api('/api/state')).status, 200, 'existing owner session survives');
  assert.deepEqual((await api('/api/bootstrap')).data, bootstrapRecord);
  assert.match(await initialize(), /Đọc kết quả kiểm thử trước khi duyệt/);
  assert.deepEqual(hub.store.get('oauthstate', pending.id), pending);
  assert.deepEqual(readFileSync(join(dir, 'master.key')), key);
  assert.equal(hub.store.get('mcp', 'mcp-00001').secret, encrypted);
  assert.equal(
    hub.store.unseal(hub.store.get('vault', 'vault-00001').secret).secret,
    'synthetic-old-vault'
  );
  await rpc('after upgrade');
  assert.equal((await api('/api/monitor')).data.totals.calls, 2);
  assert.equal(
    hub.store.db.prepare("SELECT payload FROM audit WHERE tool='echo' ORDER BY id LIMIT 1").get()
      .payload,
    oldPayload
  );
  await stop();
  await start(baseline.createHub);
  assert.equal((await api('/api/state')).status, 200, 'existing session survives rollback');
  assert.deepEqual(hub.store.get('bootstrap', 'main'), bootstrapRecord);
  assert.equal(await initialize(), beforeInstructions, 'Bootstrap instructions survive rollback');
  await rpc('after rollback');
  assert.deepEqual(hub.store.get('oauthstate', pending.id), pending);
  assert.equal(hub.store.db.prepare('PRAGMA user_version').get().user_version, 1);
  assert.equal(
    hub.store.db.prepare("SELECT COUNT(*) AS n FROM audit WHERE tool='echo'").get().n,
    3
  );
  console.log(
    'PASS: previous release → Monitor → previous release; same DB/key/session/agent token/MCP credential/Vault/pending OAuth; real HTTP calls work at all three stages.'
  );
} finally {
  if (hub) await stop();
  rmSync(dir, { recursive: true, force: true });
}
