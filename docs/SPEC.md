# Yêu cầu chuẩn — Gen-hub Linux

Chốt với Ryan ngày 2026-09-08. Đích: Hub tự sở hữu; repo Gen-hub làm SSOT. Không lấy clone Obot hay xây IDE/đội agent làm mục tiêu.

## Luồng chấp nhận

1. Một lệnh từ terminal, mọi nhập liệu tương tác qua TTY kể cả bootstrap được tải bằng curl.
2. Runtime chuẩn: Docker Compose, tự cài Docker khi thiếu. Quét OS/kiến trúc, gợi ý môi trường; người dùng xác nhận VPS hay máy cá nhân.
3. VPS: domain + IP public; hướng dẫn DNS cụ thể, chờ xác nhận thủ công và test; DNS chưa đúng dừng bước.
4. Máy cá nhân: domain gốc + hostname + token Cloudflare đủ quyền; tạo/reuse tunnel riêng của installation; tạo route/DNS; không ghi đè tài nguyên không thuộc installation.
5. Caddy/HTTPS và kết nối public cần trả đúng installation ID. Chỉ mở health check khi chưa có owner.
6. Tạo owner và password ngay trên TUI. Không có API bootstrap owner công khai.
7. In URL giao diện và MCP tổng. Agent phải xác thực riêng với Hub.
8. Web onboarding: add MCP → xác thực dịch vụ → công bố tool → duyệt/cấp quyền agent → gọi và xem log.
9. UI tiếng Việt theo hướng thiết kế được duyệt; mọi số liệu từ backend, không seed dữ liệu giả.

## Bất biến

- Cho phép gọi = agent active AND MCP enabled AND kết nối connected AND tool published AND agent có grant.
- Kiểm tra quyền ngay trước khi gửi lệnh upstream; thu hồi chặn lượt gọi mới. Lượt gọi đã gửi ra dịch vụ không thể đảm bảo thu hồi ngược.
- Token agent không thay thế token dịch vụ; không token passthrough.
- Tools/list chỉ liệt kê tool khả dụng, tên namespace ổn định theo MCP ID.
- Password chỉ hash; credential mã hóa bằng key trên máy. Không log secret.
- Quyền/credential/log/tài khoản tồn tại qua restart.
- Installer chạy lại không tạo tunnel trùng, không thay thế DNS bên ngoài, không tạo lại owner.
- Personal không publish host port; VPS chỉ publish Caddy 80/443.
- Mọi gate phải đạt trước owner. Cập nhật backup trước đổi runtime; lỗi kiểm tra khôi phục runtime trước, không tự hạ database.

## Giới hạn bản đầu được ghi rõ

- Linux systemd + Docker Engine/Compose, x86_64/arm64. Không Windows/macOS/Alpine/OpenRC.
- Remote MCP qua Streamable HTTP. Stdio và legacy SSE riêng endpoint chưa thuộc bản đầu.
- Remote OAuth tự khám phá cho MCP bên thứ ba chưa có; dùng bearer token. OAuth tích hợp cho Google Drive/GitHub/Slack và OAuth phía agent đã có.
- Không proxy sampling/elicitation server-to-client; chưa hỗ trợ giao thức 2026-07-28.
- Các bộ công cụ tích hợp là tập tool được định nghĩa trong catalog, không phải toàn bộ API nhà cung cấp.
- Dashboard tính trên 200 log gần nhất; export tối đa 5.000 bản ghi. Dữ liệu lưu theo retention 7/30/90 ngày.
