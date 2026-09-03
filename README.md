# Gen Hub

> **SSOT của sản phẩm:** file `README.md` này là nguồn chuẩn sống cho scope, kiến trúc, quyết định cố định, roadmap và trạng thái triển khai của Gen Hub. Khi scope thay đổi, cập nhật README trước hoặc cùng lúc với code.

## 1. Định vị sản phẩm

**Gen Hub** là personal **Composite MCP Gateway** xây trên fork của [Obot](https://github.com/obot-platform/obot). Mục tiêu là để nhiều AI agent / IDE / CLI kết nối vào **một MCP endpoint duy nhất**, còn Hub chịu trách nhiệm quản lý MCP phía sau, credential, quyền theo agent/tool và audit.

Nguyên tắc sản phẩm:

- Giao diện **tiếng Việt là chính**; giữ tiếng Anh khi cần cho tên chuẩn kỹ thuật.
- Ưu tiên tái sử dụng native capability của Obot; không rewrite engine nếu chưa cần.
- Domain-first cho production: public domain, DNS và HTTPS được cấu hình ở first-run/runtime bootstrap trước khi dùng OAuth/tool thực tế.
- Agent không được nhận source credential/token trực tiếp; Hub giữ credential phía server và chỉ cấp quyền gọi tool.
- Quyền được quản lý tới **từng MCP và từng function/tool**.
- Tool nguy hiểm mặc định tắt cho agent mới.
- Mọi tool call quan trọng phải có audit trail có thể truy ngược agent/session/tool.

## 2. Product Definition of Done

Gen Hub được xem là hoàn thành cấp sản phẩm khi tất cả điều sau đạt:

1. Clean VPS có thể chạy first-run flow: **public domain → DNS check → HTTPS → admin account → start Hub**.
2. Có một Composite MCP endpoint chuẩn để agent kết nối và endpoint đó không làm lộ credential nguồn.
3. Admin quản lý được danh mục MCP và bật/tắt quyền ở mức server lẫn function/tool.
4. Agent mới phải xin kết nối; admin có thể approve, revoke và áp profile quyền riêng cho từng agent.
5. Credential/OAuth/API key được lưu tập trung trong encrypted vault/server-side storage; không hardcode trong repo.
6. Tool nguy hiểm mặc định tắt, ví dụ: GitHub merge/update, DB execute, filesystem write/delete, Gmail send, Slack post.
7. Audit/Activity ghi được tối thiểu: agent, session, MCP/tool, input/output, status, latency, error và usage/token khi có.
8. Web UI tối giản, mobile-friendly, tiếng Việt mặc định; có các khu vực Dashboard, MCP, Agents, Vault, Audit, Domain & Endpoint.
9. Có trang trạng thái Domain & Endpoint và thao tác copy endpoint.
10. Production HTTPS endpoint vượt qua smoke test end-to-end: **Agent → Gen Hub → MCP tool → audit record**.
11. Fork duy trì được quy trình đồng bộ upstream Obot mà không làm mất custom Gen Hub.

## 3. Kiến trúc mục tiêu

```text
AI Agent / IDE / CLI
        │
        │ 1 MCP endpoint
        ▼
┌──────────────────────────────┐
│           Gen Hub            │
│    Composite MCP Gateway     │
│                              │
│  Agent Access / Approval     │
│  Per-MCP + Per-Tool Policy   │
│  Credential Vault            │
│  Audit / Activity            │
└──────────────┬───────────────┘
               │
      ┌────────┼────────┐
      ▼        ▼        ▼
   GitHub   GDrive   Web Search
      ▼        ▼        ▼
 PostgreSQL Filesystem Gmail
      ▼        ▼
 Calendar    Slack
```

### Nền kỹ thuật giữ nguyên từ Obot

- Backend: Go.
- Frontend: SvelteKit 5 + TypeScript + Tailwind CSS 4.
- MCP Gateway và Composite MCP runtime dùng capability hiện hữu của Obot.
- Credential/auth/audit primitives ưu tiên dùng implementation hiện hữu trước khi bổ sung abstraction mới.
- `MCPServerCatalogEntry` với runtime `composite` là nền cho endpoint tổng hợp nhiều MCP/tool.

## 4. Một endpoint cho agent

Mục tiêu vận hành:

```text
https://<public-domain>/mcp
```

Đây là endpoint mà agent biết tới. Các MCP phía sau, token nguồn, OAuth client secret, database credential và policy nội bộ không được phân phối trực tiếp cho agent.

Domain thực tế là runtime secret/config của deployment, **không hardcode trong source**. README chỉ mô tả contract và flow.

## 5. MCP catalog mục tiêu

Danh mục khởi đầu:

- GitHub
- Google Drive
- Web Search
- PostgreSQL
- Filesystem
- Gmail
- Google Calendar
- Slack

Danh mục này không phải whitelist cứng. Admin có thể thêm MCP khác sau này, nhưng mọi MCP mới vẫn phải đi qua cùng model: credential tập trung, tool-level permission và audit.

## 6. Permission model

### Agent onboarding

1. Agent/IDE/CLI gửi yêu cầu kết nối Hub.
2. Agent ở trạng thái `Pending` cho tới khi admin approve.
3. Admin chọn MCP nào agent được thấy.
4. Trong từng MCP, admin chọn function/tool cụ thể được phép gọi.
5. Có thể revoke toàn bộ agent hoặc chỉ revoke một phần quyền.

### Dangerous-by-default

Các capability có tác động ghi/xóa/gửi/execute phải mặc định **OFF** cho agent mới. Ví dụ:

- GitHub: merge, update/write mạnh.
- PostgreSQL: execute/write query.
- Filesystem: write/delete.
- Gmail: send.
- Slack: post.

Việc bật quyền nguy hiểm phải là quyết định explicit của admin.

## 7. Credential Vault

Gen Hub quản lý credential tập trung để tránh cài token lặp lại cho từng agent.

### Invariants

- Không commit API key, OAuth token, password hoặc secret vào Git.
- Không hiển thị plaintext secret trong audit/log UI.
- Agent không được nhận source token nếu chỉ cần quyền sử dụng tool.
- OAuth/API credential được inject server-side vào MCP tương ứng.
- Source code chỉ chứa schema/config name/example placeholder, không chứa giá trị secret thật.

## 8. Audit / Activity

Mỗi tool call cần có khả năng truy vết tối thiểu:

- agent identity;
- session/thread khi có;
- MCP server;
- tool/function;
- input;
- output hoặc output summary phù hợp policy;
- status;
- latency;
- error;
- usage/token/cost khi nguồn có cung cấp.

UI mục tiêu có:

- danh sách activity;
- filter theo agent/MCP/tool/status/session;
- request inspector;
- export.

## 9. UI scope

UI Gen Hub ưu tiên đơn giản hơn bề mặt quản trị tổng quát của upstream. Các màn sản phẩm chính:

1. **Dashboard** — tình trạng Hub, endpoint, MCP đang bật, agent đang kết nối, pending approval, số tool được cấp, activity gần nhất.
2. **MCP** — catalog MCP, trạng thái enable/disable và đi vào trang quản lý từng MCP.
3. **MCP / Tools** — bật/tắt từng function/tool, phân loại capability nguy hiểm.
4. **Agents** — connected agents, pending requests, approve/revoke, profile quyền.
5. **Credential Vault** — quản lý connector credential/OAuth tập trung.
6. **Audit / Activity** — lịch sử tool call + inspector + export.
7. **Domain & Endpoint** — hiển thị public domain, HTTPS/runtime status và copy MCP endpoint.

### First-run khác dashboard thường ngày

Domain không phải setting cần chỉnh mỗi ngày. First-run/bootstrap chịu trách nhiệm:

```text
public domain
→ DNS check
→ HTTPS
→ admin account
→ start Hub
```

Dashboard sau đó chỉ hiển thị trạng thái domain/endpoint và thông tin vận hành liên quan.

## 10. Roadmap / Epic SSOT

| Epic | Scope | Dependency | Acceptance | Status |
|---|---|---|---|---|
| **E0 — Foundation / README SSOT** | Đổi fork upstream thành Gen Hub SSOT, ghi baseline, architecture, security invariants, roadmap | None | README chứa spec/SSOT, không chứa secret | **In Progress** |
| **E1 — First-run domain + HTTPS** | Installer/TUI domain, DNS check, HTTPS, admin bootstrap, runtime config | E0 | Clean VPS setup xong và truy cập được HTTPS | Blocked by E0 |
| **E2 — Vietnamese UI shell + Dashboard** | Branding, nav tối giản, Dashboard/MCP/Agents/Vault/Audit/Domain, responsive | E0 | UI build/check pass; desktop/mobile dùng được; tiếng Việt là chính | Blocked by E0 |
| **E3 — Composite MCP + per-tool control** | Một endpoint tổng, catalog và bật/tắt tool | E1 | Agent kết nối một endpoint và chỉ thấy tool được grant | Blocked by E1 |
| **E4 — Agent approval + access profiles** | Pending/approve/revoke, quyền theo MCP/tool, dangerous default-off | E3 | Agent chưa approve không dùng được; approved agent chỉ gọi đúng tool được cấp | Blocked by E3 |
| **E5 — Vault + connector setup** | Credential/OAuth cho catalog MCP mục tiêu | E1 + E3 | Connector hoạt động mà agent không nhận source token; không có secret trong Git/log UI | Blocked |
| **E6 — Audit / Activity inspector** | Activity list, filter, inspector, export | E4 + E5 | Tool call test tạo audit record truy được từ UI | Blocked |
| **E7 — Production hardening + release** | E2E, production deploy, security/backup defaults, upstream-sync procedure | E1–E6 | HTTPS endpoint + Agent→Hub→Tool→Audit smoke test PASS | Blocked |

Dependency graph:

```text
E0 → {E1, E2}
E1 → E3
E3 → {E4, E5}
{E4, E5} → E6
{E1, E2, E3, E4, E5, E6} → E7
```

### Ready policy

- Chỉ item không còn dependency chưa hoàn thành mới được xem là `Ready`.
- Ở baseline ban đầu, chỉ **E0** được thực thi.
- Khi E0 merge, **E1 và E2** có thể triển khai song song.
- Không tự mở rộng scope hoặc tự chọn Epic ngoài dependency map; yêu cầu mới phải cập nhật README trước hoặc cùng lúc với implementation.

## 11. Baseline hiện tại

Baseline khi bắt đầu custom Gen Hub:

- Repository: `Genesis-ryan-84-0567536339/Gen-hub`.
- Fork parent/upstream: `obot-platform/obot`.
- Default branch: `main`.
- Upstream baseline commit của fork: `3ef02524c4f054e6c338f1f3cbbb69fc61bf6247`.
- Repo-local `BOOTSTRAP.md`: chưa có; agent guidance hiện tại nằm ở `AGENTS.md` upstream.
- Gen Hub implementation riêng: chưa có trước branch foundation này.
- GitHub Actions trên fork: chưa có run riêng ở baseline.
- Gen Hub release: chưa có.
- Production runtime/domain: chưa deploy/chưa xác minh ở baseline.
- GitHub Issues của fork đang disabled ở baseline; trong khi chưa bật Issues, Pull Request là workroom triển khai, còn README vẫn là product SSOT.

## 12. Constraints / Non-goals

### Constraints

- Dùng fork Obot hiện tại làm nền.
- Giữ upstream compatibility ở mức hợp lý.
- UI tiếng Việt là chính.
- Không đưa secret vào source.
- Domain-first trước OAuth/tool production.
- Ưu tiên thay đổi nhỏ, dùng capability có sẵn trước khi phát minh layer mới.

### Non-goals hiện tại

- Không rewrite toàn bộ Obot.
- Không xây một LLM provider platform mới nếu không phục vụ Gen Hub core goal.
- Không phát token nguồn trực tiếp cho từng agent.
- Không biến Domain page thành UI chỉnh domain hằng ngày.
- Không bật dangerous tools mặc định cho agent mới.

## 13. Upstream sync rule

Fork phải giữ quan hệ rõ với `obot-platform/obot`.

Khi sync upstream:

1. cập nhật từ upstream `main` vào một branch sync riêng;
2. resolve conflict giữ nguyên invariants Gen Hub trong README này;
3. chạy build/test liên quan;
4. review diff trước khi merge vào `main`;
5. nếu upstream thay đổi capability nền làm ảnh hưởng roadmap/architecture, cập nhật README trong cùng PR.

Không force-overwrite custom Gen Hub bằng upstream.

## 14. Development quick start

Theo stack upstream hiện tại:

```bash
make dev
make build
make test
```

Frontend trong `ui/user/`:

```bash
pnpm install
pnpm run check
pnpm run lint
pnpm run test
```

Các lệnh này là baseline upstream; deployment production của Gen Hub sẽ được chốt trong E1/E7.

## 15. Quy tắc cập nhật SSOT

README này phải được cập nhật khi có một trong các thay đổi sau:

- thay đổi product scope hoặc Definition of Done;
- thay đổi kiến trúc hoặc security invariant;
- thêm/bỏ Epic hoặc thay đổi dependency;
- một Epic đổi trạng thái quan trọng;
- deployment/runtime contract thay đổi;
- upstream thay đổi làm ảnh hưởng trực tiếp Gen Hub.

Không để quyết định quan trọng chỉ tồn tại trong chat, handoff hoặc trí nhớ của agent.

---

## Upstream foundation

Gen Hub kế thừa nền open-source Obot và giữ license MIT của upstream. Tài liệu upstream: <https://docs.obot.ai>.
