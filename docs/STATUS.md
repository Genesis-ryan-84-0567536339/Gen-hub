# Trạng thái triển khai — 2026-09-09

## Đã có mã nguồn hoạt động

Frontend tiếng Việt nối API thật; backend SQLite; owner/session/CSRF; credential mã hóa; OAuth cho agent; Composite MCP và policy từng tool; audit; 6 connector tích hợp; remote MCP HTTP; bộ cài Linux VPS/tunnel, tạo owner, Docker Compose và công cụ quản trị.

## Đã kiểm tra trong môi trường phát triển

- HTTP end-to-end: owner/session/CSRF, danh sách tool theo quyền, gọi tool, chặn tool ngoài quyền, tắt công bố, ngắt kết nối, thu hồi token.
- OAuth PKCE: đăng ký client, owner duyệt, code một lần, resource/audience đúng, token refresh xoay vòng, từ chối redirect không hợp lệ.
- Remote MCP qua HTTP thực trong test: initialize, notifications/initialized, Mcp-Session-Id, tools/list, tools/call, SSE response, đóng session.
- Database tồn tại qua mở lại; credential không plaintext; mạng riêng bị chặn mặc định.
- Installer: domain validation; DNS sai phải thử lại; HTTPS sai installation ID không được vượt qua; file bí mật 0600; không tạo tunnel trùng / không ghi đè DNS có sẵn.
- Tải Caddy và cloudflared từ GitHub releases chính thức, kiểm SHA256 thành công; xác nhận binary cloudflared có --token-file.
- Chạy Caddy validate thật: cả cấu hình VPS và máy cá nhân đều hợp lệ.

- CI Docker trong PR #2 đã chạy thành công trên Ubuntu 22.04/24.04: build images, Caddy TLS với CA kiểm thử, owner/login/MCP, gỡ và tạo lại container vẫn giữ session/token/data/key, backup 0600, tuyến Caddy personal không publish cổng và binary cloudflared. Xem kết quả ở commit cuối của PR trước khi phát hành.

- Tự update có gate đúng main SHA + push CI success, bỏ qua bản đã lỗi; doctor từ chối tạo khóa thay thế khi mất master.key; gỡ sạch kiểm tra ownership và yêu cầu xác nhận domain. CI Docker đã xác minh thêm sửa cấu hình hỏng giữ data/key và purge trong thư mục CI riêng không ảnh hưởng thư mục bên cạnh; kiểm tra timer thực dùng lệnh vô hại thay trình updater. Cần đối chiếu kết quả commit cuối PR #2.

## Kiểm thử độc lập được báo cáo trong Issue #3

Theo [Issue #3](https://github.com/Genesis-ryan-84-0567536339/Gen-hub/issues/3), Claude Code đã chạy 6 test Node và 18 test Python, kiểm tra UI qua Playwright/Chromium headless trên bản main sau PR #2 và không tìm thấy lỗi chức năng trong phạm vi đã thử:

- Owner bootstrap/login, CSRF và phát lại session sau logout bị từ chối (401).
- Năm mục giao diện chính render đúng; modal thêm MCP có 6 connector và MCP tùy chỉnh.
- Thêm MCP tùy chỉnh qua form/API và hiển thị trong danh sách; từ chối lưu token qua HTTP thường đúng thiết kế.

Đây là kết quả được người kiểm thử báo cáo trong issue, không phải toàn bộ nghiệm thu production. Lần kiểm thử đó chưa xác minh handshake MCP qua HTTPS, tài khoản nhà cung cấp thật, MCP client thật qua OAuth hoặc bộ cài trên hạ tầng thật.

## Đã nghiệm thu thật trên hạ tầng thật (2026-09-09, Claude Code + agy CLI)

- **[Issue #11](https://github.com/Genesis-ryan-84-0567536339/Gen-hub/issues/11)**: chạy `install.sh` xuyên suốt thật trên 1 VM Ubuntu 24.04 sạch (systemd thật, KVM local, chưa cài Docker/Podman) qua nhánh máy cá nhân + Cloudflare Tunnel + domain thật. Docker Engine cài tự động đúng (29.8.0, không phải Podman — xác nhận logic PR #6 hoạt động đúng trên hạ tầng thật, không chỉ trên máy dev có sẵn Podman). 3 container healthy, HTTPS thật hoạt động, `gen-hub status`/`doctor` đều ✓, Owner tạo được, login UI thật (Playwright) pass. **Phát hiện thêm 1 bug thật khác** (không liên quan Podman): `install.sh` báo exit code 1 dù cài thành công 100%, do lỗi quyền dọn `__pycache__` sinh ra khi chạy Python qua sudo — xem Issue #11 để biết chi tiết root cause.
- **[Issue #12](https://github.com/Genesis-ryan-84-0567536339/Gen-hub/issues/12)**: nghiệm thu đầy đủ luồng **Agent thật** kết nối qua OAuth PKEC + gọi tool qua `/mcp` bằng curl thật (không qua thư viện trung gian) — đăng ký client động, chủ sở hữu duyệt, đổi token, `initialize`/`tools/list`/`tools/call` đúng namespace, proxy tới downstream MCP thật thành công, và xác nhận **thu hồi quyền chặn token cũ ngay lập tức** (đúng bất biến bảo mật quan trọng nhất trong SPEC.md). Audit log ghi chính xác toàn bộ, kể cả latency thật.

## Còn cần nghiệm thu trên môi trường thật

- Chưa đăng nhập tài khoản thật của Google/GitHub/Slack/Telegram/Discord/Figma (OAuth app + credential dịch vụ thật) — mã gọi API đã có, cần acceptance bằng tài khoản thực.
- UI đã có kiểm thử Chromium headless được báo cáo ở trên; chưa nghiệm thu toàn bộ thao tác, kích thước màn hình và trình duyệt trên bản cài chính thức.
- Chưa chạy xuyên suốt một chu kỳ tự cập nhật từ bản cũ sang bản mới trên máy đã cài; timer và các gate hiện được kiểm tra từng phần.
- Cài Docker mới bằng package manager **trên Fedora cụ thể (SELinux)** và chuyển đổi từ bản systemd cũ chưa được nghiệm thu trên VM riêng — VM đã nghiệm thu ở Issue #11 là Ubuntu 24.04, không phải Fedora.
- CI GitHub: xem workflow Gen-hub Linux checks trên commit/PR hiện tại; không suy ra đã xanh từ trạng thái local.

Bản này là implementation đầu tiên để kiểm thử cài đặt thực tế, chưa gọi là bản production đã nghiệm thu. Những thiếu hụt chức năng có chủ ý được liệt kê trong SPEC.md; không dùng dữ liệu mẫu để che API chưa có.

## Điểm bắt đầu cho phiên tiếp theo

Đọc README.md → docs/SPEC.md → docs/STATUS.md → docs/OPERATIONS.md. Kiểm tra HEAD và CI trên repo trước khi sửa. Giao diện Sites là tham khảo; repo này là SSOT. Không triển khai vào runner hoặc máy của Ryan khi chưa xác định rõ môi trường đích.
