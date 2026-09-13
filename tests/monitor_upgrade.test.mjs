import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../server/store.mjs';
import { createMonitor } from '../server/monitor.mjs';

test('Existing schema v1 upgrades additively; credentials, IDs, pending OAuth and historical ciphertext survive', () => {
  const dir = mkdtempSync(join(tmpdir(), 'monitor-upgrade-'));
  try {
    let store = openStore(dir);
    const fixtures = [
      ['owner', 'main', { username: 'owner', password: 'existing-hash' }],
      [
        'agent',
        'agent-00001',
        { id: 'agent-00001', name: 'Worker', status: 'active', permissions: ['mcp-00001:echo'] }
      ],
      [
        'mcp',
        'mcp-00001',
        {
          id: 'mcp-00001',
          name: 'Existing',
          on: true,
          status: 'connected',
          tools: [{ name: 'echo', published: true }],
          secret: store.seal({ token: 'existing-private-token' })
        }
      ],
      [
        'vault',
        'vault-00001',
        {
          id: 'vault-00001',
          name: 'Existing secret',
          secret: store.seal({ secret: 'existing-vault-value' })
        }
      ],
      [
        'token',
        'existing-token',
        { id: 'existing-token', agent: 'agent-00001', expires: Date.now() + 3600000 }
      ],
      [
        'oauthstate',
        'pending-oauth',
        {
          id: 'pending-oauth',
          mcp: 'mcp-00001',
          verifier: 'keep-verifier',
          expires: Date.now() + 3600000
        }
      ]
    ];
    for (const [kind, id, row] of fixtures) store.put(kind, id, row);
    store.audit(
      'agent-00001',
      'mcp-00001',
      'echo',
      'success',
      { text: 'old input' },
      { text: 'old output' },
      1
    );
    // Remove only the new nullable columns, reproducing the previous version's actual schema.
    store.db.exec(
      'ALTER TABLE audit DROP COLUMN inputBytes; ALTER TABLE audit DROP COLUMN outputBytes;'
    );
    const key = readFileSync(join(dir, 'master.key'));
    const cipher = store.db.prepare('SELECT payload FROM audit WHERE id=1').get().payload;
    store.close();
    store = openStore(dir);
    for (const [kind, id, row] of fixtures) assert.deepEqual(store.get(kind, id), row);
    assert.deepEqual(readFileSync(join(dir, 'master.key')), key);
    assert.equal(store.db.prepare('PRAGMA user_version').get().user_version, 1);
    assert.equal(store.db.prepare('SELECT payload FROM audit WHERE id=1').get().payload, cipher);
    assert.equal(
      store.unseal(store.get('mcp', 'mcp-00001').secret).token,
      'existing-private-token'
    );
    assert.equal(
      store.unseal(store.get('vault', 'vault-00001').secret).secret,
      'existing-vault-value'
    );
    const monitor = createMonitor(store);
    assert.equal(monitor.snapshot().coverage.bytesMissing, 1);
    store.audit(
      'agent-00001',
      'mcp-00001',
      'echo',
      'success',
      { text: 'new input' },
      { text: 'new output' },
      1
    );
    store.close();
    // Previous app inserts use explicit column names; new nullable columns accept those inserts.
    const old = new DatabaseSync(join(dir, 'hub.db'));
    old
      .prepare(
        'INSERT INTO audit(created,actor,mcp,tool,status,latency,payload) VALUES(?,?,?,?,?,?,?)'
      )
      .run(new Date().toISOString(), 'agent-00001', 'mcp-00001', 'echo', 'success', 1, cipher);
    assert.equal(old.prepare('SELECT COUNT(*) AS n FROM audit').get().n, 3);
    old.close();
    store = openStore(dir);
    assert.equal(store.logs(1)[0].output.text, 'old output');
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
