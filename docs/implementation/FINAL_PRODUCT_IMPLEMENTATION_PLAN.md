# Gen Hub — Đối chiếu thực tế và kế hoạch triển khai v1

## 1. Mục đích

Tài liệu này đối chiếu code hiện có với [`FINAL_PRODUCT_SPEC.md`](FINAL_PRODUCT_SPEC.md) và chia phần còn thiếu thành các Pull Request nhỏ, có thứ tự phụ thuộc rõ ràng. Đây là kế hoạch triển khai; spec vẫn là nguồn chuẩn cho hành vi sản phẩm cuối.

Mốc kiểm tra:

- ngày kiểm tra: `2026-09-04`;
- branch đang mở: `feat/e3-composite-global-tool-policy`;
- commit branch: `82096b1aa`;
- `main` của fork: `d533127c9`;
- upstream đã kiểm tra: `obot-platform/obot@9b0a7ad94`;
- PR đang mở: fork PR `#6` cho E3.

## 2. Kết luận ngắn

Gen Hub hiện là một fork Obot có giao diện định hướng đúng và có một số nền kỹ thuật tốt, nhưng chưa phải sản phẩm mà người dùng cuối có thể cài rồi sử dụng theo spec.

Trong 27 tiêu chí nghiệm thu:

- `0/27` có đủ bằng chứng nghiệm thu sản phẩm;
- `15/27` đã có một phần code hoặc capability native của Obot để tái sử dụng;
- `12/27` còn thiếu hành vi chính.

Nhãn `Done` cũ của E1 và E2 chỉ phản ánh việc code đã merge, không phản ánh tiêu chí sản phẩm mới. Vì vậy E1 và E2 phải chuyển về `Partial` cho tới khi có bằng chứng nghiệm thu.

PR E3 hiện tại chưa nên merge. Phần có thể giữ lại là ý tưởng route `/mcp`; phần chọn Composite, OAuth discovery, global tool policy, UI và test đều chưa đạt spec. PR description cũng đang mô tả policy engine đã bị xóa ở commit cuối.

## 3. Quy ước trạng thái

| Trạng thái | Ý nghĩa |
|---|---|
| `Đạt` | Hành vi đã tồn tại và có bằng chứng nghiệm thu đúng đường chạy sản phẩm. |
| `Một phần` | Có code liên quan nhưng luồng chưa hoàn chỉnh hoặc chưa được kiểm chứng. |
| `Native` | Obot đã có cơ chế có thể dùng lại, nhưng Gen Hub chưa nối nó vào luồng sản phẩm. |
| `Thiếu` | Chưa có hành vi chính cần thiết. |

Không tiêu chí nào được đổi sang `Đạt` chỉ vì unit test pass. Mỗi tiêu chí phải có bằng chứng đúng với đường chạy được mô tả trong spec.

## 4. Tình hình thực tế

### 4.1 Nền repo và CI

- Fork đang lệch upstream: `main` của fork có 5 commit riêng; upstream có thêm 7 commit từ điểm chung `3ef02524c` và thay đổi 317 file.
- Upstream mới sửa navigation và chạm `ui/user/src/lib/components/Layout.svelte`, đúng vùng Gen Hub đã custom.
- Fork PR `#6` đang `UNSTABLE` dù hai job test đã pass.
- Các job Go lint, UI lint/test và Docker build vẫn `QUEUED` vì dùng runner `depot-ubuntu-22.04` mà fork chưa có hạ tầng Depot.
- `main` chưa bật branch protection.
- Máy kiểm tra hiện không có Go; Node là `22.23.2` trong khi UI yêu cầu Node `>=24`. Vì vậy chưa thể dùng local run làm bằng chứng thay CI.

### 4.2 E1 — Cài đặt, domain và HTTPS

Code đã có:

- validation domain, DNS và TLS mode trong `pkg/domain/bootstrap.go`;
- CLI `domain-bootstrap` và script `scripts/bootstrap-domain.sh`;
- API đọc trạng thái domain;
- Compose có Caddy và volume bền vững.

Phần chưa đạt:

- production Compose vẫn dùng `build:` từ source;
- fork chưa có release hoặc deployment;
- bootstrap đánh dấu hoàn thành trước khi chứng minh service, HTTPS, tài khoản chủ sở hữu và Composite Hub đã sẵn sàng;
- lỗi ghi file dự phòng có thể bị bỏ qua;
- trang Domain chỉ suy ra domain từ trình duyệt, không đọc API trạng thái; các nút vẫn bị khóa và có copy “khi làm thật”;
- chưa có test trên VPS sạch, test chạy lại, test restart hoặc test HTTPS thật.

### 4.3 E2 — Giao diện sản phẩm

Shell, navigation và các trang chính đã tồn tại. Tuy nhiên:

- Dashboard tính số catalog entry thành “MCP đang bật” và gắn mọi entry là “Đang hoạt động”;
- Dashboard còn agent fixture;
- MCP Tools còn nhãn `Chưa có policy · E3`;
- Vault còn nút `Thêm credential (E5)` bị khóa;
- Domain còn nút E1 bị khóa;
- nhiều trang native quan trọng như Agent Identities và OAuth consent vẫn dùng tiếng Anh;
- chưa có browser test cho Dashboard, Domain, Vault và tool toggle của Gen Hub.

### 4.4 E3 — Composite và global tool policy

Obot native đã có:

- composite runtime;
- `ComponentServer.Disabled`;
- `ToolOverride.Enabled`;
- allowlist behavior: khi đã có override, tool không có override sẽ bị loại khỏi danh sách.

PR E3 hiện tại mới thêm route `/mcp` và chọn Composite cũ nhất của user. Cách này không tạo hoặc chỉ định một Composite Hub duy nhất và vẫn tự đoán khi có nhiều Composite.

Challenge chưa đăng nhập gọi `writeMCPAuthRequired` với `mcp_id` rỗng, tạo metadata URL không đúng contract `/mcp`. Test hiện chỉ kiểm tra không có Composite trả `503` và chọn Composite theo thời gian; chưa chạy `initialize`, `tools/list`, `tools/call`, lọc tool hoặc persistence thật.

Không có code materialize override khi thêm MCP, không có classifier an toàn/nguy hiểm ở backend và toggle trên trang tool chưa nối backend.

### 4.5 E4 — Agent và quyền riêng

Obot native có API key riêng, giới hạn theo MCP server, revoke và audit attribution. Đây là nền tốt cho credential Hub cấp.

Nhưng API key hiện:

- được chủ sở hữu tạo trực tiếp, không sinh từ lần kết nối Pending;
- không có trạng thái Pending, Approved, Rejected và Revoked của một agent identity;
- không có grant từng tool;
- chỉ giới hạn theo MCP server. Vì mọi agent Gen Hub đều đi qua cùng một Composite Hub, scope này không thể phân biệt tool của agent A và agent B.

`AccessControlRule` cũng chỉ có resource catalog/MCP server, không có resource tool. Vì vậy E4 cần một model quyền agent thật, không thể chỉ đổi UI của Agent Auth Scopes.

### 4.6 E5 — Vault và connector

Obot native đã có credential store, MCP OAuth token, static OAuth credential và cơ chế che giá trị trong list response. Credential có thể được mã hóa bằng encryption provider.

Khoảng trống:

- encryption provider mặc định là `none` và production Compose chưa bật mã hóa;
- Vault hiện chỉ tổng hợp trạng thái và link sang các trang native, chưa có flow thêm/xóa credential của Gen Hub;
- chưa có bảng kiểm chứng tám connector mục tiêu;
- chưa có test chứng minh xóa credential làm connector dừng hoạt động;
- chưa có test xuyên suốt chứng minh agent không nhận source credential.

### 4.7 E6 — Audit

Đây là phần gần mục tiêu nhất. Backend đã có record MCP, API key attribution, MCP/tool, status, latency, filter, inspector và export. Header `Authorization`, cookie và một số header nhạy cảm được che trước khi ghi.

Phần còn thiếu:

- chưa có agent lifecycle và per-tool policy để ghi đúng agent và lý do từ chối;
- lỗi JSON-RPC bị policy chặn có thể vẫn mang HTTP `200`, nên không được tự động phân loại thành `Denied`;
- audit của Composite chưa bảo đảm có cả Composite Hub và MCP nguồn;
- production chưa bắt buộc mã hóa audit payload;
- bộ lọc header của MCP chỉ dùng danh sách cố định, hẹp hơn bộ lọc header dùng cho LLM;
- chưa có test bảo đảm input/output và export không chứa secret từ Vault.

### 4.8 E7 — Release và vận hành

Repo chưa có Gen Hub release. Workflow release kế thừa upstream phụ thuộc runner Depot và nhiều secret/repo của Obot. Chưa có lệnh backup, restore, update hoặc test migration của Gen Hub.

## 5. Ma trận 27 tiêu chí

| ID | Hiện tại | Bằng chứng ngắn | Gói triển khai |
|---|---|---|---|
| `INSTALL-01` | Thiếu | Compose build source; chưa có Gen Hub release. | `G02`, `G11` |
| `INSTALL-02` | Một phần | Domain và DNS validation đã có; chưa chạy trong installer release thật. | `G03` |
| `INSTALL-03` | Một phần | Có Caddy và `/mcp`; chưa có owner, designated Composite và HTTPS proof. | `G03`, `G04` |
| `INSTALL-04` | Một phần | Compose và file config có thể chạy lại; chưa kiểm chứng owner/Composite không trùng. | `G03`, `G04` |
| `INSTALL-05` | Một phần | Có volume `/data`; chưa có restart acceptance test. | `G03` |
| `MCP-01` | Thiếu | Front door chọn Composite cũ nhất, không có marker bền vững. | `G04` |
| `MCP-02` | Native | Composite runtime có sẵn; chưa test hai nguồn qua `/mcp`. | `G04`, `G05` |
| `MCP-03` | Native | `ComponentServer.Disabled` có sẵn; chưa có Gen Hub control và proof. | `G05` |
| `MCP-04` | Native | Tool allowlist có sẵn; UI và direct-call denial chưa được chứng minh. | `G05` |
| `MCP-05` | Native | Policy nằm trong MCPServer persist; chưa có restart test. | `G05` |
| `MCP-06` | Thiếu | UI chỉ gắn heuristic label; backend không lưu default nguy hiểm. | `G05` |
| `MCP-07` | Native | Allowlist loại tool mới chưa có override, nhưng onboarding chưa luôn tạo override. | `G05` |
| `AGENT-01` | Thiếu | Không có connection request hoặc Pending state. | `G06` |
| `AGENT-02` | Thiếu | API key và AccessControlRule không có tool grant. | `G07` |
| `AGENT-03` | Thiếu | Không có API kiểm tra grant là tập con của global policy. | `G07` |
| `AGENT-04` | Native | API key revoke có hiệu lực; chưa gắn với agent lifecycle. | `G06`, `G07` |
| `AGENT-05` | Native | Key riêng và audit attribution đã có; chưa có agent model. | `G06`, `G09` |
| `VAULT-01` | Native | Credential/OAuth được giữ server-side; chưa có E2E qua `/mcp`. | `G08`, `G12` |
| `VAULT-02` | Một phần | List che secret và header có redaction; encryption production đang tắt. | `G08`, `G09` |
| `AUDIT-01` | Native | Record đã có nhiều field cần thiết; thiếu source mapping và agent model. | `G09` |
| `AUDIT-02` | Thiếu | Chưa có policy-denial event và lý do chuẩn. | `G07`, `G09` |
| `AUDIT-03` | Một phần | Filter/inspector đọc backend thật; chưa phủ field Gen Hub và redaction E2E. | `G09` |
| `UI-01` | Thiếu | UI còn tiếng Anh, fixture, placeholder và thiếu browser test. | `G10` |
| `UI-02` | Thiếu | Dashboard đang đếm catalog entry thay vì server ready. | `G05`, `G10` |
| `UI-03` | Thiếu | Toggle tool chưa tồn tại trên Gen Hub tool page. | `G05` |
| `OPS-01` | Thiếu | Chưa có backup/restore command hoặc restore drill. | `G11` |
| `OPS-02` | Thiếu | Chưa có update/migration preservation test. | `G11` |

## 6. Quyết định kiến trúc phải giữ

### 6.1 Chỉ định Composite Hub

Dùng một marker riêng trên native `MCPServer` composite, ví dụ label `genhub.io/front-door=true`. ID thật vẫn là ID của `MCPServer`.

- Bootstrap tạo một Composite có marker nếu chưa có.
- Resolver chỉ nhận Composite có marker.
- Không có marker hoặc có nhiều hơn một marker thì fail closed và báo lỗi cấu hình.
- Không chọn theo thời gian, thứ tự hoặc tên.
- Không tạo database policy riêng cho global publish state.

Quyết định này phải được ghi trong ADR trước khi triển khai `G04`.

### 6.2 Global publish policy

Nguồn dữ liệu duy nhất là native composite manifest:

- tắt MCP bằng `ComponentServer.Disabled`;
- bật/tắt tool bằng `ToolOverride.Enabled`;
- khi thêm nguồn, đọc danh sách tool thật rồi ghi override cho từng tool;
- khi refresh, tool mới không có trong snapshot cũ mặc định tắt;
- annotation MCP là nguồn phân loại đầu tiên; metadata catalog là nguồn thứ hai; tên/mô tả chỉ là fallback.

API projection hiện làm mất MCP tool annotations. `G05` phải giữ các hint cần thiết như read-only, destructive, idempotent và open-world từ SDK tới backend classifier và UI.

### 6.3 Agent identity tách khỏi credential

Không dùng một API key làm luôn agent record. Agent identity phải sống qua việc rotate hoặc revoke key.

Model tối thiểu cần có:

- agent ID bền vững;
- owner ID;
- tên hiển thị và client metadata;
- trạng thái `pending`, `approved`, `rejected`, `revoked`;
- danh sách grant theo MCP nguồn và original tool name;
- các credential ID do Hub cấp cho agent;
- thời điểm tạo, duyệt và thu hồi.

Có thể dùng API key native làm credential bearer, nhưng key phải tham chiếu agent ID. Luồng MCP OAuth hiện có được tái sử dụng để nhận client metadata và phát token; Gen Hub thêm bước chờ owner duyệt, không tạo một giao thức đăng nhập hoàn toàn riêng.

### 6.4 Enforcement tại một chỗ

Mọi request `/mcp` phải đi qua cùng một authorizer trước khi tới Composite runtime:

```text
agent hợp lệ
+ agent Approved
+ MCP nguồn bật toàn Hub
+ tool bật toàn Hub
+ grant của agent chứa tool
= được phép
```

Authorizer phải áp dụng cho cả `tools/list` và `tools/call`. `tools/call` không được tin rằng client chỉ gọi tool từng xuất hiện trong list.

Grant lưu theo MCP nguồn và original tool name để không phụ thuộc tên prefix/rename của Composite. Runtime tạo index từ tên được công bố về grant gốc.

### 6.5 Vault và mã hóa

Tái dùng credential store, MCP OAuth token và secret binding native. Production phải bật custom AES-GCM provider hoặc KMS; `none` chỉ được phép trong development có cảnh báo.

Installer tạo key ngẫu nhiên, lưu ngoài database với quyền hạn chế và đưa key vào quy trình backup riêng. Mất database hoặc mất encryption key đều làm restore không đầy đủ; lệnh backup phải kiểm tra cả hai.

### 6.6 Audit

Tái dùng bảng và presenter hiện tại. Bổ sung các field cần cho Gen Hub:

- agent ID và credential ID;
- designated Composite ID;
- MCP nguồn;
- policy decision và reason code;
- original tool name và exposed tool name khi khác nhau.

Denial phải được ghi trực tiếp với outcome `Denied`; không suy ra từ HTTP status. Dùng chung một hàm redaction header cho MCP và LLM. Payload đi qua redactor trước khi ghi và trước khi export; source credential đã inject không được đưa vào payload audit.

## 7. Thứ tự triển khai

```text
G00 tài liệu và reset trạng thái
  ↓
G01 đồng bộ upstream + sửa CI
  ↓
G02 release artifact + production stack
  ↓
G03 hoàn tất first-run E1
  ↓
G04 designated Composite + /mcp
  ↓
G05 global tool policy E3
  ↓
┌───────────────────────┐
│ G06 → G07 Agent (E4) │
│ G08 Vault (E5)       │
└──────────┬────────────┘
           ↓
G09 Audit E6
  ↓
G10 hoàn tất UI E2
  ↓
G11 vận hành + release candidate E7
  ↓
G12 final product E2E
```

`G06 → G07` và `G08` có thể làm song song sau khi `G05` merge. Các bước còn lại đi theo critical path trên.

## 8. Kế hoạch từng Pull Request

### G00 — Chốt spec, gap audit và trạng thái thật

Mục tiêu: đưa spec và plan vào `main`, không kèm code E3.

Thay đổi:

- thêm `FINAL_PRODUCT_SPEC.md` và tài liệu này;
- cập nhật README và execution SSOT;
- đổi E1/E2 thành `Partial`;
- ghi rõ PR `#6` chưa merge-ready và sẽ được supersede sau `G01`.

Gate:

- link nội bộ đúng;
- `git diff --check` pass;
- không có secret hoặc domain thật.

### G01 — Đồng bộ upstream và làm CI chạy thật

Mục tiêu: tạo nền build có thể tin cậy trước khi tiếp tục sản phẩm.

Thay đổi chính:

- sync upstream `9b0a7ad94` trên branch riêng;
- giải quyết conflict navigation theo Visual SSOT;
- chuyển các required PR jobs khỏi runner Depot không tồn tại trên fork hoặc thêm GitHub-hosted fallback;
- bỏ dependency vào secret/repository chỉ thuộc Obot khỏi release path của Gen Hub;
- chuẩn hóa Node `24.15.0` và Go theo `go.mod`;
- bật branch protection cho `main` sau khi tên job ổn định.

Vùng dự kiến:

- `.github/workflows/go.yml`;
- `.github/workflows/user-ui.yml`;
- `.github/workflows/test-docker-build.yml`;
- `.github/workflows/release.yml`;
- `ui/user/src/lib/components/Layout.svelte` và các file upstream conflict.

Gate:

- Go test/lint/build chạy và kết thúc;
- UI check/lint/test/build chạy và kết thúc;
- Docker image test build chạy và kết thúc;
- không còn required job treo `QUEUED` do thiếu runner.

### G02 — Artifact phát hành và production stack

Mục tiêu: người dùng cài artifact có version, không build source trên VPS.

Thay đổi chính:

- build và publish image `ghcr.io/genesis-ryan-84-0567536339/gen-hub:<version>` cho amd64/arm64;
- pin base image và provider image theo version hoặc digest;
- đổi production Compose từ `build:` sang `image:`;
- tách PostgreSQL thành service có version cố định và health check, nối app bằng `OBOT_SERVER_DSN`;
- thêm command wrapper `install`, `status`, `logs`, `restart`;
- sinh database password và encryption key ngẫu nhiên;
- bật `OBOT_SERVER_ENCRYPTION_PROVIDER=custom` cho production.

Vùng dự kiến:

- `Dockerfile`, `run.sh`;
- `deploy/docker-compose.prod.yaml`, `deploy/Caddyfile.template`;
- `scripts/gen-hub`, `scripts/install.sh`;
- workflow Docker/release và tài liệu cài đặt.

Gate:

- Compose config hợp lệ khi chỉ dùng file mẫu và secret được sinh;
- image smoke start với database mới;
- UI và health endpoint lên;
- VPS không cần Go, Node hoặc pnpm.

### G03 — Hoàn tất first-run E1

Mục tiêu: biến bootstrap hiện tại thành state machine phản ánh đúng tình trạng thật.

Thay đổi chính:

- trạng thái `Chưa cấu hình`, `DNS chưa sẵn sàng`, `Đang cấp HTTPS`, `Sẵn sàng`, `Lỗi`;
- chỉ ghi trạng thái base bootstrap hoàn tất sau khi database, app, HTTPS và owner setup đã sẵn sàng; trạng thái sản phẩm `Sẵn sàng` vẫn phải chờ designated Composite từ `G04`;
- mọi lỗi ghi config đều phải trả ra, không bỏ qua fallback error;
- dùng native owner/bootstrap flow của Obot và bảo đảm chỉ có một owner;
- trang Domain đọc `/api/domain/status`, bỏ các nút/copy placeholder;
- installer chạy lại an toàn;
- restart proof với database và config cũ.

Vùng dự kiến:

- `pkg/domain/`;
- `pkg/cli/domain_bootstrap.go`;
- `pkg/api/handlers/domain_bootstrap.go`;
- native setup integration;
- `ui/user/src/routes/domain/` và colocated browser spec;
- `scripts/gen-hub`.

Gate đóng: `INSTALL-02`, phần owner/domain/HTTPS/restart của `INSTALL-03` đến `INSTALL-05`. `INSTALL-01` được xác nhận bằng release ở `G11`; trạng thái `Sẵn sàng` và tính idempotent của Composite được xác nhận ở `G04`.

### G04 — Designated Composite Hub và public `/mcp`

Mục tiêu: có đúng một cổng Composite bền vững.

Thay đổi chính:

- ADR cho marker và lifecycle;
- controller/bootstrap tạo Composite Hub có marker;
- resolver yêu cầu đúng một marked Composite;
- bootstrap chỉ chuyển installation sang `Sẵn sàng` sau khi Composite đã tồn tại và health check pass;
- sửa protected-resource metadata và `WWW-Authenticate` để resource là `/mcp`;
- giữ transport/path cần thiết cho MCP client;
- lỗi cấu hình fail closed và có status cho Dashboard.

Vùng dự kiến:

- `adr/`;
- `pkg/storage/apis/obot.obot.ai/v1/mcpserver.go` hoặc hằng số metadata gần resource owner;
- controller MCP bootstrap/reconcile;
- `pkg/api/handlers/mcpgateway/frontdoor.go`;
- `pkg/api/handlers/wellknown/`;
- `pkg/api/router/router.go`.

Gate đóng: `MCP-01`, phần routing của `MCP-02`, phần Composite của `INSTALL-03` và `INSTALL-04`, cùng lỗi OAuth discovery của PR `#6`.

### G05 — Global tool policy và UI thật

Mục tiêu: source MCP và tool toggle dùng đúng native composite state.

Thay đổi chính:

- giữ MCP tool annotations trong API projection;
- classifier theo annotation → catalog metadata → heuristic;
- materialize mọi `ToolOverride` sau lần discovery đầu;
- tool nguy hiểm/không rõ mặc định tắt;
- tool mới sau refresh mặc định tắt;
- API cập nhật `ComponentServer.Disabled` và `ToolOverride.Enabled` trên designated Composite;
- tool page có toggle thật, optimistic UI phải rollback khi API lỗi;
- Dashboard đếm MCP enabled, configured và runtime ready thay vì đếm catalog entry.

Vùng dự kiến:

- `apiclient/types/mcpserver.go`;
- `pkg/mcp/tools.go` và classifier mới;
- MCP controller/action và API handler;
- `ui/user/src/lib/components/mcp/McpServerTools.svelte`;
- `ui/user/src/routes/admin/dashboard/`;
- colocated UI browser specs.

Gate đóng: `MCP-02` đến `MCP-07`, `UI-02`, `UI-03`.

### G06 — Agent request và lifecycle

Mục tiêu: agent mới tạo Pending request và chỉ nhận Hub credential sau khi duyệt.

Thay đổi chính:

- resource/table `AgentAccessProfile` và migration/generated types;
- nối MCP OAuth client/auth request với agent identity;
- create Pending idempotent theo client identity;
- owner approve/reject/revoke;
- phát credential Hub riêng sau approve; rotate key không đổi agent ID;
- revoke credential ngay và giữ record lịch sử;
- trang Agents tiếng Việt cho bốn trạng thái.

Gate đóng: `AGENT-01`, lifecycle của `AGENT-04`, nền identity của `AGENT-05`.

### G07 — Per-agent MCP/tool grants và enforcement

Mục tiêu: mỗi agent chỉ thấy và gọi đúng tool được cấp.

Thay đổi chính:

- grant theo source MCP + original tool name;
- validation không cho grant vượt global policy;
- dangerous tool mặc định tắt trong agent profile mới;
- authorizer chung cho `tools/list` và `tools/call`;
- cache nếu có phải có invalidation khi grant/global policy/revoke đổi;
- reason code chuẩn cho mọi denial;
- UI chỉnh grant theo MCP/tool.

Gate đóng: `AGENT-02` đến `AGENT-05`; tạo dữ liệu đầu vào cho `AUDIT-02`.

### G08 — Vault và tám connector mục tiêu

Mục tiêu: Vault là giao diện thật trên credential primitives của Obot.

Thay đổi chính:

- API chỉ trả field name, masked status, health và last-updated;
- flow OAuth/API key/token/password/secret field;
- xóa credential làm connector về `Cần xác thực` và không gọi được tool;
- bảng support thật cho GitHub, Google Drive, Web Search, PostgreSQL, Filesystem, Gmail, Google Calendar và Slack;
- connector chưa chạy thật hiển thị `Chưa hỗ trợ`;
- test database chứng minh credential được lưu encrypted khi production config bật.

Vùng dự kiến:

- `pkg/gateway/client/credential.go`, `mcpoauthtoken.go`;
- MCP catalog/config handlers;
- `ui/user/src/routes/vault/` và browser specs;
- production encryption config.

Gate đóng: code path của `VAULT-01`, `VAULT-02`; E2E được xác nhận ở `G12`.

### G09 — Audit Gen Hub

Mục tiêu: success, error và policy denial đều có record đúng.

Thay đổi chính:

- thêm agent, Composite, source MCP và policy decision context;
- ghi `Denied` trực tiếp với stable reason code;
- dùng chung header redactor rộng cho MCP và LLM;
- redact body dựa trên sensitive field metadata, tên field nhạy cảm và source credential values trước khi persist/export;
- bảo đảm inspector không render/copy payload khi `payloadRedacted=true`;
- filter theo agent/MCP/tool/outcome/time;
- UI Activity tiếng Việt.

Gate đóng: `AUDIT-01` đến `AUDIT-03` và phần audit của `VAULT-02`.

### G10 — Hoàn tất E2 bằng dữ liệu thật

Mục tiêu: xóa toàn bộ fixture và placeholder trên bề mặt sản phẩm chính.

Thay đổi chính:

- Dashboard, MCP, Tools, Agents, Vault, Activity và Domain dùng backend thật;
- tiếng Việt cho mọi surface đi qua luồng chính, gồm OAuth consent và Agent pages;
- trạng thái chưa biết dùng `—` hoặc `Không xác định`;
- responsive browser tests ở mobile và desktop;
- accessibility cơ bản cho form, dialog, toggle và bảng.

Gate đóng: `UI-01` và xác nhận lại `UI-02`, `UI-03`.

### G11 — Update, backup, restore và release candidate

Mục tiêu: có đường vận hành chính cho người cài sản phẩm.

Thay đổi chính:

- `gen-hub update <version>` dùng image version cố định;
- `gen-hub backup <path>` lưu database, config cần thiết và manifest metadata; encryption key được xử lý như secret riêng;
- `gen-hub restore <path>` kiểm tra version, checksum và key trước khi ghi;
- backup tự động trước migration không tương thích;
- restore drill sang installation mới;
- release notes nêu migration và rollback;
- tạo release candidate image đã ký và scan.

Gate đóng: `OPS-01`, `OPS-02` và xác nhận lại `INSTALL-01`.

### G12 — Final product E2E

Chỉ chạy sau khi `G01` đến `G11` đã merge và mọi focused gate pass.

Chạy hai lớp:

1. keyless production-stack E2E bằng credentialed MCP fixture để test lặp lại trong CI;
2. staging HTTPS thật với ít nhất một connector thật và credential do chủ sở hữu cung cấp.

Chuỗi bắt buộc:

```text
agent mới → Pending → bị chặn
owner approve → cấp một read tool
agent chỉ thấy tool đó
agent gọi qua /mcp
source MCP dùng credential trong Vault
agent nhận kết quả, không nhận source credential
Activity ghi đúng agent + Composite + source MCP + tool
owner revoke
lần gọi sau bị Denied và có audit
```

Negative suite:

- tool tắt toàn Hub không thể grant;
- direct `tools/call` không vượt được list filtering;
- dangerous và unknown tool mặc định tắt;
- Pending, Rejected và Revoked đều bị chặn;
- secret không có trong HTTP response, HTML, app log, audit detail hoặc export;
- restart, update, backup/restore giữ nguyên policy, agent, credential và audit.

Nếu chưa có domain, DNS, VPS hoặc credential thật, chỉ lớp staging được ghi `Blocked`; không được đổi thành `Pass` bằng mock.

## 9. Gate chung cho mọi PR code

Mỗi PR phải có:

- test hành vi mới hoặc lỗi vừa sửa;
- test âm cho fail-closed/security path;
- UI route/component thay đổi có colocated Vitest browser spec;
- API/schema thay đổi cập nhật generated types và client types;
- docs/JSDoc liên quan được cập nhật;
- không có fixture giả trên production surface;
- không có secret trong diff hoặc test output.

Các lệnh chạy theo vùng thay đổi, sau khi `G01` đã làm CI hoạt động:

```sh
go test ./<packages-thay-doi>/...
make validate-go-code
make build

cd ui/user
pnpm run check
pnpm run lint
pnpm run test -- <spec-lien-quan>
pnpm run build
```

Docker/deploy PR phải chạy thêm Compose validation, image smoke và health check. Không gọi các gate cục bộ này là final product E2E.

## 10. Cách lưu bằng chứng

Mỗi acceptance khi đóng cần một receipt ngắn trong PR hoặc tài liệu evidence, gồm:

- acceptance ID;
- commit SHA;
- môi trường chạy;
- lệnh hoặc thao tác đã chạy;
- kết quả và link CI;
- log/screenshot đã loại secret;
- giới hạn chưa kiểm tra nếu có.

Status Epic chỉ đổi thành `Done` khi mọi acceptance của Epic có receipt. Commit đã merge nhưng acceptance chưa đủ vẫn là `Partial`.

## 11. Việc làm ngay tiếp theo

1. Tách thay đổi tài liệu hiện tại thành `G00` dựa trên `main`.
2. Không merge fork PR `#6`; ghi superseded sau khi `G00` được chấp nhận.
3. Thực hiện `G01` để sync upstream và sửa CI.
4. Chỉ bắt đầu lại code sản phẩm từ `G02` sau khi required checks chạy ổn định.
