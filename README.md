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

## Trợ lý quản trị cá nhân

Trong **Cài đặt → Trợ lý AI quản trị riêng**, nhập lại mật khẩu owner để tạo token. Sao chép token ngay; chỉ hiển thị một lần. Kết nối MCP client bằng `https://<domain>/mcp/admin` và header `Authorization: Bearer <token>`; không dùng OAuth cho endpoint này.

Token có quyền thao tác console (connector, agent, audit, cài đặt) và không tự hết hạn. Chỉ có một token hoạt động; bấm **Thu hồi token trợ lý** trong Cài đặt để chặn các lượt gọi mới, rồi tạo lại nếu cần. Token không dùng được tại `/mcp` hoặc web API. Đổi mật khẩu owner vẫn yêu cầu mật khẩu hiện tại; đăng nhập OAuth dịch vụ phải hoàn tất trong trình duyệt. Không có quyền shell, mã nguồn hoặc deploy. Nhật ký phân biệt trợ lý bằng actor `admin-assistant:<id>`.

Trong **Agent & quyền**, ID giúp phân biệt các client trùng tên. Owner có thể sửa tên, thu hồi rồi xóa agent khỏi danh sách; nhật ký liên quan được giữ theo thời gian lưu đã cấu hình.

## Danh sách và chi tiết theo tab

Agent, MCP/Connector và Vault dùng hai cột: chọn mục bên trái, xem/sửa theo tab bên phải. Màn hình nhỏ xếp danh sách trên chi tiết; có tìm kiếm theo tên hoặc ID. Cài đặt chia nhóm bên trái. Dashboard giữ nguyên; Audit giữ bảng và hộp thoại xem payload. Hộp thoại vẫn dùng cho tạo mục, credential, token, đọc giá trị secret và xác nhận thao tác.

- **Agent / Thông tin**: tên, ID, ngày tạo, mô tả tùy chọn (tối đa 2.000 ký tự) và instruction bootstrap riêng (tối đa 16.000 ký tự). `POST /api/agents`, `PATCH /api/agents/:id` và tool admin `agent_create`/`agent_update` nhận `description`, `instructions`. Agent đã có không cần migration. Khi chính agent đó gọi `/mcp` → `initialize`, Hub trả instruction riêng trong `instructions`; chuỗi trống/toàn khoảng trắng dùng câu mặc định “Chỉ sử dụng các công cụ được owner cấp quyền.”
- **Agent / Phân quyền**, **Connector / Tool**, **Vault / Quyền đọc** giữ cơ chế cấp quyền/công bố/chia sẻ hiện có. Connector có tab thông tin, nhật ký và thống kê; Vault có metadata ngày tạo/sửa và nhật ký đọc đúng secret.
- **Nhật ký và Thống kê của từng mục** lấy tối đa 5.000 bản ghi phù hợp, lọc ở backend trước giới hạn; chọn 24 giờ, 7/30/90 ngày và làm mới độc lập. Dữ liệu vẫn phụ thuộc thời hạn lưu audit. Khi chạm 5.000 bản ghi, UI hiển thị cảnh báo thiếu dữ liệu cũ hơn.
- Hai biểu đồ đếm lượt gọi theo tool/thời gian và cộng **byte JSON UTF-8 của input/output đã redact**, chia giờ hoặc ngày GMT+7. Tỷ lệ dùng tổng lượt trong từng cột, gồm thành công/lỗi/bị từ chối; loại thao tác owner/admin/Hub. Có bảng số liệu để đọc chính xác. Đây **không phải token LLM hay kích thước byte truyền trên mạng**. Vault chỉ ghi metadata lượt đọc; giá trị secret không nằm trong audit hoặc thống kê payload.

`GET /api/logs` và tool admin `audit_list` nhận bộ lọc tùy chọn `actor`, `mcp`, `tool`, `secret`, `since` (thời gian ISO 8601), `limit` (1–5.000). Các bộ lọc kết hợp bằng AND. `secret` chỉ trả `vault.read` có `input.id` tương ứng, kể cả lượt đọc bị từ chối/lỗi; không trả thao tác sửa/chia sẻ. Response vẫn là mảng audit đã redact, sắp xếp ID mới nhất trước. API tiếp tục yêu cầu phiên owner; tool admin yêu cầu token quản trị riêng.

## Kho bí mật (Vault)

1. Mở **Kho bí mật → Thêm secret**, nhập tên và giá trị (tối đa 64 KiB).
2. Mặc định **Riêng tư**. Có thể chọn từng agent hoặc chủ động chọn **Cấp cho tất cả agent đang hoạt động**. Lựa chọn “tất cả” chỉ áp dụng tại lúc lưu, không tự cấp cho agent tạo sau này.
3. Trong **Agent & quyền**, màn hình tạo token, duyệt OAuth và sửa quyền đều có checkbox cho từng secret. Agent chỉ thấy tool `vault__<secret-id>` đã được cấp và gọi với arguments `{}` để nhận giá trị. Không có quyền wildcard hay tool ghi Vault cho agent thường.
4. **Quản lý** cho phép đổi tên, thay giá trị, thay danh sách đọc, xem hoặc xóa. Lưu chia sẻ thay thế danh sách đọc của secret đó; quyền MCP và các secret khác giữ nguyên. Muốn xem giá trị phải bấm xác nhận; hộp thoại tự đóng sau 60 giây.

Vault dành cho secret độc lập mà owner **chủ động cho agent nhận giá trị thật**. Credential connector vẫn chỉ dùng bên trong Hub, không có đường đọc từ Vault. Mọi lượt đọc ghi actor/ID/thời gian/kết quả, không ghi giá trị; state và danh sách chỉ trả metadata. Giá trị dùng chung AES-256-GCM/master.key, tồn tại qua restart và nằm trong backup dữ liệu hiện có. Thu hồi quyền chặn lượt đọc mới, không xóa được bản sao mà agent đã nhận. Bản backup cũ vẫn có thể chứa giá trị cũ.

Trợ lý quản trị có các tool `vault_list`, `vault_create`, `vault_update`, `vault_read`, `vault_share`, `vault_remove`. Chúng dùng chung API quản trị; `vault_read` là thao tác đọc tường minh, không bị đưa tự động vào `hub_state` hay audit.

## PIN xác nhận thao tác xóa

Mở **Cài đặt → PIN xác nhận thao tác xóa**, nhập mật khẩu owner để đặt PIN riêng gồm 4–12 chữ số. Không có PIN mặc định; chỉ lưu hash scrypt. Quên PIN thì đặt lại tại cùng chỗ bằng mật khẩu owner.

Backend yêu cầu PIN cho cả web và `/mcp/admin` khi xóa connector, xóa agent đã thu hồi, xóa secret hoặc ngắt kết nối (xóa credential). Client quản trị phải gửi thêm `pin` cho `connector_remove`, `agent_remove`, `vault_remove`, `connector_disconnect`. Thiếu/sai PIN hoặc chưa đặt PIN thì không thay đổi dữ liệu. Sau 5 lần thử sai liên tiếp trong cửa sổ 15 phút, lượt thử tiếp theo bị chặn đến hết cửa sổ; giới hạn dùng chung giữa web, token và đối tượng. Bộ đếm nằm trong tiến trình, khởi động lại Hub sẽ đặt lại. PIN không được ghi vào audit.

Đặt/đổi PIN chỉ qua phiên web owner có CSRF và mật khẩu thật, không có tool admin tự đổi PIN. Đổi mật khẩu giữ bước xác nhận mật khẩu hiện tại. PIN là xác nhận bằng một bí mật dùng lại, không chứng minh owner vừa bấm duyệt mỗi lần: trợ lý đã biết PIN có thể dùng lại; không lưu PIN vào prompt hay Vault cấp cho trợ lý nếu muốn giữ bước nhập tay.

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

### Token kiểm tra cập nhật (tùy chọn)

Nếu GitHub báo giới hạn API theo IP, chạy `sudo gen-hub github-token` rồi nhập token GitHub riêng cho updater. Lệnh lưu `/etc/gen-hub/update.env` quyền 0600, tạo lại container Hub và kiểm tra kết nối; lỗi tạo lại sẽ khôi phục cấu hình/token trước đó. Chạy lại và để trống để gỡ. Token này dùng cho cả app và updater trên host, **không lấy token của connector GitHub**. Với repo public Gen-hub, chỉ cần token đọc API repo/Actions, không cần quyền ghi. Cấu hình token nằm trong backup cấu hình và bị xóa khi purge.

Khi bị rate limit, UI/CLI hiển thị thời điểm thử lại theo header GitHub. Nút kiểm tra ngay cũng chờ hết thời gian này; CLI lưu thời gian chờ qua các lần chạy. Sau thời điểm đó, app tự thử ở chu kỳ kiểm tra 30 phút tiếp theo hoặc khi owner bấm kiểm tra ngay; auto-update host thử ở chu kỳ timer mỗi giờ tiếp theo. HTTP 403 do quyền truy cập được báo riêng. Cache CI của app không được dùng làm giấy phép để updater root cài mã: updater vẫn tự kiểm tra đúng commit/main/push/CI, tránh tin dữ liệu mà tiến trình web có thể ghi.

## Kanban issue GitHub

Mở **Kanban → Cấu hình nguồn issue**, chọn connector GitHub REST hoặc GitHub MCP đã kết nối, nhập repo dạng `owner/repository` (gợi ý mặc định repo Gen-hub). Owner dùng quyền đọc issue của connector; không yêu cầu cấp tool đó cho một agent riêng và không tự thay quyền agent.

Bảng chỉ đọc, tự đồng bộ mỗi 2 phút khi trang đang mở; nút Đồng bộ dùng chung cache 2 phút. Các nhãn `Status: Backlog`, `Status: Ready`, `Status: In Progress`, `Status: Review`, `Status: Done` xác định cột; không phân biệt hoa/thường. Khi trùng nhiều nhãn, lấy cột tiến xa nhất; issue đã đóng luôn vào Done. Issue mở không có nhãn trạng thái vào Backlog, `agent:*` chỉ hiển thị người xử lý. Bấm thẻ để mở issue GitHub; không kéo thả/ghi ngược GitHub Projects.

Đọc tối đa 20 trang mỗi lần (100 bản ghi/trang), lọc pull request khỏi kết quả REST, báo rõ khi chạm giới hạn. Lỗi đồng bộ giữ bản dữ liệu đầy đủ gần nhất trong bộ nhớ và ghi rõ thời điểm/lỗi, không hiển thị dữ liệu một phần như đã đồng bộ xong. Cấu hình lưu qua restart; dữ liệu thẻ được tải lại. API `GET /api/kanban` và `PATCH /api/kanban` chỉ dành cho phiên owner; không thêm quyền quản trị cho agent thường. Adapter hiện tại dành cho GitHub; Gitea/runner đang ở [phương án #23](docs/GITEA_DESIGN.md), chưa triển khai.

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

`npm run test:ui` chạy cả luồng UI cơ bản và Issue #27 trên Chromium. Cài browser bằng `npx playwright-core install --with-deps chromium`, hoặc đặt `PLAYWRIGHT_CHROMIUM_PATH` tới Chrome/Chromium có sẵn. CI có job UI riêng trên Ubuntu 24.04. Đặt `UI_SCREENSHOT_DIR` nếu cần lưu ảnh desktop/mobile để review.

Các test sử dụng HTTP thật trên loopback cho MCP/đăng nhập/OAuth và server MCP kiểm soát trong test. Test installer dùng API/DNS giả lập để không thay đổi hạ tầng thật.

**Phạm vi xác minh và phần còn phải thử trên hạ tầng thật:** xem [STATUS.md](docs/STATUS.md). Không đồng nhất “test tự động đạt” với “mọi nhà cung cấp đã đăng nhập thành công bằng tài khoản thực”.
