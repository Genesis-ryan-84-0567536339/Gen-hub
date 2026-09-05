# Gen Hub — Final Product Specification v1

## 1. Mục đích và phạm vi

Tài liệu này mô tả sản phẩm Gen Hub mà người dùng cuối cài lên máy chủ và sử dụng. Đây là đặc tả hành vi để thiết kế, triển khai, review và nghiệm thu E1–E7. `README.md` vẫn là nguồn chuẩn cho định hướng, roadmap và trạng thái Epic; khi hành vi sản phẩm thay đổi, phải cập nhật cả README và tài liệu này trong cùng thay đổi. Đối chiếu code hiện tại và thứ tự triển khai nằm tại [`FINAL_PRODUCT_IMPLEMENTATION_PLAN.md`](FINAL_PRODUCT_IMPLEMENTATION_PLAN.md).

Gen Hub v1 là một Composite MCP Gateway cá nhân, tự lưu trữ, dành cho một chủ sở hữu. Chủ sở hữu kết nối nhiều MCP nguồn, quản lý credential, duyệt agent, cấp quyền tới từng tool và xem audit từ một giao diện tiếng Việt.

Gen Hub v1 không phải nền tảng MCP nhiều tổ chức, không phân phối credential nguồn cho agent và không thay thế engine MCP của Obot.

## 2. Kết quả người dùng phải nhận được

Sau khi cài đặt thành công, người dùng có:

- một trang quản trị tại `https://<domain>`;
- một MCP endpoint duy nhất tại `https://<domain>/mcp`;
- một tài khoản chủ sở hữu được tạo trong lần cài đầu;
- một Composite Hub duy nhất để chứa các MCP và tool được công bố;
- một nơi quản lý credential tập trung;
- một nơi duyệt và thu hồi quyền agent;
- một lịch sử có thể truy vết cho các lần gọi tool.

Người dùng không cần cài Go, Node.js hoặc pnpm và không cần sửa source code để chạy bản phát hành.

## 3. Vai trò

### 3.1 Chủ sở hữu

Chủ sở hữu cài đặt Hub, cấu hình MCP, quản lý credential, công bố tool, duyệt agent, cấp quyền và xem audit. V1 chỉ yêu cầu một chủ sở hữu; quản trị nhiều người không thuộc phạm vi bắt buộc.

### 3.2 Agent

Agent là ứng dụng như IDE, CLI hoặc AI client kết nối tới `/mcp`. Agent chỉ giữ credential do Gen Hub cấp. Agent không được nhận token, API key, OAuth refresh token, mật khẩu database hoặc credential của MCP nguồn.

### 3.3 MCP nguồn

MCP nguồn là một server hoặc connector như GitHub, Google Drive, Web Search, PostgreSQL, Filesystem, Gmail, Google Calendar hoặc Slack. MCP nguồn cung cấp tool; Gen Hub quyết định tool nào được đưa ra `/mcp`.

## 4. Mô hình triển khai

### 4.1 Đường cài đặt chính

Bản phát hành phải có một lệnh cài đặt được tài liệu hóa cho VPS Linux sạch. Lệnh này có thể tải release artifact hoặc container image đã gắn phiên bản; không được build sản phẩm từ source trên máy người dùng.

Repo và release phải cung cấp tối thiểu:

- container image hoặc binary có version cố định;
- production Compose hoặc cấu hình triển khai tương đương dùng artifact đã phát hành, không dùng `build:` từ source;
- một entrypoint cài đặt;
- một entrypoint cho status, logs, restart, update, backup và restore;
- file cấu hình mẫu chỉ chứa placeholder;
- hướng dẫn cài đặt, nâng cấp và khôi phục.

Trình cài đặt phải:

1. kiểm tra các điều kiện hệ thống;
2. nhận domain công khai;
3. kiểm tra cú pháp domain và DNS;
4. tạo secret hệ thống cần thiết bằng giá trị ngẫu nhiên;
5. tạo nơi lưu dữ liệu bền vững;
6. khởi động Gen Hub và reverse proxy;
7. lấy hoặc nạp TLS certificate;
8. tạo tài khoản chủ sở hữu;
9. tạo Composite Hub mặc định;
10. in ra URL quản trị và `/mcp` endpoint.

Nếu thiếu điều kiện, trình cài đặt phải dừng với lỗi và cách xử lý cụ thể. Không được báo thành công một phần như thành công hoàn chỉnh.

### 4.2 Điều kiện máy chủ

Đường cài đặt production mặc định yêu cầu:

- VPS Linux có địa chỉ IP công khai;
- domain có bản ghi A hoặc AAAA trỏ tới VPS;
- cổng 80 và 443 có thể nhận kết nối;
- container runtime được hỗ trợ bởi release;
- dung lượng bền vững cho database, credential, audit và cấu hình.

Chế độ không TLS chỉ được dùng cho local development hoặc môi trường thử nghiệm có cảnh báo rõ. Production phải dùng HTTPS.

### 4.3 Dịch vụ runtime

Một deployment tối thiểu gồm:

```text
Internet
  -> HTTPS reverse proxy
  -> Gen Hub API + Web UI + MCP Gateway
  -> database / persistent storage
  -> MCP runtimes và MCP nguồn
```

Production phải chạy PostgreSQL trong stack hoặc kết nối tới PostgreSQL bên ngoài bằng DSN hợp lệ. Database và persistent storage phải được nối vào Gen Hub bằng cấu hình runtime đầy đủ. Chỉ khai báo biến tên database mà không tạo hoặc kết nối database không được tính là production-ready.

### 4.4 Tính lặp lại an toàn

Chạy lại trình cài đặt với cùng cấu hình không được tạo thêm chủ sở hữu, Composite Hub, service hoặc volume trùng lặp. Restart không được làm mất cấu hình hay dữ liệu.

## 5. First-run

Luồng first-run chuẩn là:

```text
nhập domain
-> kiểm tra DNS
-> bật HTTPS
-> tạo chủ sở hữu
-> tạo Composite Hub
-> mở trang quản trị
```

Trạng thái domain phải là một trong các giá trị rõ ràng:

- `Chưa cấu hình`;
- `DNS chưa sẵn sàng`;
- `Đang cấp HTTPS`;
- `Sẵn sàng`;
- `Lỗi`, kèm nguyên nhân.

Sau first-run, trang Domain chỉ hiển thị trạng thái, endpoint và hướng dẫn reconfigure có chủ ý. Đây không phải form chỉnh domain hằng ngày.

## 6. Composite Hub và endpoint `/mcp`

### 6.1 Một Composite Hub chuẩn

Mỗi installation có đúng một Composite Hub đang được dùng làm cổng chính. Composite này có định danh bền vững và được lưu trong cấu hình hệ thống. Endpoint không được chọn composite theo thời gian tạo, thứ tự danh sách hoặc tên tình cờ.

Bootstrap tự tạo Composite Hub nếu chưa có. Nếu dữ liệu bị thiếu hoặc có nhiều composite cùng được đánh dấu là cổng chính, Hub phải báo lỗi cấu hình; không được tự đoán.

### 6.2 Public MCP contract

Agent luôn kết nối tới:

```text
https://<domain>/mcp
```

URL công khai không chứa MCP server ID. `/mcp` phải hỗ trợ luồng MCP cần thiết của client, gồm khởi tạo phiên, `tools/list`, `tools/call` và transport mà bản phát hành công bố hỗ trợ.

OAuth Protected Resource Metadata hoặc cơ chế discovery tương ứng phải trỏ lại đúng resource `/mcp`. Một client chưa đăng nhập phải nhận được challenge hợp lệ để bắt đầu xác thực, không phải URL metadata chứa ID rỗng.

### 6.3 Trạng thái khi chưa sẵn sàng

- Chưa có Composite Hub: trả lỗi cấu hình rõ ràng và dashboard báo `Chưa sẵn sàng`.
- Composite Hub có MCP cần credential: UI báo `Cần xác thực`; agent không nhận được credential nguồn.
- MCP nguồn lỗi: tool liên quan không được báo hoạt động; lỗi xuất hiện trong trạng thái và audit phù hợp.

## 7. Global publish policy

### 7.1 Nguồn dữ liệu duy nhất

Global publish policy của v1 chính là cấu hình persist của Composite Hub, sử dụng capability native của Obot:

- `ComponentServer.Disabled` quyết định MCP nguồn có được đưa vào composite hay không;
- `ToolOverride.Enabled` quyết định tool có được công bố hay không;
- các override tên hoặc mô tả tiếp tục dùng semantics native của composite.

Không tạo thêm một file policy hoặc database riêng chỉ để lặp lại cùng trạng thái. UI, `/mcp` và runtime phải đọc cùng nguồn dữ liệu này.

### 7.2 Khi thêm MCP nguồn

Gen Hub phải lấy danh sách tool thật trước khi lưu policy. Với mỗi tool, Hub ghi một `ToolOverride` rõ ràng thay vì để trạng thái rỗng có nghĩa là cho phép tất cả.

Quy tắc mặc định:

- tool chỉ đọc hoặc tìm kiếm: có thể bật;
- tool tạo, sửa, gửi, thực thi hoặc thay đổi dữ liệu: tắt;
- tool xóa, merge, chạy lệnh hoặc có tác động khó hoàn tác: tắt;
- tool không phân loại chắc chắn: tắt và yêu cầu chủ sở hữu xem xét.

Ưu tiên phân loại theo annotation chuẩn của MCP, sau đó theo metadata của catalog. Heuristic dựa trên tên hoặc mô tả chỉ là phương án cuối và UI phải ghi rõ đây là cảnh báo heuristic.

Tool mới xuất hiện sau lần đồng bộ đầu phải mặc định tắt cho tới khi chủ sở hữu duyệt. Tool biến mất khỏi MCP nguồn phải được đánh dấu không còn khả dụng và không được tiếp tục xuất hiện ở `/mcp`.

### 7.3 Thực thi policy

Khi MCP nguồn hoặc tool bị tắt:

- tool không xuất hiện trong `tools/list`;
- `tools/call` trực tiếp tới tool đó bị từ chối;
- thay đổi có hiệu lực cho phiên mới và trong giới hạn refresh được tài liệu hóa cho phiên đang mở;
- quyết định bị chặn được ghi audit;
- restart hoặc upgrade không làm mất policy.

Không được chỉ ẩn toggle ở UI mà vẫn cho phép gọi tool ở backend.

## 8. Agent onboarding và quyền riêng

### 8.1 Trạng thái agent

Agent có một trong các trạng thái:

```text
Pending -> Approved -> Revoked
Pending -> Rejected
```

Lần kết nối đầu tạo một yêu cầu `Pending`. Agent Pending hoặc Rejected không được xem danh sách tool và không được gọi tool. Agent Revoked mất quyền dùng Hub mà không cần thu hồi credential của MCP nguồn.

### 8.2 Quyền agent

Quyền của agent là một tập con của global publish policy:

```text
tool agent được gọi
= tool đang tồn tại ở MCP nguồn
+ MCP nguồn đang bật toàn Hub
+ tool đang bật toàn Hub
+ agent đã được cấp tool đó
```

Thiếu một điều kiện thì yêu cầu bị từ chối. Không API hoặc UI nào được cấp cho agent một tool đang tắt toàn Hub.

Khi agent mới được duyệt, mọi tool tạo, sửa, gửi, thực thi, merge hoặc xóa phải tắt mặc định trong profile của agent. Chủ sở hữu phải bật từng quyền nguy hiểm một cách rõ ràng.

### 8.3 Credential của agent

Agent chỉ nhận token hoặc OAuth grant do Gen Hub phát hành cho chính agent đó. Credential phải gắn với agent identity để audit và revoke. Không dùng chung một token không phân biệt được các agent.

## 9. Credential Vault

Vault quản lý credential MCP nguồn tại server. V1 tối thiểu hỗ trợ OAuth, API key, token, password và các trường cấu hình nhạy cảm mà connector yêu cầu.

Các quy tắc bắt buộc:

- secret không được commit vào Git;
- secret không xuất hiện trong HTML, API response, log hoặc audit;
- UI sau khi lưu chỉ hiển thị trạng thái và giá trị che;
- API cập nhật không trả plaintext secret;
- secret được mã hóa khi lưu hoặc chuyển cho secret backend được hỗ trợ;
- backup chứa secret phải được mã hóa hoặc được bảo vệ như dữ liệu nhạy cảm;
- xóa credential phải làm connector chuyển sang `Cần xác thực` và ngừng gọi tool phụ thuộc.

Catalog ban đầu gồm GitHub, Google Drive, Web Search, PostgreSQL, Filesystem, Gmail, Google Calendar và Slack. Connector chưa có implementation thật phải được ghi là `Chưa hỗ trợ`, không được hiển thị `Đã kết nối`.

## 10. Audit / Activity

Mỗi lần gọi tool và mỗi quyết định từ chối phải tạo một record có tối thiểu:

- thời gian;
- agent identity và tên hiển thị;
- session hoặc request ID;
- Composite Hub;
- MCP nguồn;
- tên tool;
- loại operation;
- trạng thái `Success`, `Error` hoặc `Denied`;
- thời gian xử lý;
- input đã qua redaction;
- output hoặc output summary đã qua redaction;
- lỗi hoặc lý do policy từ chối;
- usage, token hoặc cost nếu nguồn cung cấp.

Audit phải phân biệt lỗi thực thi với lỗi quyền. Chủ sở hữu có thể lọc theo agent, MCP, tool, trạng thái và thời gian; có thể mở inspector và export dữ liệu đã được phép hiển thị.

Credential, Authorization header, cookie, refresh token và trường đã bị redaction không được hiển thị hoặc sao chép từ inspector.

## 11. Web UI

UI mặc định dùng tiếng Việt, hoạt động trên desktop và mobile, và chỉ hiển thị trạng thái có nguồn dữ liệu thật.

### 11.1 Tổng quan

Dashboard hiển thị:

- trạng thái Hub, domain và HTTPS;
- `/mcp` endpoint và nút sao chép;
- số MCP thực sự đang bật và sẵn sàng;
- số agent Pending và Approved;
- số tool call gần đây;
- cảnh báo connector hoặc runtime lỗi;
- activity gần nhất.

Một catalog entry không được tính là MCP đang hoạt động. `Đang hoạt động` chỉ được dùng khi MCP đã bật, đủ credential và runtime sẵn sàng. Khi chưa biết trạng thái, UI hiển thị `Không xác định`, không dùng màu xanh.

### 11.2 Kho MCP và trang tool

Mỗi MCP hiển thị trạng thái bật/tắt, trạng thái credential, trạng thái runtime và số tool được công bố trên tổng số tool. Trang chi tiết có tìm kiếm, phân loại cảnh báo và toggle từng tool. Toggle phải lưu policy thật và kết quả phải phản ánh qua `/mcp`.

### 11.3 Agents

Trang Agents hiển thị Pending, Approved, Rejected và Revoked; cho phép approve, reject, revoke và chỉnh quyền từng MCP/tool. Thao tác thành công phải cập nhật backend trước khi UI báo thành công.

### 11.4 Vault, Activity và Domain

Vault chỉ hiển thị secret đã che. Activity dùng audit thật. Domain là trang trạng thái và hướng dẫn vận hành, không hiển thị domain mẫu như domain production.

### 11.5 Trạng thái chưa có backend

Nếu backend chưa hỗ trợ một chức năng, UI phải dùng `—`, `Chưa hỗ trợ` hoặc empty state. Không tạo số liệu, agent, credential, activity hoặc trạng thái hoạt động giả.

## 12. Vận hành, nâng cấp và khôi phục

Bản phát hành phải tài liệu hóa các thao tác tương đương với:

- xem trạng thái và health;
- xem log;
- restart;
- nâng cấp theo phiên bản;
- backup;
- restore.

Tên lệnh cụ thể có thể theo packaging được chọn, nhưng mỗi thao tác phải có một đường chính rõ ràng.

Nâng cấp phải giữ database, credential, Composite Hub, policy, agent và audit. Trước migration không tương thích, quy trình phải tạo hoặc yêu cầu backup. Release notes phải nêu migration và cách rollback nếu rollback được hỗ trợ.

Upstream Obot được đồng bộ trên branch riêng. Sync phải giữ nguyên product invariants và chạy lại validation cho vùng conflict, đặc biệt là navigation, MCP gateway, auth, storage và audit.

## 13. Trạng thái và lỗi chuẩn

### 13.1 MCP nguồn

- `Chưa cấu hình`;
- `Cần xác thực`;
- `Đã tắt`;
- `Đang khởi động`;
- `Sẵn sàng`;
- `Lỗi`.

### 13.2 Tool

- `Không khả dụng từ nguồn`;
- `Tắt toàn Hub`;
- `Bật toàn Hub`;
- `Không cấp cho agent`;
- `Đã cấp cho agent`.

### 13.3 Lý do từ chối

Backend và audit phải phân biệt tối thiểu:

- chưa xác thực;
- agent đang Pending;
- agent đã Rejected hoặc Revoked;
- MCP bị tắt toàn Hub;
- tool bị tắt toàn Hub;
- agent chưa được cấp tool;
- connector thiếu credential;
- MCP nguồn hoặc runtime lỗi.

Thông báo cho agent không được chứa secret hoặc chi tiết nội bộ không cần thiết.

## 14. Tiêu chí nghiệm thu

### 14.1 Cài đặt

- `INSTALL-01`: VPS sạch cài được bằng đường cài đặt release đã tài liệu hóa, không cần toolchain phát triển.
- `INSTALL-02`: DNS sai làm cài đặt dừng với hướng dẫn cụ thể.
- `INSTALL-03`: cài thành công tạo HTTPS UI và `/mcp` endpoint.
- `INSTALL-04`: chạy lại không tạo dữ liệu hoặc service trùng.
- `INSTALL-05`: restart giữ nguyên toàn bộ dữ liệu bền vững.

### 14.2 Composite và global policy

- `MCP-01`: installation có đúng một Composite Hub được chỉ định rõ.
- `MCP-02`: hai MCP nguồn bật có tool xuất hiện qua cùng `/mcp` endpoint.
- `MCP-03`: tắt MCP nguồn làm toàn bộ tool của nguồn biến mất.
- `MCP-04`: tắt một tool làm tool biến mất khỏi `tools/list` và `tools/call` bị từ chối.
- `MCP-05`: restart giữ nguyên trạng thái MCP và tool.
- `MCP-06`: tool nguy hiểm hoặc chưa phân loại mặc định tắt.
- `MCP-07`: tool mới được phát hiện mặc định tắt cho tới khi được duyệt.

### 14.3 Agent

- `AGENT-01`: agent mới tạo yêu cầu Pending và không xem/gọi được tool.
- `AGENT-02`: agent Approved chỉ xem và gọi tool được cấp.
- `AGENT-03`: agent không thể được cấp tool đang tắt toàn Hub.
- `AGENT-04`: revoke có hiệu lực mà không đưa hoặc thu hồi token nguồn ở phía agent.
- `AGENT-05`: hai agent dùng credential Hub riêng và được audit riêng.

### 14.4 Vault và audit

- `VAULT-01`: connector hoạt động mà source credential không xuất hiện trong response cho agent.
- `VAULT-02`: UI, log, audit và export không lộ plaintext secret.
- `AUDIT-01`: tool call thành công tạo record đủ agent, MCP, tool, status và latency.
- `AUDIT-02`: request bị policy chặn tạo record `Denied` với đúng lý do.
- `AUDIT-03`: filter và inspector đọc từ record backend thật.

### 14.5 UI và vận hành

- `UI-01`: mọi surface chính dùng tiếng Việt và hoạt động trên desktop/mobile.
- `UI-02`: dashboard không tính catalog entry chưa chạy là MCP hoạt động.
- `UI-03`: toggle tool thay đổi policy thật và trạng thái sống qua refresh.
- `OPS-01`: backup rồi restore trên installation mới khôi phục được cấu hình và dữ liệu cần thiết.
- `OPS-02`: nâng cấp phiên bản không làm mất quyền, credential hoặc audit.

### 14.6 Final product E2E

Bài test cuối phải chạy chuỗi thật:

```text
agent mới kết nối
-> Pending và bị chặn
-> chủ sở hữu approve và cấp một tool đọc
-> agent thấy đúng tool được cấp
-> agent gọi tool qua /mcp
-> MCP nguồn thực thi bằng credential trong Vault
-> agent nhận kết quả nhưng không nhận credential nguồn
-> Activity hiển thị audit record đúng agent, MCP và tool
-> chủ sở hữu revoke agent
-> lần gọi tiếp theo bị từ chối và được ghi audit
```

Bài test âm phải chứng minh tool tắt toàn Hub không thể được cấp hoặc gọi, tool nguy hiểm mặc định tắt và dữ liệu đã redaction không thể xem hoặc copy.

## 15. Liên kết acceptance với Epic

| Epic | Acceptance chính |
|---|---|
| E1 | `INSTALL-01` đến `INSTALL-05` |
| E2 | `UI-01` và các surface UI ở mục 11 |
| E3 | `MCP-01` đến `MCP-07`, `UI-02`, `UI-03` |
| E4 | `AGENT-01` đến `AGENT-05` |
| E5 | `VAULT-01`, `VAULT-02` và catalog connector ở mục 9 |
| E6 | `AUDIT-01` đến `AUDIT-03` |
| E7 | `OPS-01`, `OPS-02` và Final product E2E |

## 16. Điều kiện hoàn thành sản phẩm

Gen Hub v1 chỉ được gọi là hoàn thành khi:

1. E1–E6 đã merge và từng acceptance liên quan ở tài liệu này có bằng chứng;
2. E7 chạy final product E2E trên deployment HTTPS thật;
3. không còn placeholder cho chức năng được tuyên bố hoàn thành;
4. không có production state giả trong UI;
5. release artifact, hướng dẫn cài, upgrade, backup và restore đã tồn tại;
6. không có secret thật trong Git, log, UI hoặc test fixture;
7. quy trình sync upstream đã được thử trên phiên bản nền hiện tại.

Nếu thiếu domain, DNS, VPS hoặc credential do người dùng sở hữu, trạng thái cuối là `Blocked` kèm đầu vào còn thiếu; không được ghi `Pass` dựa trên mock.
