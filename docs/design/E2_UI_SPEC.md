# E2 — Gen Hub Vietnamese UI Shell / Prototype v2 Implementation Spec

> Tài liệu này là bản chuyển chính thức của prototype HTML v2 đã được người dùng chốt trong phiên thiết kế. Khi triển khai E2, UI thật phải bám tài liệu này và `README.md`; không tự đổi hướng thiết kế.

## 1. Phạm vi E2

E2 chỉ triển khai **frontend shell + dashboard + các bề mặt quản trị chính** trên nền SvelteKit/Tailwind hiện hữu của Obot.

- Không rewrite backend.
- Không triển khai installer/TUI domain (thuộc E1).
- Không tự mở rộng sang logic Composite MCP mới (E3), agent approval backend mới (E4), vault backend mới (E5) hoặc audit backend mới (E6).
- Ưu tiên tái sử dụng API/store/component và route upstream đang có.
- Không hardcode dữ liệu giả nhạy cảm vào production UI. Nếu backend capability chưa có, dùng empty state / unavailable state rõ ràng, không giả vờ mutation thành công.

## 2. Visual contract từ prototype v2

Desktop shell:

- Sidebar trái cố định khoảng `250px`, nền tối gần `#111827`.
- Brand: `Gen Hub` + subtitle `Personal MCP Gateway`.
- Main background gần `#f5f7fb`.
- Topbar cao khoảng `72px`, nền trắng, sticky.
- Primary accent: indigo gần `#4f46e5`.
- Card trắng, border nhẹ `#e5e9f0`, radius khoảng `16px`, shadow rất nhẹ.
- Typography gọn, rõ; tiếng Việt là chính; giữ tên kỹ thuật tiếng Anh như MCP, OAuth, JSON, Request ID.
- Responsive: dưới tablet/sidebar chuyển thành drawer/menu; card grid từ 4 → 2 → 1 cột tùy viewport.

Không cần copy CSS từng pixel nếu component system upstream cần điều chỉnh, nhưng **hierarchy, density, spacing, màu chủ đạo và cảm giác tổng thể phải tương đương prototype**.

## 3. Navigation chính

Sidebar theo đúng thứ tự:

1. `Tổng quan`
2. `Kho MCP`
3. `Agent kết nối`
4. `Két bảo mật`
5. `Audit / Activity`
6. `Domain & Endpoint`

Ẩn các surface upstream không phục vụ user flow chính khỏi navigation Gen Hub; không xóa engine/route upstream nếu còn cần cho compatibility.

## 4. Tổng quan / Dashboard

Dashboard gồm:

### 4.1 Stat cards

Bốn card đầu trang:

- `MCP đang bật`
- `Agent kết nối`
- `Tool đang cấp`
- `Tool calls hôm nay`

Dùng dữ liệu thật từ upstream API/store khi có. Nếu một metric chưa có nguồn thật trong E2, hiển thị `—`/empty state thay vì số giả.

### 4.2 Composite MCP Gateway card

- Heading: `Composite MCP Gateway`.
- Mô tả: agent kết nối một endpoint; Hub quyết định MCP/tool được expose.
- Hiển thị endpoint theo runtime/current origin khi có thể; mục tiêu contract là `https://<public-domain>/mcp`.
- Có nút `Copy`.
- Không hardcode domain thật trong source.

### 4.3 Pending agent card

- Khu vực `Yêu cầu kết nối mới`.
- Nếu upstream đã có dữ liệu pending/agent auth tương ứng thì hiển thị thật.
- Nếu E4 chưa có backend tương ứng, hiển thị empty state giải thích capability sẽ được kích hoạt ở E4; không tạo mock agent cố định.

### 4.4 MCP đang hoạt động

- Card grid MCP.
- Mỗi card: icon/name/description, trạng thái, số tool được cấp/tổng tool, action `Quản lý tool`, auth method khi biết.
- Dữ liệu lấy từ MCP catalog/server store thật.

## 5. Kho MCP

Trang catalog tối giản theo prototype:

- Grid card 3 cột desktop, 2 tablet, 1 mobile.
- Mỗi MCP có: name, description, on/off status, enabled-tool count, `Quản lý tool`, trạng thái xác thực.
- Không thay thế registry/backend upstream; đây là lớp UI Gen Hub lên capability hiện hữu.

## 6. MCP / Tool detail

Đây là surface bắt buộc về mặt UI trong E2 vì prototype đã chốt, dù policy backend hoàn chỉnh thuộc E3.

Layout desktop: summary trái khoảng `320px`, danh sách tool bên phải.

### Summary

- Tên MCP + mô tả.
- `Trạng thái MCP`.
- `Tool khả dụng`.
- `Tool được cấp`.
- `Xác thực`.
- Notice: tool bị tắt ở Composite layer thì agent không được thấy tool đó.

### Tool list

- Search tool.
- Action `Bật tất cả` / `Tắt tất cả` chỉ hoạt động nếu native API hiện hữu hỗ trợ đúng semantics; nếu chưa thì disable rõ ràng.
- Mỗi row gồm:
  - exact tool/function name dạng monospace;
  - description;
  - classification: `Read`, `Write`, `Dangerous`, `Execute` khi xác định được;
  - toggle/policy state.
- Dangerous capability phải có visual warning và mặc định OFF khi policy backend được nối ở E3/E4.

## 7. Agent kết nối

Trang table/list:

- Agent name / client / device context khi có.
- State: pending / connected / revoked hoặc mapping gần nhất từ upstream.
- Quyền hiện tại: số tool / số MCP hoặc `Full Composite` khi thực sự có dữ liệu.
- Last activity.
- Action `Quyền` / `Cấp quyền`.

Detail quyền agent:

- Liệt kê từng MCP.
- Trạng thái MCP.
- `x/y tool` được phép.
- Đi sâu tới từng tool.

E2 chỉ dựng surface và tận dụng native auth scopes/access policy nếu mapping phù hợp; không phát minh backend grant model mới ngoài roadmap.

## 8. Két bảo mật

- Tên surface: `Két bảo mật`.
- Hiển thị credential/provider integrations từ native credential/auth surfaces khi có.
- Secret luôn masked; **không có nút reveal plaintext** trong E2.
- Không log secret.
- Actions chỉ gọi native API có sẵn; không mock sửa/xóa thành công.

## 9. Audit / Activity

Surface phải chi tiết theo prototype v2, không chỉ là bảng tóm tắt.

### List/filter

Filter tối thiểu ở UI:

- agent;
- MCP;
- status;
- thời gian;
- search request ID/tool/text nếu native data hỗ trợ.

Table/list columns mục tiêu:

- thời gian;
- agent/client;
- MCP + exact tool;
- status;
- latency.

### Request Inspector

Khi chọn một log, panel phải hiển thị tối đa dữ liệu native có sẵn:

- Request ID;
- Agent;
- Client;
- Timestamp;
- MCP;
- exact Tool;
- protocol method;
- HTTP/status code nếu có;
- latency;
- payload size nếu có;
- **INPUT / tool arguments** dạng JSON/preformatted;
- **OUTPUT / tool result** dạng JSON/preformatted;
- **ERROR / POLICY DECISION** nếu request bị chặn/lỗi;
- usage/token/cost nếu nguồn có cung cấp.

Có nút copy JSON khi dữ liệu tồn tại. Không làm lộ credential/source token trong inspector.

Nếu native audit API upstream không trả full input/output ở E2 thì UI hiển thị field nào có thật và empty state cho field thiếu; backend enrichment thuộc E6.

## 10. Domain & Endpoint

Domain **không phải form chỉnh domain hàng ngày**.

Trang chỉ hiển thị runtime status:

- Public domain/current host.
- DNS status nếu backend/runtime có dữ liệu; nếu chưa có thì `Chưa có dữ liệu runtime`.
- HTTPS status dựa trên current origin khi có thể.
- MCP endpoint `/mcp`.
- OAuth callback path khi có contract thật.
- Nút copy endpoint.

Có notice rõ: domain gốc được cấu hình trong **TUI/first-run E1**. Không đặt input đổi domain trong dashboard.

Có thể giữ card minh họa flow first-run:

`public domain → DNS check → HTTPS → admin account → start Hub`

nhưng không tạo fake installer trong E2.

## 11. Route/component strategy

- Giữ SvelteKit 5 + TypeScript + Tailwind 4 hiện hữu.
- Ưu tiên dùng `$lib/components/Layout.svelte`, service/store upstream và route hiện hữu.
- Có thể thêm Gen Hub-specific reusable components dưới `$lib/components/gen-hub/` để giảm diff vào upstream core.
- Dashboard owner/admin hiện đi tới `/admin/dashboard`; đây là điểm vào chính cần chuyển sang Gen Hub visual shell.
- MCP nên map vào `mcp-catalog` / `mcp-servers` capability thật.
- Agents nên tận dụng `admin/agents`, `agent-auth-scopes`, `mcp-access-policies` khi semantics phù hợp.
- Audit tận dụng `admin/audit-logs` / native audit services.
- Vault tận dụng native API keys/auth/credential surfaces; nếu cần một aggregate route Gen Hub thì chỉ tạo frontend orchestration.
- Domain page có thể là route mới vì prototype yêu cầu một surface riêng.

## 12. Data & security discipline

- Không commit secret/token/password thật.
- Không dùng ví dụ token trông giống secret thật trong production component.
- Không hardcode số liệu dashboard giả.
- Không hardcode fake agent/log làm dữ liệu mặc định.
- Demo/test fixture chỉ nằm trong test/story/mock scope rõ ràng.
- UI không được phá native authorization checks của upstream.

## 13. Acceptance E2

PASS khi:

1. Branding và nav Gen Hub theo prototype v2.
2. Các surface chính tồn tại và điều hướng được: Dashboard, MCP, MCP Tools, Agents, Vault, Audit, Domain.
3. UI tiếng Việt là chính.
4. Desktop/mobile responsive hợp lý.
5. Audit inspector có cấu trúc chi tiết input/output/error như spec, dùng dữ liệu thật có sẵn.
6. Domain page read-only, không có form đổi domain.
7. MCP tool detail có quản lý/tool-policy surface và dangerous visual classification; không fake mutation nếu API chưa sẵn sàng.
8. Không có secret/fake production data mới trong source.
9. `cd ui/user && pnpm run check` PASS.
10. `cd ui/user && pnpm run lint` PASS hoặc chỉ còn lỗi upstream baseline được chứng minh không do diff E2.
11. `cd ui/user && pnpm run build` PASS.
12. README SSOT được cập nhật: E0 = Done; E2 = In Progress trong branch và E2 = Done chỉ sau review/merge.

## 14. Không được tự làm trong E2

- Không deploy production.
- Không làm E1 installer/TUI.
- Không đổi protocol MCP endpoint backend.
- Không tạo hệ permission backend mới nếu native capability chưa đáp ứng.
- Không làm database migration cho audit/vault trừ khi người dùng mở scope mới.
- Không rewrite toàn bộ Obot UI; chỉ xây Gen Hub shell và những surface cần thiết, giữ khả năng sync upstream.