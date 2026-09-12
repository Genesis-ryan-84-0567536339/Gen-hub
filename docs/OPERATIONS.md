# Vận hành Gen-hub Docker Compose

## Runtime

`install.sh` và Python TUI chạy trên host. Systemd quản lý Docker Engine và timer cập nhật `gen-hub-update.timer`; các dịch vụ ứng dụng chạy trong Compose. Compose project `gen-hub` quản lý `hub`, `caddy` và (máy cá nhân) `tunnel`; tự chạy lại khi Docker/máy khởi động. CLI chỉ dùng Docker socket local `/var/run/docker.sock`, không dùng remote context của người quản trị.

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

`doctor`: SQLite đọc/ghi + mã hóa, Caddy nội bộ và Cloudflare readiness khi có tunnel, HTTPS hợp lệ trả đúng installation ID, trạng thái owner. Không tự tạo owner hoặc đổi quyền tool. `doctor --fix` sửa quyền file/cấu hình chuẩn, dựng lại container và kiểm tra; `--fix --cloudflare` yêu cầu API token (hiện khi gõ) để cấp lại token/route đúng installation. Thiếu khóa hoặc database lỗi thì dừng, yêu cầu khôi phục backup. Healthcheck container kiểm tra HTTP/installation ID; Docker restart policy khởi động lại process đã thoát, không tự restart một process còn chạy nhưng unhealthy.

Cài lỗi: chạy lại cùng lệnh cài. State giữ bước/lỗi gần nhất. Nếu DNS có AAAA cũ trỏ sai, sửa cả A/AAAA; VPS cần DNS-only khi kiểm tra. Không gửi master.key, database, token hoặc backup lên issue/chat. Đổi domain/mode chưa có wizard; cần thao tác của quản trị viên với backup và callback OAuth tương ứng.

Fedora báo phát hiện Podman/podman-docker: làm theo [README — Fedora / Podman](../README.md#fedora--podman), gỡ shim sau khi kiểm tra giao dịch DNF rồi chạy lại bộ cài. Gen-hub cần Docker Engine và unit hệ thống `docker.service`; không thể chỉ thay `OSType` bằng `host.os` để dùng Podman. `doctor --fix` cũng áp dụng bước phát hiện này và không tự gỡ/chuyển đổi Podman.

## Cập nhật / rollback

Mặc định bật timer mỗi giờ (+0–10 phút ngẫu nhiên, chạy bù sau khi bật máy). `sudo gen-hub auto-update on|off` điều khiển timer. Chỉ cập nhật đúng SHA trên main có push CI hoàn tất/thành công. Bản đã update lỗi bị bỏ qua tự động cho đến khi có commit mới hoặc update thủ công. Log: `sudo journalctl -u gen-hub-update -n 100 --no-pager`. Rollback thủ công tạm tắt auto-update để tránh lập tức nâng lại.

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

## Chuyển đổi ID cũ (Migration)

```bash
sudo gen-hub migrate-ids
```

Lệnh chạy một lần để chuyển đổi các ID cũ tạo trước bản chuẩn hóa #40 (không có tiền tố) sang định dạng chuẩn 5 chữ số có dấu gạch ngang (`agent-NNNNN`, `vault-NNNNN`, `mcp-NNNNN`, `client-NNNNN`, `flow-NNNNN`, `admin-NNNNN`). Thực thi nguyên tử trong một transaction `store.tx()`, đồng thời cập nhật mọi liên kết chéo (`agent.permissions`, `token.agent`, `code.agent`, v.v.) mà không làm thay đổi giá trị token bí mật của client. Giữ nguyên toàn bộ lịch sử audit cũ và bổ sung một bản ghi `system.id_migration` lưu lại bảng ánh xạ.

## Gỡ

`sudo gen-hub uninstall` hỏi xác nhận, chạy Compose down để gỡ container/network của Gen-hub. Giữ data, key, config, source, images, backup, Docker và Cloudflare tunnel/DNS. Không dùng `down -v` hoặc `system prune`; không gỡ container ứng dụng khác. `sudo gen-hub uninstall --purge` xóa luôn data/key/cert/config/source/backup nội bộ, yêu cầu nhập DELETE kèm domain. Thêm `--cloudflare` để xóa tài nguyên Cloudflare đúng installation sau khi nhập API token; kiểm tra tên tunnel và các hostname/DNS trước khi xóa. Giữ Docker và image nền dùng chung. Backup cần giữ phải nằm ngoài thư mục Gen-hub. Lệnh gỡ tắt timer tự cập nhật.

## Nguồn thiết kế

- [Docker Compose startup/health](https://docs.docker.com/compose/how-tos/startup-order/)
- [Docker packages Ubuntu](https://docs.docker.com/engine/install/ubuntu/) / [Fedora](https://docs.docker.com/engine/install/fedora/)
- [Caddy Docker Compose](https://caddyserver.com/docs/running#docker-compose)
- [cloudflared token file](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/)
