# Kiến trúc bản Linux

## Các thành phần Backend (`server/`)

- `server/app.mjs`: HTTP router chính, API quản trị web, middleware bảo mật (CSRF, session, rate-limit, destructive PIN), dispatcher MCP `/mcp` và endpoint trích xuất nhật ký `/api/logs/export`.
- `server/auth.mjs`: Quản lý phiên đăng nhập owner và OAuth 2.0 Authorization Server (RFC 6749 / RFC 7636 PKCE) cho agent. Agent tokens lưu hash một chiều, bound tài nguyên `/mcp`; không dùng credential upstream làm token agent.
- `server/owner-oidc.mjs`: OpenID Connect (OIDC) Identity Provider tối giản phục vụ SSO cho owner vào Gitea (metadata discovery, JWKS RS256 2048-bit, authorization code flow, token exchange, userinfo, RP-Initiated logout).
- `server/store.mjs`: SQLite store quản lý cấu hình, entities, credentials mã hóa (`store.seal()`) và nhật ký audit (`store.audit()`). Hỗ trợ ID 5 chữ số chuẩn hóa (`type-NNNNN`), chỉ mục đa chiều (`idx_audit_created`, `idx_audit_actor`, v.v.), chuẩn hóa settings mặc định và scrypt password hashing.
- `server/catalog.mjs`: Định nghĩa schema tool và chính sách công bố mặc định cho 8 nhà cung cấp tích hợp (Google Drive, GitHub REST, GitHub MCP, Gitea MCP, Slack, Telegram, Discord, Figma) cùng MCP tùy chỉnh Streamable HTTP.
- `server/connectors.mjs`: Quản lý kết nối nhà cung cấp, refresh token OAuth, phiên Remote HTTP MCP (SSE), thăm dò quyền token (scopes) và đồng bộ tool không giới hạn.
- `server/github-mcp.mjs`: Connector tích hợp GitHub MCP Copilot endpoint, bọc công cụ ghi issue an toàn (`github_issue_create`, `github_issue_close`, `github_issue_label`) và bổ sung tool đọc CI Actions `github_check_status`.
- `server/gitea-mcp.mjs`: Connector tích hợp Gitea REST API tự host với 59 tool MCP chuẩn hóa và cơ chế bảo vệ SSRF (`allowPrivate`).
- `server/kanban.mjs`: Dịch vụ bảng Kanban đa nguồn (GitHub REST, GitHub MCP, Gitea multi-repo), chuẩn hóa trạng thái cột/nhãn, lọc bỏ PR, và hỗ trợ lưu trữ (archive) thủ công hoặc tự động sau 24h.
- `server/export-audit.mjs`: Trích xuất nhật ký audit dạng JSONL (kèm payload) hoặc CSV (7 cột metadata) với phân trang cursor server-side, chống formula injection (`=`, `+`, `-`, `@`, tab, CR) và manifest đối chiếu dữ liệu.
- `server/admin-assistant.mjs`: Dispatcher MCP quản trị `/mcp/admin` dành riêng cho agent có cờ `isAdmin: true` với ranh giới an toàn, bảo vệ mật khẩu step-up và PIN thao tác phá hủy.
- `server/vault.mjs`: Quản lý kho bí mật per-agent grant `vault:<id>`, mã hóa bảo vệ bằng master key, trường ghi chú (`notes`), và kiểm soát chia sẻ snapshot.
- `server/migrate-ids.mjs`: Tiện ích CLI chuyển đổi nguyên tử các ID cũ sang chuẩn 5 chữ số `type-NNNNN` mà không làm đứt gãy token hay quan hệ dữ liệu.
- `server/llm.mjs` & `server/chat-validator.mjs`: Tích hợp mô hình ngôn ngữ (BYOC LLM) và kiểm định giao thức cho trợ lý hỗ trợ trực tiếp trên console.
- `server/net.mjs`: Lớp mạng outbound giới hạn thời gian/kích thước, DNS pinning, chặn mạng riêng/metadata mặc định, không theo redirect HTTP.

## Giao diện Frontend (`public/`)

- `public/app.js`: Ứng dụng Single Page Application (SPA) viết bằng vanilla JS/CSS, không phụ thuộc framework hay build step nặng; tải dữ liệu qua REST API có xác thực CSRF.
- `public/audit-stats.js`: Tính toán thống kê lượt gọi công cụ và dung lượng JSON trong cửa sổ 12h, sinh hình cung SVG (`pieArc`) cho 4 biểu đồ tròn trên Tổng quan (MCP lượt gọi, Tool lượt gọi, MCP dung lượng, Agent lượt gọi).
- `public/kanban.js`: Hiển thị bảng Kanban kéo-thả/chuyển cột và quản lý lưu trữ issue.
- `public/settings.js`: Quản lý cấu hình retention (7/30/90 ngày) và chuẩn hóa thông số hệ thống.
- Khung chat trợ lý (`chat-dock`): Thanh trượt bên phải (resizable right-hand rail) cố định, cho phép điều chỉnh kích thước hoặc thu gọn, hỗ trợ hướng dẫn trực quan (visual guidance).

## Vận hành & Hạ tầng (`scripts/`, `deploy/`)

- `scripts/install.py`: Bộ cài TUI Linux, hỗ trợ tiếp tục cài đặt (resumable), tích hợp Cloudflare Tunnel, Caddy reverse proxy, tự động cài Docker Engine và bootstrap owner/Gitea.
- `scripts/runtime.py`: Tự động sinh Compose JSON, Caddyfile, quản lý named volumes và snapshot sao lưu.
- `scripts/docker_setup.py`: Cài đặt Docker Engine chính thức từ repository package manager của OS nếu thiếu.
- `Dockerfile` / `deploy/images.json`: Dockerfile tối thiểu và bảng digest chuẩn cho các container runtime (Hub, Caddy, cloudflared, Gitea).
- `scripts/lifecycle.py`: Tự động cập nhật theo CI SHA trên `main`, systemd timer `gen-hub-update.timer`, doctor repair và quy trình gỡ bỏ cài đặt an toàn.
- `scripts/manage.py`: CLI quản trị (`gen-hub status`, `logs`, `doctor`, `backup`, `rollback`, `gitea-enable`, `migrate-ids`).

## Giao thức và ranh giới bảo mật

Server stateless MCP dùng POST JSON; GET/DELETE phía downstream trả 405 theo transport cho phép. Client lấy lại `tools/list` để cập nhật danh mục. Phía server luôn thẩm định quyền (policy) trên `tools/call`, bảo đảm cache phía client không bao giờ vượt quyền cho phép.

Callback dịch vụ lưu state một lần, bound với session owner, TTL 10 phút. DCR client được giữ tối đa 90 ngày, access token OAuth 1 giờ, refresh 30 ngày; manual token 90 ngày. Sau expiry manual token, tạo agent/token mới hoặc dùng OAuth để tự refresh.

SQLite chạy trong tiến trình Node.js với WAL mode và các chỉ mục đa chiều; phù hợp cho Hub tự lưu trữ cá nhân/đội ngũ nhỏ. Toàn bộ credential được mã hóa bằng AES-256-GCM qua khóa chủ `master.key` lưu ngoài source với phân quyền 0600.

