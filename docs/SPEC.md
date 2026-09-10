# Yêu cầu chuẩn — Gen-hub Linux

Chốt với Ryan ngày 2026-09-08. Đích: Hub tự sở hữu; repo Gen-hub làm SSOT. Không lấy clone Obot hay xây IDE/đội agent làm mục tiêu.

## Luồng chấp nhận

1. Một lệnh từ terminal, mọi nhập liệu tương tác qua TTY kể cả bootstrap được tải bằng curl.
2. Runtime chuẩn: Docker Compose, tự cài Docker khi thiếu. Quét OS/kiến trúc, gợi ý môi trường; người dùng xác nhận VPS hay máy cá nhân.
3. VPS: domain + IP public; hướng dẫn DNS cụ thể, chờ xác nhận thủ công và test; DNS chưa đúng dừng bước.
4. Máy cá nhân: domain gốc + hostname + token Cloudflare đủ quyền; tạo/reuse tunnel riêng của installation; tạo route/DNS; không ghi đè tài nguyên không thuộc installation.
5. Caddy/HTTPS và kết nối public cần trả đúng installation ID. Chỉ mở health check khi chưa có owner.
6. Tạo owner và password ngay trên TUI. Không có API bootstrap owner công khai.
7. In URL giao diện và MCP tổng. Agent phải xác thực riêng với Hub.
8. Web onboarding: add MCP → xác thực dịch vụ → công bố tool → duyệt/cấp quyền agent → gọi và xem log.
9. Tự cập nhật từ main sau khi CI đạt, backup/health gates/khôi phục runtime khi lỗi; có bật/tắt timer. Doctor có chế độ tự sửa an toàn; gỡ sạch có xác nhận domain, tùy chọn xóa đúng tài nguyên Cloudflare.
10. UI tiếng Việt theo hướng thiết kế được duyệt; mọi số liệu từ backend, không seed dữ liệu giả.

## Bất biến

- Trợ lý quản trị cá nhân (Issue #15) dùng `/mcp/admin` và loại token riêng, tách khỏi `/mcp` và OAuth agent thường. Owner phải nhập lại mật khẩu khi tạo, chỉ một token hoạt động, chỉ hiện một lần, lưu hash và không tự hết hạn. Owner thu hồi trong Cài đặt; token này không đăng nhập web hoặc tự cấp token quản trị mới.
- Tool quản trị dùng chung dispatcher với web API, trong phạm vi console. OAuth dịch vụ vẫn cần owner thao tác trong trình duyệt; đổi mật khẩu vẫn cần mật khẩu hiện tại. Không có shell, sửa mã nguồn, deploy hoặc truy cập filesystem.
- Audit trợ lý ghi actor `admin-assistant:<id>` riêng; đọc log chỉ ghi số lượng/ID để tránh lặp lại payload audit vô hạn. Credential và mật khẩu bị che trước khi ghi.

- Cho phép gọi = agent active AND MCP enabled AND kết nối connected AND tool published AND agent có grant.
- Kiểm tra quyền ngay trước khi gửi lệnh upstream; thu hồi chặn lượt gọi mới. Lượt gọi đã gửi ra dịch vụ không thể đảm bảo thu hồi ngược.
- Token agent không thay thế token dịch vụ; không token passthrough.
- Tools/list chỉ liệt kê tool khả dụng, tên namespace ổn định theo MCP ID.
- Agent có ID riêng hiển thị thường trực; owner đặt tên khi duyệt OAuth hoặc sửa sau đó. Chỉ xóa agent đã thu hồi, xóa token/code còn lại và giữ audit theo retention.
- Password chỉ hash; credential mã hóa bằng key trên máy. Không log secret.
- Vault (#22) lưu secret độc lập bằng `store.seal()`; chỉ owner/web hoặc admin dispatcher được ghi. Grant `vault:<id>` nằm trong cùng `agent.permissions`, kiểm tra ID tồn tại, không wildcard. MCP thường chỉ công bố tool đọc `vault__<id>` nếu agent active và có đúng grant; không liệt kê secret chưa cấp. Đây là cơ chế owner chủ động chia sẻ giá trị, không cho phép đọc credential connector.
- Vault mặc định riêng tư. Tạo/sửa quyền agent và consent dùng chung checkbox Vault. Chia sẻ “tất cả” chỉ cấp snapshot agent active tại lúc lưu, audit `vault.share_all`; không tự cấp cho agent tương lai. Xóa secret gỡ grant trong cùng transaction, giữ audit. Metadata không chứa ciphertext/giá trị; đọc tường minh ghi ID/actor/kết quả, tuyệt đối không audit giá trị.
- PIN (#25) scrypt, không mặc định, không plaintext; đặt/đổi chỉ bằng web owner + CSRF + password step-up. Cùng server gate cho web/admin ở xóa connector, agent đã revoked, secret và disconnect credential. Fail closed nếu thiếu/sai/chưa đặt PIN; một rate budget dùng chung, 5 lần sai trong cửa sổ 15 phút (in-memory). Không có tool admin đặt PIN. PIN dùng lại không tương đương xác nhận con người từng lần; không dùng nó làm bằng chứng owner vừa phê duyệt trong thiết kế chat #24.
- Quyền/credential/log/tài khoản tồn tại qua restart.
- Installer chạy lại không tạo tunnel trùng, không thay thế DNS bên ngoài, không tạo lại owner.
- Personal không publish host port; VPS chỉ publish Caddy 80/443.
- Mọi gate phải đạt trước owner. Cập nhật backup trước đổi runtime; lỗi kiểm tra khôi phục runtime trước, không tự hạ database.

## Giới hạn bản đầu được ghi rõ

- Linux systemd + Docker Engine/Compose, x86_64/arm64. Không Windows/macOS/Alpine/OpenRC.
- Remote MCP qua Streamable HTTP. Stdio và legacy SSE riêng endpoint chưa thuộc bản đầu.
- Remote OAuth tự khám phá cho MCP bên thứ ba chưa có; dùng bearer token. OAuth tích hợp cho Google Drive/GitHub/Slack và OAuth phía agent đã có.
- Không proxy sampling/elicitation server-to-client; chưa hỗ trợ giao thức 2026-07-28.
- Các bộ công cụ tích hợp là tập tool được định nghĩa trong catalog, không phải toàn bộ API nhà cung cấp.
- Dashboard tính trên 200 log gần nhất; export tối đa 5.000 bản ghi. Dữ liệu lưu theo retention 7/30/90 ngày.

## Chi tiết theo tab và thống kê audit (#27)

- Agent, Connector, Vault: danh sách + chi tiết theo tab; Cài đặt: danh sách nhóm + tab. Audit giữ bảng/modal, Dashboard không đổi.
- Agent lưu `description` và `instructions` tùy chọn trong record hiện có. Initialize chỉ lấy instruction từ agent đã được xác thực, fallback câu mặc định nếu thiếu/trống. Không thay đổi policy grant.
- Audit lọc actor/connector/secret/time/tool trước limit, dùng chung web và admin. Secret ID nằm trong payload mã hóa nên được đối chiếu sau decrypt trong iterator, trước khi dừng ở limit. Không thu thập dữ liệu mới, không đưa giá trị Vault vào audit.
- Biểu đồ chỉ tổng hợp lượt gọi tool của agent thường, theo thời gian GMT+7; byte = độ dài UTF-8 của JSON input/output đã redact. Tối đa 5.000 bản ghi phù hợp trong khoảng chọn và retention; UI ghi rõ giới hạn, đơn vị và dữ liệu trống.
