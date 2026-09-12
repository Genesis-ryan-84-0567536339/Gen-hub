# Phương án Gitea và runner — Issue #23

> [!NOTE]
> **Tài liệu thiết kế lịch sử (Historical Design Document)**: Tài liệu này ghi lại đề xuất kiến trúc ban đầu tại thời điểm thảo luận Issue #23 (2026-09-10).
> **Trạng thái triển khai thực tế**: Các hạng mục cốt lõi đã được hoàn thành và merge vào `main`:
> - Storage & Lifecycle Gitea: **Đã triển khai** (PR #56 / #57).
> - Gitea MCP Connector (59 tool): **Đã triển khai** (PR #59, #60).
> - Owner OIDC / SSO Identity Provider: **Đã triển khai** (PR #61, `server/owner-oidc.mjs`).
> - Kanban Gitea Multi-repo Adapter: **Đã triển khai** (PR #65).
> - Kanban Archive (Thủ công & Tự động 24h): **Đã triển khai** (PR #66).
> - Xem hướng dẫn vận hành chi tiết và giới hạn bảo mật tại [GITEA_OPERATIONS.md](GITEA_OPERATIONS.md) và ma trận năng lực tại [STATUS.md](STATUS.md).

## Quyết định đã chốt

Gitea là thành phần bắt buộc của mọi bản cài Gen-hub. TUI luôn bootstrap Gitea cùng owner, không hỏi bật/tắt, không có cấu hình on/off. Route cố định `/gitea/` qua Caddy dùng hostname Gen-hub hiện tại; git/database và cấu hình/keys nằm trong hai named volume riêng của Gitea. Máy đã có owner nhận bước bootstrap bắt buộc một lần qua `sudo gen-hub gitea-enable`. Đây là luồng chuyển tiếp cho bản cài cũ, không phải lựa chọn sản phẩm ở bước cài. Sau khi đã bootstrap, owner vẫn có thể chủ động tắt qua `sudo gen-hub gitea-disable` nếu quyết định không dùng (xem `docs/GITEA_OPERATIONS.md`) — khác với việc TUI không hỏi lựa chọn lúc cài.

PR storage/lifecycle dùng admin Gitea nội bộ với mật khẩu sinh bằng `secret()` của `server/store.mjs`, hiện một lần ở TUI. SSO owner đã được triển khai (PR #61) qua OpenID Connect riêng biệt, không tái sử dụng mật khẩu owner, token MCP hoặc isAdmin. Chi tiết hiện thực, backup/restore và giới hạn phiên bản tại [GITEA_OPERATIONS.md](GITEA_OPERATIONS.md).

Deploy đã chốt theo action đăng ký sẵn + owner duyệt đúng SHA. Không triển khai shell tự do trên host. Runner/CI vẫn nằm ngoài PR storage/lifecycle.

## Tách SSO owner khỏi OAuth agent

Gitea hỗ trợ nguồn đăng nhập OAuth2/OpenID Connect. Để đáp ứng yêu cầu này, Gen-hub đã bổ sung OpenID Connect (OIDC) Identity Provider đầy đủ (`server/owner-oidc.mjs`, PR #61): bao gồm issuer/metadata discovery, ID token ký RS256, JWKS public keys, userinfo, audience `genhub-gitea` và client đăng ký cố định cho Gitea. Tuyệt đối không dùng token `/mcp` hay cờ isAdmin làm đăng nhập Gitea. [Tài liệu xác thực Gitea](https://docs.gitea.com/administration/authentication/).

Luồng đã triển khai: owner đã đăng nhập Hub → Gitea chuyển tới issuer owner (`/oidc/owner/authorize`) → code một lần ràng buộc callback/client → Gitea tạo/liên kết đúng owner. Tắt đăng ký công khai; không đưa mật khẩu owner sang Gitea. Đường khôi phục SSO có sẵn qua `sudo gen-hub gitea-enable`, kiểm thử logout/revoke đã hoàn thành. Agent truy cập Gitea qua connector `gitea-mcp` (PR #59) bằng credential PAT riêng, scope theo repo và tool; không dùng session owner.

## Ranh giới runner và deploy

Gitea Runner có chế độ container và host; chế độ host không cách ly các job. Tài liệu cũng nêu Docker mode thường dùng daemon của host. Việc chỉ chạy runner trong container không đủ tách quyền nếu vẫn trao socket Docker quản trị. [Tài liệu Gitea Runner](https://docs.gitea.com/runner/).

Đề xuất hai đường riêng:

1. **CI**: user `genhub-ci`, vùng làm việc riêng, không sudo, không đọc `/var/lib/gen-hub`, master.key, update.env hoặc cấu hình Cloudflare. Đăng ký runner giới hạn repo, giới hạn CPU/RAM/disk/thời gian. Job không mount socket Docker của runtime Gen-hub. Chọn sandbox build riêng; cần nghiệm thu mức cách ly thực tế trước khi nhận code không tin cậy.
2. **Deploy**: dịch vụ host riêng chỉ nhận yêu cầu có schema cố định (repo ID, SHA, environment, action ID). Action/script do owner đăng ký trong thư mục root-owned; workflow không sửa được. Owner duyệt đúng SHA + digest artifact + action version tại UI; giấy duyệt ngắn hạn, một lần, ràng buộc các trường này. Đổi commit/artifact sau duyệt phải duyệt lại. Agent không có API tự cấp giấy duyệt; PIN dùng lại không thay thế bước duyệt này.

Không thực thi shell string gửi từ issue hoặc tham số tool. Action deploy truyền argv đã kiểm tra; không cấp `sudo bash`, wildcard sudo hay quyền sửa script cho runner. Nếu muốn deploy container app khác, owner đăng ký đúng service/rootless runtime được phép. Triển khai chính Gen-hub vẫn dùng pipeline updater hiện tại, không tự cho runner thay thế.

Luồng audit: agent/tool → commit SHA → workflow/run/job → yêu cầu deploy → owner phê duyệt → kết quả và health check/rollback. Ghi input/output đã che secret, ID credential và tên tool; **không hiển thị credential thật trong log**. Số token LLM input/output chỉ ghi khi provider cung cấp usage; nếu không có thì báo chưa có dữ liệu, không quy đổi byte thành token. Thống kê byte JSON đã redact hiện có (#27) vẫn được ghi riêng. Code job vẫn có thể cố tình in secret được cấp, nên chỉ cấp credential ngắn hạn/phạm vi nhỏ cần thiết; redaction không được coi là bảo đảm tuyệt đối với code tùy ý.

## Public ở mốc hoàn thành

Gitea hỗ trợ push mirror cho branches/tags/commits; cơ chế này không phải đồng bộ issues, review và project board. [Tài liệu mirror Gitea](https://docs.gitea.com/usage/repository/repo-mirror/).

Theo yêu cầu mới “chỉ khi đạt mốc”: mặc định không push-on-commit và không mirror định kỳ. Owner chọn repo đích và mốc release/SHA rồi kích publish. Mirror có thể mang theo lịch sử git; nếu không muốn công khai lịch sử nội bộ, cần repo xuất bản riêng với snapshot đã duyệt. Đây là lựa chọn phải hiện rõ trước lần publish đầu. Không tự tạo repo public, không tự migrate Brain hoặc đẩy toàn bộ repo nội bộ ra ngoài.

## Vòng đời mục tiêu cho toàn Epic

| Lệnh/luồng      | Phần Gitea/runner phải xử lý                                                                               |
| --------------- | ---------------------------------------------------------------------------------------------------------- |
| Cài             | Hostname riêng, Caddy/tunnel route thuộc installation, Gitea storage và SSO qua đủ health gate             |
| Status/doctor   | Trạng thái Gitea, database, SSO, runner đăng ký, job hiện tại và dung lượng                                |
| Backup          | Snapshot nhất quán database + git/LFS/attachments/config/keys; kiểm thử restore                            |
| Update/rollback | Gitea/runner pin phiên bản độc lập; backup trước schema migration, không hạ schema tự động                 |
| Restart         | Dừng nhận job mới, xử lý job đang chạy và báo rõ gián đoạn                                                 |
| Uninstall       | Dừng/deregister runner; giữ dữ liệu nếu không purge                                                        |
| Purge           | Xác nhận domain, xóa đúng container/user/storage/route thuộc installation, báo riêng repo/backup sẽ bị xóa |

## Thứ tự thực hiện và tiến độ

- [x] **Gitea storage + lifecycle**: Đã hoàn thành (PR #56 / #57).
- [x] **Gitea MCP Connector (59 tool)**: Đã hoàn thành (PR #59, #60).
- [x] **Owner OIDC / SSO**: Đã hoàn thành (PR #61, `server/owner-oidc.mjs`).
- [x] **Adapter Kanban toàn repo Gitea**: Đã hoàn thành (PR #65).
- [x] **Kanban Archive (Manual & Auto 24h)**: Đã hoàn thành (PR #66).
- [ ] **CI cách ly**: Triển khai trong Epic/PR tiếp theo.
- [ ] **Deploy có duyệt SHA**: Triển khai sau CI.
- [ ] **Publish theo mốc**: Triển khai theo nhu cầu.

Mỗi phần có PR và kiểm tra riêng. Kanban GitHub #52 và Gitea #65 đã được chuẩn hóa dùng chung UI và cấu trúc cột/thẻ.

Không dùng thiết kế này như quyền đã cấp để cài/chạy runner hoặc chuyển repo Brain trên host.
