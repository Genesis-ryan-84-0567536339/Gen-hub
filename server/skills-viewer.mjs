import { HubError } from './net.mjs';
import { unwrap } from './connector-envelope.mjs';
import { load as parseYaml } from 'js-yaml';

function githubConnector(store) {
  return store.list('mcp').find(x => x.provider === 'github' && x.on && x.status === 'connected');
}

function splitRepo(repoFullName) {
  const [owner, repo] = String(repoFullName || '').split('/');
  if (!owner || !repo) throw new HubError('Chưa cấu hình repo Brain (dạng owner/repo).');
  return { owner, repo };
}

export function skillsViewerService(store, connectors) {
  async function fetchFile(m, owner, repo, path) {
    const res = unwrap(
      await connectors.call(m, 'get_file_contents', { owner, repo, path }),
      `Đọc ${path}`
    );
    return Buffer.from(res.content, 'base64').toString('utf8');
  }

  async function tree(repoFullName) {
    const m = githubConnector(store);
    if (!m) throw new HubError('Cần kết nối GitHub ở trang Connectors trước khi xem Skills.');
    const { owner, repo } = splitRepo(repoFullName);
    const idxText = await fetchFile(m, owner, repo, 'skills/index.yaml');
    const idx = parseYaml(idxText) || {};
    const categories = await Promise.all(
      (idx.categories || []).map(async c => {
        const catText = await fetchFile(m, owner, repo, c.index);
        const cat = parseYaml(catText) || {};
        return { ten: c.ten, trigger: c.trigger || [], leaves: cat.leaves || [] };
      })
    );
    return { metaSkill: idx.meta_skill || null, categories };
  }

  async function leafContent(repoFullName, path) {
    if (typeof path !== 'string' || !path || path.includes('..'))
      throw new HubError('Đường dẫn không hợp lệ.');
    const m = githubConnector(store);
    if (!m) throw new HubError('Cần kết nối GitHub ở trang Connectors trước khi xem Skills.');
    const { owner, repo } = splitRepo(repoFullName);
    const content = await fetchFile(m, owner, repo, path);
    return { path, content };
  }

  return { tree, leafContent };
}
