# Gen Hub — Execution SSOT E1 → E7

Canonical workroom: `Genesis-ryan-84-0567536339/Brain#42`

## User execution directive

Hoàn tất phần implementation còn lại trước, sau đó mới chạy **final product E2E test**.

Validation bắt buộc trong từng Epic (compile/check/lint/unit/smoke cục bộ khi cần) chỉ là merge safety, **không được báo là final test**.

## Existing SSOT

- Product SSOT: `README.md`
- Visual/UI SSOT: `docs/design/prototype/gen-hub-ui-prototype.html`
- Approved visual blob SHA: `4e9d931eabe942c8af5ec2e2bbb145190a0ac164`
- E2 implementation merge: `72d0d92094c2fe8cc71eac9877d4b800ee8a4761`

## Current state

- E0 — Done
- E2 — Done
- E1 — Ready
- E3 — blocked by E1
- E4 — blocked by E3
- E5 — blocked by E1 + E3
- E6 — blocked by E4 + E5
- E7 — blocked by E1–E6

## Required execution order

```text
E1
↓
E3
↓
E4 + E5
↓
E6
↓
E7 final hardening + integrated E2E
```

Do not skip dependency order and do not mark a later Epic Done while its prerequisite is not merged into `main`.

## Cross-cutting invariants

1. Keep Obot foundation: Go backend + SvelteKit 5/TypeScript/Tailwind 4 frontend.
2. Preserve upstream compatibility and existing native capability whenever possible.
3. Vietnamese-first product UI.
4. No production secrets, API keys, OAuth tokens, passwords or private credentials in Git/log/UI.
5. Agent authenticates to Hub; agent must not receive source provider credential.
6. Three-layer permission invariant:
   - source MCP capability;
   - Gen Hub global publish policy;
   - per-agent policy.
   An agent cannot re-enable a tool globally disabled by Gen Hub.
7. Dangerous/write/delete/send/execute capability defaults OFF for a newly approved agent.
8. Public domain is first-run/runtime config, not a routine dashboard editable field.
9. Approved HTML is the Visual/UI SSOT. Do not translate the artifact into prose and redesign from memory.
10. Do not fake production state. If a backend state is not authoritative yet, render neutral state until the owning Epic provides it.

## E1 — First-run domain + HTTPS

### Scope

Implement a first-run/bootstrap flow that configures runtime domain and HTTPS without hardcoding real production values.

Expected flow:

```text
public domain
→ validate domain syntax
→ DNS readiness check
→ HTTPS/TLS bootstrap configuration
→ admin/bootstrap readiness
→ start/restart Hub with persisted runtime config
```

### Requirements

- Reuse existing Obot install/runtime/config machinery before inventing a new installer.
- Provide idempotent reconfigure path.
- Do not store secrets in source.
- Domain page remains status/reconfigure surface, not daily free-form configuration.
- Runtime config supports future VPS deployment cleanly.

### Acceptance

- A clean deployment can be configured with a supplied domain and produce the expected runtime endpoint contract `https://<domain>/mcp`.
- DNS/HTTPS checks have explicit states/errors.
- Re-running bootstrap is idempotent and does not duplicate services/config.
- Repository docs explain required runtime inputs without embedding real secret/domain values.

## E3 — Composite MCP + per-tool global control

### Scope

Implement the Gen Hub front-door Composite MCP endpoint and global publish policy.

### Requirements

- Use Obot composite MCP/runtime primitives where available.
- One agent-facing endpoint.
- Catalog supports many source MCP servers.
- Global publish policy controls MCP/tool visibility.
- Per-tool UI controls from the approved HTML become functional.
- Dangerous tools default globally unpublished or explicitly controlled according to product policy.
- Do not implement per-agent approval rules here except interfaces needed by E4.

### Acceptance

- A composite endpoint can aggregate enabled source MCPs.
- Globally disabled tool does not appear through the composite endpoint.
- Global policy persists and is reflected truthfully in UI.

## E4 — Agent approval + per-agent access profile

### Scope

Implement pending/approve/revoke and per-agent MCP/tool grants.

### Requirements

- New agent identity starts Pending and cannot use Hub tools.
- Admin can approve/reject/revoke.
- Per-agent grant is a subset of globally published tools.
- Cannot grant a tool globally disabled by E3.
- Dangerous tools default OFF in new agent profile.
- Audit identity/session context should remain available for E6.

### Acceptance

- Pending agent cannot call tools.
- Approved agent can call only explicitly granted tools.
- Revoke takes effect without distributing/revoking source provider tokens to the agent.

## E5 — Credential Vault + connector setup

### Scope

Finish centralized connector credential/OAuth setup for the target catalog.

Initial target catalog:

- GitHub
- Google Drive
- Web Search
- PostgreSQL
- Filesystem
- Gmail
- Google Calendar
- Slack

### Requirements

- Reuse native Obot credential/auth primitives where possible.
- Credentials remain server-side.
- No plaintext secret in audit/log UI.
- Connector setup reports factual configured/not-configured/health states.
- Keep provider-specific auth behind Hub; agent only receives Hub access.

### Acceptance

- Connector credential can be configured at Hub level.
- Agent can use an authorized connector without receiving the connector source token.
- Secret redaction is preserved.

## E6 — Audit / Activity end-to-end model

### Scope

Complete the audit model required by Gen Hub and connect the existing E2 inspector to authoritative backend records.

### Minimum record

- agent identity;
- session/thread when available;
- MCP server/source;
- tool/function;
- input/output according to redaction policy;
- status;
- latency;
- error/reason;
- usage/token/cost when source provides it;
- policy decision context when a request is denied.

### Requirements

- Preserve upstream forensic fields already retained in E2.
- Add only fields needed for Gen Hub policy/agent/composite attribution.
- Redacted payload must not be renderable/copyable.
- Filters should work against authoritative fields.

### Acceptance

- Real MCP/tool calls create inspectable records.
- Policy-denied calls are distinguishable from execution failures.
- Agent/composite/source MCP attribution is traceable.

## E7 — Production hardening + final integrated test

E7 starts only after E1, E3, E4, E5 and E6 are merged and marked Done.

### Hardening

- production/runtime config review;
- secure defaults and secret handling;
- backup/restore or persistence notes for required state;
- upstream sync procedure verification;
- failure/error surfaces;
- deployment/restart idempotency.

### Final product E2E

Only here run and report the final integrated chain:

```text
Agent
→ Gen Hub authentication / approval
→ composite MCP endpoint
→ global publish policy
→ per-agent policy
→ source MCP tool
→ result
→ audit record / inspector
```

Required negative tests:

- pending agent denied;
- approved agent calling ungranted tool denied;
- per-agent grant cannot bypass global disabled tool;
- dangerous tool remains OFF by default;
- redacted payload is not exposed;
- source provider credential is not exposed to agent.

### Environment blocker rule

Actual public HTTPS deployment may require user-owned domain/DNS/VPS/provider credentials. Complete all code/config/documentation that can be implemented without those values first. At E7, if a real runtime input is absent, report the exact missing input and keep the final production E2E status BLOCKED rather than fabricating PASS.

## Status update rule

After each Epic is reviewed and merged:

- update `README.md` roadmap status;
- comment canonical Brain Issue #42 with `[KẾT QUẢ]` for that Epic;
- select only the newly unblocked Epic as next work;
- continue automatically until E7 or a real blocker requires user-owned runtime input.
