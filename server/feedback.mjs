import { HubError } from './net.mjs';
import { secret, digest, uniqueId } from './store.mjs';

// Public ingest keys are meant to ship inside open-source app builds — anyone
// can read one from the app's own source. The key must therefore never grant
// more than "create 1 report for this project": no listing, no reading other
// reports, no reach into other projects. Leaking a key's worst case is spam
// into that one project, nothing else. See Issue #119.
export const MAX_REPORT_BYTES = 8 * 1024;
const MAX_NAME_LENGTH = 200;

export function feedbackService(store) {
  function keysForProject(projectId) {
    return store.list('feedback_key').filter(k => k.project_id === projectId);
  }

  function getProject(id) {
    const p = store.get('feedback_project', id);
    if (!p) throw new HubError('Không tìm thấy project', 404);
    return p;
  }

  function listProjects() {
    return store
      .list('feedback_project')
      .map(p => ({ ...p, activeKeyCount: keysForProject(p.id).filter(k => !k.revoked_at).length }))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }

  function createProject(name) {
    if (typeof name !== 'string' || !name.trim() || name.length > MAX_NAME_LENGTH)
      throw new HubError('Tên project không hợp lệ');
    const id = uniqueId(store, 'feedback_project', 'proj');
    const record = { id, name: name.trim(), created_at: new Date().toISOString() };
    store.put('feedback_project', id, record);
    return record;
  }

  function deleteProject(id) {
    getProject(id);
    for (const k of keysForProject(id)) store.del('feedback_key', k.id);
    for (const r of store.list('feedback_report')) if (r.project_id === id) store.del('feedback_report', r.id);
    store.del('feedback_project', id);
  }

  // The plaintext key is returned exactly once, here. Only its digest is ever
  // stored — same idiom as agent/session/admin-assistant tokens elsewhere in
  // this codebase (see auth.mjs, admin-assistant.mjs).
  function createKey(projectId) {
    getProject(projectId);
    const raw = secret('fbk');
    const keyId = digest(raw);
    const record = {
      id: keyId,
      project_id: projectId,
      created_at: new Date().toISOString(),
      revoked_at: null,
      last_used_at: null
    };
    store.put('feedback_key', keyId, record);
    return { key: raw, id: keyId, project_id: projectId, created_at: record.created_at };
  }

  function listKeys(projectId) {
    getProject(projectId);
    return keysForProject(projectId).map(({ id, created_at, revoked_at, last_used_at }) => ({
      id,
      created_at,
      revoked_at,
      last_used_at
    }));
  }

  function revokeKey(projectId, keyId) {
    getProject(projectId);
    const k = store.get('feedback_key', keyId);
    if (!k || k.project_id !== projectId) throw new HubError('Không tìm thấy key', 404);
    if (!k.revoked_at) {
      k.revoked_at = new Date().toISOString();
      store.put('feedback_key', keyId, k);
    }
    return { id: keyId, revoked_at: k.revoked_at };
  }

  // Bearer-key auth for the public ingest endpoint. Deliberately independent
  // of auth.owner()/session/CSRF — a report-submitting app is not the owner
  // and must never be treated as one.
  function authenticateKey(req) {
    const raw = req.headers.authorization?.match(/^Bearer (\S+)$/i)?.[1];
    if (!raw || raw.length > 256) throw new HubError('Ingest key không hợp lệ', 401);
    const key = store.get('feedback_key', digest(raw));
    if (!key || key.revoked_at) throw new HubError('Ingest key không hợp lệ hoặc đã bị thu hồi', 401);
    return key;
  }

  function submitReport(keyRecord, payload, sourceIp) {
    let serialized;
    try {
      serialized = JSON.stringify(payload ?? {});
    } catch {
      throw new HubError('Report không hợp lệ');
    }
    if (Buffer.byteLength(serialized, 'utf8') > MAX_REPORT_BYTES)
      throw new HubError('Report vượt quá kích thước cho phép (8KB)', 413);
    keyRecord.last_used_at = new Date().toISOString();
    store.put('feedback_key', keyRecord.id, keyRecord);
    const id = uniqueId(store, 'feedback_report', 'rep');
    const record = {
      id,
      project_id: keyRecord.project_id,
      created_at: new Date().toISOString(),
      source_ip: sourceIp || null,
      payload: JSON.parse(serialized)
    };
    store.put('feedback_report', id, record);
    return { id, created_at: record.created_at };
  }

  function listReports(projectId, { limit = 50, cursor } = {}) {
    getProject(projectId);
    const capped = Math.min(Math.max(1, Number(limit) || 50), 200);
    const all = store
      .list('feedback_report')
      .filter(r => r.project_id === projectId)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? 1 : -1));
    const startIdx = cursor ? Math.max(0, all.findIndex(r => r.id === cursor) + 1) : 0;
    const page = all.slice(startIdx, startIdx + capped);
    const hasMore = startIdx + capped < all.length;
    return { reports: page, nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null };
  }

  return {
    listProjects,
    getProject,
    createProject,
    deleteProject,
    createKey,
    listKeys,
    revokeKey,
    authenticateKey,
    submitReport,
    listReports
  };
}
