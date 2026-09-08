# Kiến trúc bản Linux

- `server/app.mjs`: HTTP router, API quản trị, policy và MCP resource server.
- `server/auth.mjs`: session owner và OAuth authorization server cho agent. Agent tokens lưu hash, bound resource `/mcp`; không dùng credential upstream làm token agent.
- `server/store.mjs`: SQLite records/audit, crypto và scrypt password. Schema v1 được khởi tạo idempotent; DB+key tồn tại ngoài source.
- `server/catalog.mjs`: schema tool của 6 dịch vụ, publication mặc định.
- `server/connectors.mjs`: provider API adapters, refresh OAuth, remote HTTP MCP session.
- `server/net.mjs`: outbound request giới hạn thời gian/kích thước, DNS pinning, kiểm tra mạng riêng, không theo redirect.
- `public/`: frontend vanilla JS/CSS, không build step, không sessionStorage/localStorage cho dữ liệu backend.
- `scripts/install.py`: TUI Linux, trạng thái resumable, Cloudflare provisioning, Caddy/systemd và tạo owner qua stdin.
- `scripts/manage.py`: vận hành, sao lưu/reset/update/rollback/gỡ có xác nhận.

Server stateless MCP dùng POST JSON; GET/DELETE phía downstream trả 405 theo transport cho phép. Không thông báo tools/list_changed; client lấy lại tools/list để thấy thay đổi. Phía server luôn kiểm policy trên tools/call, nên cache danh sách của client không vượt quyền.

Callback dịch vụ lưu state một lần, bound với session owner, TTL 10 phút. DCR client được giữ tối đa 90 ngày, access token OAuth 1 giờ, refresh 30 ngày; manual token 90 ngày. Sau expiry manual token, tạo agent/token mới hoặc dùng OAuth để tự refresh.

SQLite trong một tiến trình Node. Một số crypto và SQL đồng bộ; phù hợp Hub cá nhân, chưa thiết kế scale nhiều node. Cần benchmark và review bảo mật độc lập trước khi mở cho nhiều người hoặc môi trường nhạy cảm.
