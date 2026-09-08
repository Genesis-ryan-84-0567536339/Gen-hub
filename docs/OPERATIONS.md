# Vận hành Gen-hub Docker Compose

## Runtime

`install.sh` và Python TUI chạy trên host. Docker Engine là service systemd duy nhất cần cho bản cài mới. Compose project `gen-hub` quản lý `hub`, `caddy` và (máy cá nhân) `tunnel`; tự chạy lại khi Docker/máy khởi động. CLI chỉ dùng Docker socket local `/var/run/docker.sock`, không dùng remote context của người quản trị.

- VPS: Internet → Caddy 80/443 HTTPS → `hub:3080`. Backend không publish port. Cần mở firewall OS/nhà cung cấp; không tự sửa firewall. Docker published ports có quy tắc riêng, phải kiểm tra cả firewall nhà cung cấp.
- Máy cá nhân: Cloudflare HTTPS → cloudflared → `caddy:8080` HTTP nội bộ → `hub:3080`. Không publish bất kỳ host port nào. Cần outbound DNS/HTTPS và Cloudflare Tunnel 7844 TCP/UDP.
- Gen-hub chạy bằng UID/GID tài khoản hệ thống `genhub`, filesystem container chỉ đọc; không mount Docker socket. Docker không được coi là máy ảo bảo mật tuyệt đối.
- Node/Caddy/cloudflared khóa theo digest trong `deploy/images.json`. Thay runtime bằng cập nhật repo được kiểm CI; không dùng Watchtower/tự kéo latest. Docker Engine cập nhật qua package manager của OS.

## Dữ liệu giữ ngoài container

| Đường dẫn host | Nội dung |
|---|---|
| `/var/lib/gen-hub` | SQLite, WAL/SHM, `master.key` |
| `/var/lib/gen-hub-caddy` | Chứng chỉ và trạng thái Caddy |
| `/var/lib/gen-hub-caddy-config` | Cấu hình runtime Caddy |
| `/etc/gen-hub` | Compose JSON, Caddyfile, token tunnel, trạng thái/checkpoint |
| `/opt/gen-hub/releases/<SHA>` | Mã nguồn chuẩn theo commit |
| `/opt/gen-hub/backups` | Backup tự động trước cập nhật/rollback |

Các bind volume có SELinux label cho Fedora. `tunnel.token` owner genhub, mode 0600 dưới thư mục root-only; Compose secret mount file này vào container. Compose secrets trên một máy không phải kho mã hóa riêng. API token Cloudflare quản trị chỉ giữ trong bộ nhớ khi thiết lập; runtime token không nằm trong môi trường container hoặc repo.

## Kiểm tra / khắc phục

```bash
sudo gen-hub status
sudo gen-hub logs
sudo gen-hub doctor
sudo gen-hub restart
```

`doctor`: SQLite đọc/ghi + mã hóa, Caddy nội bộ và Cloudflare readiness khi có tunnel, HTTPS hợp lệ trả đúng installation ID, trạng thái owner. Không tự tạo owner hoặc đổi quyền. Healthcheck container kiểm tra HTTP/installation ID; Docker restart policy khởi động lại process đã thoát, không tự restart một process còn chạy nhưng unhealthy.

Cài lỗi: chạy lại cùng lệnh cài. State giữ bước/lỗi gần nhất. Nếu DNS có AAAA cũ trỏ sai, sửa cả A/AAAA; VPS cần DNS-only khi kiểm tra. Không gửi master.key, database, token hoặc backup lên issue/chat. Đổi domain/mode chưa có wizard; cần thao tác của quản trị viên với backup và callback OAuth tương ứng.

## Cập nhật / rollback

```bash
sudo gen-hub update
sudo gen-hub rollback
```

Update tải source theo commit SHA, pull image digest, build app, validate Caddy trước khi đổi runtime. Với bản đã có dữ liệu, tự backup nhất quán trước đổi. Tạo lại container, kiểm tra local/HTTPS rồi xác nhận thành công. Nếu kiểm tra thất bại, khôi phục Compose/Caddy/runtime trước; không hạ database. Rollback hiện chỉ cho schema v1 và cần image/source cũ còn được giữ. Không chạy docker prune tự động.

Cài lại sau `uninstall` giữ domain, token, owner và dữ liệu. Chạy lại bản cùng SHA vẫn kiểm tra đầy đủ; không hỏi lại Cloudflare API token nếu đã có cấu hình Compose/token runtime hợp lệ. Tunnel bị xóa hoặc token bị thu hồi cần quản trị viên xử lý trước khi doctor đạt.

Nếu đã cài bản systemd cũ: xác minh đúng unit Gen-hub, chuẩn bị image trước; dừng unit cũ, backup DB/key, giữ nguyên UID/data và chuyển sang Compose. Chỉ disable unit cũ khi kiểm tra thành công. Nếu thất bại, khởi động lại unit cũ và khôi phục route tunnel cũ. Unit/source cũ không bị xóa tự động. Luồng chuyển đổi này cần nghiệm thu riêng trên máy đã cài bản cũ.

## Backup / khôi phục

```bash
sudo gen-hub backup /root/gen-hub-backup.tar.gz
```

SQLite `VACUUM INTO` tạo snapshot nhất quán khi Hub đang chạy; lưu cùng master.key và cấu hình trong archive 0600. Backup chứa đủ thông tin giải mã dữ liệu, cần bảo quản như credential. Chứng chỉ Caddy không nằm trong archive DB; giữ thư mục Caddy riêng khi chuyển máy để tránh cấp lại chứng chỉ không cần thiết.

Khôi phục trên cùng revision: dừng container Hub bằng `sudo docker compose -p gen-hub -f /etc/gen-hub/compose.json stop hub`; giải nén archive tin cậy vào thư mục root-only tạm; thay `hub.db` và `master.key` trong `/var/lib/gen-hub`, dọn WAL/SHM cũ chỉ sau khi đã dừng Hub. Đặt owner genhub:genhub, thư mục 0700/file 0600; chạy `sudo gen-hub restart` rồi `sudo gen-hub doctor`. Không đặt database mới cạnh WAL cũ. Khi chuyển máy cần khôi phục cấu hình phù hợp và DNS/tunnel; không tự ghi đè domain của ứng dụng khác.

## Gỡ

`sudo gen-hub uninstall` hỏi xác nhận, chạy Compose down để gỡ container/network của Gen-hub. Giữ data, key, config, source, images, backup, Docker và Cloudflare tunnel/DNS. Không dùng `down -v` hoặc `system prune`; không gỡ container ứng dụng khác. Dữ liệu/tài nguyên Cloudflare chỉ xóa thủ công sau khi kiểm tra đúng installation.

## Nguồn thiết kế

- [Docker Compose startup/health](https://docs.docker.com/compose/how-tos/startup-order/)
- [Docker packages Ubuntu](https://docs.docker.com/engine/install/ubuntu/) / [Fedora](https://docs.docker.com/engine/install/fedora/)
- [Caddy Docker Compose](https://caddyserver.com/docs/running#docker-compose)
- [cloudflared token file](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/)
