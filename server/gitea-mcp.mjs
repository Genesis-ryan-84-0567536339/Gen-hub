import { HubError, assertSchema, request } from './net.mjs';

export const DEFAULT_GITEA_URL = 'http://gitea:3000/api/v1';

export function giteaBaseUrl(url = DEFAULT_GITEA_URL) {
  const clean = String(url || DEFAULT_GITEA_URL).trim().replace(/\/+$/, '');
  if (!clean) return DEFAULT_GITEA_URL;
  if (clean.endsWith('/api/v1')) return clean;
  return `${clean}/api/v1`;
}

export function giteaEndpoint(m) {
  const u = giteaBaseUrl(m?.url);
  try {
    const parsed = new URL(u);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new Error();
    }
  } catch {
    throw new HubError('Gitea URL không hợp lệ');
  }
  return u;
}

export function giteaPublished(tool, previous) {
  return (
    previous?.published === true &&
    JSON.stringify(previous.inputSchema) === JSON.stringify(tool.inputSchema) &&
    JSON.stringify(previous.annotations) === JSON.stringify(tool.annotations)
  );
}

const string = (desc) => ({ type: 'string', ...(desc ? { description: desc } : {}) });
const integer = (desc, min = 1) => ({ type: 'integer', minimum: min, ...(desc ? { description: desc } : {}) });
const repoProps = {
  owner: string('Chủ sở hữu repo hoặc tên tổ chức'),
  repo: string('Tên kho mã nguồn')
};

const defineTool = (name, description, properties, required, write = false) => ({
  name,
  description,
  inputSchema: {
    type: 'object',
    properties,
    required,
    additionalProperties: false
  },
  annotations: {
    readOnlyHint: !write,
    destructiveHint: write,
    openWorldHint: true
  },
  published: false
});

export const GITEA_TOOLS = [
  defineTool(
    'get_file_contents',
    'Đọc nội dung và metadata tệp từ Gitea repo.',
    {
      ...repoProps,
      filepath: string('Đường dẫn tệp trong repo'),
      ref: string('Tên branch, tag hoặc commit SHA (mặc định branch chính)')
    },
    ['owner', 'repo', 'filepath'],
    false
  ),
  defineTool(
    'create_or_update_file',
    'Tạo mới hoặc cập nhật tệp trong Gitea repo.',
    {
      ...repoProps,
      filepath: string('Đường dẫn tệp trong repo'),
      content: string('Nội dung tệp dạng văn bản utf-8'),
      message: string('Thông điệp commit'),
      branch: string('Tên branch thực hiện thay đổi'),
      sha: string('SHA của tệp cũ khi cập nhật (tùy chọn, tự lấy nếu bỏ qua)')
    },
    ['owner', 'repo', 'filepath', 'content', 'message'],
    true
  ),
  defineTool(
    'push_files',
    'Commit nhiều tệp cùng lúc trong một commit (batch commit).',
    {
      ...repoProps,
      branch: string('Branch cơ sở để áp dụng commit'),
      message: string('Thông điệp commit'),
      files: {
        type: 'array',
        description: 'Danh sách tệp thao tác ({ path, content, operation: create|update|delete })',
        items: {
          type: 'object',
          properties: {
            path: string('Đường dẫn tệp'),
            content: string('Nội dung tệp (với create/update)'),
            operation: {
              type: 'string',
              description: 'Thao tác: create, update hoặc delete',
              enum: ['create', 'update', 'delete']
            },
            sha: string('SHA tệp cũ (tùy chọn)')
          },
          required: ['path'],
          additionalProperties: false
        }
      },
      new_branch: string('Tạo branch mới từ branch cơ sở (tùy chọn)')
    },
    ['owner', 'repo', 'branch', 'message', 'files'],
    true
  ),
  defineTool(
    'list_branches',
    'Liệt kê danh sách các branch trong Gitea repo.',
    {
      ...repoProps,
      page: integer('Số trang', 1),
      limit: integer('Số lượng kết quả mỗi trang', 1)
    },
    ['owner', 'repo'],
    false
  ),
  defineTool(
    'create_branch',
    'Tạo branch mới trong Gitea repo.',
    {
      ...repoProps,
      branch: string('Tên branch mới cần tạo'),
      ref: string('Tên branch hoặc commit làm nguồn (mặc định branch chính)')
    },
    ['owner', 'repo', 'branch'],
    true
  ),
  defineTool(
    'list_pull_requests',
    'Liệt kê pull request trong Gitea repo.',
    {
      ...repoProps,
      state: { type: 'string', description: 'Trạng thái PR (open, closed, all)', enum: ['open', 'closed', 'all'] },
      page: integer('Số trang', 1),
      limit: integer('Số lượng kết quả mỗi trang', 1),
      sort: string('Sắp xếp (oldest, recentupdate, leastupdate, mostcomment, leastcomment, priority)')
    },
    ['owner', 'repo'],
    false
  ),
  defineTool(
    'create_pull_request',
    'Tạo pull request mới trên Gitea.',
    {
      ...repoProps,
      title: string('Tiêu đề pull request'),
      head: string('Branch chứa mã nguồn thay đổi'),
      base: string('Branch đích nhận thay đổi'),
      body: string('Mô tả chi tiết pull request')
    },
    ['owner', 'repo', 'title', 'head', 'base'],
    true
  ),
  defineTool(
    'merge_pull_request',
    'Hợp nhất (merge) pull request trên Gitea.',
    {
      ...repoProps,
      pull_number: integer('Số thứ tự / chỉ mục của PR'),
      merge_method: {
        type: 'string',
        description: 'Phương thức merge',
        enum: ['merge', 'rebase', 'rebase-merge', 'squash', 'fast-forward-only', 'manually-merged']
      },
      title: string('Tiêu đề commit merge'),
      message: string('Nội dung chi tiết commit merge')
    },
    ['owner', 'repo', 'pull_number'],
    true
  ),
  defineTool(
    'pull_request_read',
    'Đọc thông tin chi tiết một pull request trên Gitea.',
    {
      ...repoProps,
      pull_number: integer('Số thứ tự / chỉ mục của PR')
    },
    ['owner', 'repo', 'pull_number'],
    false
  ),
  defineTool(
    'list_issues',
    'Liệt kê các issue trong Gitea repo.',
    {
      ...repoProps,
      state: { type: 'string', description: 'Trạng thái issue (open, closed, all)', enum: ['open', 'closed', 'all'] },
      page: integer('Số trang', 1),
      limit: integer('Số lượng kết quả mỗi trang', 1),
      q: string('Từ khóa tìm kiếm')
    },
    ['owner', 'repo'],
    false
  ),
  defineTool(
    'issue_read',
    'Đọc chi tiết một issue trên Gitea.',
    {
      ...repoProps,
      issue_number: integer('Số thứ tự / chỉ mục của issue')
    },
    ['owner', 'repo', 'issue_number'],
    false
  ),
  defineTool(
    'add_issue_comment',
    'Thêm bình luận vào issue hoặc pull request trên Gitea.',
    {
      ...repoProps,
      issue_number: integer('Số thứ tự / chỉ mục của issue'),
      body: string('Nội dung bình luận')
    },
    ['owner', 'repo', 'issue_number', 'body'],
    true
  ),
  defineTool(
    'gitea_issue_create',
    'Tạo issue mới trên Gitea (chỉ tiêu đề và nội dung).',
    {
      ...repoProps,
      title: string('Tiêu đề issue'),
      body: string('Nội dung chi tiết issue')
    },
    ['owner', 'repo', 'title'],
    true
  ),
  defineTool(
    'gitea_issue_close',
    'Đóng issue trên Gitea; không sửa nội dung hay nhãn.',
    {
      ...repoProps,
      issue_number: integer('Số thứ tự / chỉ mục của issue')
    },
    ['owner', 'repo', 'issue_number'],
    true
  ),
  defineTool(
    'gitea_issue_label',
    'Thay toàn bộ nhãn của issue bằng danh sách labels mới; [] xóa hết nhãn.',
    {
      ...repoProps,
      issue_number: integer('Số thứ tự / chỉ mục của issue'),
      labels: {
        type: 'array',
        description: 'Mảng tên nhãn hoặc ID nhãn. Truyền [] để gỡ bỏ toàn bộ nhãn.',
        items: string()
      }
    },
    ['owner', 'repo', 'issue_number', 'labels'],
    true
  )
];

export function giteaTools() {
  return structuredClone(GITEA_TOOLS);
}

function checkRequiredStrings(obj, keys) {
  for (const k of keys) {
    if (typeof obj[k] !== 'string' || !obj[k].trim()) {
      throw new HubError(k + ' không được rỗng');
    }
  }
}

async function requestGitea(url, { method = 'GET', token, body, request: doRequest = request } = {}) {
  if (!token) throw new HubError('MCP chưa có credential', 401);
  const headers = {
    Accept: 'application/json',
    Authorization: 'token ' + token,
    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
  };

  const r = await doRequest(url, {
    method,
    headers,
    body,
    allowPrivate: true
  });

  if (r.status !== undefined) {
    if (r.status === 401) throw new HubError('MCP yêu cầu xác thực lại', 401);
    if (r.status === 403) throw new HubError('Gitea API từ chối truy cập (403)', 403);
    if (r.status === 404) throw new HubError('Không tìm thấy tài nguyên trên Gitea (404)', 404);
    if (r.status < 200 || r.status >= 300) {
      throw new HubError('Gitea API trả HTTP ' + r.status, 502);
    }
  }

  return r.json ?? (r.text ? JSON.parse(r.text) : r);
}

export async function giteaCall(name, args = {}, { url, token, request: doRequest = request } = {}) {
  const toolDef = GITEA_TOOLS.find(t => t.name === name);
  if (!toolDef) throw new HubError('Tool không hỗ trợ: ' + name, 404);

  assertSchema(toolDef.inputSchema, args);

  const base = giteaBaseUrl(url);
  const enc = encodeURIComponent;

  let result;

  switch (name) {
    case 'get_file_contents': {
      checkRequiredStrings(args, ['owner', 'repo', 'filepath']);
      const owner = enc(args.owner.trim());
      const repo = enc(args.repo.trim());
      // Filepath may contain slashes, encode path segments
      const filepath = args.filepath.trim().split('/').map(enc).join('/');
      const refQuery = args.ref ? `?ref=${enc(args.ref.trim())}` : '';
      const targetUrl = `${base}/repos/${owner}/${repo}/contents/${filepath}${refQuery}`;
      const data = await requestGitea(targetUrl, { method: 'GET', token, request: doRequest });

      // If content is base64 encoded by Gitea, decode to text for ease of use
      let decoded = null;
      if (data && typeof data.content === 'string' && data.encoding === 'base64') {
        try {
          decoded = Buffer.from(data.content, 'base64').toString('utf8');
        } catch {}
      }

      result = {
        name: data?.name,
        path: data?.path,
        sha: data?.sha,
        size: data?.size,
        content: decoded !== null ? decoded : data?.content,
        encoding: decoded !== null ? 'utf-8' : data?.encoding
      };
      break;
    }

    case 'create_or_update_file': {
      checkRequiredStrings(args, ['owner', 'repo', 'filepath', 'message']);
      if (typeof args.content !== 'string') throw new HubError('content phải là chuỗi');
      const owner = enc(args.owner.trim());
      const repo = enc(args.repo.trim());
      const filepath = args.filepath.trim().split('/').map(enc).join('/');
      const targetUrl = `${base}/repos/${owner}/${repo}/contents/${filepath}`;

      let sha = args.sha;
      if (!sha) {
        // Try to check if file already exists
        const refQuery = args.branch ? `?ref=${enc(args.branch.trim())}` : '';
        try {
          const existing = await requestGitea(`${targetUrl}${refQuery}`, {
            method: 'GET',
            token,
            request: doRequest
          });
          if (existing?.sha) sha = existing.sha;
        } catch (err) {
          if (err.status !== 404) throw err;
        }
      }

      const base64Content = Buffer.from(args.content, 'utf8').toString('base64');
      const payload = {
        message: args.message.trim(),
        content: base64Content,
        ...(args.branch ? { branch: args.branch.trim() } : {}),
        ...(sha ? { sha } : {})
      };

      // Gitea uses PUT for update (or create if sha empty)
      const res = await requestGitea(targetUrl, {
        method: sha ? 'PUT' : 'POST',
        token,
        body: payload,
        request: doRequest
      });

      result = {
        content: {
          name: res?.content?.name,
          path: res?.content?.path,
          sha: res?.content?.sha
        },
        commit: {
          sha: res?.commit?.sha,
          message: res?.commit?.message
        }
      };
      break;
    }

    case 'push_files': {
      checkRequiredStrings(args, ['owner', 'repo', 'branch', 'message']);
      if (!Array.isArray(args.files) || args.files.length === 0) {
        throw new HubError('files phải là mảng tệp không rỗng');
      }

      const owner = enc(args.owner.trim());
      const repo = enc(args.repo.trim());
      const targetUrl = `${base}/repos/${owner}/${repo}/contents`;

      const formattedFiles = args.files.map(f => {
        if (!f || typeof f.path !== 'string' || !f.path.trim()) {
          throw new HubError('Mỗi phần tử trong files phải có path hợp lệ');
        }
        const op = f.operation || 'create';
        const fileObj = {
          path: f.path.trim(),
          operation: op
        };
        if (op !== 'delete') {
          fileObj.content = Buffer.from(typeof f.content === 'string' ? f.content : '', 'utf8').toString('base64');
        }
        if (f.sha) fileObj.sha = f.sha;
        return fileObj;
      });

      const payload = {
        branch: args.branch.trim(),
        message: args.message.trim(),
        files: formattedFiles,
        ...(args.new_branch ? { new_branch: args.new_branch.trim() } : {})
      };

      const res = await requestGitea(targetUrl, {
        method: 'POST',
        token,
        body: payload,
        request: doRequest
      });

      result = {
        commit: {
          sha: res?.commit?.sha,
          message: res?.commit?.message
        },
        files: (res?.files || []).map(f => ({ path: f.path, sha: f.sha }))
      };
      break;
    }

    case 'list_branches': {
      checkRequiredStrings(args, ['owner', 'repo']);
      const owner = enc(args.owner.trim());
      const repo = enc(args.repo.trim());
      const params = new URLSearchParams();
      if (args.page) params.set('page', String(args.page));
      if (args.limit) params.set('limit', String(args.limit));
      const q = params.toString() ? `?${params.toString()}` : '';
      const targetUrl = `${base}/repos/${owner}/${repo}/branches${q}`;
      const data = await requestGitea(targetUrl, { method: 'GET', token, request: doRequest });
      result = (Array.isArray(data) ? data : []).map(b => ({
        name: b.name,
        commit: { id: b.commit?.id },
        protected: !!b.protected
      }));
      break;
    }

    case 'create_branch': {
      checkRequiredStrings(args, ['owner', 'repo', 'branch']);
      const owner = enc(args.owner.trim());
      const repo = enc(args.repo.trim());
      const targetUrl = `${base}/repos/${owner}/${repo}/branches`;
      const payload = {
        new_branch_name: args.branch.trim(),
        ...(args.ref ? { old_ref_name: args.ref.trim() } : {})
      };
      const res = await requestGitea(targetUrl, {
        method: 'POST',
        token,
        body: payload,
        request: doRequest
      });
      result = {
        name: res?.name,
        commit: { id: res?.commit?.id }
      };
      break;
    }

    case 'list_pull_requests': {
      checkRequiredStrings(args, ['owner', 'repo']);
      const owner = enc(args.owner.trim());
      const repo = enc(args.repo.trim());
      const params = new URLSearchParams();
      if (args.state) params.set('state', args.state);
      if (args.page) params.set('page', String(args.page));
      if (args.limit) params.set('limit', String(args.limit));
      if (args.sort) params.set('sort', args.sort);
      const q = params.toString() ? `?${params.toString()}` : '';
      const targetUrl = `${base}/repos/${owner}/${repo}/pulls${q}`;
      const data = await requestGitea(targetUrl, { method: 'GET', token, request: doRequest });
      result = (Array.isArray(data) ? data : []).map(p => ({
        number: p.number,
        title: p.title,
        state: p.state,
        user: { username: p.user?.username || p.user?.login },
        head: { ref: p.head?.ref, sha: p.head?.sha },
        base: { ref: p.base?.ref, sha: p.base?.sha },
        created_at: p.created_at,
        updated_at: p.updated_at
      }));
      break;
    }

    case 'create_pull_request': {
      checkRequiredStrings(args, ['owner', 'repo', 'title', 'head', 'base']);
      const owner = enc(args.owner.trim());
      const repo = enc(args.repo.trim());
      const targetUrl = `${base}/repos/${owner}/${repo}/pulls`;
      const payload = {
        title: args.title.trim(),
        head: args.head.trim(),
        base: args.base.trim(),
        body: typeof args.body === 'string' ? args.body : ''
      };
      const p = await requestGitea(targetUrl, {
        method: 'POST',
        token,
        body: payload,
        request: doRequest
      });
      result = {
        number: p?.number,
        title: p?.title,
        state: p?.state,
        head: { ref: p?.head?.ref, sha: p?.head?.sha },
        base: { ref: p?.base?.ref, sha: p?.base?.sha }
      };
      break;
    }

    case 'merge_pull_request': {
      checkRequiredStrings(args, ['owner', 'repo']);
      const num = Number(args.pull_number);
      if (!Number.isInteger(num) || num <= 0) throw new HubError('pull_number phải là số nguyên dương');
      const owner = enc(args.owner.trim());
      const repo = enc(args.repo.trim());
      const targetUrl = `${base}/repos/${owner}/${repo}/pulls/${num}/merge`;
      const payload = {
        Do: args.merge_method || 'merge',
        ...(args.title ? { MergeTitleField: args.title } : {}),
        ...(args.message ? { MergeMessageField: args.message } : {})
      };
      const res = await requestGitea(targetUrl, {
        method: 'POST',
        token,
        body: payload,
        request: doRequest
      });
      result = {
        merged: true,
        message: res?.message || 'Pull request merged successfully'
      };
      break;
    }

    case 'pull_request_read': {
      checkRequiredStrings(args, ['owner', 'repo']);
      const num = Number(args.pull_number);
      if (!Number.isInteger(num) || num <= 0) throw new HubError('pull_number phải là số nguyên dương');
      const owner = enc(args.owner.trim());
      const repo = enc(args.repo.trim());
      const targetUrl = `${base}/repos/${owner}/${repo}/pulls/${num}`;
      const p = await requestGitea(targetUrl, { method: 'GET', token, request: doRequest });
      result = {
        number: p.number,
        title: p.title,
        body: p.body,
        state: p.state,
        user: { username: p.user?.username || p.user?.login },
        head: { ref: p.head?.ref, sha: p.head?.sha },
        base: { ref: p.base?.ref, sha: p.base?.sha },
        merged: !!p.merged,
        merged_at: p.merged_at,
        created_at: p.created_at,
        updated_at: p.updated_at
      };
      break;
    }

    case 'list_issues': {
      checkRequiredStrings(args, ['owner', 'repo']);
      const owner = enc(args.owner.trim());
      const repo = enc(args.repo.trim());
      const params = new URLSearchParams();
      if (args.state) params.set('state', args.state);
      if (args.page) params.set('page', String(args.page));
      if (args.limit) params.set('limit', String(args.limit));
      if (args.q) params.set('q', args.q);
      const q = params.toString() ? `?${params.toString()}` : '';
      const targetUrl = `${base}/repos/${owner}/${repo}/issues${q}`;
      const data = await requestGitea(targetUrl, { method: 'GET', token, request: doRequest });
      result = (Array.isArray(data) ? data : []).map(i => ({
        number: i.number,
        title: i.title,
        state: i.state,
        user: { username: i.user?.username || i.user?.login },
        labels: (i.labels || []).map(l => (typeof l === 'object' ? l.name : l)),
        created_at: i.created_at,
        updated_at: i.updated_at
      }));
      break;
    }

    case 'issue_read': {
      checkRequiredStrings(args, ['owner', 'repo']);
      const num = Number(args.issue_number);
      if (!Number.isInteger(num) || num <= 0) throw new HubError('issue_number phải là số nguyên dương');
      const owner = enc(args.owner.trim());
      const repo = enc(args.repo.trim());
      const targetUrl = `${base}/repos/${owner}/${repo}/issues/${num}`;
      const i = await requestGitea(targetUrl, { method: 'GET', token, request: doRequest });
      result = {
        number: i.number,
        title: i.title,
        body: i.body,
        state: i.state,
        user: { username: i.user?.username || i.user?.login },
        labels: (i.labels || []).map(l => (typeof l === 'object' ? l.name : l)),
        comments: i.comments,
        created_at: i.created_at,
        updated_at: i.updated_at
      };
      break;
    }

    case 'add_issue_comment': {
      checkRequiredStrings(args, ['owner', 'repo', 'body']);
      const num = Number(args.issue_number);
      if (!Number.isInteger(num) || num <= 0) throw new HubError('issue_number phải là số nguyên dương');
      const owner = enc(args.owner.trim());
      const repo = enc(args.repo.trim());
      const targetUrl = `${base}/repos/${owner}/${repo}/issues/${num}/comments`;
      const res = await requestGitea(targetUrl, {
        method: 'POST',
        token,
        body: { body: args.body.trim() },
        request: doRequest
      });
      result = {
        id: res?.id,
        user: { username: res?.user?.username || res?.user?.login },
        body: res?.body,
        created_at: res?.created_at
      };
      break;
    }

    case 'gitea_issue_create': {
      checkRequiredStrings(args, ['owner', 'repo', 'title']);
      const owner = enc(args.owner.trim());
      const repo = enc(args.repo.trim());
      const targetUrl = `${base}/repos/${owner}/${repo}/issues`;
      const payload = {
        title: args.title.trim(),
        body: typeof args.body === 'string' ? args.body : ''
      };
      const res = await requestGitea(targetUrl, {
        method: 'POST',
        token,
        body: payload,
        request: doRequest
      });
      result = {
        number: res?.number,
        title: res?.title,
        state: res?.state,
        user: { username: res?.user?.username || res?.user?.login }
      };
      break;
    }

    case 'gitea_issue_close': {
      checkRequiredStrings(args, ['owner', 'repo']);
      const num = Number(args.issue_number);
      if (!Number.isInteger(num) || num <= 0) throw new HubError('issue_number phải là số nguyên dương');
      const owner = enc(args.owner.trim());
      const repo = enc(args.repo.trim());
      const targetUrl = `${base}/repos/${owner}/${repo}/issues/${num}`;
      const res = await requestGitea(targetUrl, {
        method: 'PATCH',
        token,
        body: { state: 'closed' },
        request: doRequest
      });
      result = {
        number: res?.number,
        title: res?.title,
        state: res?.state
      };
      break;
    }

    case 'gitea_issue_label': {
      checkRequiredStrings(args, ['owner', 'repo']);
      const num = Number(args.issue_number);
      if (!Number.isInteger(num) || num <= 0) throw new HubError('issue_number phải là số nguyên dương');
      if (
        !Array.isArray(args.labels) ||
        args.labels.length > 100 ||
        args.labels.some(v => typeof v !== 'string' || !v.trim() || v.length > 100)
      ) {
        throw new HubError('labels phải là mảng tên nhãn (tối đa 100)');
      }
      const owner = enc(args.owner.trim());
      const repo = enc(args.repo.trim());
      const targetUrl = `${base}/repos/${owner}/${repo}/issues/${num}/labels`;
      const res = await requestGitea(targetUrl, {
        method: 'PUT',
        token,
        body: { labels: args.labels },
        request: doRequest
      });
      result = {
        number: num,
        labels: (Array.isArray(res) ? res : []).map(l => (typeof l === 'object' ? l.name : l))
      };
      break;
    }
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
    isError: false
  };
}
