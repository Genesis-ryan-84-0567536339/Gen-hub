import { HubError, assertSchema, request } from './net.mjs';

export const GITHUB_MCP_URL = 'https://api.githubcopilot.com/mcp/';
export const isMcp = m => ['remote', 'github-mcp'].includes(m.provider);

// Keep this policy in code, never in upstream metadata or caller arguments.
const string = { type: 'string' };
const repo = { owner: string, repo: string };
const issue = { ...repo, issue_number: { type: 'integer', minimum: 1 } };
const wrapper = (name, description, properties, required, fixed) => ({
  tool: {
    name,
    description,
    inputSchema: { type: 'object', properties, required, additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    published: false
  },
  fixed
});
const wrappers = [
  wrapper(
    'github_issue_create',
    'Tạo issue mới (chỉ tiêu đề và nội dung).',
    { ...repo, title: string, body: string },
    ['owner', 'repo', 'title'],
    { method: 'create' }
  ),
  wrapper(
    'github_issue_close',
    'Đóng issue; không sửa nội dung, nhãn hoặc mở lại.',
    issue,
    ['owner', 'repo', 'issue_number'],
    { method: 'update', state: 'closed' }
  ),
  wrapper(
    'github_issue_label',
    'Thay toàn bộ nhãn của issue bằng labels; [] xóa hết nhãn. Gửi cả nhãn muốn giữ.',
    { ...issue, labels: { type: 'array', items: string } },
    ['owner', 'repo', 'issue_number', 'labels'],
    { method: 'update' }
  )
];

export const checkStatusTool = {
  name: 'github_check_status',
  description: 'Đọc trạng thái CI / GitHub Actions check-runs của commit hoặc branch.',
  inputSchema: {
    type: 'object',
    properties: { ...repo, ref: string },
    required: ['owner', 'repo', 'ref'],
    additionalProperties: false
  },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  published: false
};

export async function githubCheckStatus(args, { token, request: doRequest = request } = {}) {
  if (!token) throw new HubError('MCP chưa có credential', 401);
  assertSchema(checkStatusTool.inputSchema, args);
  for (const key of ['owner', 'repo', 'ref']) {
    if (typeof args[key] !== 'string' || !args[key].trim())
      throw new HubError(key + ' không được rỗng');
  }
  const enc = encodeURIComponent;
  const url = `https://api.github.com/repos/${enc(args.owner.trim())}/${enc(args.repo.trim())}/commits/${enc(args.ref.trim())}/check-runs`;
  const headers = {
    Authorization: 'Bearer ' + token,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  const r = await doRequest(url, { headers, method: 'GET' });
  if (r.status !== undefined) {
    if (r.status === 401) throw new HubError('MCP yêu cầu xác thực lại', 401);
    if (r.status < 200 || r.status >= 300)
      throw new HubError('GitHub API trả HTTP ' + r.status, r.status === 403 ? 403 : 502);
  }
  const data = r.json ?? (r.text ? JSON.parse(r.text) : r);
  const checkRuns = Array.isArray(data?.check_runs) ? data.check_runs : [];
  const runs = checkRuns.map(c => ({
    name: c.name,
    status: c.status,
    conclusion: c.conclusion ?? null
  }));
  return {
    content: [{ type: 'text', text: JSON.stringify(runs) }],
    isError: false
  };
}

export function githubTools(tools) {
  if (
    tools.some(
      t => t.name === checkStatusTool.name || wrappers.some(w => w.tool.name === t.name)
    )
  )
    throw new HubError('GitHub MCP trùng tên wrapper của Hub', 502);
  const upstream = tools.find(t => t.name === 'issue_write');
  const result = tools.filter(t => t.name !== 'issue_write');
  if (upstream) {
    const props = upstream.inputSchema?.properties || {};
    for (const { tool, fixed } of wrappers) {
      const keys = [...Object.keys(tool.inputSchema.properties), ...Object.keys(fixed)];
      if (
        keys.some(k => !Object.hasOwn(props, k)) ||
        (upstream.inputSchema.required || []).some(k => !keys.includes(k)) ||
        Object.entries(fixed).some(([k, v]) => props[k].enum && !props[k].enum.includes(v))
      )
        throw new HubError('Schema issue_write đã đổi; cần kiểm tra adapter GitHub', 502);
      result.push(structuredClone(tool));
    }
  }
  result.push(structuredClone(checkStatusTool));
  return result;
}

export function githubCall(name, args, { token, request: doRequest = request } = {}) {
  if (name === 'github_check_status') {
    return githubCheckStatus(args, { token, request: doRequest });
  }
  if (name === 'issue_write') throw new HubError('Dùng wrapper issue riêng của Gen-hub', 403);
  const w = wrappers.find(w => w.tool.name === name);
  if (!w) return { name, arguments: args };
  assertSchema(w.tool.inputSchema, args);
  for (const [key, value] of Object.entries(args)) {
    if (w.tool.inputSchema.properties[key].type === 'string' && !value.trim())
      throw new HubError(key + ' không được rỗng');
  }
  if (
    name === 'github_issue_label' &&
    (!Array.isArray(args.labels) ||
      args.labels.length > 100 ||
      args.labels.some(v => typeof v !== 'string' || !v.trim() || v.length > 100))
  )
    throw new HubError('labels phải là mảng tên nhãn (tối đa 100)');
  // Build from an allowlist even after validation: no method/state/extra-field override.
  const payload = { ...w.fixed };
  for (const key of Object.keys(w.tool.inputSchema.properties))
    if (Object.hasOwn(args, key)) payload[key] = args[key];
  return { name: 'issue_write', arguments: payload };
}

export function githubEndpoint(m) {
  if (m.url !== GITHUB_MCP_URL || m.allowPrivate || m.auth !== 'token')
    throw new HubError('GitHub MCP yêu cầu endpoint HTTPS chính thức và Bearer token');
  return m.url;
}

export function githubPublished(tool, previous) {
  // New or changed contracts need owner review, irrespective of upstream hints.
  return (
    previous?.published === true &&
    JSON.stringify(previous.inputSchema) === JSON.stringify(tool.inputSchema) &&
    JSON.stringify(previous.annotations) === JSON.stringify(tool.annotations)
  );
}
