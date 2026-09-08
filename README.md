# Gen-hub

Nguồn chuẩn duy nhất (SSOT) cho Gen-hub: trung tâm MCP tự lưu trữ trên Linux.

## Mục tiêu đã chốt

- Một lệnh `install.sh`; nhận diện môi trường và xác nhận VPS hoặc máy cá nhân.
- VPS: domain → hướng dẫn DNS theo IP → người dùng xác nhận → kiểm tra DNS/HTTPS đến đúng bản cài.
- Máy cá nhân: domain + Cloudflare API token → tự cấu hình tunnel/DNS/Caddy → kiểm tra kết nối.
- Chỉ sau khi kiểm tra thành công mới tạo owner/mật khẩu trên TUI.
- Trả link đăng nhập và Composite MCP `/mcp` có xác thực.
- Giao diện tiếng Việt đã duyệt; onboarding thêm MCP, tài khoản, duyệt agent, cấp quyền từng tool và xem input/output.
- Kết nối phổ biến: Google Drive, GitHub, Slack, Telegram, Discord, Figma; hỗ trợ MCP HTTP tùy chỉnh.
- Frontend, backend, bộ cài, kiểm thử, tài liệu và tiến độ nằm trong repo này.

## Trạng thái

Đang triển khai. Commit đặc tả này chưa phải bản cài hoàn chỉnh. Chỉ công bố lệnh cài sau khi mã nguồn và kiểm thử được đưa lên.
