# Trạng thái triển khai và Ma trận Năng lực (Capability Matrix)

Cập nhật ngày 12/09/2026 · Phiên bản: `v0.1.0` (Refs #23, #75, #82)

Tài liệu này là nguồn sự thật duy nhất (SSOT) về trạng thái thực tế của các tính năng đã được triển khai, kiểm chứng và các giới hạn đã biết trong Gen-hub.

---

## 1. Ma trận Năng lực Hệ thống (Capability Matrix)

| Tính năng / Hạng mục | Trạng thái | Phạm vi & Mô tả kỹ thuật | Bằng chứng & PR / Revision tham chiếu | Giới hạn đã biết (Known Limitations) |
|---|---|---|---|---|
| **Gitea Storage & Lifecycle** | `implemented`<br>`configured`<br>`verified-live` | Tích hợp Gitea rootless 1.27.3 bắt buộc lúc cài (TUI luôn bootstrap cùng owner, không hỏi bật/tắt); Caddy reverse proxy route `/gitea/`; 2 named volumes độc lập `gen-hub-<id>-gitea-data` & `config`; các lệnh vòng đời `status`, `doctor`, `backup`, `rollback`, `gitea-enable`. Sau khi cài, owner có thể chủ động tắt qua `gitea-disable [--purge]` nếu quyết định không dùng — dữ liệu giữ nguyên trừ khi purge. | PR #56, #57, #87, #88, #89<br>Commit `69a7a12`<br>[GITEA_OPERATIONS.md](GITEA_OPERATIONS.md) | Dùng Git HTTPS; SSH, Actions và package registry chưa mở trong bản hiện tại. `gitea-disable` chỉ gỡ container/route của installation này, không đổi mặc định "bắt buộc" cho bản cài mới. |
| **Gitea MCP Connector (59 tool)** | `implemented`<br>`configured`<br>`verified-live` | Bọc đầy đủ REST API Gitea tự host (tệp, commits, nhánh, tags, PRs, reviews, issues, labels, milestones, releases, collaborators, search, orgs/teams, webhooks); bảo vệ SSRF qua kiểm soát `allowPrivate`; phân quyền per-agent và audit giống GitHub MCP. | PR #59, #60, #64<br>Commit `b5e79fa`, `733c999`<br>[CONNECTORS.md](CONNECTORS.md) | Yêu cầu PAT do owner cấp trên Gitea; tool mới đồng bộ mặc định `published: false` chờ owner duyệt. |
| **Owner OIDC / SSO IdP** | `implemented`<br>`configured`<br>`verified-live`<br>`limitation` | IdP OpenID Connect tối giản (`server/owner-oidc.mjs`): discovery, JWKS RS256 2048-bit, authorization code PKCE, token exchange, userinfo, RP-Initiated logout. Tự động tạo và liên kết tài khoản `genhub-owner`. | PR #61<br>Commit `c07a99f`<br>`tests/owner_oidc.test.mjs` | Phiên Gitea web có TTL 30 ngày; đổi mật khẩu Hub không hủy tức thời phiên Gitea trên trình duyệt (giới hạn kiến trúc đã chấp nhận). |
| **Bảng Kanban đa nguồn (Multi-repo)** | `implemented`<br>`configured`<br>`verified-live` | Dịch vụ Kanban (`server/kanban.mjs`) tích hợp adapter cho GitHub REST, GitHub MCP và Gitea multi-repo; chuẩn hóa trạng thái 4 cột (Backlog, Todo, Doing, Done); tự động loại bỏ PRs; lọc theo repo và agent. | PR #52, #54, #65<br>Commit `d4c8ca1`, `9bc805a`<br>`tests/kanban_archive.test.mjs` | Phụ thuộc rate-limit của upstream provider; hiện chỉ hỗ trợ các repository có quyền truy cập qua connector đã kết nối. |
| **Kanban Lưu trữ (Archive)** | `implemented`<br>`configured`<br>`verified-live` | Nút lưu trữ thủ công toàn bộ cột Done trên giao diện; cơ chế tự động chuyển lưu trữ mọi issue ở cột Done liên tục > 24 giờ; issue lưu trữ bị ẩn khỏi board nhưng bảo tồn trong config. | PR #66<br>Commit `41eec1c`<br>`tests/kanban_archive.test.mjs`<br>`tests/ui_kanban_archive_test.mjs` | Thời gian 24h tính từ lần đầu Hub quan sát thấy issue ở cột Done (không phụ thuộc thời điểm đóng issue từ upstream). |
| **Nhật ký Audit: Query & Cursor Server-side** | `implemented`<br>`configured`<br>`verified-live` | Truy vấn nhật ký server-side với bộ lọc thời gian, actor, mcp, status, tool, text search (`q`); phân trang con trỏ (cursor pagination) giảm dần theo ID; lazy-load payload giải mã theo ID (`/api/logs/:id`). | Gói B (PR #67, #63)<br>Commit `090303b`, `e8c9cd0`<br>`tests/audit_query.test.mjs` | Truy vấn trực tiếp trên bảng SQLite có chỉ mục; chưa có bảng tổng hợp chuyên biệt (O9). |
| **Xuất nhật ký (Audit Export O8)** | `implemented`<br>`configured`<br>`verified-live` | Xuất toàn bộ nhật ký theo đúng bộ lọc server-side (không lọc ở client); hỗ trợ 2 định dạng: JSONL (đầy đủ payload) và CSV (7 cột metadata); cơ chế chống formula injection (`'`, `=`, `+`, `-`, `@`, tab, CR); kèm manifest đối chiếu; hard limit 50.000 dòng có cảnh báo rõ. | Gói O8 (PR #70)<br>Commit `69082bd`<br>`server/export-audit.mjs`<br>`tests/audit_export.test.mjs` | Dữ liệu vượt quá 50.000 bản ghi sẽ được cắt kèm cờ `truncated: true` và cảnh báo để owner thu hẹp bộ lọc. |
| **Khung chat Trợ lý Dockable & Resizable Rail** | `implemented`<br>`configured`<br>`verified-live` | Khung chat gắn cố định cạnh phải (right-hand rail) có thể kéo chỉnh độ rộng (300px - 700px) hoặc thu gọn; cấu hình BYOC LLM (Gemini, OpenAI, Anthropic, Custom); visual guidance dẫn hướng trực quan trên UI. | PR #60, #62, #68<br>Commit `bf6ae11`, `a9b4633`<br>`tests/ui_chat_dock_test.mjs` | Phụ thuộc vào API key LLM do owner tự cấu hình; không có quyền tự động gọi tool thay thế agent nếu chưa được cấp phép. |
| **Trợ lý quản trị cá nhân (`/mcp/admin`)** | `implemented`<br>`configured`<br>`verified-live` | Dispatcher riêng `/mcp/admin` dành riêng cho agent có cờ boolean `isAdmin: true` được cấp qua OAuth consent có mật khẩu step-up; tách biệt hoàn toàn khỏi `/mcp` thường; bảo vệ thao tác phá hủy bằng destructive PIN. | PR #15, #21, #25<br>Commit `8a56b59`<br>`tests/destructive_pin.test.mjs` | PIN scrypt, giới hạn rate budget 5 lần sai trong 15 phút. |
| **Kho bí mật (Vault)** | `implemented`<br>`configured`<br>`verified-live` | Lưu trữ secret mã hóa AES-256-GCM qua `master.key`; cấp quyền đọc per-agent `vault:<id>`; trường ghi chú (`notes`) tối đa 2.000 ký tự; đọc secret được audit vết nhưng giá trị không bao giờ lọt vào log. | PR #22, #33<br>`tests/vault.test.mjs`<br>`tests/ui_secret_notes_test.mjs` | Cấp quyền chia sẻ chỉ ghi nhận snapshot agent active tại thời điểm lưu, không tự cấp cho agent tương lai. |
| **Chuẩn hóa ID (`type-NNNNN`) & Migration** | `implemented`<br>`configured`<br>`verified-live` | Định dạng ID chuẩn 5 chữ số có dấu gạch ngang (`agent-NNNNN`, `vault-NNNNN`, `mcp-NNNNN`, `client-NNNNN`, `flow-NNNNN`, `admin-NNNNN`); công cụ CLI `gen-hub migrate-ids` chuyển đổi an toàn nguyên tử trong transaction. | PR #40, #50, #55<br>Commit `8a56b59`<br>`server/migrate-ids.mjs`<br>`tests/migrate_ids.test.mjs` | ID 5 chữ số chỉ dùng cho khóa thực thể hiển thị, không dùng cho token truy cập bearer. |
| **Thăm dò quyền Tool & Scopes động** | `implemented`<br>`configured`<br>`verified-live` | Phân trang đồng bộ tool upstream không giới hạn (tối đa 10.000 tools); tự động đối chiếu header `X-OAuth-Scopes` (GitHub, Slack) hoặc OAuth scope (Drive); hiển thị badge Khả dụng / Thiếu quyền / Không xác định. | PR #32, #47<br>Commit `e2d049c`<br>`tests/connector_permissions.test.mjs` | Các dịch vụ bên thứ ba không hỗ trợ introspect scope qua header (Discord, Figma, Remote MCP) hiển thị trạng thái "Không xác định". |
| **Thống kê Tổng quan: Agent Pie & Tồn kho Tool** | `implemented`<br>`configured`<br>`verified-live` | 4 đồ thị tròn 12h: MCP theo lượt gọi, Tool theo lượt gọi, MCP theo dung lượng, Lượt gọi theo Agent (lọc bằng `isToolCall`, loại bỏ owner/system/admin/hub); Bảng Tồn kho công cụ toàn thời gian liệt kê mọi tool đã công bố, sắp xếp theo lượt gọi tăng dần. | Issue #75, PR #81<br>Commit `e17c0df`<br>`tests/overview_inventory.test.mjs`<br>`tests/ui_overview_inventory_test.mjs` | 4 biểu đồ tròn chỉ tính toán trong phạm vi cửa sổ 12 giờ gần nhất của audit log. |
| **Tự cập nhật & Quản lý vòng đời (Lifecycle)** | `implemented`<br>`configured`<br>`verified-live` | Cập nhật tự động qua systemd timer dựa trên commit SHA `main` có CI xanh; backup nhất quán trước nâng cấp/rollback; doctor tự chẩn đoán và sửa lỗi an toàn; rollback giữ nguyên dữ liệu. | PR #34<br>`scripts/lifecycle.py`<br>`tests/update.test.mjs` | Rollback chỉ hỗ trợ khi cấu trúc schema database tương thích (schema v1). |

---

## 2. Mốc kiểm chứng lịch sử (Historical Milestones)

> [!NOTE]
> Các mục dưới đây ghi lại kết quả kiểm chứng tại các mốc phát triển trước đó:

### Mốc khởi tạo (2026-09-09)
- **Kiểm thử độc lập ban đầu (Issue #3)**: 6 test Node, 18 test Python, Playwright headless sau PR #2 xác nhận: Owner bootstrap/login, CSRF, 5 màn hình chính, thêm MCP tùy chỉnh và từ chối lưu token HTTP thường.
- **Nghiệm thu trên máy ảo VM sạch (Issue #11)**: Chạy `install.sh` trên Ubuntu 24.04 sạch qua Cloudflare Tunnel + domain thật. Docker Engine 29.8.0 cài tự động, 3 container healthy, HTTPS hoạt động, owner tạo thành công.
- **Nghiệm thu OAuth Agent thật (Issue #12)**: Luồng agent kết nối qua OAuth PKCE + gọi tool `/mcp` bằng curl thật; thu hồi quyền chặn token tức thì; audit log ghi chính xác latency.

### Mốc hoàn thiện Gitea & Kiểm toán (2026-09-10 ~ 2026-09-12)
- **Gitea Suite (Issue #23)**: Hoàn thành 5 PR liên tiếp: Gitea bootstrap (#56/#57), Gitea MCP (#59/#60), Owner OIDC SSO (#61), Kanban Gitea (#65), Kanban Archive (#66).
- **Kiểm toán độc lập (/tmp/genhub-audit-report.md)**: Xử lý các khuyến nghị cốt lõi: Gói B (Query logs cursor server-side, PR #67), Gói O8 (Export CSV/JSONL phân trang đầy đủ có manifest, PR #70), Thống kê Agent & Tồn kho công cụ (Issue #75, PR #81), Đối chiếu tài liệu thiết kế C7 (Issue #82).

---

## 3. Quy ước và Bất biến vận hành

1. **Repo GitHub này là SSOT**: Mọi thay đổi kiến trúc và trạng thái phải được phản ánh vào repo trước khi triển khai.
2. **ID Thực thể**: Sử dụng dấu gạch ngang chuẩn `type-NNNNN` (ví dụ `agent-12345`, `vault-67890`), không dùng dấu gạch dưới `_`.
3. **SSO Session Boundary**: Phiên OIDC SSO vào Gitea có hiệu lực tối đa 30 ngày tại trình duyệt; đổi mật khẩu Hub không tự động hủy phiên Gitea đang mở từ xa.
4. **Bảo vệ Secret**: Giá trị secret trong Vault và upstream token không bao giờ xuất hiện trong audit log hoặc các file export.
