import { HubError } from './net.mjs';

export const defaultRepository = 'Genesis-ryan-84-0567536339/Gen-hub';
export const columns = ['Backlog', 'Ready', 'In Progress', 'Review', 'Done'];
export function issueColumn(issue) {
  if (String(issue.state).toLowerCase() === 'closed') return 'Done';
  const statuses = (issue.labels || [])
    .map(l => (typeof l === 'string' ? l : l.name || '').trim().toLowerCase())
    .filter(l => l.startsWith('status:'))
    .map(l => l.slice(7).trim().replace(/[_-]+/g, ' '));
  // In conflicting labels, prefer the furthest explicit stage. agent:* identifies the worker, not progress.
  return [...columns].reverse().find(c => statuses.includes(c.toLowerCase())) || 'Backlog';
}
function normalize(row, repository) {
  if (row.pull_request || !Number.isSafeInteger(row.number) || row.number < 1) return null;
  const labels = (Array.isArray(row.labels) ? row.labels : row.labels?.nodes || []).map(l =>
    String(typeof l === 'string' ? l : l.name || '').slice(0, 100)
  );
  return {
    id: repository + '#' + row.number,
    number: row.number,
    title: String(row.title || '').slice(0, 1000),
    url: 'https://github.com/' + repository + '/issues/' + row.number,
    state: String(row.state).toLowerCase(),
    labels,
    assignees: (Array.isArray(row.assignees) ? row.assignees : row.assignees?.nodes || []).map(a =>
      String(a.login || '').slice(0, 100)
    ),
    updatedAt: row.updated_at || row.updatedAt || null,
    column: issueColumn({ state: row.state, labels })
  };
}
function payload(result) {
  if (result?.isError)
    throw new HubError('GitHub từ chối đọc issue; kiểm tra quyền connector', 502);
  if (result?.structuredContent) return result.structuredContent;
  for (const content of result?.content || []) {
    if (content.type === 'text') {
      try {
        return JSON.parse(content.text);
      } catch {}
    }
  }
  throw new HubError('GitHub trả danh sách issue không hợp lệ', 502);
}
export function kanbanService(store, connectors) {
  let cache = null,
    pending = null;
  const config = () =>
    store.get('kanban', 'config') || { repository: defaultRepository, connectorId: '' };
  function source(c) {
    const m = store.get('mcp', c.connectorId);
    if (
      !m ||
      !['github', 'github-mcp'].includes(m.provider) ||
      !m.on ||
      m.status !== 'connected' ||
      !m.tools.some(t => t.name === 'list_issues' && t.permission?.status !== 'missing')
    )
      throw new HubError('Chọn connector GitHub đang kết nối và có quyền đọc issue', 409);
    return m;
  }
  function configure(b, actor) {
    if (
      typeof b.repository !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(b.repository) ||
      /\/(\.|\.\.)$/.test(b.repository)
    )
      throw new HubError('Repo phải có dạng owner/repository');
    if (typeof b.connectorId !== 'string') throw new HubError('Chọn connector GitHub');
    const value = { repository: b.repository, connectorId: b.connectorId };
    source(value);
    store.put('kanban', 'config', value);
    store.audit(actor, 'hub', 'kanban.configure', 'success', value, {});
    cache = null;
    return value;
  }
  async function read() {
    const c = config();
    if (!c.connectorId) return { config: c, columns, issues: [], configured: false };
    const m = source(c);
    const key = JSON.stringify([c, m.secret, m.credentialVersion]);
    if (cache?.key === key && Date.now() < cache.nextCheck) return cache.value;
    if (pending?.key === key) return pending.promise;
    const promise = (async () => {
      try {
        const [owner, repo] = c.repository.split('/');
        const found = new Map();
        let after,
          truncated = false;
        for (let page = 1; page <= 20; page++) {
          const args =
            m.provider === 'github'
              ? {
                  owner,
                  repo,
                  state: 'all',
                  page,
                  per_page: 100,
                  sort: 'updated',
                  direction: 'desc'
                }
              : {
                  owner,
                  repo,
                  perPage: 100,
                  orderBy: 'UPDATED_AT',
                  direction: 'DESC',
                  ...(after ? { after } : {})
                };
          const data = payload(await connectors.call(m, 'list_issues', args));
          const rows = m.provider === 'github' ? data : data.issues;
          if (!Array.isArray(rows))
            throw new HubError('GitHub trả danh sách issue không hợp lệ', 502);
          for (const row of rows) {
            const item = normalize(row, c.repository);
            if (item) found.set(item.number, item);
          }
          const more =
            m.provider === 'github' ? rows.length === 100 : data.pageInfo?.hasNextPage === true;
          if (!more) break;
          if (m.provider === 'github-mcp') {
            if (!data.pageInfo.endCursor || after === data.pageInfo.endCursor)
              throw new HubError('GitHub trả cursor phân trang không hợp lệ', 502);
            after = data.pageInfo.endCursor;
          }
          if (page === 20) truncated = true;
        }
        // Never publish results from a credential/configuration that changed during the request.
        const latest = source(config());
        if (JSON.stringify([config(), latest.secret, latest.credentialVersion]) !== key)
          throw new HubError('Cấu hình Kanban vừa thay đổi; mở lại bảng', 409);
        const value = {
          config: c,
          columns,
          configured: true,
          issues: [...found.values()].sort((a, b) => b.number - a.number),
          fetchedAt: new Date().toISOString(),
          stale: false,
          truncated,
          error: null
        };
        cache = { key, nextCheck: Date.now() + 120000, value };
        return value;
      } catch (e) {
        const latest = source(config());
        if (JSON.stringify([config(), latest.secret, latest.credentialVersion]) !== key)
          throw new HubError('Cấu hình Kanban vừa thay đổi; mở lại bảng', 409);
        // Show a clearly dated snapshot on transient errors, never a partially fetched board.
        const value = {
          ...(cache?.key === key
            ? cache.value
            : { config: c, columns, configured: true, issues: [], fetchedAt: null }),
          stale: true,
          error: e instanceof HubError ? e.message : 'Không thể đồng bộ issue GitHub; thử lại sau'
        };
        if (JSON.stringify(config()) === JSON.stringify(c))
          cache = { key, nextCheck: Date.now() + 120000, value };
        return value;
      }
    })();
    pending = { key, promise };
    try {
      return await promise;
    } finally {
      if (pending?.promise === promise) pending = null;
    }
  }
  return { config, configure, read };
}
