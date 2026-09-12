import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import {
  auditFields,
  auditProjection,
  newClassification,
  summarizeAudit
} from './audit-metrics.mjs';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import {
  randomBytes,
  randomInt,
  createCipheriv,
  createDecipheriv,
  createHash,
  scryptSync,
  timingSafeEqual
} from 'node:crypto';
import { normalizeSettings, DEFAULT_SETTINGS, VALID_RETENTIONS } from '../public/settings.js';
export { normalizeSettings, DEFAULT_SETTINGS, VALID_RETENTIONS };
export const id = type => {
  const num = randomInt(0, 100000).toString().padStart(5, '0');
  return type ? `${type}-${num}` : num;
};
export const prefixedId = id;
// Short digit IDs are for display-facing record keys only, never for bearer secrets.
export const secret = prefix =>
  (prefix ? `${prefix}_` : '') + randomBytes(18).toString('base64url');
// Record primary keys must never silently collide with an existing row (store.put upserts on conflict).
export function uniqueId(store, kind, type) {
  let candidate;
  do {
    candidate = id(type);
  } while (store.get(kind, candidate));
  return candidate;
}
export const digest = v => createHash('sha256').update(v).digest('hex');
export const passwordHash = p => {
  const salt = randomBytes(16).toString('hex');
  return (
    salt + ':' + scryptSync(p, salt, 64, { N: 32768, maxmem: 64 * 1024 * 1024 }).toString('hex')
  );
};
export function passwordCheck(p, h) {
  try {
    const [s, v] = h.split(':');
    return timingSafeEqual(
      Buffer.from(v, 'hex'),
      scryptSync(p, s, 64, { N: 32768, maxmem: 64 * 1024 * 1024 })
    );
  } catch {
    return false;
  }
}
export function openStore(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const kp = join(dir, 'master.key');
  if (existsSync(join(dir, 'hub.db')) && !existsSync(kp))
    throw Error('Missing master.key for existing database; restore the original key from backup');
  if (!existsSync(kp)) writeFileSync(kp, randomBytes(32), { flag: 'wx', mode: 0o600 });
  const key = readFileSync(kp);
  if (key.length !== 32) throw Error('Invalid master.key');
  const db = new DatabaseSync(join(dir, 'hub.db'));
  if (db.prepare('PRAGMA user_version').get().user_version > 1) {
    db.close();
    throw Error('Unsupported database schema; do not downgrade this database');
  }
  chmodSync(join(dir, 'hub.db'), 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL,id TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(kind,id));
 CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT,created TEXT NOT NULL,actor TEXT NOT NULL,mcp TEXT NOT NULL,tool TEXT NOT NULL,status TEXT NOT NULL,latency INTEGER NOT NULL,payload TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS idx_audit_created ON audit(created);
 CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit(actor);
 CREATE INDEX IF NOT EXISTS idx_audit_mcp ON audit(mcp);
 CREATE INDEX IF NOT EXISTS idx_audit_tool ON audit(tool);
 CREATE INDEX IF NOT EXISTS idx_audit_status ON audit(status);
 CREATE INDEX IF NOT EXISTS idx_audit_actor_id ON audit(actor, id DESC);
 CREATE INDEX IF NOT EXISTS idx_audit_mcp_id ON audit(mcp, id DESC);
 CREATE INDEX IF NOT EXISTS idx_audit_tool_id ON audit(tool, id DESC);
 CREATE INDEX IF NOT EXISTS idx_audit_status_id ON audit(status, id DESC);
 PRAGMA user_version=1;`);
  // Additive, nullable metadata only: never backfill or rewrite historical audit rows.
  const columns = new Set(
    db
      .prepare('PRAGMA table_info(audit)')
      .all()
      .map(c => c.name)
  );
  for (const [name, type] of Object.entries({
    eventKind: 'TEXT',
    actorType: 'TEXT',
    policyDecision: 'TEXT',
    outcome: 'TEXT',
    errorCategory: 'TEXT',
    latencyMeasured: 'INTEGER',
    operationId: 'TEXT'
  }))
    if (!columns.has(name)) db.exec(`ALTER TABLE audit ADD COLUMN ${name} ${type}`);
  const operationContext = new AsyncLocalStorage();
  const operation = fn => operationContext.run(randomUUID(), fn);
  const seal = v => {
    const iv = randomBytes(12),
      c = createCipheriv('aes-256-gcm', key, iv),
      out = Buffer.concat([c.update(JSON.stringify(v)), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), out]).toString('base64');
  };
  const unseal = s => {
    const b = Buffer.from(s, 'base64'),
      d = createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString());
  };
  const put = (kind, id, value) =>
    db
      .prepare(
        'INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET value=excluded.value'
      )
      .run(kind, id, JSON.stringify(value));
  const get = (kind, id) => {
    const r = db.prepare('SELECT value FROM records WHERE kind=? AND id=?').get(kind, id);
    return r ? JSON.parse(r.value) : null;
  };
  const list = kind =>
    db
      .prepare('SELECT value FROM records WHERE kind=? ORDER BY id')
      .all(kind)
      .map(r => JSON.parse(r.value));
  const del = (kind, id) => db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind, id);
  const audit = (actor, mcp, tool, status, input, output, latency, reason = '', meta = {}) => {
    // Freeze the actor's role at write time; later role changes must not relabel history.
    const actorRecord = get('agent', actor);
    const role = actorRecord ? { actorType: actorRecord.isAdmin ? 'admin' : 'agent' } : {};
    if (actorRecord?.isAdmin && meta.eventKind === 'tool_call') role.eventKind = 'admin_action';
    const c = newClassification({ actor, mcp, tool, status, latency }, { ...meta, ...role });
    return db
      .prepare(
        `INSERT INTO audit(created,actor,mcp,tool,status,latency,payload,eventKind,actorType,policyDecision,outcome,errorCategory,latencyMeasured,operationId) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        new Date().toISOString(),
        actor,
        mcp,
        tool,
        status,
        Math.round(latency ?? 0),
        seal({ input, output, reason, ...(meta.phases ? { phases: meta.phases } : {}) }),
        c.eventKind,
        c.actorType,
        c.policyDecision,
        c.outcome,
        c.errorCategory,
        c.latencyMeasured,
        operationContext.getStore() || randomUUID()
      );
  };
  const log = id => {
    const row = db
      .prepare(
        `SELECT id, created, actor, mcp, tool, status, latency, payload, ${auditProjection} FROM audit WHERE id = ?`
      )
      .get(id);
    if (!row) return null;
    const { payload, ...meta } = row;
    try {
      return { ...meta, ...unseal(payload) };
    } catch {
      return { ...meta, input: {}, output: {}, reason: '' };
    }
  };
  const logs = (limit = 200, filters = {}) => {
    const clauses = [],
      values = [];
    for (const key of ['eventKind', 'actorType', 'policyDecision', 'outcome', 'errorCategory']) {
      if (filters[key] !== undefined) {
        clauses.push(`${auditFields[key]} = ?`);
        values.push(filters[key]);
      }
    }
    if (filters.before) {
      clauses.push('created < ?');
      values.push(filters.before);
    }
    if (filters.id !== undefined) {
      clauses.push('id = ?');
      values.push(filters.id);
    }
    if (filters.cursor !== undefined) {
      clauses.push('id < ?');
      values.push(filters.cursor);
    }
    if (filters.actor !== undefined) {
      if (Array.isArray(filters.actor)) {
        if (filters.actor.length === 0) {
          clauses.push('0 = 1');
        } else {
          clauses.push(`actor IN (${filters.actor.map(() => '?').join(',')})`);
          values.push(...filters.actor);
        }
      } else {
        clauses.push('actor = ?');
        values.push(filters.actor);
      }
    }
    if (filters.mcp !== undefined) {
      clauses.push('mcp = ?');
      values.push(filters.mcp);
    }
    if (filters.tool !== undefined) {
      clauses.push('tool = ?');
      values.push(filters.tool);
    }
    if (filters.status !== undefined) {
      if (filters.status === 'ok' || filters.status === 'success') {
        clauses.push("status IN ('success', 'ok')");
      } else {
        clauses.push('status = ?');
        values.push(filters.status);
      }
    }
    if (filters.since) {
      clauses.push('created >= ?');
      values.push(filters.since);
    }
    if (filters.until) {
      clauses.push('created <= ?');
      values.push(filters.until);
    }
    if (filters.minLatency !== undefined) {
      clauses.push('latency >= ?');
      values.push(filters.minLatency);
    }
    if (filters.maxLatency !== undefined) {
      clauses.push('latency <= ?');
      values.push(filters.maxLatency);
    }
    if (filters.q) {
      const q = filters.q;
      if (/^\d+$/.test(q)) {
        clauses.push('(id = ? OR tool LIKE ? OR actor LIKE ?)');
        values.push(Number(q), `%${q}%`, `%${q}%`);
      } else {
        clauses.push('(tool LIKE ? OR actor LIKE ?)');
        values.push(`%${q}%`, `%${q}%`);
      }
    }
    if (filters.secret) {
      clauses.push("mcp = 'vault' AND tool = 'vault.read'");
    }

    const includePayload =
      filters.includePayload ??
      (!filters.paginate && !filters.cursor && filters.includePayload !== false);
    const cols = includePayload
      ? `id, created, actor, mcp, tool, status, latency, payload, ${auditProjection}`
      : `id, created, actor, mcp, tool, status, latency, ${auditProjection}`;

    const fetchLimit = limit + 1;
    const query =
      `SELECT ${cols} FROM audit` +
      (clauses.length ? ' WHERE ' + clauses.join(' AND ') : '') +
      (filters.aggregate ? '' : ' ORDER BY id DESC') +
      (filters.secret || filters.aggregate ? '' : ' LIMIT ?');
    if (!filters.secret && !filters.aggregate) values.push(fetchLimit);
    if (filters.aggregate) return db.prepare(query).iterate(...values);

    const rawRows = [];
    for (const r of db.prepare(query).iterate(...values)) {
      if (includePayload || filters.secret) {
        let data = {};
        try {
          data = unseal(r.payload);
        } catch {}
        if (filters.secret && data.input?.id !== filters.secret) continue;
        const { payload, ...meta } = r;
        rawRows.push(includePayload ? { ...meta, ...data } : meta);
      } else {
        rawRows.push(r);
      }
      if (rawRows.length >= fetchLimit) break;
    }

    const hasMore = rawRows.length > limit;
    const rows = hasMore ? rawRows.slice(0, limit) : rawRows;
    const nextCursor = rows.length ? rows[rows.length - 1].id : null;

    if (filters.paginate) {
      return { rows, nextCursor: hasMore ? nextCursor : null, hasMore };
    }

    rows.rows = rows;
    rows.nextCursor = hasMore ? nextCursor : null;
    rows.hasMore = hasMore;
    return rows;
  };
  const summary = filters => {
    const fetchedAt = new Date().toISOString();
    const effectiveRetentionDays = normalizeSettings(
      get('settings', 'main')
    ).effectiveRetentionDays;
    const retentionBoundary = new Date(
      Date.now() - effectiveRetentionDays * 86400000
    ).toISOString();
    const earliestAvailableAt = db.prepare('SELECT MIN(created) AS value FROM audit').get().value;
    return summarizeAudit(
      logs(0, {
        ...filters,
        until: undefined,
        before: filters.until,
        aggregate: true,
        includePayload: false
      }),
      filters,
      {
        fetchedAt,
        effectiveRetentionDays,
        earliestAvailableAt,
        retentionBoundary,
        incomplete: filters.since < retentionBoundary,
        coverageStartUnknown: true
      }
    );
  };
  const tx = fn => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const v = fn();
      db.exec('COMMIT');
      return v;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };
  const clean = () => {
    const now = Date.now();
    for (const kind of [
      'session',
      'flow',
      'code',
      'oauthstate',
      'client',
      'token',
      'owner-oidc-flow',
      'owner-oidc-code',
      'owner-oidc-token'
    ])
      for (const r of list(kind)) if (r.expires && r.expires < now) del(kind, r.id);
    const settings = normalizeSettings(get('settings', 'main'));
    const days = settings.effectiveRetentionDays;
    db.prepare('DELETE FROM audit WHERE created < ?').run(
      new Date(now - days * 86400000).toISOString()
    );
  };
  return {
    db,
    get,
    put,
    list,
    del,
    seal,
    unseal,
    audit,
    logs,
    log,
    summary,
    operation,
    tx,
    clean,
    close: () => db.close()
  };
}
export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        /(?:^|[_-])token(?:$|[_-])|password|secret|authorization|api.?key|^pin$|^current$/i.test(k)
          ? '[REDACTED]'
          : redact(v)
      ])
    );
  if (typeof value === 'string') {
    if (/^[\[{]/.test(value.trim())) {
      try {
        return JSON.stringify(redact(JSON.parse(value)));
      } catch {}
    }
    return value.replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]');
  }
  return value;
}
