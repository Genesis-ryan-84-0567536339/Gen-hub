# Dashboard vận hành tối thiểu — Gói C (O1, O3, O4)

Refs #23. Một PR gồm các commit backend và giao diện riêng để review hợp đồng
API trước, rồi nghiệm thu xuyên suốt dashboard → logs → export. Không merge/deploy
trong bàn giao này.

## Mẫu số và phân loại

- Tool calls: `eventKind=tool_call AND actorType=agent`. Đếm một lần khi lời gọi
  đã đến nhánh `tools/call` sau xác thực/protocol validation. Thiếu tên tool vẫn
  là một validation error; tools/list, initialize, owner/admin/system không vào
  mẫu số. Vault read qua MCP có một audit tại dispatcher, kể cả khi read lỗi.
- `policyDecision=allow|deny|null` độc lập với `outcome=success|error|null`.
  Null nghĩa là chưa có bằng chứng/quyết định áp dụng, không phải DENY hay ALLOW.
  Sau policy allow, validation/transport/domain failure vẫn giữ ALLOW.
  `status` cũ được giữ tương thích (`success`, `error`, `denied`).
- `actorType`: agent, owner, admin, system, anonymous, unclassified. Với record mới,
  role lấy từ agent registry tại lúc ghi, gồm admin gọi endpoint `/mcp` thường;
  đổi quyền sau này không đổi role lịch sử. Metadata ghi
  mới có eventKind, actorType, policyDecision, outcome, errorCategory,
  latencyMeasured, operationId. Giá trị `unclassified` dành cho nguồn không đủ
  bằng chứng; lỗi không được suy đoán từ chuỗi nội dung tự do.
- Validation: schema của Hub/adapter hoặc lỗi local HTTP 400 không có upstream
  status. Authentication: 401; rate_limit: 429; timeout: 408/504/timeout; HTTP
  upstream 409/422 và MCP `result.isError`: upstream_tool_conflict (nhóm lỗi
  nghiệp vụ tool, không tuyên bố mọi lỗi trong nhóm là merge conflict). Các lỗi
  transport/protocol upstream khác: upstream_transport; lỗi nội bộ: internal.
  Giữ upstreamStatus để 429/409 không mất loại khi public response vẫn là 502.
- 401/429 tại cửa xác thực/rate admission của `/mcp` và `/mcp/admin` ghi auth
  telemetry riêng, không có bearer token, không vào tool calls. Đây không phải
  telemetry hoàn chỉnh cho mọi HTTP endpoint (O10 vẫn là gói sau).
- Admin dispatcher và audit mutation con dùng cùng operationId qua
  AsyncLocalStorage, an toàn khi nhiều request đồng thời. Tổng otherEvents đếm
  distinct operationId theo eventKind; lịch sử thiếu ID chỉ đếm record và ghi rõ
  legacy. Tool calls không cộng audit mutation của admin.

## Lịch sử không bị sửa

Migration chỉ ADD COLUMN nullable, không UPDATE payload/metadata cũ. Raw audit
vẫn được giữ theo retention hiện hữu. Bản cũ được chiếu qua cùng SQL cho summary,
logs và export:

1. actor owner/system/admin-assistant:* nhận loại tương ứng; agent-*/agt-* nhận
   agent. ID không nhận diện được là unclassified, kể cả entity đã bị xóa.
2. actor system hoặc tool system.* → system; owner.*/security.*/auth.* → auth;
   owner/admin còn lại → admin_action; agent và mcp khác hub → tool_call;
   còn lại → unclassified.
3. success/ok → outcome success; error/denied → outcome error. denied → policy
   deny; tool-call success → allow. Error lịch sử không có bằng chứng policy
   trong metadata → null. Nội dung reason gốc vẫn xem được tại chi tiết.
4. denied → category denied; error → unclassified. Không giải mã hàng nghìn
   payload cũ để đoán validation/conflict. Vì vậy số 7 validation + 1 conflict
   của snapshot audit cũ không tự động được gán lại; những record mới mới có
   phân loại chính xác ở điểm thực thi.
5. Latency cũ chỉ coi là đo được với tool call có latency > 0. Số 0 cũ không
   phân biệt được mặc định với đo thật nên bỏ khỏi percentile. Latency mới 0 ms
   vẫn hợp lệ khi được đo (latencyMeasured=1).

API thêm `classification=legacy|recorded`; Nhật ký hiện nhãn lịch sử và loại lỗi.
Không dùng status error để hiện decision ERROR nữa. Tổng quan hiển thị số legacy,
unclassified, missingLatency; không trình bày thiếu bằng chứng thành kết quả tốt.

## Hợp đồng tổng hợp và drill-down

`GET /api/logs/summary?since=<ISO>&until=<ISO>` dùng cùng quyền owner/admin console
và bộ lọc metadata với `/api/logs`. Mặc định 24h, tối đa 90 ngày; khoảng >0.
Không nhận cursor, secret hoặc includePayload. Không chọn/giải mã cột payload.
SQLite iterate metadata toàn khoảng bằng index thời gian sẵn có; server giữ các
mẫu số latency cần cho exact percentile, không gửi từng audit record ra browser.
Độ phức tạp đọc O(n), sort percentile O(n log n), bộ nhớ O(n) theo số mẫu latency;
chưa có rollup/worker nền (O9). Không có giới hạn ngầm 200/5.000.

Response: totals, buckets, connectors, agents, tools, data coverage. Các dimension
nhóm theo ID; tool theo cặp connector ID + tool name, không gộp tên hiển thị.
Những connector/agent đã xóa vẫn hiện bằng ID. Top 10 agent/tool trên UI xếp calls.

- Summary dùng khoảng **[since, until)**. Logs thêm `before` exclusive để click
  bucket không trùng biên với bucket kế; `until` cũ vẫn inclusive để tương thích B.
- Bucket theo GMT+7: <=6h dùng 5 phút, <=7 ngày dùng giờ, còn lại ngày. Bucket đầu/
  cuối cắt theo khoảng xem. Calls/phút = calls / phút thực tế trong phần bucket.
- Calls = success + execution error + denied (+ unknown nếu trạng thái cũ lạ).
  Error rate = execution errors / calls, denial rate = denied / calls. Không xem
  tổng lỗi thao tác là uptime/downtime. Khi calls=0, cả hai rate là null, UI
  “Không có mẫu”; lưu lượng 0 calls/phút vẫn là phép đếm, không đánh giá sức khỏe.
- Filter eventKind, actorType, outcome, policyDecision, errorCategory áp trước
  pagination, dùng chung với export; UI giữ filter chính xác trong URL kể cả
  reload/back. Export tiếp tục giới hạn 5.000 của Gói B, UI ghi rõ giới hạn đó.

## Percentile, histogram và thời gian đo

Nearest-rank trên latency gốc đã sắp xếp: vị trí ceil(q*n), q=0.5/0.95. Phân phối
success/error tách riêng, không gồm denied; không trung bình p95 các bucket/
connector. n=0 → null/N/A; 1..19 → “Mẫu nhỏ”. Histogram tích lũy <= 5,10,25,50,
100,250,500,1000,2500,5000,10000,30000,+Inf ms có thể cộng theo cùng biên.
Cơ sở: [Prometheus histograms and summaries](https://prometheus.io/docs/practices/histograms/)
phân biệt phân phối gộp được với các quantile không gộp được.

Latency của tool từ lúc vào tools/call (sau auth/protocol) qua policy, validation,
connector đến trước ghi audit/trả HTTP. Không đo byte mạng hay thời gian client.
`phases` ở payload chi tiết lưu slotWait (0 vì admission fail-fast, không có hàng
đợi), connectorTotal, credentialRefresh (bao gồm chờ refresh lock), initialize,
upstreamCall, cleanup khi pha đó chạy. Pha vắng mặt nghĩa là không đo/không chạy,
không phải mặc định 0. Pha có thể lồng nhau (ví dụ refresh trong initialize), nên
không cộng các pha để suy ra total. Cleanup lỗi bị bỏ qua theo hành vi cũ; đo
thời gian không thay đổi kết quả nghiệp vụ hay báo cleanup thành outage.

## Tình trạng dữ liệu

fetchedAt là thời điểm query server, không đổi thành giờ render. Fetch thất bại
hiện cảnh báo và thời điểm cũ. Dashboard ghi earliestAvailableAt, retentionBoundary,
effectiveRetentionDays và incomplete khi khoảng vượt retention. Earliest log
không chứng minh thu thập liên tục; coverageStartUnknown được ghi rõ, không suy
diễn khoảng không request là khỏe. Health probes/alerts/auto-refresh vẫn thuộc D.

## Kiểm chứng cục bộ

- Fixture 32 tool calls + 4 system events → 32, 24 success / 8 error; 7 validation
  + 1 domain conflict. Owner/admin/system thêm vào không đổi tổng/rate tool calls.
- Fixture 5.100 calls ngoài giới hạn trang; group theo connector ID và cặp
  connector/tool, biên thời gian exclusive; encrypted payload hỏng không làm
  ảnh hưởng summary. Migration mở lại DB giữ raw rows nguyên byte.
- Tập latency 1..100 → p50=50, p95=95; 100 mẫu 100ms + 1 mẫu 1000ms → p95=100ms,
  không phải 550ms; n=0, n=19/20, histogram, success/error, Vault, phase MCP.
- Probe 100.000 events trong DB tạm, 4 agents / 3 connectors / 10 tools, 5 lần
  summary toàn 24h: 1412 / 1182 / 1122 / 1067 / 1134 ms; tổng luôn 100.000.
  Node 24.20.0, Intel i7-4771 3.50GHz, 8 logical CPUs, RAM 31 GiB; peak RSS cả
  process seed+5 query 240 MiB. Đây là 5 lần đo local, không phải p95 benchmark
  production. Summary exact giữ mẫu trong bộ nhớ và chặn event loop khoảng 1s
  ở cỡ này; không áp mục tiêu metadata page <500ms của O2 cho summary toàn tập.
- Nghiệm thu cuối trên Node 24.20.0: `npm test` 130/130; `npm run check` syntax
  và Python 45/45; UI 11/11 với `NO_AT_SPI_BUS=1`, Chrome `/usr/bin/google-chrome`,
  timeout toàn suite 180s. UI kiểm tra desktop 1440px/mobile 390px, exact
  drill-down, reload/back, export, ALLOW + error, empty samples và fetch lỗi.
  Ảnh fixture local: `/tmp/audit-c-evidence/dashboard-desktop.png` và
  `/tmp/audit-c-evidence/dashboard-mobile.png` (không dùng production data).
