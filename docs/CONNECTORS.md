# Kết nối dịch vụ

Mỗi bản cài dùng tài khoản và ứng dụng OAuth do owner sở hữu. Gen-hub không cung cấp OAuth client dùng chung trung tâm.

| Dịch vụ | Cách kết nối | Tool có sẵn |
|---|---|---|
| Google Drive | OAuth web app, bật Drive API; scope Drive; đăng ký callback | list_files, get_file (metadata), read_file (tệp văn bản), export_file (Docs/CSV), create_file (văn bản) |
| GitHub | OAuth app hoặc PAT có quyền repo phù hợp | search_repositories, get_file_contents, list_issues, create_issue, create_pull_request |
| GitHub MCP (pilot) | PAT qua Bearer tới endpoint https://api.githubcopilot.com/mcp/ | Đồng bộ từ upstream MCP; issue_write được bọc an toàn thành github_issue_create, github_issue_close, github_issue_label; tích hợp github_check_status đọc trạng thái CI/GitHub Actions qua REST; tool mới chờ owner bật |
| Gitea MCP (pilot) | PAT token gọi REST API Gitea tự host (mặc định http://gitea:3000/api/v1) | 59 tool MCP: tệp, repo/commit/topics, nhánh/tag, pull requests/reviews, issues/comments, nhãn (labels), milestones, releases, collaborators, tìm kiếm (search), organizations/teams, webhooks; tool mới chờ owner bật |
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

## Connector Gitea MCP (pilot) (#23)

Connector `gitea-mcp` tích hợp phiên bản Gitea tự host (self-hosted) với mô hình quản trị công cụ và bảo mật tương tự GitHub MCP:
- **Kiến trúc mạng & REST API**: Gitea chạy trong mạng Docker nội bộ (mặc định: `http://gitea:3000/api/v1`) hoặc URL tự cấu hình bởi owner qua giao diện cài đặt credential. URL mặc định nội bộ do Hub quản lý được tự động kích hoạt truy cập mạng riêng (`allowPrivate: true`). Đối với URL tùy chỉnh trỏ tới mạng riêng/nội bộ khác, Hub mặc định chặn mạng riêng để ngăn chặn SSRF trừ khi owner chủ động bật cờ `allowPrivate`.
- **Xác thực**: Sử dụng Personal Access Token (PAT) với header `Authorization: token <PAT>` hoặc `Authorization: Bearer <PAT>`. Token được mã hóa trên Hub và không bao giờ rò rỉ vào audit log.
- **Danh mục 59 tool MCP chuẩn hóa**:
  - *Quản lý tệp*: `get_file_contents` (tự giải mã base64 sang text UTF-8), `create_or_update_file` (tự động phát hiện SHA khi cập nhật hoặc tạo mới), `push_files` (batch commit nhiều tệp đồng thời).
  - *Kho mã nguồn & Commits*: `get_repository`, `create_repository`, `fork_repository`, `list_commits`, `get_commit`, `list_repo_topics`, `set_repo_topics`.
  - *Quản lý nhánh & Tag*: `list_branches` (liệt kê branch, commit id, trạng thái bảo vệ), `create_branch`, `list_tags`, `create_tag`, `delete_tag`.
  - *Pull Requests & Reviews*: `list_pull_requests`, `create_pull_request`, `pull_request_read`, `merge_pull_request` (merge, squash, rebase), `list_pr_commits`, `list_pr_reviews`, `create_pr_review`.
  - *Issues*: `list_issues`, `issue_read`, `update_issue` (cập nhật tiêu đề, nội dung, trạng thái open/closed, assignees, milestone), `add_issue_comment`, `gitea_issue_create`, `gitea_issue_close`, `gitea_issue_label` (thay thế nhãn, `[]` để xóa).
  - *Nhãn repo (Labels)*: `list_repo_labels`, `get_repo_label`, `create_repo_label`, `update_repo_label`, `delete_repo_label`.
  - *Milestones*: `list_milestones`, `get_milestone`, `create_milestone`, `update_milestone`, `delete_milestone`.
  - *Releases*: `list_releases`, `get_release`, `create_release`, `delete_release`.
  - *Collaborators*: `list_collaborators`, `check_collaborator`, `add_collaborator`, `remove_collaborator`.
  - *Tìm kiếm*: `search_repositories`, `search_issues`, `search_users`.
  - *Organizations & Teams*: `list_user_orgs`, `get_org`, `list_org_repos`, `list_org_teams`, `list_team_members`.
  - *Webhooks*: `list_repo_hooks`, `get_repo_hook`, `create_repo_hook`, `delete_repo_hook`.
- **Chính sách an toàn & phân quyền**:
  - Mọi tool mới đồng bộ đều ở trạng thái chờ owner kích hoạt (`published: false`).
  - Phân quyền mặc định là `Khả dụng` (`checkToolPermissions` trả về `ok`), tương thích hoàn toàn với mô hình cấp quyền per-agent của Gen-hub.
  - Toàn bộ lượt gọi tool được ghi vết đầy đủ vào `store.audit()` với dữ liệu nhạy cảm được che giấu (`redact()`).

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
