import { HubError } from './net.mjs';
import { load as parseYaml } from 'js-yaml';

// get_file_contents trả 2 dạng khác nhau tuỳ provider connector đang dùng:
// - provider 'github' (REST thô của Gen-hub): content[0].text là JSON của
//   GitHub Contents API, field "content" là base64.
// - provider 'github-mcp' (remote MCP chính thức): 1 item type 'text' chỉ là
//   thông báo trạng thái, nội dung thật nằm ở item type 'resource'.resource.text
//   (đã là plain text, không phải base64).
function extractFileText(envelope, action) {
  const items = envelope?.content || [];
  if (envelope?.isError)
    throw new HubError(`${action} thất bại: ${items[0]?.text || 'lỗi không rõ'}`);
  const resourceItem = items.find(i => i?.type === 'resource' && typeof i.resource?.text === 'string');
  if (resourceItem) return resourceItem.resource.text;
  const textItem = items.find(i => i?.type === 'text');
  if (textItem) {
    try {
      const data = JSON.parse(textItem.text);
      if (typeof data.content === 'string') return Buffer.from(data.content, 'base64').toString('utf8');
    } catch {}
  }
  throw new HubError(`${action} thất bại: không đọc được nội dung file.`);
}

function githubConnector(store) {
  return store
    .list('mcp')
    .find(x => (x.provider === 'github' || x.provider === 'github-mcp') && x.on && x.status === 'connected');
}

function splitRepo(repoFullName) {
  const [owner, repo] = String(repoFullName || '').split('/');
  if (!owner || !repo) throw new HubError('Chưa cấu hình repo Brain (dạng owner/repo).');
  return { owner, repo };
}

export function skillsViewerService(store, connectors) {
  async function fetchFile(m, owner, repo, path) {
    const envelope = await connectors.call(m, 'get_file_contents', { owner, repo, path });
    return extractFileText(envelope, `Đọc ${path}`);
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
