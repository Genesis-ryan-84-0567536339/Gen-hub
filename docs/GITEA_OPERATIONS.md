# Gitea storage và lifecycle — Refs #23

Gitea là bước cố định của TUI cài mới, hoàn tất cùng owner sau các health gate. Không có câu hỏi bật/tắt hoặc cờ tính năng. Nếu một bước thất bại, cài đặt chưa hoàn tất; chạy lại TUI để tiếp tục, giữ owner và storage đã tạo. Bootstrap dùng tài khoản nội bộ `genhub-admin`, mật khẩu sinh từ `secret()` trong `server/store.mjs` và truyền qua stdin tới container. Mật khẩu chỉ được ghi một lần trực tiếp ra `/dev/tty`, không vào stdout, state, Compose hoặc log file; lưu ngay và đổi trong lần đăng nhập đầu. TUI cần terminal có controlling TTY.

## Máy đã có owner

Sau khi cập nhật bộ cài/CLI:

```sh
sudo gen-hub gitea-enable
sudo gen-hub doctor
```

Đây là bước chuyển tiếp bắt buộc, không phải công tắc bật tính năng. Auto-update chuẩn bị container Gitea nhưng không tạo/giao mật khẩu trong journal của systemd. `status` báo còn thiếu bootstrap; `doctor` không báo PASS trước khi admin và health gate thành công. Chạy lại `gitea-enable` chỉ xác minh, không đổi mật khẩu hoặc tạo lại owner. Nếu TUI bị ngắt sau khi admin được ghi nhưng trước khi kịp lưu mật khẩu, dùng CLI `gitea admin user change-password` tại container để khôi phục tài khoản; không xóa database hoặc chạy lại installer với storage trống.

## Storage và route

- Image rootless 1.27.3 pin digest multiarch trong `deploy/images.json`, UID/GID 1000 nội bộ container, không cần user Gitea trên host.
- `gen-hub-<installation_id>-gitea-data` → `/var/lib/gitea`: SQLite, git repositories, LFS, attachments và dữ liệu app.
- `gen-hub-<installation_id>-gitea-config` → `/etc/gitea`: app.ini và khóa Gitea. Hai volume mang nhãn installation, không dùng volume Hub, không mount master.key, update.env hoặc Docker socket.
- Caddy dành riêng `/gitea/*`, bỏ prefix trước khi proxy và giữ HTTPS trong header. `/gitea` redirect 308 tới `/gitea/`; các route Hub tiếp tục đến Hub. VPS và tunnel dùng cùng hostname, không thêm DNS/tunnel hay cổng host cho Gitea.
- SSH, Actions và package registry chưa mở; dùng Git HTTPS. Registry cần route `/v2` riêng nên nằm ngoài scope. Tắt đăng ký công khai; yêu cầu đăng nhập để xem nội dung.

Cấu hình theo tài liệu chính thức [Docker rootless](https://docs.gitea.com/installation/install-with-docker-rootless/) và [Caddy/subpath](https://docs.gitea.com/administration/reverse-proxies/). SSO/OIDC, Kanban adapter, CI runner/deploy và di chuyển Brain ở các PR sau.

## Các lệnh vòng đời

| Lệnh | Hành vi Gitea |
| --- | --- |
| `status` | URL, bootstrap còn thiếu/đã xong, trạng thái container/health |
| `doctor` | Volume đúng installation, app.ini/SQLite tồn tại, dung lượng, database/cache health nội bộ và qua HTTPS, admin đã bootstrap |
| `doctor --fix` | Giữ dữ liệu và image đã pin, dựng lại config/container; dừng nếu mất volume hoặc chưa bootstrap |
| `backup <file>` | Tạm dừng Gitea, archive cả hai volume, kiểm SQLite integrity, snapshot Hub và config, khởi động lại Gitea cả khi backup lỗi |
| `update` | Backup trước đổi runtime; giữ nguyên image Gitea đang cài độc lập với revision Hub |
| `rollback` | Backup trước quay runtime; chỉ cho phép cùng image/volume Gitea, từ chối quay về release chưa có Gitea hoặc có image/storage khác |
| `restart` | Khởi động lại tất cả service, đợi healthy và kiểm bootstrap; có gián đoạn Git/HTTP |
| `uninstall` | Dừng container/network và updater; giữ cả hai named volume cùng backup |
| `uninstall --purge` | Xác nhận domain, kiểm nhãn trước khi xóa đúng volume Gitea; giữ volume ứng dụng khác, Docker và backup lưu ngoài installation |

Không có lệnh nâng phiên bản/schema Gitea trong PR này. Image Gitea thay đổi cần một quy trình migration riêng có backup/restore được kiểm thử; không tự hạ binary trên database đã nâng cấp. Rollback về bản Hub trước khi tích hợp Gitea bị chặn vì CLI cũ không quản lý được storage mới.

## Backup và restore

Backup `.tar.gz` quyền 0600 chứa `data/hub.db`, `data/master.key`, `config/` và `gitea/volumes.tar`. Archive lồng chứa `var/lib/gitea/` và `etc/gitea/`, gồm SQLite/WAL nếu còn, git, LFS, attachments, config/keys. Phải giữ cả bundle; đây là dữ liệu nhạy cảm. Gitea ngừng ghi trong suốt snapshot. Không có giao dịch phân tán Hub/Gitea ở PR storage này và chưa có dữ liệu SSO liên kết.

Restore thủ công trên máy phục hồi riêng, từ backup đáng tin cậy:

1. Dừng runtime; giữ một bản sao dữ liệu hiện tại trước khi thay thế. Đọc `config/install.json` và `config/compose.json` trong backup để dùng đúng installation ID và đúng image digest.
2. Khôi phục cấu hình và dữ liệu Hub theo đường dẫn `/etc/gen-hub`, `/var/lib/gen-hub`; giữ nguyên master.key và quyền UID/GID của owner service. Khôi phục source release tương ứng tại `/opt/gen-hub/releases/<revision>`.
3. Tạo hai named volume trống qua Compose của backup (để giữ đúng tên/nhãn). Không giải nén chồng lên repo/database đang chạy. Giải nén `gitea/volumes.tar` vào các mount tương ứng bằng image Gitea đã pin, ví dụ với `docker compose --project-name gen-hub -f /etc/gen-hub/compose.json run --rm --no-deps -T --entrypoint tar gitea -C / -xf - < volumes.tar`.
4. Khởi động Compose với `--wait`, chạy `sudo gen-hub doctor`, đăng nhập cả Hub và Gitea, xác nhận repo/issue, clone qua HTTPS, LFS/attachments cần thiết rồi mới nhận ghi mới.

CI Docker thử tạo private repo + issue, giữ qua recreate, backup lạnh, xóa dữ liệu **trong volume kiểm thử**, restore archive, đọc lại README/issue và kiểm credential không xuất hiện trong log container. Không phục hồi hoặc purge production trong bài kiểm thử.
