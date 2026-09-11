import { HubError, assertSchema, request } from './net.mjs';

export const DEFAULT_GITEA_URL = 'http://gitea:3000/api/v1';

export function giteaBaseUrl(url = DEFAULT_GITEA_URL) {
  const clean = String(url || DEFAULT_GITEA_URL).trim().replace(/\/+$/, '');
  if (!clean) return DEFAULT_GITEA_URL;
  if (clean.endsWith('/api/v1')) return clean;
  return `${clean}/api/v1`;
}

export function isDefaultGiteaUrl(url) {
  if (!url) return true;
  try {
    const parsed = new URL(giteaBaseUrl(url));
    const defaultParsed = new URL(DEFAULT_GITEA_URL);
    return (
      parsed.protocol === defaultParsed.protocol &&
      parsed.hostname.toLowerCase() === defaultParsed.hostname.toLowerCase() &&
      (parsed.port || (parsed.protocol === 'https:' ? '443' : '80')) ===
        (defaultParsed.port || (defaultParsed.protocol === 'https:' ? '443' : '80')) &&
      parsed.pathname.replace(/\/+$/, '') === defaultParsed.pathname.replace(/\/+$/, '')
    );
  } catch {
    return false;
  }
}

export function isDefaultGiteaTarget(url) {
  try {
    const parsed = new URL(url);
    const defaultParsed = new URL(DEFAULT_GITEA_URL);
    return (
      parsed.protocol === defaultParsed.protocol &&
      parsed.hostname.toLowerCase() === defaultParsed.hostname.toLowerCase() &&
      (parsed.port || (parsed.protocol === 'https:' ? '443' : '80')) ===
        (defaultParsed.port || (defaultParsed.protocol === 'https:' ? '443' : '80')) &&
      (parsed.pathname === defaultParsed.pathname ||
        parsed.pathname.startsWith(defaultParsed.pathname + '/'))
    );
  } catch {
    return false;
  }
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
const boolean = (desc) => ({ type: 'boolean', ...(desc ? { description: desc } : {}) });

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
  // --- Files & Contents ---
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

  // --- Repositories & Commits ---
  defineTool(
    'get_repository',
    'Đọc thông tin chi tiết một kho mã nguồn trên Gitea.',
    repoProps,
    ['owner', 'repo'],
    false
  ),
  defineTool(
    'create_repository',
    'Tạo một kho mã nguồn mới trên Gitea.',
    {
      name: string('Tên repo cần tạo'),
      org: string('Tên tổ chức (nếu tạo cho tổ chức, bỏ trống để tạo cho user hiện tại)'),
      description: string('Mô tả repo'),
      private: boolean('Repo riêng tư'),
      auto_init: boolean('Tự động khởi tạo README, gitignore'),
      default_branch: string('Tên branch mặc định (vd: main)')
    },
    ['name'],
    true
  ),
  defineTool(
    'fork_repository',
    'Fork một kho mã nguồn trên Gitea.',
    {
      ...repoProps,
      organization: string('Tên tổ chức đích để fork vào (tùy chọn)'),
      name: string('Tên mới cho repo đã fork (tùy chọn)')
    },
    ['owner', 'repo'],
    true
  ),
  defineTool(
    'list_commits',
    'Liệt kê các commit trong Gitea repo.',
    {
      ...repoProps,
      sha: string('Branch hoặc commit SHA bắt đầu'),
      path: string('Đường dẫn tệp/thư mục để lọc commit'),
      page: integer('Số trang', 1),
      limit: integer('Số commit mỗi trang', 1)
    },
    ['owner', 'repo'],
    false
  ),
  defineTool(
    'get_commit',
    'Đọc thông tin chi tiết một commit cụ thể qua SHA.',
    {
      ...repoProps,
      sha: string('Commit SHA')
    },
    ['owner', 'repo', 'sha'],
    false
  ),
  defineTool(
    'list_repo_topics',
    'Liệt kê danh sách topic/chủ đề của repo.',
    repoProps,
    ['owner', 'repo'],
    false
  ),
  defineTool(
    'set_repo_topics',
    'Cập nhật toàn bộ danh sách topic/chủ đề của repo.',
    {
      ...repoProps,
      topics: {
        type: 'array',
        description: 'Mảng tên chủ đề',
        items: string()
      }
    },
    ['owner', 'repo', 'topics'],
    true
  ),

  // --- Branches & Tags ---
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
    'list_tags',
    'Liệt kê danh sách git tag trong Gitea repo.',
    {
      ...repoProps,
      page: integer('Số trang', 1),
      limit: integer('Số lượng tag mỗi trang', 1)
    },
    ['owner', 'repo'],
    false
  ),
  defineTool(
    'create_tag',
    'Tạo git tag mới trong Gitea repo.',
    {
      ...repoProps,
      tag_name: string('Tên tag cần tạo'),
      target: string('Target commit SHA hoặc branch name'),
      message: string('Thông điệp cho annotated tag')
    },
    ['owner', 'repo', 'tag_name'],
    true
  ),
  defineTool(
    'delete_tag',
    'Xóa git tag trong Gitea repo.',
    {
      ...repoProps,
      tag_name: string('Tên tag cần xóa')
    },
    ['owner', 'repo', 'tag_name'],
    true
  ),

  // --- Pull Requests & Reviews ---
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
    'list_pr_commits',
    'Liệt kê các commit thuộc một pull request.',
    {
      ...repoProps,
      pull_number: integer('Số thứ tự của PR')
    },
    ['owner', 'repo', 'pull_number'],
    false
  ),
  defineTool(
    'list_pr_reviews',
    'Liệt kê các review của một pull request.',
    {
      ...repoProps,
      pull_number: integer('Số thứ tự của PR')
    },
    ['owner', 'repo', 'pull_number'],
    false
  ),
  defineTool(
    'create_pr_review',
    'Tạo review cho một pull request.',
    {
      ...repoProps,
      pull_number: integer('Số thứ tự của PR'),
      event: {
        type: 'string',
        description: 'Loại review: APPROVED, REQUEST_CHANGES, hoặc COMMENT',
        enum: ['APPROVED', 'REQUEST_CHANGES', 'COMMENT', 'PENDING']
      },
      body: string('Nội dung đánh giá review'),
      commit_id: string('Commit SHA được review (tùy chọn)')
    },
    ['owner', 'repo', 'pull_number', 'event'],
    true
  ),

  // --- Issues & Comments ---
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
    'update_issue',
    'Cập nhật thông tin issue (tiêu đề, nội dung, trạng thái open/closed, người được giao, milestone).',
    {
      ...repoProps,
      issue_number: integer('Số thứ tự / chỉ mục của issue'),
      title: string('Tiêu đề mới của issue'),
      body: string('Nội dung mới của issue'),
      state: {
        type: 'string',
        enum: ['open', 'closed'],
        description: 'Trạng thái của issue (open hoặc closed)'
      },
      assignees: {
        type: 'array',
        description: 'Danh sách username được giao phụ trách issue',
        items: string()
      },
      milestone: integer('ID của milestone gắn với issue', 0)
    },
    ['owner', 'repo', 'issue_number'],
    true
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
  ),

  // --- Labels (Repo Level) ---
  defineTool(
    'list_repo_labels',
    'Liệt kê danh sách tất cả các nhãn (labels) được cấu hình trong repo.',
    repoProps,
    ['owner', 'repo'],
    false
  ),
  defineTool(
    'get_repo_label',
    'Đọc thông tin một nhãn theo ID.',
    {
      ...repoProps,
      label_id: integer('ID của nhãn')
    },
    ['owner', 'repo', 'label_id'],
    false
  ),
  defineTool(
    'create_repo_label',
    'Tạo nhãn (label) mới cho repo.',
    {
      ...repoProps,
      name: string('Tên nhãn'),
      color: string('Mã màu hex (ví dụ: #00aabb)'),
      description: string('Mô tả nhãn')
    },
    ['owner', 'repo', 'name', 'color'],
    true
  ),
  defineTool(
    'update_repo_label',
    'Cập nhật tên, màu sắc hoặc mô tả nhãn theo ID.',
    {
      ...repoProps,
      label_id: integer('ID của nhãn'),
      name: string('Tên mới cho nhãn'),
      color: string('Mã màu hex mới'),
      description: string('Mô tả mới')
    },
    ['owner', 'repo', 'label_id'],
    true
  ),
  defineTool(
    'delete_repo_label',
    'Xóa nhãn khỏi repo theo ID.',
    {
      ...repoProps,
      label_id: integer('ID của nhãn cần xóa')
    },
    ['owner', 'repo', 'label_id'],
    true
  ),

  // --- Milestones ---
  defineTool(
    'list_milestones',
    'Liệt kê các milestone trong repo.',
    {
      ...repoProps,
      state: { type: 'string', description: 'Trạng thái milestone (open, closed, all)', enum: ['open', 'closed', 'all'] },
      page: integer('Số trang', 1),
      limit: integer('Số lượng mỗi trang', 1)
    },
    ['owner', 'repo'],
    false
  ),
  defineTool(
    'get_milestone',
    'Đọc thông tin một milestone theo ID hoặc tên.',
    {
      ...repoProps,
      milestone_id: integer('ID của milestone')
    },
    ['owner', 'repo', 'milestone_id'],
    false
  ),
  defineTool(
    'create_milestone',
    'Tạo milestone mới trong repo.',
    {
      ...repoProps,
      title: string('Tiêu đề milestone'),
      description: string('Mô tả milestone'),
      due_on: string('Hạn chót theo định dạng ISO 8601 (vd: 2026-12-31T23:59:59Z)'),
      state: { type: 'string', description: 'Trạng thái ban đầu', enum: ['open', 'closed'] }
    },
    ['owner', 'repo', 'title'],
    true
  ),
  defineTool(
    'update_milestone',
    'Cập nhật milestone theo ID.',
    {
      ...repoProps,
      milestone_id: integer('ID của milestone'),
      title: string('Tiêu đề mới'),
      description: string('Mô tả mới'),
      due_on: string('Hạn chót ISO 8601 mới'),
      state: { type: 'string', description: 'Trạng thái', enum: ['open', 'closed'] }
    },
    ['owner', 'repo', 'milestone_id'],
    true
  ),
  defineTool(
    'delete_milestone',
    'Xóa milestone theo ID.',
    {
      ...repoProps,
      milestone_id: integer('ID của milestone cần xóa')
    },
    ['owner', 'repo', 'milestone_id'],
    true
  ),

  // --- Releases ---
  defineTool(
    'list_releases',
    'Liệt kê danh sách các bản phát hành (releases) trong repo.',
    {
      ...repoProps,
      page: integer('Số trang', 1),
      limit: integer('Số release mỗi trang', 1)
    },
    ['owner', 'repo'],
    false
  ),
  defineTool(
    'get_release',
    'Đọc thông tin một bản release theo ID hoặc lấy bản mới nhất.',
    {
      ...repoProps,
      release_id: integer('ID của release (bỏ trống nếu lấy release mới nhất)'),
      latest: boolean('Lấy bản release mới nhất')
    },
    ['owner', 'repo'],
    false
  ),
  defineTool(
    'create_release',
    'Tạo release mới trong Gitea repo.',
    {
      ...repoProps,
      tag_name: string('Tên git tag cho release'),
      name: string('Tiêu đề release'),
      body: string('Nội dung ghi chú phát hành (release notes)'),
      draft: boolean('Lưu dưới dạng bản nháp (draft)'),
      prerelease: boolean('Đánh dấu là bản phát hành thử nghiệm (pre-release)'),
      target_commitish: string('Nhánh hoặc commit đích nếu tag chưa tồn tại')
    },
    ['owner', 'repo', 'tag_name'],
    true
  ),
  defineTool(
    'delete_release',
    'Xóa bản release theo ID.',
    {
      ...repoProps,
      release_id: integer('ID của release cần xóa')
    },
    ['owner', 'repo', 'release_id'],
    true
  ),

  // --- Collaborators ---
  defineTool(
    'list_collaborators',
    'Liệt kê danh sách cộng tác viên (collaborators) trong repo.',
    repoProps,
    ['owner', 'repo'],
    false
  ),
  defineTool(
    'check_collaborator',
    'Kiểm tra một người dùng có phải cộng tác viên của repo hay không.',
    {
      ...repoProps,
      collaborator: string('Tên người dùng cần kiểm tra')
    },
    ['owner', 'repo', 'collaborator'],
    false
  ),
  defineTool(
    'add_collaborator',
    'Thêm hoặc cập nhật quyền cộng tác viên cho một người dùng.',
    {
      ...repoProps,
      collaborator: string('Tên người dùng cần thêm'),
      permission: {
        type: 'string',
        description: 'Quyền: read, write hoặc admin',
        enum: ['read', 'write', 'admin']
      }
    },
    ['owner', 'repo', 'collaborator'],
    true
  ),
  defineTool(
    'remove_collaborator',
    'Xóa cộng tác viên khỏi repo.',
    {
      ...repoProps,
      collaborator: string('Tên người dùng cần xóa')
    },
    ['owner', 'repo', 'collaborator'],
    true
  ),

  // --- Search ---
  defineTool(
    'search_repositories',
    'Tìm kiếm kho mã nguồn trên Gitea theo từ khóa hoặc liệt kê tất cả.',
    {
      q: string('Từ khóa tìm kiếm (bỏ trống để liệt kê tất cả kho mã nguồn)'),
      page: integer('Số trang', 1),
      limit: integer('Số kết quả mỗi trang', 1),
      topic: string('Lọc theo chủ đề topic')
    },
    [],
    false
  ),
  defineTool(
    'search_issues',
    'Tìm kiếm issue và pull request trên Gitea theo từ khóa.',
    {
      q: string('Từ khóa tìm kiếm'),
      state: { type: 'string', description: 'Trạng thái open, closed', enum: ['open', 'closed'] },
      owner: string('Lọc theo chủ sở hữu repo'),
      page: integer('Số trang', 1),
      limit: integer('Số kết quả mỗi trang', 1)
    },
    ['q'],
    false
  ),
  defineTool(
    'search_users',
    'Tìm kiếm tài khoản người dùng trên Gitea.',
    {
      q: string('Từ khóa tìm kiếm username hoặc tên'),
      page: integer('Số trang', 1),
      limit: integer('Số kết quả mỗi trang', 1)
    },
    ['q'],
    false
  ),

  // --- Organizations & Teams ---
  defineTool(
    'list_user_orgs',
    'Liệt kê danh sách các tổ chức (organizations) mà người dùng tham gia.',
    {
      page: integer('Số trang', 1),
      limit: integer('Số kết quả mỗi trang', 1)
    },
    [],
    false
  ),
  defineTool(
    'get_org',
    'Đọc thông tin một tổ chức trên Gitea.',
    {
      org: string('Tên tổ chức')
    },
    ['org'],
    false
  ),
  defineTool(
    'list_org_repos',
    'Liệt kê các repo thuộc một tổ chức.',
    {
      org: string('Tên tổ chức'),
      page: integer('Số trang', 1),
      limit: integer('Số kết quả mỗi trang', 1)
    },
    ['org'],
    false
  ),
  defineTool(
    'list_org_teams',
    'Liệt kê danh sách các nhóm (teams) trong tổ chức.',
    {
      org: string('Tên tổ chức'),
      page: integer('Số trang', 1),
      limit: integer('Số kết quả mỗi trang', 1)
    },
    ['org'],
    false
  ),
  defineTool(
    'list_team_members',
    'Liệt kê thành viên của một team theo team ID.',
    {
      team_id: integer('ID của team'),
      page: integer('Số trang', 1),
      limit: integer('Số kết quả mỗi trang', 1)
    },
    ['team_id'],
    false
  ),

  // --- Webhooks ---
  defineTool(
    'list_repo_hooks',
    'Liệt kê danh sách webhook được cấu hình trong repo.',
    repoProps,
    ['owner', 'repo'],
    false
  ),
  defineTool(
    'get_repo_hook',
    'Đọc chi tiết một webhook trong repo theo ID.',
    {
      ...repoProps,
      hook_id: integer('ID của webhook')
    },
    ['owner', 'repo', 'hook_id'],
    false
  ),
  defineTool(
    'create_repo_hook',
    'Tạo webhook mới cho repo.',
    {
      ...repoProps,
      type: {
        type: 'string',
        description: 'Loại webhook (gitea, slack, discord, telegram...)',
        enum: ['gitea', 'gogs', 'slack', 'discord', 'telegram', 'dingtalk', 'feishu', 'msteams']
      },
      target_url: string('URL nhận webhook payload'),
      events: {
        type: 'array',
        description: 'Danh sách sự kiện kích hoạt webhook (vd: push, pull_request, issues)',
        items: string()
      },
      active: boolean('Kích hoạt webhook ngay khi tạo (mặc định true)'),
      secret: string('Chuỗi bí mật xác thực webhook (tùy chọn)')
    },
    ['owner', 'repo', 'type', 'target_url'],
    true
  ),
  defineTool(
    'delete_repo_hook',
    'Xóa webhook khỏi repo theo ID.',
    {
      ...repoProps,
      hook_id: integer('ID của webhook cần xóa')
    },
    ['owner', 'repo', 'hook_id'],
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

async function _requestGitea(url, { method = 'GET', token, body, allowPrivate = false, request: doRequest = request } = {}) {
  if (!token) throw new HubError('MCP chưa có credential', 401);
  const headers = {
    Accept: 'application/json',
    Authorization: 'token ' + token,
    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
  };

  const effectiveAllowPrivate = isDefaultGiteaTarget(url) || !!allowPrivate;

  const r = await doRequest(url, {
    method,
    headers,
    body,
    allowPrivate: effectiveAllowPrivate
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

export const requestGitea = _requestGitea;

export async function giteaCall(name, args = {}, { url, token, allowPrivate, request: doRequest = request } = {}) {
  const toolDef = GITEA_TOOLS.find(t => t.name === name);
  if (!toolDef) throw new HubError('Tool không hỗ trợ: ' + name, 404);

  assertSchema(toolDef.inputSchema, args);

  const base = giteaBaseUrl(url);
  const effectiveAllowPrivate = isDefaultGiteaUrl(base) || !!allowPrivate;

  const requestGitea = (targetUrl, opts = {}) =>
    _requestGitea(targetUrl, {
      token,
      allowPrivate: effectiveAllowPrivate,
      request: doRequest,
      ...opts
    });

  const enc = encodeURIComponent;
  const owner = args.owner ? enc(args.owner.trim()) : '';
  const repo = args.repo ? enc(args.repo.trim()) : '';

  let result;

  switch (name) {
    // --- Files & Contents ---
    case 'get_file_contents': {
      checkRequiredStrings(args, ['owner', 'repo', 'filepath']);
      const filepath = args.filepath.trim().split('/').map(enc).join('/');
      const refQuery = args.ref ? `?ref=${enc(args.ref.trim())}` : '';
      const targetUrl = `${base}/repos/${owner}/${repo}/contents/${filepath}${refQuery}`;
      const data = await requestGitea(targetUrl, { method: 'GET', token, request: doRequest });

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
      const filepath = args.filepath.trim().split('/').map(enc).join('/');
      const targetUrl = `${base}/repos/${owner}/${repo}/contents/${filepath}`;

      let sha = args.sha;
      if (!sha) {
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

    // --- Repositories & Commits ---
    case 'get_repository': {
      checkRequiredStrings(args, ['owner', 'repo']);
      const targetUrl = `${base}/repos/${owner}/${repo}`;
      result = await requestGitea(targetUrl, { method: 'GET', token, request: doRequest });
      break;
    }

    case 'create_repository': {
      checkRequiredStrings(args, ['name']);
      const targetUrl = args.org ? `${base}/org/${enc(args.org.trim())}/repos` : `${base}/user/repos`;
      const payload = {
        name: args.name.trim(),
        ...(args.description ? { description: args.description.trim() } : {}),
        ...(args.private !== undefined ? { private: !!args.private } : {}),
        ...(args.auto_init !== undefined ? { auto_init: !!args.auto_init } : {}),
        ...(args.default_branch ? { default_branch: args.default_branch.trim() } : {})
      };
      result = await requestGitea(targetUrl, {
        method: 'POST',
        token,
        body: payload,
        request: doRequest
      });
      break;
    }

    case 'fork_repository': {
      checkRequiredStrings(args, ['owner', 'repo']);
      const targetUrl = `${base}/repos/${owner}/${repo}/forks`;
      const payload = {
        ...(args.organization ? { organization: args.organization.trim() } : {}),
        ...(args.name ? { name: args.name.trim() } : {})
      };
      result = await requestGitea(targetUrl, {
        method: 'POST',
        token,
        body: payload,
        request: doRequest
      });
      break;
    }

    case 'list_commits': {
      checkRequiredStrings(args, ['owner', 'repo']);
      const params = new URLSearchParams();
      if (args.sha) params.set('sha', args.sha.trim());
      if (args.path) params.set('path', args.path.trim());
      if (args.page) params.set('page', String(args.page));
      if (args.limit) params.set('limit', String(args.limit));
      const q = params.toString() ? `?${params.toString()}` : '';
      const targetUrl = `${base}/repos/${owner}/${repo}/commits${q}`;
      result = await requestGitea(targetUrl, { method: 'GET', token, request: doRequest });
      break;
    }

    case 'get_commit': {
      checkRequiredStrings(args, ['owner', 'repo', 'sha']);
      const targetUrl = `${base}/repos/${owner}/${repo}/git/commits/${enc(args.sha.trim())}`;
      result = await requestGitea(targetUrl, { method: 'GET', token, request: doRequest });
      break;
    }

    case 'list_repo_topics': {
      checkRequiredStrings(args, ['owner', 'repo']);
      const targetUrl = `${base}/repos/${owner}/${repo}/topics`;
      result = await requestGitea(targetUrl, { method: 'GET', token, request: doRequest });
      break;
    }

    case 'set_repo_topics': {
      checkRequiredStrings(args, ['owner', 'repo']);
      if (!Array.isArray(args.topics)) throw new HubError('topics phải là mảng chuỗi');
      const targetUrl = `${base}/repos/${owner}/${repo}/topics`;
      result = await requestGitea(targetUrl, {
        method: 'PUT',
        token,
        body: { topics: args.topics.map(t => String(t).trim()).filter(Boolean) },
        request: doRequest
      });
      break;
    }

    // --- Branches & Tags ---
    case 'list_branches': {
      checkRequiredStrings(args, ['owner', 'repo']);
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

    case 'list_tags': {
      checkRequiredStrings(args, ['owner', 'repo']);
      const params = new URLSearchParams();
      if (args.page) params.set('page', String(args.page));
      if (args.limit) params.set('limit', String(args.limit));
      const q = params.toString() ? `?${params.toString()}` : '';
      const targetUrl = `${base}/repos/${owner}/${repo}/tags${q}`;
      result = await requestGitea(targetUrl, { method: 'GET', token, request: doRequest });
      break;
    }

    case 'create_tag': {
      checkRequiredStrings(args, ['owner', 'repo', 'tag_name']);
      const targetUrl = `${base}/repos/${owner}/${repo}/tags`;
      const payload = {
        tag_name: args.tag_name.trim(),
        ...(args.target ? { target: args.target.trim() } : {}),
        ...(args.message ? { message: args.message.trim() } : {})
      };
      result = await requestGitea(targetUrl, {
        method: 'POST',
        token,
        body: payload,
        request: doRequest
      });
      break;
    }

    case 'delete_tag': {
      checkRequiredStrings(args, ['owner', 'repo', 'tag_name']);
      const targetUrl = `${base}/repos/${owner}/${repo}/tags/${enc(args.tag_name.trim())}`;
      await requestGitea(targetUrl, { method: 'DELETE', token, request: doRequest });
      result = { ok: true, deleted: args.tag_name.trim() };
      break;
    }

    // --- Pull Requests & Reviews ---
    case 'list_pull_requests': {
      checkRequiredStrings(args, ['owner', 'repo']);
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

    case 'pull_request_read': {
      checkRequiredStrings(args, ['owner', 'repo']);
      const num = Number(args.pull_number);
      if (!Number.isInteger(num) || num <= 0) throw new HubError('pull_number phải là số nguyên dương');
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

    case 'merge_pull_request': {
      checkRequiredStrings(args, ['owner', 'repo']);
      const num = Number(args.pull_number);
      if (!Number.isInteger(num) || num <= 0) throw new HubError('pull_number phải là số nguyên dương');
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

    case 'list_pr_commits': {
      checkRequiredStrings(args, ['owner', 'repo']);
      const num = Number(args.pull_number);
      if (!Number.isInteger(num) || num <= 0) throw new HubError('pull_number phải là số nguyên dương');
      const targetUrl = `${base}/repos/${owner}/${repo}/pulls/${num}/commits`;
      result = await requestGitea(targetUrl, { method: 'GET', token, request: doRequest });
      break;
    }

    case 'list_pr_reviews': {
      checkRequiredStrings(args, ['owner', 'repo']);
      const num = Number(args.pull_number);
      if (!Number.isInteger(num) || num <= 0) throw new HubError('pull_number phải là số nguyên dương');
      const targetUrl = `${base}/repos/${owner}/${repo}/pulls/${num}/reviews`;
      result = await requestGitea(targetUrl, { method: 'GET', token, request: doRequest });
      break;
    }

    case 'create_pr_review': {
      checkRequiredStrings(args, ['owner', 'repo', 'event']);
      const num = Number(args.pull_number);
      if (!Number.isInteger(num) || num <= 0) throw new HubError('pull_number phải là số nguyên dương');
      const targetUrl = `${base}/repos/${owner}/${repo}/pulls/${num}/reviews`;
      const payload = {
        event: args.event,
        body: typeof args.body === 'string' ? args.body : '',
        ...(args.commit_id ? { commit_id: args.commit_id.trim() } : {})
      };
      result = await requestGitea(targetUrl, {
        method: 'POST',
        token,
        body: payload,
        request: doRequest
      });
      break;
    }

    // --- Issues & Comments ---
    case 'list_issues': {
      checkRequiredStrings(args, ['owner', 'repo']);
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
        assignees: (Array.isArray(i.assignees) ? i.assignees : i.assignee ? [i.assignee] : []).map(a =>
          typeof a === 'string' ? { username: a } : { username: a?.username || a?.login || '' }
        ),
        pull_request: i.pull_request || null,
        created_at: i.created_at,
        updated_at: i.updated_at
      }));
      break;
    }

    case 'issue_read': {
      checkRequiredStrings(args, ['owner', 'repo']);
      const num = Number(args.issue_number);
      if (!Number.isInteger(num) || num <= 0) throw new HubError('issue_number phải là số nguyên dương');
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

    case 'update_issue': {
      checkRequiredStrings(args, ['owner', 'repo']);
      const num = Number(args.issue_number);
      if (!Number.isInteger(num) || num <= 0) throw new HubError('issue_number phải là số nguyên dương');

      const payload = {};
      if (args.title !== undefined) {
        if (typeof args.title !== 'string' || !args.title.trim()) {
          throw new HubError('title không được rỗng');
        }
        payload.title = args.title.trim();
      }
      if (args.body !== undefined) {
        if (typeof args.body !== 'string') throw new HubError('body phải là chuỗi');
        payload.body = args.body;
      }
      if (args.state !== undefined) {
        if (!['open', 'closed'].includes(args.state)) {
          throw new HubError("state phải là 'open' hoặc 'closed'");
        }
        payload.state = args.state;
      }
      if (args.assignees !== undefined) {
        if (!Array.isArray(args.assignees) || args.assignees.some(v => typeof v !== 'string' || !v.trim())) {
          throw new HubError('assignees phải là mảng tên người dùng hợp lệ');
        }
        payload.assignees = args.assignees.map(a => a.trim());
      }
      if (args.milestone !== undefined) {
        const ms = Number(args.milestone);
        if (!Number.isInteger(ms) || ms < 0) throw new HubError('milestone phải là số nguyên không âm');
        payload.milestone = ms;
      }

      const targetUrl = `${base}/repos/${owner}/${repo}/issues/${num}`;
      const res = await requestGitea(targetUrl, {
        method: 'PATCH',
        token,
        body: payload,
        request: doRequest
      });
      result = {
        number: res?.number ?? num,
        title: res?.title,
        body: res?.body,
        state: res?.state,
        user: res?.user ? { username: res.user.username || res.user.login } : undefined,
        assignees: (res?.assignees || []).map(u => ({ username: u.username || u.login })),
        milestone: res?.milestone ? { id: res.milestone.id, title: res.milestone.title } : null,
        labels: (res?.labels || []).map(l => (typeof l === 'object' ? l.name : l)),
        updated_at: res?.updated_at
      };
      break;
    }

    case 'add_issue_comment': {
      checkRequiredStrings(args, ['owner', 'repo', 'body']);
      const num = Number(args.issue_number);
      if (!Number.isInteger(num) || num <= 0) throw new HubError('issue_number phải là số nguyên dương');
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

    // --- Labels (Repo Level) ---
    case 'list_repo_labels': {
      checkRequiredStrings(args, ['owner', 'repo']);
      const targetUrl = `${base}/repos/${owner}/${repo}/labels`;
      result = await requestGitea(targetUrl, { method: 'GET', token, request: doRequest });
      break;
    }

    case 'get_repo_label': {
      checkRequiredStrings(args, ['owner', 'repo']);
      const id = Number(args.label_id);
      if (!Number.isInteger(id) || id <= 0) throw new HubError('label_id phải là số nguyên dương');
      const targetUrl = `${base}/repos/${owner}/${repo}/labels/${id}`;
      result = await requestGitea(targetUrl, { method: 'GET', token, request: doRequest });
      break;
    }

    case 'create_repo_label': {
      checkRequiredStrings(args, ['owner', 'repo', 'name', 'color']);
      const targetUrl = `${base}/repos/${owner}/${repo}/labels`;
      const payload = {
        name: args.name.trim(),
        color: args.color.trim(),
        ...(args.description ? { description: args.description.trim() } : {})
      };
      result = await requestGitea(targetUrl, {
        method: 'POST',
        token,
        body: payload,
        request: doRequest
      });
      break;
    }

    case 'update_repo_label': {
      checkRequiredStrings(args, ['owner', 'repo']);
      const id = Number(args.label_id);
      if (!Number.isInteger(id) || id <= 0) throw new HubError('label_id phải là số nguyên dương');
      const targetUrl = `${base}/repos/${owner}/${repo}/labels/${id}`;
      const payload = {
        ...(args.name ? { name: args.name.trim() } : {}),
        ...(args.color ? { color: args.color.trim() } : {}),
        ...(args.description !== undefined ? { description: args.description.trim() } : {})
      };
      result = await requestGitea(targetUrl, {
        method: 'PATCH',
        token,
        body: payload,
        request: doRequest
      });
      break;
    }

    case 'delete_repo_label': {
      checkRequiredStrings(args, ['owner', 'repo']);
      const id = Number(args.label_id);
      if (!Number.isInteger(id) || id <= 0) throw new HubError('label_id phải là số nguyên dương');
      const targetUrl = `${base}/repos/${owner}/${repo}/labels/${id}`;
      await requestGitea(targetUrl, { method: 'DELETE', token, request: doRequest });
      result = { ok: true, deleted: id };
      break;
    }

    // --- Milestones ---
    case 'list_milestones': {
      checkRequiredStrings(args, ['owner', 'repo']);
      const params = new URLSearchParams();
      if (args.state) params.set('state', args.state);
      if (args.page) params.set('page', String(args.page));
      if (args.limit) params.set('limit', String(args.limit));
      const q = params.toString() ? `?${params.toString()}` : '';
      const targetUrl = `${base}/repos/${owner}/${repo}/milestones${q}`;
      result = await requestGitea(targetUrl, { method: 'GET', token, request: doRequest });
      break;
    }

    case 'get_milestone': {
      checkRequiredStrings(args, ['owner', 'repo']);
      const id = Number(args.milestone_id);
      if (!Number.isInteger(id) || id <= 0) throw new HubError('milestone_id phải là số nguyên dương');
      const targetUrl = `${base}/repos/${owner}/${repo}/milestones/${id}`;
      result = await requestGitea(targetUrl, { method: 'GET', token, request: doRequest });
      break;
    }

    case 'create_milestone': {
      checkRequiredStrings(args, ['owner', 'repo', 'title']);
      const targetUrl = `${base}/repos/${owner}/${repo}/milestones`;
      const payload = {
        title: args.title.trim(),
        ...(args.description ? { description: args.description.trim() } : {}),
        ...(args.due_on ? { due_on: args.due_on.trim() } : {}),
        ...(args.state ? { state: args.state } : {})
      };
      result = await requestGitea(targetUrl, {
        method: 'POST',
        token,
        body: payload,
        request: doRequest
      });
      break;
    }

    case 'update_milestone': {
      checkRequiredStrings(args, ['owner', 'repo']);
      const id = Number(args.milestone_id);
      if (!Number.isInteger(id) || id <= 0) throw new HubError('milestone_id phải là số nguyên dương');
      const targetUrl = `${base}/repos/${owner}/${repo}/milestones/${id}`;
      const payload = {
        ...(args.title ? { title: args.title.trim() } : {}),
        ...(args.description !== undefined ? { description: args.description.trim() } : {}),
        ...(args.due_on ? { due_on: args.due_on.trim() } : {}),
        ...(args.state ? { state: args.state } : {})
      };
      result = await requestGitea(targetUrl, {
        method: 'PATCH',
        token,
        body: payload,
        request: doRequest
      });
      break;
    }

    case 'delete_milestone': {
      checkRequiredStrings(args, ['owner', 'repo']);
      const id = Number(args.milestone_id);
      if (!Number.isInteger(id) || id <= 0) throw new HubError('milestone_id phải là số nguyên dương');
      const targetUrl = `${base}/repos/${owner}/${repo}/milestones/${id}`;
      await requestGitea(targetUrl, { method: 'DELETE', token, request: doRequest });
      result = { ok: true, deleted: id };
      break;
    }

    // --- Releases ---
    case 'list_releases': {
      checkRequiredStrings(args, ['owner', 'repo']);
      const params = new URLSearchParams();
      if (args.page) params.set('page', String(args.page));
      if (args.limit) params.set('limit', String(args.limit));
      const q = params.toString() ? `?${params.toString()}` : '';
      const targetUrl = `${base}/repos/${owner}/${repo}/releases${q}`;
      result = await requestGitea(targetUrl, { method: 'GET', token, request: doRequest });
      break;
    }

    case 'get_release': {
      checkRequiredStrings(args, ['owner', 'repo']);
      const targetUrl = args.latest
        ? `${base}/repos/${owner}/${repo}/releases/latest`
        : `${base}/repos/${owner}/${repo}/releases/${enc(String(args.release_id || 'latest'))}`;
      result = await requestGitea(targetUrl, { method: 'GET', token, request: doRequest });
      break;
    }

    case 'create_release': {
      checkRequiredStrings(args, ['owner', 'repo', 'tag_name']);
      const targetUrl = `${base}/repos/${owner}/${repo}/releases`;
      const payload = {
        tag_name: args.tag_name.trim(),
        ...(args.name ? { name: args.name.trim() } : {}),
        ...(args.body ? { body: args.body.trim() } : {}),
        ...(args.draft !== undefined ? { draft: !!args.draft } : {}),
        ...(args.prerelease !== undefined ? { prerelease: !!args.prerelease } : {}),
        ...(args.target_commitish ? { target_commitish: args.target_commitish.trim() } : {})
      };
      result = await requestGitea(targetUrl, {
        method: 'POST',
        token,
        body: payload,
        request: doRequest
      });
      break;
    }

    case 'delete_release': {
      checkRequiredStrings(args, ['owner', 'repo']);
      const id = Number(args.release_id);
      if (!Number.isInteger(id) || id <= 0) throw new HubError('release_id phải là số nguyên dương');
      const targetUrl = `${base}/repos/${owner}/${repo}/releases/${id}`;
      await requestGitea(targetUrl, { method: 'DELETE', token, request: doRequest });
      result = { ok: true, deleted: id };
      break;
    }

    // --- Collaborators ---
    case 'list_collaborators': {
      checkRequiredStrings(args, ['owner', 'repo']);
      const targetUrl = `${base}/repos/${owner}/${repo}/collaborators`;
      result = await requestGitea(targetUrl, { method: 'GET', token, request: doRequest });
      break;
    }

    case 'check_collaborator': {
      checkRequiredStrings(args, ['owner', 'repo', 'collaborator']);
      const targetUrl = `${base}/repos/${owner}/${repo}/collaborators/${enc(args.collaborator.trim())}`;
      try {
        await requestGitea(targetUrl, { method: 'GET', token, request: doRequest });
        result = { is_collaborator: true, user: args.collaborator.trim() };
      } catch (err) {
        if (err.status === 404) {
          result = { is_collaborator: false, user: args.collaborator.trim() };
        } else {
          throw err;
        }
      }
      break;
    }

    case 'add_collaborator': {
      checkRequiredStrings(args, ['owner', 'repo', 'collaborator']);
      const targetUrl = `${base}/repos/${owner}/${repo}/collaborators/${enc(args.collaborator.trim())}`;
      const payload = {
        ...(args.permission ? { permission: args.permission } : {})
      };
      await requestGitea(targetUrl, {
        method: 'PUT',
        token,
        body: payload,
        request: doRequest
      });
      result = { ok: true, collaborator: args.collaborator.trim(), permission: args.permission || 'write' };
      break;
    }

    case 'remove_collaborator': {
      checkRequiredStrings(args, ['owner', 'repo', 'collaborator']);
      const targetUrl = `${base}/repos/${owner}/${repo}/collaborators/${enc(args.collaborator.trim())}`;
      await requestGitea(targetUrl, { method: 'DELETE', token, request: doRequest });
      result = { ok: true, removed: args.collaborator.trim() };
      break;
    }

    // --- Search ---
    case 'search_repositories': {
      const params = new URLSearchParams();
      if (args.q && typeof args.q === 'string' && args.q.trim()) {
        params.set('q', args.q.trim());
      }
      if (args.page) params.set('page', String(args.page));
      if (args.limit) params.set('limit', String(args.limit));
      if (args.topic && typeof args.topic === 'string' && args.topic.trim()) {
        params.set('topic', args.topic.trim());
      }
      const q = params.toString() ? `?${params.toString()}` : '';
      const targetUrl = `${base}/repos/search${q}`;
      result = await requestGitea(targetUrl, { method: 'GET', token, request: doRequest });
      break;
    }

    case 'search_issues': {
      checkRequiredStrings(args, ['q']);
      const params = new URLSearchParams({ q: args.q.trim() });
      if (args.state) params.set('state', args.state);
      if (args.owner) params.set('owner', args.owner.trim());
      if (args.page) params.set('page', String(args.page));
      if (args.limit) params.set('limit', String(args.limit));
      const targetUrl = `${base}/repos/issues/search?${params.toString()}`;
      result = await requestGitea(targetUrl, { method: 'GET', token, request: doRequest });
      break;
    }

    case 'search_users': {
      checkRequiredStrings(args, ['q']);
      const params = new URLSearchParams({ q: args.q.trim() });
      if (args.page) params.set('page', String(args.page));
      if (args.limit) params.set('limit', String(args.limit));
      const targetUrl = `${base}/users/search?${params.toString()}`;
      result = await requestGitea(targetUrl, { method: 'GET', token, request: doRequest });
      break;
    }

    // --- Organizations & Teams ---
    case 'list_user_orgs': {
      const params = new URLSearchParams();
      if (args.page) params.set('page', String(args.page));
      if (args.limit) params.set('limit', String(args.limit));
      const q = params.toString() ? `?${params.toString()}` : '';
      const targetUrl = `${base}/user/orgs${q}`;
      result = await requestGitea(targetUrl, { method: 'GET', token, request: doRequest });
      break;
    }

    case 'get_org': {
      checkRequiredStrings(args, ['org']);
      const targetUrl = `${base}/orgs/${enc(args.org.trim())}`;
      result = await requestGitea(targetUrl, { method: 'GET', token, request: doRequest });
      break;
    }

    case 'list_org_repos': {
      checkRequiredStrings(args, ['org']);
      const params = new URLSearchParams();
      if (args.page) params.set('page', String(args.page));
      if (args.limit) params.set('limit', String(args.limit));
      const q = params.toString() ? `?${params.toString()}` : '';
      const targetUrl = `${base}/orgs/${enc(args.org.trim())}/repos${q}`;
      result = await requestGitea(targetUrl, { method: 'GET', token, request: doRequest });
      break;
    }

    case 'list_org_teams': {
      checkRequiredStrings(args, ['org']);
      const params = new URLSearchParams();
      if (args.page) params.set('page', String(args.page));
      if (args.limit) params.set('limit', String(args.limit));
      const q = params.toString() ? `?${params.toString()}` : '';
      const targetUrl = `${base}/orgs/${enc(args.org.trim())}/teams${q}`;
      result = await requestGitea(targetUrl, { method: 'GET', token, request: doRequest });
      break;
    }

    case 'list_team_members': {
      const id = Number(args.team_id);
      if (!Number.isInteger(id) || id <= 0) throw new HubError('team_id phải là số nguyên dương');
      const params = new URLSearchParams();
      if (args.page) params.set('page', String(args.page));
      if (args.limit) params.set('limit', String(args.limit));
      const q = params.toString() ? `?${params.toString()}` : '';
      const targetUrl = `${base}/teams/${id}/members${q}`;
      result = await requestGitea(targetUrl, { method: 'GET', token, request: doRequest });
      break;
    }

    // --- Webhooks ---
    case 'list_repo_hooks': {
      checkRequiredStrings(args, ['owner', 'repo']);
      const targetUrl = `${base}/repos/${owner}/${repo}/hooks`;
      result = await requestGitea(targetUrl, { method: 'GET', token, request: doRequest });
      break;
    }

    case 'get_repo_hook': {
      checkRequiredStrings(args, ['owner', 'repo']);
      const id = Number(args.hook_id);
      if (!Number.isInteger(id) || id <= 0) throw new HubError('hook_id phải là số nguyên dương');
      const targetUrl = `${base}/repos/${owner}/${repo}/hooks/${id}`;
      result = await requestGitea(targetUrl, { method: 'GET', token, request: doRequest });
      break;
    }

    case 'create_repo_hook': {
      checkRequiredStrings(args, ['owner', 'repo', 'type', 'target_url']);
      const targetUrl = `${base}/repos/${owner}/${repo}/hooks`;
      const payload = {
        type: args.type,
        config: {
          url: args.target_url.trim(),
          content_type: 'json',
          ...(args.secret ? { secret: args.secret } : {})
        },
        events: Array.isArray(args.events) && args.events.length ? args.events : ['push'],
        active: args.active !== undefined ? !!args.active : true
      };
      result = await requestGitea(targetUrl, {
        method: 'POST',
        token,
        body: payload,
        request: doRequest
      });
      break;
    }

    case 'delete_repo_hook': {
      checkRequiredStrings(args, ['owner', 'repo']);
      const id = Number(args.hook_id);
      if (!Number.isInteger(id) || id <= 0) throw new HubError('hook_id phải là số nguyên dương');
      const targetUrl = `${base}/repos/${owner}/${repo}/hooks/${id}`;
      await requestGitea(targetUrl, { method: 'DELETE', token, request: doRequest });
      result = { ok: true, deleted: id };
      break;
    }
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
    isError: false
  };
}
