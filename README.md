# Gen-hub

Trung tâm MCP tự lưu trữ trên Linux. Một giao diện tiếng Việt để kết nối dịch vụ, công bố công cụ, cấp quyền từng agent và xem nhật ký input/output.

**Repo này là SSOT:** mã nguồn, yêu cầu, hướng dẫn vận hành, kiểm thử và trạng thái phát hành đều nằm tại đây. Giao diện demo trên Sites là bản tham khảo thiết kế; không phải backend đang chạy của repo này.

## Cài bằng một lệnh

Yêu cầu Linux **systemd**, x86_64 hoặc aarch64; Python >=3.10, quyền sudo và ít nhất 2 GiB trống tại nơi Docker lưu images. Tự cài Docker Engine + Compose trên Ubuntu/Debian/Fedora nếu thiếu, rồi chạy Gen-hub, Caddy và cloudflared bằng container. Máy chủ không cần cài Node.js hoặc npm. Các images được khóa digest trong repo.

Runtime được hỗ trợ là **Docker Engine Linux + Docker Compose >=2.20** qua socket hệ thống; chưa hỗ trợ Podman/podman-docker hoặc Docker rootless. Podman có thể cùng được cài trên máy, nhưng lệnh `docker` và `/var/run/docker.sock` dùng cho Gen-hub phải thuộc Docker Engine.

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Genesis-ryan-84-0567536339/Gen-hub/main/install.sh)
```

Đã clone repo thì chỉ cần `./install.sh`. Cập nhật sau khi cài: `sudo gen-hub update`. Không cần tự gõ lệnh Docker.

1. Xác nhận **VPS/server** hoặc **máy cá nhân**. Nhận diện chỉ là gợi ý.
2. VPS: nhập domain, xác nhận IP, tạo DNS theo hướng dẫn rồi kiểm tra. Mở TCP 80/443; Caddy tự cấp/gia hạn HTTPS.
3. Máy cá nhân: nhập hostname, domain gốc và Cloudflare API token; bộ cài tạo tunnel, DNS và container cloudflared/Caddy. Không publish cổng trên máy cá nhân. Domain gốc cần ở trạng thái Active trên Cloudflare.
4. Bộ cài kiểm Docker, cổng, image/build, Caddy, container health và SQLite. Chờ kiểm tra HTTPS tới **đúng installation ID**. Chưa đạt không cho tạo owner.
5. Tạo owner/mật khẩu ngay trên TUI; mật khẩu hiện ra khi gõ (không ẩn — để paste/gõ ổn định trên mọi terminal), không đi qua tham số lệnh hay lưu lịch sử lệnh.
6. Nhận URL đăng nhập và MCP tổng `/mcp`; đăng nhập để xem hướng dẫn thiết lập đầu tiên.

Cloudflare token cần **Account / Cloudflare Tunnel / Edit**, **Zone / DNS / Edit**, **Zone / Zone / Read**, giới hạn đúng account/zone. Token quản trị chỉ dùng trong tiến trình cài; runtime tunnel token riêng lưu root-only. Không nhập token vào GitHub hoặc chat.

Bộ cài không ghi đè DNS đang trỏ nơi khác, không chiếm dịch vụ đang dùng cổng cần thiết. Trạng thái được lưu để chạy lại khi mất mạng hoặc ngắt cài. Máy cá nhân cần bật máy và kết nối Internet để agent từ xa truy cập được.

### Fedora / Podman

Nếu `docker` là shim do `podman-docker` cung cấp, bộ cài phát hiện và dừng trước khi cài package hoặc gọi `docker.service`. Cách chuyển lệnh `docker` sang Docker Engine:

```bash
rpm -q podman-docker
sudo dnf remove podman-docker
```

Xem danh sách thay đổi của DNF trước khi xác nhận. Sau đó chạy lại lệnh cài Gen-hub ở trên; bộ cài sẽ tự cài các package Docker Engine + Compose còn thiếu từ repo chính thức. Không dùng `dnf install docker` để thay bước này. Nếu dùng wrapper/symlink tự tạo, hãy sửa đường dẫn lệnh `docker`; nếu socket `/var/run/docker.sock` trỏ tới Podman, quản trị viên cần xử lý cấu hình socket trước.

Không xóa dữ liệu/container Podman và không tự chuyển chúng sang Docker. Nếu DNF báo package xung đột khác, xử lý theo [hướng dẫn Docker cho Fedora](https://docs.docker.com/engine/install/fedora/) rồi chạy lại; bộ cài không tự gỡ package xung đột hoặc dùng `--allowerasing`.

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

## Tự cập nhật từ repo Gen-hub

**Mặc định bật sau khi cài thành công.** Máy kiểm tra `Gen-hub/main` mỗi giờ, lệch ngẫu nhiên tối đa 10 phút. Chỉ cập nhật commit có workflow CI trên `main` đã thành công; tải source theo đúng SHA và dùng image digest trong repo. Không tự cập nhật image `latest` riêng lẻ.

Trước cập nhật: backup dữ liệu/khóa/cấu hình → tạo runtime mới → kiểm tra container, SQLite và HTTPS → xác nhận thành công. Nếu kiểm tra lỗi, khôi phục runtime trước. Bản cập nhật đã thất bại không bị tự thử đi thử lại; chờ commit mới hoặc bạn chủ động chạy update.

```bash
sudo gen-hub update                 # Kiểm tra và cập nhật ngay
sudo gen-hub auto-update off        # Tạm dừng cập nhật tự động
sudo gen-hub auto-update on         # Bật lại
sudo systemctl list-timers gen-hub-update.timer
sudo journalctl -u gen-hub-update -n 100 --no-pager
```

Cần Internet tới GitHub và registry. Máy cá nhân tắt máy thì không chạy cập nhật; timer kiểm tra bù khi bật lại. Quá trình tạo lại container có gián đoạn ngắn, không cam kết zero-downtime. `sudo gen-hub rollback` quay về runtime trước và tạm tắt auto-update để giữ bản bạn chọn. Rollback không tự hạ database.

## Doctor: kiểm tra và tự sửa

```bash
sudo gen-hub doctor                 # Chẩn đoán, không sửa cấu hình
sudo gen-hub doctor --fix           # Sửa quyền file/cấu hình, tạo lại container và kiểm tra
sudo gen-hub doctor --fix --cloudflare  # Thêm cấp lại token/route tunnel bằng API token (hiện khi gõ)
sudo gen-hub status
sudo gen-hub logs
```

`--fix` giữ database, khóa mã hóa và owner; lưu bản cấu hình cũ trước khi dựng lại cấu hình chuẩn của bản đang cài. Nó kiểm Docker, quyền file, Caddy, container health, SQLite, tunnel và HTTPS đúng installation. Không tự ghi đè DNS thuộc ứng dụng khác, đổi firewall hay đoán credential. Mất `master.key` hoặc database hỏng thì **dừng và yêu cầu khôi phục backup**, không tạo khóa/database thay thế. Nếu source của revision bị mất, chạy lại lệnh cài.

## Sao lưu và gỡ cài đặt

```bash
sudo gen-hub backup /root/gen-hub-backup.tar.gz
sudo gen-hub uninstall              # Gỡ container, giữ dữ liệu để cài lại
sudo gen-hub uninstall --purge      # Gỡ sạch Gen-hub và dữ liệu trên máy
sudo gen-hub uninstall --purge --cloudflare  # Gỡ sạch máy và xóa thêm tunnel/DNS của bản cài
```

**`--purge` xóa vĩnh viễn** container/network Gen-hub, database, credentials, master.key, chứng chỉ Caddy, cấu hình, source và backup nằm trong `/opt/gen-hub/backups`. Chương trình yêu cầu nhập `DELETE <domain>` trước khi thực hiện. Sao lưu ra ngoài thư mục Gen-hub nếu muốn giữ khả năng khôi phục.

`--cloudflare` cần API token (hiện khi gõ, không lưu ra đĩa/tham số lệnh) với quyền Tunnel Edit và DNS Edit; chỉ xóa tunnel có tên/ID đúng installation và DNS vẫn trỏ tới tunnel đó. Nếu tài nguyên đã được dùng cho hostname khác hoặc API lỗi, dừng để kiểm tra; không báo đã xóa sạch Cloudflare khi chưa thành công.

Docker Engine, image nền dùng chung, ứng dụng khác và backup bạn lưu nơi khác được giữ. Tài khoản Linux `genhub` chỉ gỡ khi bộ cài ghi nhận đã tạo tài khoản đó và UID/home vẫn đúng; không gỡ tài khoản có sẵn của quản trị viên. `uninstall` và `--purge` đều tắt lịch tự cập nhật trước khi gỡ.

Dữ liệu: `/var/lib/gen-hub`. Cấu hình: `/etc/gen-hub`. Source: `/opt/gen-hub/releases/<SHA>`. Dữ liệu dùng bind volume, tồn tại qua thay container. Chi tiết khôi phục và xử lý lỗi: [OPERATIONS.md](docs/OPERATIONS.md).

## Phát triển và kiểm thử

Cần Node.js 24 và Python 3.10+. Không có dependency npm ngoài runtime.

```bash
npm test
npm run check
```

Format JavaScript bằng Prettier 3.6.2 theo cấu hình trong repo (công cụ phát triển, không cần khi chạy/cài Gen-hub):

```bash
npx --yes prettier@3.6.2 --write 'server/*.mjs' public/app.js
npx --yes prettier@3.6.2 --check 'server/*.mjs' public/app.js
```

Giữ nguyên nội dung chuỗi HTML/SQL khi format; không trộn thay đổi logic với PR chỉ chỉnh định dạng.

Khởi tạo owner local qua CLI, rồi chạy server trên loopback (chỉ dùng phát triển; cài chính thức qua TUI):

```bash
python3 scripts/dev.py
npm start
```

CI còn build/chạy Docker thật trên Ubuntu 22.04/24.04, thử Caddy TLS với CA kiểm thử được tin cậy, đăng nhập/MCP, tạo lại container, giữ dữ liệu và backup; kiểm tra tuyến nội bộ personal và binary cloudflared. Không dùng token giả để kết nối Cloudflare.

Các test sử dụng HTTP thật trên loopback cho MCP/đăng nhập/OAuth và server MCP kiểm soát trong test. Test installer dùng API/DNS giả lập để không thay đổi hạ tầng thật.

**Phạm vi xác minh và phần còn phải thử trên hạ tầng thật:** xem [STATUS.md](docs/STATUS.md). Không đồng nhất “test tự động đạt” với “mọi nhà cung cấp đã đăng nhập thành công bằng tài khoản thực”.
