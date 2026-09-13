# Monitor tích hợp trong Gen-hub

Tổng quan là nơi xem tài nguyên, hoạt động và yêu cầu đi qua Hub. Dữ liệu do backend trả về; không có fixture hoặc hội thoại mẫu trong sản phẩm. Các trang Agent, MCP, Vault, Bootstrap, Nhật ký và khung chat hiện có tiếp tục là nơi quản lý/thao tác.

## Mẫu giao diện đã chốt và trạng thái nghiệm thu

**Chưa đạt nghiệm thu giao diện.** Mã tại `67819e272e29f78dd98b170e3b1315ff4051676b` đã qua kiểm thử kỹ thuật và được agent local review kỹ thuật, nhưng Ryan chỉ ra bố cục chưa đúng mẫu đã chọn. Các kết quả PASS phía dưới không thay thế đối chiếu thiết kế.

Nguồn chuẩn giao diện: [gen-hub-integrated-monitor.html](design/gen-hub-integrated-monitor.html). Đây là nguyên bản HTML tích hợp đã trình bày và được Ryan chốt trong hội thoại, đưa vào repo để Claude có thể mở trực tiếp. Đây là tài liệu mẫu có dữ liệu minh họa và tương tác mô phỏng, không phải trang production. Không dùng các số liệu, hội thoại mẫu hoặc trạng thái giả của file này làm dữ liệu app.

Mẫu này là chuẩn đối chiếu bố cục, thứ tự khối, cách biểu diễn quan hệ và tương tác. Nội dung thực tế phải đọc từ Hub; giữ Bootstrap và các chức năng mới của repo. Nếu dữ liệu thật không có trường trong mẫu, ghi rõ chưa ghi nhận, không dựng số liệu để làm giống hình.

| Khu vực | Mẫu đã chốt | Sai khác ở bản kỹ thuật hiện tại / việc Claude cần kiểm tra |
|---|---|---|
| Tổng quan | Tab gạch dưới → endpoint → 4 thẻ tài nguyên → lựa chọn → cặp bản đồ và hoạt động → bảng yêu cầu | Tab dạng nút, endpoint đứng trước tab; cần so thứ tự, khoảng cách và phân cấp thông tin |
| Bản đồ hoạt động | Đường nối Agent–Kết nối, chọn đối tượng làm nổi quan hệ và làm mờ phần không liên quan | Hai danh sách cùng bảng quan hệ thu gọn; chưa có đường nối tương tác |
| Hoạt động bên phải | Biểu đồ vòng lượt gọi theo agent, chú giải chọn được, thanh tỷ lệ dung lượng vào/ra, lối mở công cụ ít dùng | Thay bằng số liệu chữ; 4 biểu đồ đặt thành hàng riêng phía dưới |
| Yêu cầu gần đây | Bảng cột yêu cầu/công cụ, agent→kết nối, trạng thái, thời điểm; chọn để mở Nhật ký | Đang dùng danh sách thẻ; chưa đối chiếu khả năng đọc và chọn hàng theo mẫu |
| Tồn kho công cụ | Bảng theo mẫu, bộ lọc, chọn công cụ mở chi tiết quan hệ và đường tới quản lý | Đang dùng thẻ và liên kết quản lý; thiếu phần chọn công cụ mở chi tiết tại chỗ |
| Chi tiết yêu cầu | Các nút tròn nối thành 5 bước; tab Tóm tắt/Đầu vào/Đầu ra/Quyền; đường quay lại và mở đúng đối tượng | Có dữ liệu mốc và tab nhưng hình thức bước, bố cục chi tiết chưa theo mẫu |
| Chat, màn hình nhỏ | Chat gắn với ngữ cảnh đang xem; bố cục và đường nối thay đổi theo không gian còn lại | Kiểm thử hiện tại chưa đối chiếu trực quan khi chat mở và các trạng thái chọn/lọc |

### Bàn giao Claude kiểm tra

1. Đọc PR #96, bàn giao mới nhất và mẫu HTML trên nhánh `feat/integrated-monitor`. Dùng worktree riêng. Không cần hỏi Ryan gửi lại mẫu.
2. Mở file mẫu bằng trình duyệt, thao tác các tab, chọn agent/kết nối/công cụ, mở chi tiết và chat để hiểu hành vi; sau đó chạy app thật trên dữ liệu thử nghiệm riêng.
3. So sánh mẫu và app ở cùng kích thước: desktop 1440×1000, tablet 1024×900, mobile 390×844; thêm desktop khi chat mở. Chụp ảnh cả hai phía cho cùng trạng thái và ghi rõ ảnh mẫu/ảnh app, commit và viewport. Dùng dữ liệu tổng hợp/ẩn danh, không đưa thông tin production lên PR.
4. Phân biệt hai kết luận: **đạt kỹ thuật** và **khớp thiết kế đã chốt**. Bảng review cần có khu vực, mong đợi, thực tế, bằng chứng ảnh, mức độ và đề xuất sửa. Không chỉ chạy lại bộ test đang PASS rồi kết luận giao diện hoàn tất.
5. Kiểm tra đúng dữ liệu thực tế: `tools[].published` khác permission; quyền đã cấp khác đang dùng được; bytes chỉ đo JSON sau che bí mật; timeline chỉ có mốc đã ghi nhận; không vẽ hàng đợi vì Hub hiện từ chối khi hết suất xử lý.
6. Rà lại các chỗ render dữ liệu vào HTML. Nhận xét trước rằng không có `innerHTML` mới là chưa chính xác: `public/app.js` có cập nhật `innerHTML` cho Monitor. Điều cần xác minh là escape, dữ liệu được đưa vào DOM và cách tạo thuộc tính/SVG; sự tồn tại của `innerHTML` tự nó chưa chứng minh có lỗi XSS.
7. Đăng `[REVIEW — THIẾT KẾ MONITOR]` trực tiếp PR #96, nêu các phần phải sửa và các điểm chưa kiểm chứng. Yêu cầu hiện tại của Ryan là bàn giao để Claude kiểm tra; không đồng nghĩa đã nghiệm thu hoặc cho phép merge/deploy.

Tiêu chí hoàn tất phần giao diện: các khối và tương tác bám mẫu; trường thiếu có giải thích trung thực; không mất Bootstrap/chức năng hiện có; không tràn ngang hoặc che nút trên viewport kiểm tra; có bằng chứng trực quan và kiểm thử luồng thật. Các test UI về bố cục phải phản ánh mẫu đã chốt, không giữ bố cục sai chỉ vì test cũ đang PASS.

## Trải nghiệm

- **Toàn cảnh:** agent, kết nối, toàn bộ công cụ, Vault; quan hệ cấp quyền/sử dụng; số lượt gọi và dung lượng đầu vào/đầu ra. Chọn agent hoặc kết nối để xem quan hệ và yêu cầu tương ứng, rồi mở trang quản lý đúng đối tượng.
- **Luồng đang xử lý:** yêu cầu đang thực hiện, bước đang chạy, thời điểm bắt đầu. Chọn yêu cầu mở Nhật ký, cập nhật sang kết quả khi hoàn tất.
- **Tồn kho công cụ:** gồm cả công cụ chưa công bố và kết nối đang tắt. Phân biệt quyền đã cấp với agent hiện dùng được (agent active + quyền riêng + công cụ published + kết nối sẵn sàng), tổng lượt trong lịch sử còn lưu và lần gọi gần nhất. Công cụ ít dùng đứng trước. Quyền/công bố vẫn được sửa ở trang quản lý hiện có.
- **Nhật ký:** thời điểm từng bước được ghi thực tế, input/output đã che bí mật, quyết định quyền tại thời điểm gọi, đường về đúng agent/MCP.
- **Trợ lý:** dùng LLM owner đã cấu hình, nhận thống kê và ngữ cảnh đối tượng/yêu cầu do server đọc. Không gửi giá trị Vault, credential hoặc payload input/output vào ngữ cảnh tự động. Việc đổi quyền/xóa vẫn qua quy trình xác nhận đang có.

## Dữ liệu và giới hạn

`GET /api/monitor?period=today|12|24|168` yêu cầu phiên owner; tổng hợp trực tiếp SQLite, không giới hạn 200 dòng. Mốc hôm nay theo GMT+7. Bộ lọc `actor`/`mcp` áp dụng trước khi tổng hợp lượt gọi và lấy 30 nhật ký gần nhất; số lượng tài nguyên vẫn là toàn Hub. Trạng thái công bố đọc từ từng `tools[].published`, không suy ra từ trường cấp connector. `GET /api/monitor/active` chỉ trả metadata yêu cầu. Tổng quan cập nhật mỗi 15 giây; trạng thái đang chạy mỗi 3 giây khi trang đang mở. Lỗi tải hiển thị dữ liệu cũ kèm thời điểm và thông báo.

Lượt gọi chỉ gồm sự kiện công cụ của agent theo phân loại audit chung; không trộn owner, system hoặc admin assistant vào thống kê này. Nhóm theo ID, không nhóm theo tên. Bốn biểu đồ hoạt động sử dụng lại `smallPie()` hiện có.

“Chưa ghi nhận sử dụng” chỉ nói về phần lịch sử còn lưu, không chứng minh công cụ chưa từng được dùng. Byte là kích thước JSON đã lưu sau che bí mật, không phải token LLM hoặc lưu lượng mạng. Nhật ký cũ/metadata-only chưa có số đo byte được đánh dấu thiếu; không suy ra bằng 0. Lưu trình cũ thiếu thời điểm từng bước không được dựng giả.

Hub đang từ chối khi hết suất xử lý đồng thời, không có hàng đợi. Registry đang chạy giữ metadata trong `records` với kind `monitor-operation`; hoàn tất thì xóa registry và lưu timeline vào audit đã mã hóa. Sau khởi động lại, yêu cầu còn dang dở được đánh dấu **chưa xác nhận kết quả**, giữ tối đa 24 giờ và không tự thử lại. Giám sát ở đây là từng lượt MCP đi qua Hub, không phải toàn bộ suy nghĩ/công việc agent thực hiện bên ngoài Hub.

## Tương thích và phát hành

- Giữ `PRAGMA user_version=1`. Chỉ thêm hai cột nullable `inputBytes`, `outputBytes` vào audit; timeline nằm trong payload audit. Không viết lại ciphertext hoặc lịch sử cũ.
- Giữ IDs, master key, credential, permissions, owner session, agent token và pending OAuth. Không thay đổi installer, domain, cơ chế cập nhật hoặc cấu hình dịch vụ đang cài. Monitor không phụ thuộc Gitea.
- Nhánh phát triển/PR được kiểm thử trước khi merge. Bản cài đang bật tự cập nhật có thể lấy `main` sau CI thành công, vì vậy merge là quyết định phát hành cần review.
- Rollback ứng dụng với schema v1 được kiểm tra. Không có cam kết nâng cấp trên một máy cụ thể trước khi xác minh revision/config thực tế; bài kiểm tra ở đây dùng dữ liệu tổng hợp, không đọc database sản xuất.

## Kiểm chứng có thể chạy lại

```bash
node --test tests/monitor.test.mjs tests/monitor_upgrade.test.mjs
node --test tests/ui_monitor_test.mjs tests/ui_overview_inventory_test.mjs tests/ui_audit_fixes_test.mjs tests/ui_bootstrap_test.mjs
node scripts/verify-monitor-upgrade.mjs /path/to/previous-release-checkout
```

Bài kiểm tra cuối dựng cùng một installation thử nghiệm và chạy HTTP thật qua ba lượt: bản trước → bản Monitor → bản trước. Cùng database, master key, phiên owner và token agent; kiểm tra credential/Vault/pending OAuth, bảo toàn ciphertext cũ và gọi công cụ được ở cả ba lượt. Connector thử nghiệm không thực hiện tác động bên ngoài.

Đã chạy chuyển đổi với checkout `7fc5ed005db763975200aed23d489fa7d54047df` và `9959e10a70ad8f2ca397e52370ccd76b898cb27d` trong môi trường phát triển. Mốc thứ hai là bản production được agent local xác minh trong Issue #95. Bài kiểm tra còn xác nhận Bootstrap tùy chỉnh và instructions khi kết nối được giữ qua nâng cấp/quay lại. Đây là bằng chứng tương thích ở cấp ứng dụng/dữ liệu; chưa phải nghiệm thu cập nhật Docker/HTTPS trên máy Ryan.

Kết quả kiểm tra trên nền `619e776`: 10/10 bài Monitor, migration và Bootstrap; kiểm tra cú pháp/Python 78/78. Toàn bộ backend 193/199, còn 6 lỗi phân giải DNS ở các bài LLM/telemetry/outbound đã tái hiện trên nền cũ chưa sửa. UI Monitor chưa được nghiệm thu do Chromium trong môi trường phát triển không khởi động được; phải chạy các bài trình duyệt trên CI hoặc môi trường local đã chuẩn bị trước khi duyệt phát hành.
