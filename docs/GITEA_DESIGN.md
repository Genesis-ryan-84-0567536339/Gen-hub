# Phương án Gitea và runner — Issue #23

Trạng thái: phương án để Ryan quyết định, chưa cài Gitea/runner, chưa chuyển repo Brain. Phản ánh bình luận mở lại #23 ngày 2026-09-10. Gen-hub vẫn lấy chính repo GitHub Gen-hub làm SSOT sản phẩm.

## Đề xuất để chọn

Đóng gói sẵn khả năng cài Gitea trong installer, hỏi bật ở TUI và cho tắt. Không bắt buộc mọi bản cài đều chạy thêm Gitea: người chỉ cần MCP hub không phải quản lý thêm database/git storage, hostname và backup. Với máy của Ryan có thể chọn bật ngay khi cài. Runner là lựa chọn riêng, mặc định chưa đăng ký quyền deploy.

| Phần                       | Đề xuất                                                               | Đánh đổi                                                              |
| -------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Gitea                      | Có trong bộ cài, owner bật ở TUI                                      | Thêm một lựa chọn nhưng giữ bản cài nhỏ gọn                           |
| Repo nội bộ                | Gitea là nơi commit/issue chính                                       | GitHub chỉ là đích xuất bản đã chọn                                   |
| Kanban                     | Đọc tất cả repo owner cho phép trên Gitea; lọc theo repo/agent/status | Phân trang toàn instance, giới hạn và báo snapshot rõ ràng            |
| CI build/test              | Runner ở host, user riêng; jobs trong môi trường riêng                | Cần giới hạn tài nguyên, không cấp socket Docker quản trị host        |
| Deploy                     | Owner duyệt chính xác repo + SHA + môi trường + tác vụ đã đăng ký     | Có một bước duyệt trước khi thực thi trên host                        |
| Chạy shell tùy ý trên host | Chỉ là chế độ nâng quyền tùy chọn cần Ryan chọn riêng                 | Agent có quyền đẩy workflow thực tế có quyền thực thi của user runner |

## Tách SSO owner khỏi OAuth agent

Gitea hỗ trợ nguồn đăng nhập OAuth2/OpenID Connect. Gen-hub hiện có OAuth cho MCP, chưa phải OIDC Identity Provider đầy đủ: cần bổ sung issuer/metadata, ID token ký, JWKS, userinfo, audience và client đăng ký cố định cho Gitea. Không dùng token `/mcp` hay cờ isAdmin làm đăng nhập Gitea. [Tài liệu xác thực Gitea](https://docs.gitea.com/administration/authentication/).

Luồng đề xuất: owner đã đăng nhập Hub → Gitea chuyển tới issuer owner → code một lần ràng buộc callback/client → Gitea tạo/liên kết đúng owner. Tắt đăng ký công khai; không đưa mật khẩu owner sang Gitea. Cần có đường khôi phục SSO qua TUI, kiểm thử logout/revoke, tránh khóa owner ngoài hệ thống khi issuer lỗi. Agent dùng credential Gitea riêng, scope theo repo và tool; không dùng session owner.

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

## Vòng đời bắt buộc trước khi bật bản chính thức

| Lệnh/luồng      | Phần Gitea/runner phải xử lý                                                                               |
| --------------- | ---------------------------------------------------------------------------------------------------------- |
| Cài             | Hostname riêng, Caddy/tunnel route thuộc installation, Gitea storage và SSO qua đủ health gate             |
| Status/doctor   | Trạng thái Gitea, database, SSO, runner đăng ký, job hiện tại và dung lượng                                |
| Backup          | Snapshot nhất quán database + git/LFS/attachments/config/keys; kiểm thử restore                            |
| Update/rollback | Gitea/runner pin phiên bản độc lập; backup trước schema migration, không hạ schema tự động                 |
| Restart         | Dừng nhận job mới, xử lý job đang chạy và báo rõ gián đoạn                                                 |
| Uninstall       | Dừng/deregister runner; giữ dữ liệu nếu không purge                                                        |
| Purge           | Xác nhận domain, xóa đúng container/user/storage/route thuộc installation, báo riêng repo/backup sẽ bị xóa |

## Thứ tự thực hiện sau khi Ryan chọn phương án

Gitea storage + lifecycle → owner OIDC/SSO → adapter Kanban toàn repo → CI cách ly → deploy có duyệt SHA → publish theo mốc. Mỗi phần có PR và kiểm tra riêng. Kanban GitHub #52 được triển khai độc lập ngay; UI nhận dữ liệu chuẩn hóa, adapter Gitea sau này không cần đổi cấu trúc cột/thẻ.

Quyết định còn cần Ryan chọn: **Gitea bật tùy chọn (đề xuất) hay bắt buộc**, và **deploy theo action đã đăng ký + owner duyệt SHA (đề xuất) hay shell tùy ý trong phạm vi user runner**. Không dùng đề xuất này như quyền đã cấp để cài/chạy runner trên host.
