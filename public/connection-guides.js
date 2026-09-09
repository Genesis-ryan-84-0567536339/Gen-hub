const guides = {
  github: {
    title: 'GitHub',
    recommendation: 'Dùng Personal Access Token để bắt đầu nhanh.',
    links: [
      ['Tạo fine-grained token', 'https://github.com/settings/personal-access-tokens/new'],
      ['Tạo OAuth App', 'https://github.com/settings/applications/new']
    ],
    steps: [
      'Chọn chủ sở hữu, repo cần dùng và ngày hết hạn.',
      'Cấp Contents: Read và Issues: Read; chỉ thêm Issues hoặc Pull requests: Write nếu cần tạo issue/PR.',
      'Tạo token, sao chép và dán vào ô Access token bên dưới. Tổ chức có thể cần duyệt token.'
    ],
    note: 'OAuth là lựa chọn khác nếu bạn đã có OAuth App; callback phải đúng domain của Hub.'
  },
  slack: {
    title: 'Slack',
    recommendation: 'Dùng Bot User OAuth Token cho workspace của bạn.',
    links: [
      ['Tạo / mở Slack App', 'https://api.slack.com/apps'],
      ['Hướng dẫn token', 'https://docs.slack.dev/authentication/tokens/']
    ],
    steps: [
      'Tạo app → OAuth & Permissions → Bot Token Scopes.',
      'Thêm channels:read, channels:history, chat:write rồi Install to Workspace.',
      'Sao chép Bot User OAuth Token (xoxb-…), dán bên dưới và mời bot vào kênh cần dùng.'
    ],
    note: 'Không dùng App-Level Token (xapp-). Với nhiều workspace, có thể cấu hình OAuth App bên dưới.'
  },
  drive: {
    title: 'Google Drive',
    recommendation: 'Dùng OAuth; connector Drive không nhận token dán thủ công.',
    links: [
      [
        'Bật Google Drive API',
        'https://console.cloud.google.com/apis/library/drive.googleapis.com'
      ],
      ['Tạo OAuth client', 'https://console.cloud.google.com/apis/credentials']
    ],
    steps: [
      'Chọn project và bật Google Drive API.',
      'Cấu hình màn hình đồng ý OAuth; thêm tài khoản vào Test users nếu app đang Testing.',
      'Tạo OAuth client loại Web application, thêm Redirect URI của Hub bên dưới; dán Client ID/secret rồi bấm đăng nhập.'
    ],
    note: 'Google có thể yêu cầu xác minh ứng dụng khi xuất bản cho người dùng khác.'
  },
  telegram: {
    title: 'Telegram',
    recommendation: 'Dùng bot token từ BotFather.',
    links: [
      ['Mở BotFather', 'https://t.me/BotFather'],
      ['Hướng dẫn tạo bot', 'https://core.telegram.org/bots/features#botfather']
    ],
    steps: [
      'Mở BotFather chính thức, gửi /newbot và đặt tên bot.',
      'Sao chép bot token vào ô bên dưới.',
      'Nhắn /start cho bot hoặc thêm bot vào nhóm cần sử dụng.'
    ],
    note: 'get_updates không dùng đồng thời với webhook của bot.'
  },
  discord: {
    title: 'Discord',
    recommendation: 'Dùng Bot Token của ứng dụng Discord.',
    links: [['Mở Developer Portal', 'https://discord.com/developers/applications']],
    steps: [
      'Tạo application → Bot → tạo hoặc reset token rồi sao chép.',
      'Cài bot vào server với quyền View Channels, Read Message History và Send Messages theo nhu cầu.',
      'Dán Bot Token bên dưới; bật Message Content Intent nếu cần đọc nội dung tin nhắn thuộc trường hợp Discord yêu cầu.'
    ],
    note: 'Dùng token bot, không dùng token tài khoản cá nhân.'
  },
  figma: {
    title: 'Figma',
    recommendation: 'Dùng Personal Access Token.',
    links: [
      ['Mở Figma', 'https://www.figma.com/files'],
      ['Hướng dẫn tạo token', 'https://developers.figma.com/docs/rest-api/personal-access-tokens/']
    ],
    steps: [
      'Trong Figma: menu tài khoản → Settings → Security → Personal access tokens.',
      'Generate new token; đặt hạn dùng và scopes: current_user:read, file_content:read, file_comments:read; thêm file_comments:write nếu cần bình luận.',
      'Sao chép token và dán bên dưới.'
    ],
    note: 'Token chỉ truy cập được những file tài khoản của bạn được phép dùng.'
  }
};

export function connectionGuide(provider, endpoint = '') {
  if (provider !== 'remote') return guides[provider] || null;
  let host;
  try {
    host = new URL(endpoint).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return null;
  }
  const matches = domain => host === domain || host.endsWith('.' + domain);
  if (matches('notion.so') || matches('notion.com'))
    return {
      title: 'Notion MCP',
      recommendation: 'Notion MCP chính thức dùng OAuth.',
      links: [
        ['Hướng dẫn Notion MCP', 'https://developers.notion.com/guides/mcp/get-started-with-mcp']
      ],
      steps: [
        'Kiểm tra endpoint chính thức: https://mcp.notion.com/mcp.',
        'Gen-hub hiện chưa hỗ trợ OAuth cho MCP HTTP tùy chỉnh; không dán Notion API token để thay bước OAuth.'
      ],
      note: 'Đây là giới hạn kết nối hiện tại, không phải lỗi token của bạn.'
    };
  const key =
    matches('github.com') || matches('githubcopilot.com')
      ? 'github'
      : matches('slack.com')
        ? 'slack'
        : matches('google.com') || matches('googleapis.com')
          ? 'drive'
          : matches('figma.com')
            ? 'figma'
            : matches('discord.com')
              ? 'discord'
              : matches('telegram.org')
                ? 'telegram'
                : null;
  if (!key) return null;
  if (key === 'github')
    return {
      ...guides.github,
      note: 'Kiểm tra MCP server chấp nhận PAT trước khi dán. Token được gửi tới đúng endpoint bạn nhập.'
    };
  return {
    title: guides[key].title + ' · MCP tùy chỉnh',
    recommendation: 'Cách xác thực MCP phụ thuộc endpoint; token API không luôn thay được OAuth.',
    links: guides[key].links,
    steps: [
      'Nếu muốn dùng bộ công cụ có sẵn, chọn connector ' +
        guides[key].title +
        ' trong danh mục để xem từng bước.',
      'Với MCP tùy chỉnh, làm theo tài liệu của chính endpoint. Gen-hub hiện nhận Bearer token hoặc không xác thực, chưa hỗ trợ remote OAuth.'
    ],
    note: 'Chỉ dán credential khi endpoint đó hỗ trợ đúng loại token.'
  };
}
