# Đặc tả JSON Schema & Hợp đồng Lỗi Chuẩn Hóa (C2)

Tài liệu này công bố tập con JSON Schema được hỗ trợ bởi hệ thống `Gen-hub` (`server/net.mjs:assertSchema`) và chuẩn hóa cấu trúc lỗi (`HubError` / `ValidationError`) theo kiến nghị C2 trong báo cáo kiểm toán Gói F (Issue #73).

---

## 1. Tập con JSON Schema hỗ trợ (Supported Schema Subset)

Hàm `assertSchema(schema, args)` kiểm định dữ liệu đầu vào (đặc biệt là MCP tool `inputSchema` và API payloads) dựa trên tập từ khóa sau:

### 1.1. Kiểu dữ liệu gốc (Primitive Types)
- **`string`**:
  - `typeof value === 'string'`
  - `minLength`: độ dài tối thiểu của chuỗi.
  - `maxLength`: độ dài tối đa của chuỗi (mặc định trần bảo vệ là 100.000 ký tự để chống DoS).
  - `pattern`: biểu thức chính quy (chuỗi regex hoặc đối tượng `RegExp`).
- **`integer`**:
  - `Number.isSafeInteger(value)`
  - `minimum` / `maximum`: biên giá trị bao gồm (inclusive).
  - `exclusiveMinimum` / `exclusiveMaximum`: biên giá trị loại trừ (exclusive).
- **`number`**:
  - `typeof value === 'number' && Number.isFinite(value)`
  - `minimum` / `maximum` / `exclusiveMinimum` / `exclusiveMaximum`.
- **`boolean`**:
  - `typeof value === 'boolean'`
- **`null`**:
  - `value === null`

### 1.2. Mảng (Arrays)
- **`type: 'array'`**:
  - `Array.isArray(value)`
  - `minItems`: số phần tử tối thiểu.
  - `maxItems`: số phần tử tối đa.
  - `uniqueItems`: kiểm tra không có phần tử trùng lặp (so sánh đệ quy sâu `deepEquals`).
  - `items`: schema con áp dụng cho từng phần tử của mảng. Lỗi ở phần tử sẽ báo rõ đường dẫn dạng `items[0].field`.

### 1.3. Đối tượng & Phân cấp lồng nhau (Objects & Nested Schemas)
- **`type: 'object'`**:
  - Kiểm tra đối tượng hợp lệ (không phải `null`, không phải mảng).
  - `required`: danh sách tên thuộc tính bắt buộc phải có (`!== undefined`).
  - `properties`: định nghĩa schema cho từng thuộc tính con. Hỗ trợ lồng nhau không giới hạn cấp độ.
  - `additionalProperties`:
    - `false`: không cho phép các thuộc tính lạ nằm ngoài `properties`.
    - `Schema`: cho phép thuộc tính lạ nhưng phải khớp với schema được chỉ định.
    - `true` hoặc bỏ trống: cho phép thuộc tính ngoài.

### 1.4. Enum & Nullable
- **`enum: [...]`**:
  - Giá trị phải thuộc danh sách giá trị cho phép (so sánh an toàn kiểu dữ liệu và cấu trúc).
- **`nullable: true`** hoặc **`type: ['string', 'null']`**:
  - Cho phép giá trị `null` bên cạnh kiểu dữ liệu chính.

### 1.5. Tổ hợp (Unions)
- **`oneOf: [schema1, schema2, ...]`**: Giá trị phải khớp với đúng một schema con.
- **`anyOf: [schema1, schema2, ...]`**: Giá trị phải khớp với ít nhất một schema con.

---

## 2. Hợp đồng lỗi chuẩn hóa (Standardized Error Contract)

Mọi lỗi ném ra từ tầng mạng và validation đều kế thừa từ `HubError` và đảm bảo các thuộc tính sau:

| Thuộc tính | Kiểu dữ liệu | Mô tả |
| :--- | :--- | :--- |
| `category` | `string` | Nhóm lỗi chuẩn hóa: `validation`, `denied`, `authentication`, `rate_limit`, `timeout`, `upstream_transport`, `upstream_tool_conflict`, `internal`, `unclassified`. |
| `code` | `string` | Mã lỗi máy đọc (vd: `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `RATE_LIMITED`, `TIMEOUT`, `BAD_GATEWAY`). |
| `status` | `number` | Mã HTTP status tương ứng (vd: 400, 401, 403, 429, 502, 504). |
| `upstreamStatus` | `number \| null` | Mã HTTP phản hồi từ upstream service nếu lỗi phát sinh từ bên thứ ba; `null` nếu lỗi nội bộ hoặc do validation client. |
| `retryable` | `boolean` | `true` nếu client có thể gửi lại yêu cầu (429, 502, 504, timeout); `false` với lỗi logic/xác thực/validation. |
| `message` | `string` | Thông điệp lỗi đã được làm sạch (`sanitized`), tự động che Bearer tokens, URL credentials và secret keys. |

### 2.1. Lớp `ValidationError`
- Kế thừa từ `HubError`.
- `status`: 400.
- `category`: `'validation'`.
- `code`: `'VALIDATION_ERROR'` (hoặc mã tùy chọn).
- `upstreamStatus`: `null`.
- `retryable`: `false`.
- Tương thích ngược: thuộc tính `errorCategory` được ánh xạ song song với `category`.

### 2.2. Khử nhạy cảm thông điệp lỗi (`sanitizeErrorMessage`)
- Tự động thay thế:
  - `Bearer <token>` → `Bearer [REDACTED]`
  - `https://user:password@host` → `https://user:[REDACTED]@host`
  - GitHub token (`ghp_...`, `gho_...`) → `[REDACTED]`
  - OpenAI / Anthropic key (`sk-...`) → `[REDACTED]`
  - Tham số URL chứa secret (`?token=...`, `&apiKey=...`) → `[REDACTED]`
- Giới hạn kích thước thông điệp tối đa 500 ký tự để chống tràn nhật ký và UI.
