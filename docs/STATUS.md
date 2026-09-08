# Trạng thái triển khai — 2026-09-08

## Đã có mã nguồn hoạt động

Frontend tiếng Việt nối API thật; backend SQLite; owner/session/CSRF; credential mã hóa; OAuth cho agent; Composite MCP và policy từng tool; audit; 6 connector tích hợp; remote MCP HTTP; bộ cài Linux VPS/tunnel, tạo owner, systemd và công cụ quản trị.

## Đã kiểm tra trong môi trường phát triển

- HTTP end-to-end: owner/session/CSRF, danh sách tool theo quyền, gọi tool, chặn tool ngoài quyền, tắt công bố, ngắt kết nối, thu hồi token.
- OAuth PKCE: đăng ký client, owner duyệt, code một lần, resource/audience đúng, token refresh xoay vòng, từ chối redirect không hợp lệ.
- Remote MCP qua HTTP thực trong test: initialize, notifications/initialized, Mcp-Session-Id, tools/list, tools/call, SSE response, đóng session.
- Database tồn tại qua mở lại; credential không plaintext; mạng riêng bị chặn mặc định.
- Installer: domain validation; DNS sai phải thử lại; HTTPS sai installation ID không được vượt qua; file bí mật 0600; không tạo tunnel trùng / không ghi đè DNS có sẵn.
- Tải Caddy và cloudflared từ GitHub releases chính thức, kiểm SHA256 thành công; xác nhận binary cloudflared có --token-file.
- Chạy Caddy validate thật: cả cấu hình VPS và máy cá nhân đều hợp lệ.

## Chưa thể xác minh trong môi trường này

- Không có systemd VM/VPS Linux chuyên dụng và domain/token Cloudflare của người dùng: chưa chạy bộ cài xuyên suốt trên hạ tầng thật, chưa xác minh cấp chứng chỉ/tunnel thật.
- Không có OAuth app và credential dịch vụ của người dùng: chưa đăng nhập tài khoản thật của Google/GitHub/Slack/Telegram/Discord/Figma. Mã gọi API đã có; cần acceptance bằng tài khoản thực.
- Chưa kiểm tra trình duyệt trực quan cho frontend đã nối backend.
- CI GitHub: xem workflow Gen-hub Linux checks trên commit/PR hiện tại; không suy ra đã xanh từ trạng thái local.

Bản này là implementation đầu tiên để kiểm thử cài đặt thực tế, chưa gọi là bản production đã nghiệm thu. Những thiếu hụt chức năng có chủ ý được liệt kê trong SPEC.md; không dùng dữ liệu mẫu để che API chưa có.

## Điểm bắt đầu cho phiên tiếp theo

Đọc README.md → docs/SPEC.md → docs/STATUS.md → docs/OPERATIONS.md. Kiểm tra HEAD và CI trên repo trước khi sửa. Giao diện Sites là tham khảo; repo này là SSOT. Không triển khai vào runner hoặc máy của Ryan khi chưa xác định rõ môi trường đích.
