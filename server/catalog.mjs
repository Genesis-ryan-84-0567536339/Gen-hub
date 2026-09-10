const s = description => ({ type: 'string', description });
const n = (description, maximum = 100) => ({ type: 'integer', description, minimum: 1, maximum });
const tool = (name, description, props = {}, required = [], write = false, scopes = []) => ({
  name,
  description,
  inputSchema: { type: 'object', properties: props, required, additionalProperties: false },
  annotations: { readOnlyHint: !write, destructiveHint: write, openWorldHint: true },
  published: !write,
  scopes
});
export const catalog = [
  {
    id: 'github',
    name: 'GitHub',
    description: 'Kho mã nguồn, issue và pull request.',
    category: 'Phát triển',
    auth: 'OAuth / token',
    guide: 'https://github.com/settings/developers',
    tokenGuide: 'https://github.com/settings/tokens',
    oauth: {
      authorize: 'https://github.com/login/oauth/authorize',
      token: 'https://github.com/login/oauth/access_token',
      scope: 'repo read:user'
    },
    tools: [
      tool(
        'search_repositories',
        'Tìm kho mã nguồn',
        { query: s('Từ khóa'), per_page: n('Số kết quả') },
        ['query'],
        false,
        []
      ),
      tool(
        'get_file_contents',
        'Đọc nội dung tệp',
        {
          owner: s('Chủ repo'),
          repo: s('Tên repo'),
          path: s('Đường dẫn'),
          ref: s('Branch hoặc commit')
        },
        ['owner', 'repo', 'path'],
        false,
        ['repo', 'public_repo']
      ),
      tool(
        'list_issues',
        'Danh sách issue',
        { owner: s('Chủ repo'), repo: s('Repo'), state: s('open, closed hoặc all') },
        ['owner', 'repo'],
        false,
        ['repo', 'public_repo']
      ),
      tool(
        'create_issue',
        'Tạo issue',
        { owner: s('Chủ repo'), repo: s('Repo'), title: s('Tiêu đề'), body: s('Nội dung') },
        ['owner', 'repo', 'title'],
        true,
        ['repo', 'public_repo']
      ),
      tool(
        'create_pull_request',
        'Tạo pull request',
        {
          owner: s('Chủ repo'),
          repo: s('Repo'),
          title: s('Tiêu đề'),
          head: s('Branch nguồn'),
          base: s('Branch đích'),
          body: s('Mô tả')
        },
        ['owner', 'repo', 'title', 'head', 'base'],
        true,
        ['repo', 'public_repo']
      )
    ]
  },
  {
    id: 'github-mcp',
    name: 'GitHub MCP (pilot)',
    description:
      'MCP chính thức của GitHub, chạy song song với GitHub REST. Owner công bố từng tool.',
    category: 'Phát triển',
    auth: 'PAT',
    guide: 'https://github.com/github/github-mcp-server',
    tokenGuide: 'https://github.com/settings/personal-access-tokens/new',
    tools: []
  },
  {
    id: 'drive',
    name: 'Google Drive',
    description: 'Tìm, đọc và tạo tài liệu trên Drive.',
    category: 'Tài liệu',
    auth: 'OAuth',
    guide: 'https://console.cloud.google.com/apis/credentials',
    oauth: {
      authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
      token: 'https://oauth2.googleapis.com/token',
      scope: 'https://www.googleapis.com/auth/drive'
    },
    tools: [
      tool(
        'list_files',
        'Liệt kê hoặc tìm tệp',
        {
          query: s('Truy vấn Drive q'),
          page_size: n('Số kết quả'),
          page_token: s('Trang tiếp theo')
        },
        [],
        false,
        [
          'https://www.googleapis.com/auth/drive',
          'https://www.googleapis.com/auth/drive.readonly',
          'https://www.googleapis.com/auth/drive.file'
        ]
      ),
      tool('get_file', 'Đọc metadata của tệp', { file_id: s('ID tệp') }, ['file_id'], false, [
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/drive.readonly',
        'https://www.googleapis.com/auth/drive.file'
      ]),
      tool('read_file', 'Đọc nội dung tệp văn bản', { file_id: s('ID tệp') }, ['file_id'], false, [
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/drive.readonly',
        'https://www.googleapis.com/auth/drive.file'
      ]),
      tool(
        'export_file',
        'Xuất Google Docs thành văn bản',
        { file_id: s('ID tệp'), mime_type: s('text/plain hoặc text/csv') },
        ['file_id'],
        false,
        [
          'https://www.googleapis.com/auth/drive',
          'https://www.googleapis.com/auth/drive.readonly',
          'https://www.googleapis.com/auth/drive.file'
        ]
      ),
      tool(
        'create_file',
        'Tạo tệp văn bản',
        { name: s('Tên tệp'), content: s('Nội dung'), parent_id: s('ID thư mục') },
        ['name', 'content'],
        true,
        ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/drive.file']
      )
    ]
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Đọc kênh và gửi tin nhắn công việc.',
    category: 'Giao tiếp',
    auth: 'OAuth / bot token',
    guide: 'https://api.slack.com/apps',
    oauth: {
      authorize: 'https://slack.com/oauth/v2/authorize',
      token: 'https://slack.com/api/oauth.v2.access',
      scope: 'channels:read,channels:history,chat:write'
    },
    tools: [
      tool(
        'list_channels',
        'Liệt kê kênh',
        { cursor: s('Trang tiếp theo'), limit: n('Số kênh') },
        [],
        false,
        ['channels:read', 'groups:read']
      ),
      tool(
        'read_history',
        'Đọc lịch sử kênh',
        { channel: s('ID kênh'), cursor: s('Trang tiếp theo'), limit: n('Số tin') },
        ['channel'],
        false,
        ['channels:history', 'groups:history']
      ),
      tool(
        'post_message',
        'Gửi tin nhắn',
        { channel: s('ID kênh'), text: s('Tin nhắn'), thread_ts: s('Thread tùy chọn') },
        ['channel', 'text'],
        true,
        ['chat:write', 'chat:write:bot', 'chat:write:user']
      )
    ]
  },
  {
    id: 'telegram',
    name: 'Telegram',
    description: 'Kết nối bot Telegram và trao đổi tin nhắn.',
    category: 'Giao tiếp',
    auth: 'Bot token',
    guide: 'https://core.telegram.org/bots/features#botfather',
    tools: [
      tool('get_me', 'Thông tin bot'),
      tool(
        'get_updates',
        'Đọc sự kiện bot (khi không dùng webhook)',
        { offset: { type: 'integer', description: 'Update ID bắt đầu' }, limit: n('Số sự kiện') },
        []
      ),
      tool(
        'send_message',
        'Gửi tin nhắn',
        { chat_id: s('ID cuộc trò chuyện'), text: s('Nội dung') },
        ['chat_id', 'text'],
        true
      )
    ]
  },
  {
    id: 'discord',
    name: 'Discord',
    description: 'Kết nối bot vào máy chủ Discord.',
    category: 'Giao tiếp',
    auth: 'Bot token',
    guide: 'https://discord.com/developers/applications',
    tools: [
      tool('get_me', 'Thông tin bot'),
      tool('list_guilds', 'Liệt kê máy chủ bot tham gia'),
      tool(
        'get_channel_messages',
        'Đọc tin nhắn trong kênh',
        { channel_id: s('ID kênh'), limit: n('Số tin') },
        ['channel_id']
      ),
      tool(
        'create_message',
        'Gửi tin nhắn vào kênh',
        { channel_id: s('ID kênh'), content: s('Nội dung') },
        ['channel_id', 'content'],
        true
      )
    ]
  },
  {
    id: 'figma',
    name: 'Figma',
    description: 'Đọc bản thiết kế và quản lý bình luận.',
    category: 'Thiết kế',
    auth: 'Personal access token',
    guide: 'https://developers.figma.com/docs/rest-api/personal-access-tokens/',
    tools: [
      tool('get_me', 'Thông tin tài khoản'),
      tool('get_file', 'Đọc cấu trúc thiết kế', { file_key: s('File key') }, ['file_key']),
      tool('get_comments', 'Đọc bình luận', { file_key: s('File key') }, ['file_key']),
      tool(
        'post_comment',
        'Thêm bình luận',
        { file_key: s('File key'), message: s('Nội dung') },
        ['file_key', 'message'],
        true
      )
    ]
  }
];
export const provider = id => catalog.find(c => c.id === id);
