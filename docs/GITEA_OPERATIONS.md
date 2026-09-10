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

## SSO OpenID Connect cho Owner và giới hạn bảo mật

Gen-hub tích hợp OpenID Connect (OIDC) Identity Provider tối giản, phục vụ đăng nhập SSO cho owner vào Gitea:

- **Endpoint IdP**: đặt tại prefix `/oidc/owner/`, bao gồm:
  - `/.well-known/openid-configuration`: metadata discovery cho OIDC.
  - `/jwks`: công bố RSA public key (RS256, 2048-bit, `kid` cố định theo cặp khóa).
  - `/authorize`: khởi tạo luồng xác thực mã (authorization code flow). Nếu owner đã có phiên Hub hợp lệ trong trình duyệt, tự động cấp mã một lần và chuyển hướng ngay về Gitea; nếu chưa đăng nhập, chuyển tới modal đăng nhập `/#gitea/<flow>` và phục hồi tiếp luồng sau khi xác thực thành công.
  - `/resume`: tiếp tục luồng authorization sau khi đăng nhập thành công trên Hub UI.
  - `/token`: trao đổi auth code một lần lấy ID Token ký RS256 và access token ngắn hạn. Hỗ trợ xác thực client bằng cả HTTP Basic Auth (`client_secret_basic`) và POST body (`client_secret_post`).
  - `/userinfo`: trả thông tin danh tính owner (`sub`, `preferred_username: genhub-owner`, `name`, `email`, `groups: ['genhub-owner']`).
  - `/logout`: RP-Initiated Logout (`end_session_endpoint`), cho phép owner đăng xuất cả phiên Hub khi đăng xuất khỏi Gitea.
- **Client và nguồn xác thực cố định**:
  - Client ID: `genhub-gitea`.
  - Nguồn xác thực trong Gitea: `genhub-owner`.
  - Không mở dynamic client registration; client secret và private key được sinh cục bộ bởi CLI quản trị và lưu mã hóa (sealed) trong cơ sở dữ liệu Hub.
- **Thời gian sống phiên (TTL 30 ngày)**:
  - Phiên đăng nhập của owner trên Hub và phiên web/cookie của Gitea (`GITEA__session__SESSION_LIFE_TIME`) đều được cấu hình là **30 ngày** (2.592.000 giây / 720 giờ).
- **Giới hạn bảo mật đã biết (Known Limitation)**:
  - Gitea 1.27.3 **không hỗ trợ** API back-channel logout hoặc cơ chế thu hồi web session từ xa qua IdP.
  - Khi owner đổi mật khẩu hoặc bị thu hồi quyền trên Hub, phiên web Gitea đang mở trên trình duyệt của owner **không bị hủy tức thời** từ phía IdP, mà tiếp tục có hiệu lực tối đa tới **30 ngày** kể từ lần đăng nhập gần nhất (hết TTL đã cấu hình).
  - Quyết định kiến trúc đã chốt: chấp nhận giới hạn phơi nhiễm theo thời gian này (time-bound exposure 30 ngày) thay vì can thiệp trực tiếp/hack vào session store nội bộ của Gitea (dễ vỡ khi Gitea nâng cấp phiên bản).
  - Khi owner chủ động nhấn đăng xuất (SignOut) trên giao diện Gitea, Gitea chuyển hướng tới `end_session_endpoint` (`/oidc/owner/logout`), cho phép owner xác nhận đăng xuất cả phiên Hub.
- **Cách ly tài khoản & ranh giới an toàn**:
  - Gitea giữ cấu hình `DISABLE_REGISTRATION = true`.
  - Cấu hình `[oauth2_client]` bật `ENABLE_AUTO_REGISTRATION = true`, `ACCOUNT_LINKING = disabled`, `USERNAME = preferred_username` để tài khoản `genhub-owner` được tạo tự động khi đăng nhập SSO lần đầu, không bao giờ liên kết nhầm vào tài khoản kỹ thuật `genhub-admin`.
  - Mật khẩu owner không bao giờ chuyển sang Gitea; ID token và userinfo chỉ chứa định danh và email sso nội bộ.
  - Token `/mcp` của agent và cờ `isAdmin` không bao giờ được dùng để đăng nhập Gitea.
- **Đường khôi phục SSO (Recovery Route)**:
  - Chạy `sudo gen-hub gitea-enable` trên host để đồng bộ/tái cấp nguồn xác thực SSO `genhub-owner` trong Gitea nếu khóa bị hỏng, đổi domain hoặc database bị khôi phục từ bản lưu cũ.
  - Lệnh CLI nội bộ `node server/admin.mjs gitea-oidc [--rotate]` cho phép xem hoặc xoay vòng khóa ký OIDC khi cần.
