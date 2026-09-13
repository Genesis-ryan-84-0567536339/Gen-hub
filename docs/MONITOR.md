# Monitor tích hợp trong Gen-hub

Tổng quan là nơi xem tài nguyên, hoạt động và yêu cầu đi qua Hub. Dữ liệu do backend trả về; không có fixture hoặc hội thoại mẫu trong sản phẩm. Các trang Agent, MCP, Vault, Bootstrap, Nhật ký và khung chat hiện có tiếp tục là nơi quản lý/thao tác.

## Mẫu giao diện đã chốt và trạng thái nghiệm thu

**Đã sửa bố cục và bổ sung cấp quyền hàng loạt; chờ review độc lập và Ryan nghiệm thu.** Bản kỹ thuật `67819e2` trước đó lệch mẫu. Đợt sửa mới thay phần trình bày và tương tác theo bảng dưới; kết quả kiểm thử/ảnh gắn với commit cụ thể nằm trong bàn giao mới nhất tại PR #96. PASS kỹ thuật không thay cho nghiệm thu giao diện.

Nguồn chuẩn giao diện: [gen-hub-integrated-monitor.html](design/gen-hub-integrated-monitor.html). Đây là nguyên bản HTML tích hợp đã trình bày và được Ryan chốt trong hội thoại, đưa vào repo để Claude có thể mở trực tiếp. Đây là tài liệu mẫu có dữ liệu minh họa và tương tác mô phỏng, không phải trang production. Không dùng các số liệu, hội thoại mẫu hoặc trạng thái giả của file này làm dữ liệu app.

Mẫu này là chuẩn đối chiếu bố cục, thứ tự khối, cách biểu diễn quan hệ và tương tác. Nội dung thực tế phải đọc từ Hub; giữ Bootstrap và các chức năng mới của repo. Nếu dữ liệu thật không có trường trong mẫu, ghi rõ chưa ghi nhận, không dựng số liệu để làm giống hình.

| Khu vực | Đã sửa | Điểm cần đối chiếu khi review |
|---|---|---|
| Tổng quan | Tab gạch dưới → endpoint → 4 thẻ → lựa chọn → cặp bản đồ/hoạt động → bảng yêu cầu | Thứ tự, khoảng cách; giữ shell/Bootstrap/nút cập nhật của phiên bản hiện tại |
| Bản đồ | Đường cong SVG theo vị trí thật của node; chọn làm nổi quan hệ và mờ node không liên quan | Đường nối đúng lượt gọi, không suy ra từ quyền; vẫn thấy toàn bộ tài nguyên khi chọn |
| Hoạt động bên phải | Một donut theo agent, chú giải bấm được, thanh tỷ lệ byte vào/ra, lối mở công cụ chưa dùng | Tổng/chú giải đúng bộ lọc; thiếu số đo có thông báo; không còn hàng 4 biểu đồ lệch mẫu |
| Yêu cầu gần đây | Bảng 4 cột, 6 yêu cầu mới nhất, mở chi tiết qua Nhật ký; đường xem toàn bộ lịch sử | Không làm trang tổng quan dài thành trang nhật ký; số liệu tổng vẫn tính toàn bộ khoảng chọn |
| Tồn kho | Bảng có bộ lọc, chọn tên mở chi tiết ngay trong trang và đi tới quản lý đúng đối tượng | Lượt trong khoảng chọn khác tổng lịch sử còn lưu; quyền đã cấp khác đang dùng được |
| Chi tiết yêu cầu | 5 bước tròn có đường nối, màu đã ghi/đang chạy/lỗi; các tab và link quản lý | Chỉ hiện thời điểm có bằng chứng; nhật ký cũ không tự dựng timeline |
| Chat và mobile | Bố cục theo chiều rộng vùng nội dung; vẽ lại đường khi resize/mở chat | 1440×1000, 1024×900, 390×844, thêm trạng thái chọn và chat mở |
| Cấp quyền hàng loạt | Chọn nhiều agent + tool, xem trước rồi cấp thêm một lần | Không thu hồi quyền cũ, không cấp Vault/admin, không tự công bố tool; lỗi cả đợt không ghi một phần |

### Bàn giao Claude kiểm tra

1. Đọc PR #96, bàn giao mới nhất và mẫu HTML trên nhánh `feat/integrated-monitor`. Dùng worktree riêng. Không cần hỏi Ryan gửi lại mẫu.
2. Mở file mẫu bằng trình duyệt, thao tác các tab, chọn agent/kết nối/công cụ, mở chi tiết và chat để hiểu hành vi; sau đó chạy app thật trên dữ liệu thử nghiệm riêng.
3. So sánh mẫu và app ở cùng kích thước: desktop 1440×1000, tablet 1024×900, mobile 390×844; thêm desktop khi chat mở. Chụp ảnh cả hai phía cho cùng trạng thái và ghi rõ ảnh mẫu/ảnh app, commit và viewport. Dùng dữ liệu tổng hợp/ẩn danh, không đưa thông tin production lên PR.
4. Phân biệt hai kết luận: **đạt kỹ thuật** và **khớp thiết kế đã chốt**. Bảng review cần có khu vực, mong đợi, thực tế, bằng chứng ảnh, mức độ và đề xuất sửa. Không chỉ chạy lại bộ test đang PASS rồi kết luận giao diện hoàn tất.
5. Kiểm tra đúng dữ liệu thực tế: `tools[].published` khác permission; quyền đã cấp khác đang dùng được; bytes chỉ đo JSON sau che bí mật; timeline chỉ có mốc đã ghi nhận; không vẽ hàng đợi vì Hub hiện từ chối khi hết suất xử lý.
6. Rà lại các chỗ render dữ liệu vào HTML. Nhận xét trước rằng không có `innerHTML` mới là chưa chính xác: `public/app.js` có cập nhật `innerHTML` cho Monitor. Điều cần xác minh là escape, dữ liệu được đưa vào DOM và cách tạo thuộc tính/SVG; sự tồn tại của `innerHTML` tự nó chưa chứng minh có lỗi XSS.
7. Kiểm tra cấp quyền hàng loạt từ cả Agent & quyền và Tồn kho: chọn hai agent có quyền khác nhau, xem trước, thay lựa chọn, cấp quyền, kiểm tra nhật ký và quyền hiệu lực. Thử thu hồi một agent sau khi xem trước: cả đợt phải bị từ chối.
8. Đăng `[REVIEW — THIẾT KẾ MONITOR]` trực tiếp PR #96, tách kết luận kỹ thuật/giao diện và nêu phần chưa kiểm chứng. Ryan yêu cầu sửa và bổ sung tính năng, chưa nghiệm thu hay cho phép merge/deploy.

Tiêu chí hoàn tất phần giao diện: các khối và tương tác bám mẫu; trường thiếu có giải thích trung thực; không mất Bootstrap/chức năng hiện có; không tràn ngang hoặc che nút trên viewport kiểm tra; có bằng chứng trực quan và kiểm thử luồng thật. Các test UI về bố cục phải phản ánh mẫu đã chốt, không giữ bố cục sai chỉ vì test cũ đang PASS.

## Trải nghiệm

- **Toàn cảnh:** agent, kết nối, toàn bộ công cụ, Vault; quan hệ cấp quyền/sử dụng; số lượt gọi và dung lượng đầu vào/đầu ra. Chọn agent hoặc kết nối để xem quan hệ và yêu cầu tương ứng, rồi mở trang quản lý đúng đối tượng.
- **Luồng đang xử lý:** yêu cầu đang thực hiện, bước đang chạy, thời điểm bắt đầu. Chọn yêu cầu mở Nhật ký, cập nhật sang kết quả khi hoàn tất.
- **Tồn kho công cụ:** gồm cả công cụ chưa công bố và kết nối đang tắt. Phân biệt quyền đã cấp với agent hiện dùng được (agent active + quyền riêng + công cụ published + kết nối sẵn sàng), lượt trong khoảng chọn; chi tiết có tổng lịch sử còn lưu và lần gọi gần nhất. Công cụ ít dùng đứng trước. Có lối cấp quyền hàng loạt và quản lý công bố.
- **Nhật ký:** thời điểm từng bước được ghi thực tế, input/output đã che bí mật, quyết định quyền tại thời điểm gọi, đường về đúng agent/MCP.
- **Trợ lý:** dùng LLM owner đã cấu hình, nhận thống kê và ngữ cảnh đối tượng/yêu cầu do server đọc. Không gửi giá trị Vault, credential hoặc payload input/output vào ngữ cảnh tự động. Việc đổi quyền/xóa vẫn qua quy trình xác nhận đang có.

## Dữ liệu và giới hạn

`GET /api/monitor?period=today|12|24|168` yêu cầu phiên owner; tổng hợp trực tiếp SQLite, không giới hạn 200 dòng. Mốc hôm nay theo GMT+7. Bộ lọc `actor`/`mcp` áp dụng trước khi tổng hợp lượt gọi và lấy 30 nhật ký gần nhất; số lượng tài nguyên vẫn là toàn Hub. Trạng thái công bố đọc từ từng `tools[].published`, không suy ra từ trường cấp connector. `GET /api/monitor/active` chỉ trả metadata yêu cầu. Tổng quan cập nhật mỗi 15 giây; trạng thái đang chạy mỗi 3 giây khi trang đang mở. Lỗi tải hiển thị dữ liệu cũ kèm thời điểm và thông báo.

Lượt gọi chỉ gồm sự kiện công cụ của agent theo phân loại audit chung; không trộn owner, system hoặc admin assistant vào thống kê này. Nhóm theo ID, không nhóm theo tên. Một biểu đồ vòng theo agent nằm cạnh bản đồ. Chú giải chỉ có agent có lượt gọi; agent chưa dùng vẫn xuất hiện trên bản đồ.

Bộ lọc “Chưa dùng trong khoảng chọn” lấy công cụ đã công bố có `calls=0` trong thời gian/đối tượng đã chọn. Tổng lịch sử còn lưu (`retainedCalls`) chỉ dùng trong chi tiết. Không kết luận một công cụ chưa từng được dùng. Byte là kích thước JSON đã lưu sau che bí mật, không phải token LLM hoặc lưu lượng mạng. Nhật ký cũ/metadata-only chưa có số đo byte được đánh dấu thiếu; không suy ra bằng 0. Lưu trình cũ thiếu thời điểm từng bước không được dựng giả.

Hub đang từ chối khi hết suất xử lý đồng thời, không có hàng đợi. Registry đang chạy giữ metadata trong `records` với kind `monitor-operation`; hoàn tất thì xóa registry và lưu timeline vào audit đã mã hóa. Sau khởi động lại, yêu cầu còn dang dở được đánh dấu **chưa xác nhận kết quả**, giữ tối đa 24 giờ và không tự thử lại. Giám sát ở đây là từng lượt MCP đi qua Hub, không phải toàn bộ suy nghĩ/công việc agent thực hiện bên ngoài Hub.

## Cấp quyền hàng loạt

Mở tại **Agent & quyền → Cấp quyền hàng loạt**, hoặc **Tồn kho công cụ → Cấp quyền hàng loạt**. Từ chi tiết một tool, nút này chọn sẵn tool đó. Chọn agent đang hoạt động, chọn công cụ theo MCP (có chọn tất cả/chỉ đọc/bỏ chọn), bấm **Xem trước quyền sẽ thêm**, đọc số quyền mới/đã có của từng agent rồi bấm **Cấp quyền đã xem trước**. Bỏ chọn ở đây chỉ sửa lựa chọn của đợt cấp, không thu hồi quyền đang có.

`POST /api/agents/bulk-grants` dùng phiên owner và CSRF hiện có:

- Xem trước: `{agentIds, permissions, preview: true}`. Trả `previewToken`, tổng agent/tool/quyền mới và chi tiết quyền mới/đã có của mỗi agent. Không ghi DB hay audit.
- Áp dụng: `{agentIds, permissions, previewToken}`. Kiểm tra lại toàn bộ danh sách rồi lưu trong một transaction. Token đối chiếu ảnh chụp quyền/agent lúc xem trước; thay đổi kể từ đó trả 409 để xem trước lại.
- 1–100 agent mỗi đợt, danh sách tối đa 2000 quyền; quyền sau hợp nhất của từng agent không vượt 2000. Loại bỏ ID/quyền trùng. Chỉ thêm công cụ MCP đã công bố; không thay `status`, quyền quản trị, quyền Vault hay quyền đã có.
- Agent không hoạt động, công cụ không hợp lệ/chưa công bố, dữ liệu quá giới hạn hoặc lỗi ghi DB: không cập nhật một phần. Khi có quyền mới, ghi một sự kiện `agent.bulk_grants` (admin_action) với danh sách thay đổi; cấp trùng không tạo thêm quyền hoặc audit giả.
- Thay lựa chọn trên form hủy kết quả xem trước và khóa nút cấp đến khi xem trước lại. Công cụ thuộc kết nối đang tắt vẫn có thể được cấp trước, nhưng chỉ gọi được khi kết nối sẵn sàng.

## Tương thích và phát hành

- Giữ `PRAGMA user_version=1`. Chỉ thêm hai cột nullable `inputBytes`, `outputBytes` vào audit; timeline nằm trong payload audit. Không viết lại ciphertext hoặc lịch sử cũ.
- Giữ IDs, master key, credential, permissions, owner session, agent token và pending OAuth. Không thay đổi installer, domain, cơ chế cập nhật hoặc cấu hình dịch vụ đang cài. Monitor không phụ thuộc Gitea.
- Nhánh phát triển/PR được kiểm thử trước khi merge. Bản cài đang bật tự cập nhật có thể lấy `main` sau CI thành công, vì vậy merge là quyết định phát hành cần review.
- Rollback ứng dụng với schema v1 được kiểm tra. Không có cam kết nâng cấp trên một máy cụ thể trước khi xác minh revision/config thực tế; bài kiểm tra ở đây dùng dữ liệu tổng hợp, không đọc database sản xuất.

## Kiểm chứng có thể chạy lại

```bash
node --test tests/bulk_grants.test.mjs tests/monitor.test.mjs tests/monitor_upgrade.test.mjs
UI_SCREENSHOT_DIR=test-results/monitor node --test tests/ui_monitor_design_test.mjs tests/ui_monitor_test.mjs tests/ui_overview_inventory_test.mjs tests/ui_audit_fixes_test.mjs tests/ui_bootstrap_test.mjs
node scripts/verify-monitor-upgrade.mjs /path/to/previous-release-checkout
```

Bài kiểm tra cuối dựng cùng một installation thử nghiệm và chạy HTTP thật qua ba lượt: bản trước → bản Monitor → bản trước. Cùng database, master key, phiên owner và token agent; kiểm tra credential/Vault/pending OAuth, bảo toàn ciphertext cũ và gọi công cụ được ở cả ba lượt. Connector thử nghiệm không thực hiện tác động bên ngoài.

Đã chạy chuyển đổi với checkout `7fc5ed005db763975200aed23d489fa7d54047df` và `9959e10a70ad8f2ca397e52370ccd76b898cb27d` trong môi trường phát triển. Mốc thứ hai là bản production được agent local xác minh trong Issue #95. Bài kiểm tra còn xác nhận Bootstrap tùy chỉnh và instructions khi kết nối được giữ qua nâng cấp/quay lại. Đây là bằng chứng tương thích ở cấp ứng dụng/dữ liệu; chưa phải nghiệm thu cập nhật Docker/HTTPS trên máy Ryan.

CI tạo artifact **monitor-design-screenshots**. Ảnh `approved-*` lấy nguyên mẫu đã chốt; `monitor-*` và `bulk-grants-*` lấy app chạy thật với dữ liệu kiểm thử tổng hợp. Tên ảnh chỉ trạng thái/viewport, không phải bằng chứng của production. Đọc commit/run/artifact cụ thể ở bàn giao PR #96; không dùng ảnh từ commit cũ để xác nhận commit mới.

Lần chạy trên `0195d48`: backend 202/202, Python 78/78, Docker Ubuntu 22.04/24.04 PASS; UI 14/16 do hai bài kiểm tra chọn sai selector/fixture sau đổi thiết kế. Các selector đã sửa trong `e9b06bc`; xem kết quả lần chạy mới tại PR. Kiểm tra nâng cấp và quay lại nền production `9959e10` đã chạy lại thành công sau bổ sung cấp quyền. Không coi kết quả này là nghiệm thu trên máy Ryan.
