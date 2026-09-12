# Monitor tích hợp trong Gen-hub

Tổng quan là nơi xem tài nguyên, hoạt động và yêu cầu đi qua Hub. Dữ liệu do backend trả về; không có fixture hoặc hội thoại mẫu trong sản phẩm. Các trang Agent, MCP, Vault, Bootstrap, Nhật ký và khung chat hiện có tiếp tục là nơi quản lý/thao tác.

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
