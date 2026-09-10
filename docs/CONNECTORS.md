# Kết nối dịch vụ

Mỗi bản cài dùng tài khoản và ứng dụng OAuth do owner sở hữu. Gen-hub không cung cấp OAuth client dùng chung trung tâm.

| Dịch vụ | Cách kết nối | Tool có sẵn |
|---|---|---|
| Google Drive | OAuth web app, bật Drive API; scope Drive; đăng ký callback | list_files, get_file (metadata), read_file (tệp văn bản), export_file (Docs/CSV), create_file (văn bản) |
| GitHub | OAuth app hoặc PAT có quyền repo phù hợp | search_repositories, get_file_contents, list_issues, create_issue, create_pull_request |
| GitHub MCP (pilot) | PAT qua Bearer tới endpoint https://api.githubcopilot.com/mcp/ | Đồng bộ từ upstream MCP; issue_write được bọc an toàn thành github_issue_create, github_issue_close, github_issue_label; tích hợp github_check_status đọc trạng thái CI/GitHub Actions qua REST; tool mới chờ owner bật |
| Slack | OAuth app hoặc bot token; channels:read, channels:history, chat:write; bot tham gia kênh | list_channels, read_history, post_message |
| Telegram | BotFather bot token | get_me, get_updates, send_message |
| Discord | Bot token, mời bot vào guild, quyền view/read/send kênh | get_me, list_guilds, get_channel_messages, create_message |
| Figma | Personal access token; file_content:read, file_comments:read/write theo tool | get_me, get_file, get_comments, post_comment |
| MCP tùy chỉnh | HTTP(S) Streamable HTTP, bearer hoặc không auth | Đồng bộ tools/list và chuyển tiếp tools/call |

Callback OAuth dịch vụ: `https://<domain>/oauth/callback`. Cấu hình đúng URI ở provider trước khi đăng nhập. Google app Testing cần thêm test user và chịu thời hạn token theo chính sách Google; app dùng rộng cần quy trình xuất bản/xác minh của Google.

Telegram get_updates không dùng cùng webhook. Chỉ cập nhật offset khi muốn xác nhận các update đã đọc. Discord bot có thể cần Message Content intent và quyền server tùy dữ liệu. Figma API có giới hạn theo plan/seat của tài khoản.

MCP tùy chỉnh: checkbox cho phép mạng riêng là quyết định của owner về việc truy cập localhost/LAN trên máy cài Hub. Mặc định chặn mạng riêng và các endpoint metadata. Không tự theo HTTP redirect để tránh gửi credential sang host khác. Phản hồi tối đa 4 MiB, timeout 30 giây; không tự retry write để tránh tác dụng phụ lặp.

## Tool đọc trạng thái CI `github_check_status` (GitHub MCP)

Connector `github-mcp` bổ sung tool đọc trạng thái CI / GitHub Actions trực tiếp qua REST API công khai của GitHub:
- **API sử dụng**: `GET https://api.github.com/repos/{owner}/{repo}/commits/{ref}/check-runs` dùng đúng Bearer PAT token của connector đang cấu hình.
- **Tham số đầu vào**: `owner` (chủ sở hữu repo), `repo` (tên repository), `ref` (commit SHA hoặc tên branch). Tất cả đều là chuỗi bắt buộc, không được để trống.
- **Dữ liệu trả về**: Rút gọn về mảng các đối tượng `{ name, status, conclusion }` cho từng check-run, loại bỏ toàn bộ dữ liệu thừa (URL, log, chi tiết metadata) nhằm giảm thiểu kích thước phản hồi và tránh rò rỉ thông tin không cần thiết vào audit log.
- **Đặc tính**: Tool chỉ đọc (`readOnlyHint: true`, `destructiveHint: false`), độc lập với công cụ ghi `issue_write`, và mặc định nhận trạng thái quyền `Khả dụng` tương tự các tool GitHub MCP khác.

## Kiểm tra quyền theo tool và đồng bộ không giới hạn (#32)

- **Quét đủ tool**: Gen-hub đồng bộ danh sách tool MCP với phân trang đầy đủ (tối đa 500 trang / 10.000 tool thay vì cắt ngắn tùy tiện), đảm bảo lấy trọn vẹn danh mục từ upstream MCP server.
- **Chủ động kiểm tra quyền token**: Khi đồng bộ (`connector_sync`), Gen-hub kiểm tra token với provider để đối chiếu quyền cần thiết cho từng tool:
  - `GitHub`: Đọc header `X-OAuth-Scopes` từ GitHub API. Nếu token thiếu scope (ví dụ chỉ có `read:user` mà thiếu `repo`), đánh dấu tool thiếu quyền cụ thể ("Thiếu quyền: cần scope repo"). Nếu dùng fine-grained PAT không trả header scope, đánh dấu trạng thái "không xác định được".
  - `GitHub MCP (pilot)`: Endpoint MCP chính thức (`https://api.githubcopilot.com/mcp/`) lọc động danh mục tool theo token và không trả header `X-OAuth-Scopes`. Các tool lấy về thành công qua phiên MCP hợp lệ (bao gồm tool wrapper và `github_check_status`) được đánh dấu `Khả dụng`. Trường hợp token có khai báo scope hoặc header `X-OAuth-Scopes`, Hub đối chiếu scope tương ứng.
  - `Google Drive`: Đối chiếu scope OAuth/token đã cấp (`drive` vs `drive.readonly`). Đánh dấu rõ các tool ghi văn bản khi token chỉ có quyền đọc.
  - `Slack`: Thăm dò scope qua `auth.test` và header `X-OAuth-Scopes`; báo rõ nếu thiếu các scope như `channels:read`, `channels:history`, hoặc `chat:write`.
  - `Telegram`: Đánh dấu khả dụng khi bot token hợp lệ qua `getMe`.
  - `Discord / Figma / Remote MCP`: Đánh dấu trạng thái "không xác định được" nếu nhà cung cấp không hỗ trợ introspect scope qua header token.
- **Trạng thái hiển thị trên giao diện**: Mỗi tool trên trang chi tiết connector và form cấp quyền agent hiển thị 1 trong 3 trạng thái:
  - `Khả dụng` (badge xanh)
  - `Thiếu quyền: cần scope X` (badge cam / cảnh báo)
  - `Không xác định` (badge xám)
- **Phân biệt lỗi rõ ràng**: Khi gọi tool bị từ chối quyền hoặc thiếu scope (HTTP 403 hoặc lỗi `missing_scope`), Hub trả HTTP 403 và thông báo rõ quyền bị thiếu thay vì báo lỗi chung.

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
