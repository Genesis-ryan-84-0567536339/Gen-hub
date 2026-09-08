# Gen-hub

Trung tâm MCP tự lưu trữ trên Linux. Một giao diện tiếng Việt để kết nối dịch vụ, công bố công cụ, cấp quyền từng agent và xem nhật ký input/output.

**Repo này là SSOT:** mã nguồn, yêu cầu, hướng dẫn vận hành, kiểm thử và trạng thái phát hành đều nằm tại đây. Giao diện demo trên Sites là bản tham khảo thiết kế; không phải backend đang chạy của repo này.

## Cài bằng một lệnh

Yêu cầu Linux **systemd, glibc**, x86_64 hoặc aarch64; Ubuntu 22.04/24.04, Debian 12/13, Fedora tương thích. Python >=3.10; quyền sudo; ít nhất 1 GiB trống. Bộ cài tải Node.js 24 LTS, Caddy và cloudflared khi cần; không yêu cầu Docker hoặc npm install.

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Genesis-ryan-84-0567536339/Gen-hub/main/install.sh)
```

1. Xác nhận **VPS/server** hoặc **máy cá nhân**. Nhận diện chỉ là gợi ý.
2. VPS: nhập domain, xác nhận IP, tạo DNS theo hướng dẫn rồi kiểm tra. Mở TCP 80/443; Caddy tự cấp/gia hạn HTTPS.
3. Máy cá nhân: nhập hostname, domain gốc và Cloudflare API token; bộ cài tạo tunnel, DNS và dịch vụ cloudflared/Caddy. Domain gốc cần ở trạng thái Active trên Cloudflare.
4. Chờ kiểm tra HTTPS tới **đúng installation ID**. Chưa đạt không cho tạo owner.
5. Tạo owner/mật khẩu ngay trên TUI; mật khẩu nhập ẩn, không đi qua tham số lệnh.
6. Nhận URL đăng nhập và MCP tổng `/mcp`; đăng nhập để xem hướng dẫn thiết lập đầu tiên.

Cloudflare token cần **Account / Cloudflare Tunnel / Edit**, **Zone / DNS / Edit**, **Zone / Zone / Read**, giới hạn đúng account/zone. Token quản trị chỉ dùng trong tiến trình cài; runtime tunnel token riêng lưu root-only. Không nhập token vào GitHub hoặc chat.

Bộ cài không ghi đè DNS đang trỏ nơi khác, không chiếm dịch vụ đang dùng cổng cần thiết. Trạng thái được lưu để chạy lại khi mất mạng hoặc ngắt cài. Máy cá nhân cần bật máy và kết nối Internet để agent từ xa truy cập được.

## Bắt đầu sử dụng

- **MCP & kết nối** → Thêm dịch vụ hoặc MCP HTTP tùy chỉnh.
- Kết nối bằng OAuth hoặc token theo hướng dẫn từng dịch vụ; kiểm tra và đồng bộ tool thật.
- Công bố các tool cần cung cấp. Tool ghi mặc định tắt; tool remote chỉ tự công bố khi server khai báo readOnlyHint=true.
- **Agent & quyền** → Kết nối agent: dùng OAuth có PKCE hoặc tạo token riêng cho MCP client. Owner chọn từng tool khi duyệt.
- Agent dùng `https://<domain>/mcp`. Tool được đặt namespace theo ID MCP để tránh trùng tên.
- **Nhật ký** → xem input/output, lỗi, lý do cấp/từ chối, thời gian xử lý; lọc và xuất JSONL.

Đăng nhập dịch vụ thực hiện ở Hub; agent không nhận credential dịch vụ. Nhà cung cấp vẫn có thể yêu cầu xác thực lại khi token bị thu hồi hoặc quyền thay đổi.

## Có gì trong bản này

- Backend Node.js 24, SQLite WAL, migration khởi tạo schema v1.
- Owner/password scrypt; session HttpOnly/SameSite/Secure trên HTTPS; kiểm tra Origin/Host/CSRF; giới hạn đăng nhập và đăng ký client.
- Credential và payload audit mã hóa AES-256-GCM; credential nhạy cảm được che trước khi ghi nhật ký.
- OAuth authorization code + PKCE S256, resource binding, dynamic client registration, code một lần, refresh token xoay vòng. Thu hồi agent vô hiệu hóa token hiện hữu.
- MCP Streamable HTTP JSON responses; client upstream hỗ trợ JSON/SSE, session initialize/close, pagination tools/list. Protocol hỗ trợ 2025-03-26 / 2025-06-18 / 2025-11-25; không tự nhận tương thích bản protocol mới hơn chưa kiểm tra.
- Google Drive, GitHub, Slack, Telegram, Discord, Figma: bộ công cụ tích hợp gọi API thật. Google/GitHub/Slack có OAuth app; các connector token có kiểm tra kết nối. Xem [CONNECTORS.md](docs/CONNECTORS.md).
- MCP HTTP tùy chỉnh: bearer token hoặc không xác thực; owner chủ động cho phép mạng riêng nếu cần. Không tự chạy lệnh shell của MCP từ nguồn chưa kiểm soát.
- Giao diện tiếng Việt, dữ liệu thật, onboarding, cấp quyền, kiểm tra policy, log và đổi mật khẩu owner.

## Vận hành

```bash
sudo gen-hub status
sudo gen-hub logs
sudo gen-hub restart
sudo gen-hub backup /root/gen-hub-backup.tar.gz
sudo gen-hub reset-password
sudo gen-hub update
sudo gen-hub rollback
sudo gen-hub uninstall
```

Dữ liệu: `/var/lib/gen-hub`. Cấu hình và trạng thái cài: `/etc/gen-hub`. Mã nguồn theo revision: `/opt/gen-hub/releases`. Gỡ mặc định giữ dữ liệu/cấu hình; tunnel và DNS Cloudflare được giữ để khôi phục hoặc xóa thủ công. Chi tiết: [OPERATIONS.md](docs/OPERATIONS.md).

## Phát triển và kiểm thử

Cần Node.js 24 và Python 3.10+. Không có dependency npm ngoài runtime.

```bash
npm test
npm run check
```

Khởi tạo owner local qua CLI, rồi chạy server trên loopback (chỉ dùng phát triển; cài chính thức qua TUI):

```bash
python3 scripts/dev.py
npm start
```

Các test sử dụng HTTP thật trên loopback cho MCP/đăng nhập/OAuth và server MCP kiểm soát trong test. Test installer dùng API/DNS giả lập để không thay đổi hạ tầng thật.

**Phạm vi xác minh và phần còn phải thử trên hạ tầng thật:** xem [STATUS.md](docs/STATUS.md). Không đồng nhất “test tự động đạt” với “mọi nhà cung cấp đã đăng nhập thành công bằng tài khoản thực”.
