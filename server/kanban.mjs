import { HubError } from './net.mjs';

export const defaultRepository = 'Genesis-ryan-84-0567536339/Gen-hub';
export const columns = ['Backlog', 'Ready', 'In Progress', 'Review', 'Done'];

export function giteaWebBase(url) {
  try {
    const parsed = new URL(String(url || 'http://gitea:3000').trim());
    if (['http:', 'https:'].includes(parsed.protocol)) {
      return parsed.origin + parsed.pathname.replace(/\/api\/v1\/?$/, '').replace(/\/+$/, '');
    }
  } catch {}
  return 'http://gitea:3000';
}

export function issueColumn(issue) {
  if (String(issue.state).toLowerCase() === 'closed') return 'Done';
  const statuses = (issue.labels || [])
    .map(l => (typeof l === 'string' ? l : l.name || '').trim().toLowerCase())
    .filter(l => l.startsWith('status:'))
    .map(l => l.slice(7).trim().replace(/[_-]+/g, ' '));
  // In conflicting labels, prefer the furthest explicit stage. agent:* identifies the worker, not progress.
  return [...columns].reverse().find(c => statuses.includes(c.toLowerCase())) || 'Backlog';
}

export function normalize(row, repository, baseUrl = '') {
  if (row.pull_request || !Number.isSafeInteger(row.number) || row.number < 1) return null;
  const labels = (Array.isArray(row.labels) ? row.labels : row.labels?.nodes || []).map(l =>
    String(typeof l === 'string' ? l : l.name || '').slice(0, 100)
  );
  let url = '';
  if (baseUrl) {
    url = giteaWebBase(baseUrl) + '/' + repository + '/issues/' + row.number;
  } else {
    url = 'https://github.com/' + repository + '/issues/' + row.number;
  }
  return {
    id: repository + '#' + row.number,
    number: row.number,
    title: String(row.title || '').slice(0, 1000),
    url,
    state: String(row.state).toLowerCase(),
    labels,
    assignees: (Array.isArray(row.assignees) ? row.assignees : row.assignees?.nodes || []).map(a =>
      String(typeof a === 'string' ? a : a.login || a.username || '').slice(0, 100)
    ),
    updatedAt: row.updated_at || row.updatedAt || null,
    column: issueColumn({ state: row.state, labels }),
    repo: repository
  };
}

function payload(result) {
  if (result?.isError)
    throw new HubError('Dịch vụ từ chối yêu cầu; kiểm tra quyền connector', 502);
  if (result?.structuredContent) return result.structuredContent;
  for (const content of result?.content || []) {
    if (content.type === 'text') {
      try {
        return JSON.parse(content.text);
      } catch {}
    }
  }
  throw new HubError('Dịch vụ trả danh sách issue không hợp lệ', 502);
}

export function kanbanService(store, connectors) {
  let cache = null,
    pending = null;
  const config = () =>
    store.get('kanban', 'config') || { repository: defaultRepository, connectorId: '' };

  function source(c) {
    const m = store.get('mcp', c.connectorId);
    const isGitea = m?.provider === 'gitea-mcp';
    const isGithub = ['github', 'github-mcp'].includes(m?.provider);
    if (
      !m ||
      (!isGithub && !isGitea) ||
      !m.on ||
      m.status !== 'connected' ||
      !m.tools.some(t => t.name === 'list_issues' && t.permission?.status !== 'missing')
    )
      throw new HubError(
        `Chọn connector ${isGitea ? 'Gitea' : 'GitHub'} đang kết nối và có quyền đọc issue`,
        409
      );
    return m;
  }

  function configure(b, actor) {
    if (typeof b.connectorId !== 'string' || !b.connectorId)
      throw new HubError('Chọn connector GitHub');
    const m = store.get('mcp', b.connectorId);
    const isGitea = m?.provider === 'gitea-mcp';
    let repository = '';
    if (isGitea) {
      repository = typeof b.repository === 'string' ? b.repository.trim() : '';
    } else {
      if (
        typeof b.repository !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/.test(b.repository) ||
        /\/(\.|\.\.)$/.test(b.repository)
      )
        throw new HubError('Repo phải có dạng owner/repository');
      repository = b.repository.trim();
    }
    const value = { repository, connectorId: b.connectorId };
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
        const found = new Map();
        let truncated = false;

        if (m.provider === 'gitea-mcp') {
          // Gitea multi-repo discovery
          const repoList = [];
          for (let page = 1; page <= 10; page++) {
            const searchData = payload(
              await connectors.call(m, 'search_repositories', { page, limit: 50 })
            );
            const rawList = Array.isArray(searchData)
              ? searchData
              : Array.isArray(searchData?.data)
                ? searchData.data
                : [];
            for (const item of rawList) {
              const owner = String(
                item.owner?.login ||
                  item.owner?.username ||
                  (item.full_name ? item.full_name.split('/')[0] : '')
              ).trim();
              const name = String(
                item.name || (item.full_name ? item.full_name.split('/')[1] : '')
              ).trim();
              const fullRepo = item.full_name ? String(item.full_name).trim() : `${owner}/${name}`;
              if (owner && name && !repoList.some(r => r.fullRepo === fullRepo)) {
                repoList.push({ owner, name, fullRepo });
              }
            }
            if (rawList.length < 50) break;
            if (page === 10) truncated = true;
          }

          // Concurrently fetch issues for each repository (bounded concurrency to avoid N+1 slow down)
          const concurrency = 5;
          const baseUrl = m.url;
          for (let i = 0; i < repoList.length; i += concurrency) {
            const batch = repoList.slice(i, i + concurrency);
            const batchResults = await Promise.all(
              batch.map(async ({ owner, name, fullRepo }) => {
                const repoIssues = [];
                let repoTruncated = false;
                for (let page = 1; page <= 5; page++) {
                  const data = payload(
                    await connectors.call(m, 'list_issues', {
                      owner,
                      repo: name,
                      state: 'all',
                      page,
                      limit: 50
                    })
                  );
                  const rows = Array.isArray(data) ? data : data?.issues || [];
                  for (const row of rows) {
                    const item = normalize(row, fullRepo, baseUrl);
                    if (item) repoIssues.push(item);
                  }
                  if (rows.length < 50) break;
                  if (page === 5) repoTruncated = true;
                }
                return { repoIssues, repoTruncated };
              })
            );
            for (const res of batchResults) {
              if (res.repoTruncated) truncated = true;
              for (const item of res.repoIssues) {
                found.set(item.id, item);
              }
            }
            if (found.size >= 1000) {
              truncated = true;
              break;
            }
          }
        } else {
          // GitHub / GitHub MCP flow
          const [owner, repo] = c.repository.split('/');
          let after;
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
              if (item) found.set(item.id, item);
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
        }

        // Never publish results from a credential/configuration that changed during the request.
        const latest = source(config());
        if (JSON.stringify([config(), latest.secret, latest.credentialVersion]) !== key)
          throw new HubError('Cấu hình Kanban vừa thay đổi; mở lại bảng', 409);

        const sortedIssues =
          m.provider === 'gitea-mcp'
            ? [...found.values()].sort((a, b) => {
                const tA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
                const tB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
                if (tB !== tA) return tB - tA;
                return b.number - a.number;
              })
            : [...found.values()].sort((a, b) => b.number - a.number);

        const value = {
          config: c,
          columns,
          configured: true,
          issues: sortedIssues,
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
        const isGitea = m?.provider === 'gitea-mcp';
        const value = {
          ...(cache?.key === key
            ? cache.value
            : { config: c, columns, configured: true, issues: [], fetchedAt: null }),
          stale: true,
          error:
            e instanceof HubError
              ? e.message
              : `Không thể đồng bộ issue ${isGitea ? 'Gitea' : 'GitHub'}; thử lại sau`
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
