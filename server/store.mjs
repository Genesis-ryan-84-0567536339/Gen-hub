import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  createHash,
  scryptSync,
  timingSafeEqual
} from 'node:crypto';
export const id = type => {
  let rand = randomBytes(18).toString('base64url');
  if (type && rand.startsWith('_')) rand = '-' + rand.slice(1);
  while (rand.includes('__')) rand = rand.replace('__', '-_');
  return (type ? `${type}_` : '') + rand;
};
export const prefixedId = id;
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
 PRAGMA user_version=1;`);
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
  const audit = (actor, mcp, tool, status, input, output, latency = 0, reason = '') =>
    db
      .prepare(
        'INSERT INTO audit(created,actor,mcp,tool,status,latency,payload) VALUES(?,?,?,?,?,?,?)'
      )
      .run(
        new Date().toISOString(),
        actor,
        mcp,
        tool,
        status,
        Math.round(latency),
        seal({ input, output, reason })
      );
  const logs = (limit = 200, filters = {}) => {
    const clauses = [],
      values = [];
    for (const key of ['actor', 'mcp', 'tool']) {
      if (filters[key] !== undefined) {
        clauses.push(`${key} = ?`);
        values.push(filters[key]);
      }
    }
    if (filters.since) {
      clauses.push('created >= ?');
      values.push(filters.since);
    }
    if (filters.secret) clauses.push("mcp = 'vault' AND tool = 'vault.read'");
    // Secret IDs live inside encrypted payloads. Filter while iterating, before LIMIT.
    const query =
      'SELECT * FROM audit' +
      (clauses.length ? ' WHERE ' + clauses.join(' AND ') : '') +
      ' ORDER BY id DESC' +
      (filters.secret ? '' : ' LIMIT ?');
    if (!filters.secret) values.push(limit);
    const rows = [];
    for (const { payload, ...r } of db.prepare(query).iterate(...values)) {
      const data = unseal(payload);
      if (filters.secret && data.input?.id !== filters.secret) continue;
      rows.push({ ...r, ...data });
      if (rows.length >= limit) break;
    }
    return rows;
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
    for (const kind of ['session', 'flow', 'code', 'oauthstate', 'client', 'token'])
      for (const r of list(kind)) if (r.expires && r.expires < now) del(kind, r.id);
    const days = get('settings', 'main')?.retention || 30;
    db.prepare('DELETE FROM audit WHERE created < ?').run(
      new Date(now - days * 86400000).toISOString()
    );
  };
  return { db, get, put, list, del, seal, unseal, audit, logs, tx, clean, close: () => db.close() };
}
export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        /token|password|secret|authorization|api.?key|^pin$|^current$/i.test(k)
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
