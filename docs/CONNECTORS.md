# Kết nối dịch vụ

Mỗi bản cài dùng tài khoản và ứng dụng OAuth do owner sở hữu. Gen-hub không cung cấp OAuth client dùng chung trung tâm.

| Dịch vụ | Cách kết nối | Tool có sẵn |
|---|---|---|
| Google Drive | OAuth web app, bật Drive API; scope Drive; đăng ký callback | list_files, get_file (metadata), read_file (tệp văn bản), export_file (Docs/CSV), create_file (văn bản) |
| GitHub | OAuth app hoặc PAT có quyền repo phù hợp | search_repositories, get_file_contents, list_issues, create_issue, create_pull_request |
| Slack | OAuth app hoặc bot token; channels:read, channels:history, chat:write; bot tham gia kênh | list_channels, read_history, post_message |
| Telegram | BotFather bot token | get_me, get_updates, send_message |
| Discord | Bot token, mời bot vào guild, quyền view/read/send kênh | get_me, list_guilds, get_channel_messages, create_message |
| Figma | Personal access token; file_content:read, file_comments:read/write theo tool | get_me, get_file, get_comments, post_comment |
| MCP tùy chỉnh | HTTP(S) Streamable HTTP, bearer hoặc không auth | Đồng bộ tools/list và chuyển tiếp tools/call |

Callback OAuth dịch vụ: `https://<domain>/oauth/callback`. Cấu hình đúng URI ở provider trước khi đăng nhập. Google app Testing cần thêm test user và chịu thời hạn token theo chính sách Google; app dùng rộng cần quy trình xuất bản/xác minh của Google.

Telegram get_updates không dùng cùng webhook. Chỉ cập nhật offset khi muốn xác nhận các update đã đọc. Discord bot có thể cần Message Content intent và quyền server tùy dữ liệu. Figma API có giới hạn theo plan/seat của tài khoản.

MCP tùy chỉnh: checkbox cho phép mạng riêng là quyết định của owner về việc truy cập localhost/LAN trên máy cài Hub. Mặc định chặn mạng riêng và các endpoint metadata. Không tự theo HTTP redirect để tránh gửi credential sang host khác. Phản hồi tối đa 4 MiB, timeout 30 giây; không tự retry write để tránh tác dụng phụ lặp.

## Nguồn chuẩn dùng khi triển khai

- MCP transport: https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
- MCP authorization: https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization
- Google OAuth: https://developers.google.com/identity/protocols/oauth2/web-server
- Drive API: https://developers.google.com/workspace/drive/api/reference/rest/v3
- GitHub REST: https://docs.github.com/rest
- Slack: https://docs.slack.dev/apis/web-api/
- Telegram: https://core.telegram.org/bots/api
- Discord: https://docs.discord.com/developers/resources/message
- Figma: https://developers.figma.com/docs/rest-api/
