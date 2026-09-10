import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { id, openStore } from './store.mjs';

const isStandard = (kind, val) =>
  typeof val === 'string' && new RegExp(`^${kind}-[0-9]{5}$`).test(val);

/**
 * Migrate legacy IDs (unprefixed or old base64 format) to standard 5-digit format `type-NNNNN` (Issue #40, #50).
 * Runs atomically in a single store transaction.
 *
 * @param {object} store - openStore instance
 * @returns {object} { mappings, migrated, total }
 */
export function migrateIds(store) {
  return store.tx(() => {
    const mappings = {
      agent: {},
      mcp: {},
      vault: {},
      client: {},
      flow: {},
      admin: {}
    };

    function generateId(kind) {
      let newId;
      do {
        newId = id(kind);
      } while (
        store.get(kind, newId) ||
        Object.values(mappings[kind] || {}).includes(newId)
      );
      return newId;
    }

    // 1. MCP connectors: migrate if id does not match mcp-NNNNN
    const mcps = store.list('mcp');
    for (const m of mcps) {
      if (!isStandard('mcp', m.id)) {
        const oldId = m.id;
        const newId = generateId('mcp');
        mappings.mcp[oldId] = newId;
        store.del('mcp', oldId);
        m.id = newId;
        store.put('mcp', newId, m);
      }
    }

    // 2. Vault secrets: migrate if id does not match vault-NNNNN
    const vaults = store.list('vault');
    for (const v of vaults) {
      if (!isStandard('vault', v.id)) {
        const oldId = v.id;
        const newId = generateId('vault');
        mappings.vault[oldId] = newId;
        store.del('vault', oldId);
        v.id = newId;
        store.put('vault', newId, v);
      }
    }

    // 3. OAuth Clients: migrate if id does not match client-NNNNN
    const clients = store.list('client');
    for (const c of clients) {
      if (!isStandard('client', c.id)) {
        const oldId = c.id;
        const newId = generateId('client');
        mappings.client[oldId] = newId;
        store.del('client', oldId);
        c.id = newId;
        if (c.client_id !== undefined) c.client_id = newId;
        store.put('client', newId, c);
      }
    }

    // 4. OAuth Flows: migrate if id does not match flow-NNNNN and update client_id
    const flows = store.list('flow');
    for (const f of flows) {
      let changed = false;
      if (f.client_id && mappings.client[f.client_id]) {
        f.client_id = mappings.client[f.client_id];
        changed = true;
      }
      if (!isStandard('flow', f.id)) {
        const oldId = f.id;
        const newId = generateId('flow');
        mappings.flow[oldId] = newId;
        store.del('flow', oldId);
        f.id = newId;
        store.put('flow', newId, f);
      } else if (changed) {
        store.put('flow', f.id, f);
      }
    }

    // 5. Agents: migrate if id does not match agent-NNNNN
    // Also update all permissions referencing migrated mcps (mid:tool) and vaults (vault:vid)
    // Also update client references
    const agents = store.list('agent');
    for (const a of agents) {
      let changed = false;
      if (a.client && mappings.client[a.client]) {
        a.client = mappings.client[a.client];
        changed = true;
      }
      if (Array.isArray(a.permissions)) {
        const updatedPermissions = a.permissions.map(p => {
          if (p.startsWith('vault:')) {
            const vid = p.slice(6);
            if (mappings.vault[vid]) {
              changed = true;
              return 'vault:' + mappings.vault[vid];
            }
          } else if (p.includes(':')) {
            const idx = p.indexOf(':');
            const mid = p.slice(0, idx);
            const tool = p.slice(idx + 1);
            if (mappings.mcp[mid]) {
              changed = true;
              return mappings.mcp[mid] + ':' + tool;
            }
          }
          return p;
        });
        a.permissions = updatedPermissions;
      }

      if (!isStandard('agent', a.id)) {
        const oldId = a.id;
        const newId = generateId('agent');
        mappings.agent[oldId] = newId;
        store.del('agent', oldId);
        a.id = newId;
        store.put('agent', newId, a);
      } else if (changed) {
        store.put('agent', a.id, a);
      }
    }

    // 6. Tokens: update agent and client references
    // Token primary key (digest) remains unchanged so active client sessions continue to work
    const tokens = store.list('token');
    for (const t of tokens) {
      let changed = false;
      if (t.agent && mappings.agent[t.agent]) {
        t.agent = mappings.agent[t.agent];
        changed = true;
      }
      if (t.client && mappings.client[t.client]) {
        t.client = mappings.client[t.client];
        changed = true;
      }
      if (changed) {
        store.put('token', t.id, t);
      }
    }

    // 7. OAuth Codes: update agent and client_id references
    const codes = store.list('code');
    for (const c of codes) {
      let changed = false;
      if (c.agent && mappings.agent[c.agent]) {
        c.agent = mappings.agent[c.agent];
        changed = true;
      }
      if (c.client_id && mappings.client[c.client_id]) {
        c.client_id = mappings.client[c.client_id];
        changed = true;
      }
      if (changed) {
        store.put('code', c.id, c);
      }
    }

    // 8. OAuth State: update mid references if connector was migrated
    const states = store.list('oauthstate');
    for (const s of states) {
      if (s.id && mappings.mcp[s.id]) {
        s.id = mappings.mcp[s.id];
        store.put('oauthstate', s.state || s.id, s);
      }
    }

    // 9. Admin Assistant: migrate record.id in 'admin-assistant'
    const adminRecord = store.get('admin-assistant', 'main');
    if (adminRecord?.id && !isStandard('admin', adminRecord.id)) {
      const oldId = adminRecord.id;
      const newId = generateId('admin');
      mappings.admin[oldId] = newId;
      adminRecord.id = newId;
      store.put('admin-assistant', 'main', adminRecord);
    }
    // Also check any direct records in 'admin' kind
    const admins = store.list('admin');
    for (const adm of admins) {
      if (!isStandard('admin', adm.id)) {
        const oldId = adm.id;
        const newId = generateId('admin');
        mappings.admin[oldId] = newId;
        store.del('admin', oldId);
        adm.id = newId;
        store.put('admin', newId, adm);
      }
    }

    const counts = {
      agent: Object.keys(mappings.agent).length,
      mcp: Object.keys(mappings.mcp).length,
      vault: Object.keys(mappings.vault).length,
      client: Object.keys(mappings.client).length,
      flow: Object.keys(mappings.flow).length,
      admin: Object.keys(mappings.admin).length
    };
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);

    // Audit log: Keep old audit logs unmodified.
    // Record 1 new audit log documenting the mapping table and migration stats.
    if (total > 0) {
      store.audit(
        'owner',
        'hub',
        'system.id_migration',
        'success',
        { mappings },
        { migrated: counts, total }
      );
    }

    return { mappings, migrated: counts, total };
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.env.DATA_DIR || './var';
  const store = openStore(dir);
  try {
    const result = migrateIds(store);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('Lỗi khi migrate ID:', err.message);
    process.exitCode = 1;
  } finally {
    store.close();
  }
}
