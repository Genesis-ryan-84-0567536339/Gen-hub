# Kế hoạch triển khai: Kho Ryan (Baserow Second Brain) trong Gen-hub

> **Mã công việc**: Issue #125  
> **Nhánh thực thi**: `feat/kho-ryan` (worktree `../gen-hub-kho`)  
> **Người thực thi**: agy ("Thủ kho")  
> **Người duyệt**: Claude Code & Boss Ryan  

---

## 1. Mục tiêu & Đánh giá công nghệ ban đầu

- **Mục tiêu**: Xây dựng kho tri thức & điều hành công việc tập trung (second brain) cho Boss và các agent tại `https://hub.genos.top/kho/`, gồm 8 bảng dữ liệu chuẩn hóa, Kanban, dashboard thống kê, MCP connector qua cổng Gen-hub và lệnh quản trị vòng đời theo tiền lệ Gitea.
- **Đánh giá Baserow vs NocoDB**:
  - **Baserow**: Bản 1.33+ đã tích hợp native MCP server chính thức, hỗ trợ Kanban, Form, Gallery, quan hệ bảng chặt chẽ, API REST đầy đủ, image all-in-one tự host ổn định. Bản Community không có sẵn OIDC SSO (tính năng trả phí Advanced/Enterprise) → Theo đúng SPEC mục 4: Ghi rõ giới hạn và cấp tài khoản owner nội bộ lúc bootstrap.
  - **NocoDB**: Bản miễn phí chưa có native MCP server chính thức chuẩn hóa như Baserow 1.33+.
  - **Kết luận**: Chọn **Baserow** theo đúng định hướng của SPEC.

---

## 2. Các bước triển khai chi tiết

Kế hoạch chia thành 5 giai đoạn nhỏ, mỗi bước đều chạy kiểm thử (`npm test` và test Python):

### Bước 1: Hạ tầng container, vòng đời & backup (Tiền lệ Gitea)
- Khai báo image Baserow (pinned tag/digest) trong `deploy/images.json`.
- Tạo `scripts/kho.py` quản lý:
  - Named volume `kho-data` (`/baserow/data`) gắn nhãn `installation_id`.
  - Service definition `kho` với giới hạn tài nguyên (mem_limit 1.5GB, pids_limit 256), biến môi trường subpath `/kho/`, WebSocket và healthcheck.
  - Snapshot consistent cho `backup()` (lưu dữ liệu database vào `kho/volumes.tar`).
  - Các hàm kiểm tra `check_volumes()`, `verify()`, `bootstrap()`.
  - Hàm `enable()` (`kho-enable`) và `disable(purge=...)` (`kho-disable`).
- Cập nhật `scripts/runtime.py`:
  - Route Caddy: chuyển tiếp `/kho/*` tới `kho:80` (hỗ trợ WebSocket & subpath rewrite).
  - Tích hợp snapshot Kho vào hàm `backup()`.
- Cập nhật `scripts/manage.py`: thêm lệnh `kho-enable`, `kho-disable`, bổ sung kiểm tra Kho vào `status`, `doctor`, `restart`.

### Bước 2: Script cấu hình Schema 8 bảng & Dữ liệu hạt giống (SSOT Schema)
- Viết `kho/schema.py` (hoặc `server/kho-schema.mjs`):
  - Idempotent 100%: Chạy lần đầu tạo Workspace, Database "Kho Ryan", 8 bảng, các cột, quan hệ liên kết (Link row) và trường ID tự tăng (`concat('VIEC-', to_string(row_id()))`). Chạy lại lần 2 không gây lỗi và không làm mất dữ liệu.
  - 8 bảng: Dự án (`DA-`), Việc (`VIEC-`), Phiên (`PHIEN-`), Quyết định (`QD-`), Bài học (`BAI-`), Tri thức (`TT-`), Tài sản (`TS-`), Chỉ mục khóa (`KHOA-`).
  - Tạo các view mặc định: Việc = Kanban theo Trạng thái; Phiên = Danh sách ngày; Bài học = Gallery theo Chủ đề; Dashboard tổng hợp.
  - Seed dữ liệu ban đầu: Phiên 27/09/2026 (`PHIEN-1`), Tri thức Boss profile (`TT-1`), Tri thức Ryan core instructions (`TT-2`).

### Bước 3: Connector Gen-hub Kho MCP (Cổng duy nhất cho Agent)
- Tạo `server/kho-mcp.mjs`:
  - Đăng ký provider `kho-mcp` trong `server/catalog.mjs` (mặc định publish nội bộ theo phân quyền).
  - Cung cấp các công cụ chuẩn hóa: `kho_list_records`, `kho_get_record`, `kho_create_record`, `kho_update_record`, `kho_search` (hỗ trợ tra cứu theo ID tiền tố: `VIEC-1`, `QD-2`...).
  - Kết nối nội bộ tới Baserow qua Docker network với cơ chế an toàn `allowPrivate: true` và token quản trị lấy từ Vault Gen-hub.
  - Tích hợp kiểm toán `store.audit()` cho mọi cuộc gọi đọc/ghi.
  - Phân quyền (policy): cấp quyền ghi cho Claude Code, Claude Cloud, agy Thủ kho; các agent khác mặc định chỉ đọc.
- Bổ sung chỉ dẫn vào prompt Bootstrap của Gen-hub MCP:
  - "Đầu phiên: đọc Kho — Phiên gần nhất, Việc đang mở, Quyết định hiệu lực. Cuối phiên: ghi Phiên + cập nhật Việc/Quyết định/Bài học."

### Bước 4: Tích hợp Giao diện Gen-hub Web UI
- Cập nhật `public/app.js`:
  - Thêm mục **"Kho"** trên thanh điều hướng sidebar (icon database/archive, link trực tiếp tới `/kho/`).
  - Hỗ trợ modal hướng dẫn đăng nhập Kho cho Boss hoặc trạng thái bootstrap.

### Bước 5: Tài liệu & Bộ kiểm thử tự động
- Viết tài liệu:
  - `docs/KHO_DESIGN.md`: Kiến trúc, mô hình dữ liệu, ranh giới an toàn, token Vault.
  - `docs/KHO_OPERATIONS.md`: Hướng dẫn vận hành CLI, backup, restore, xử lý sự cố.
- Viết test:
  - `tests/kho_lifecycle_test.py`: Kiểm thử cấu hình Compose, routing Caddy, lifecycle enable/disable/backup.
  - `tests/kho-mcp.test.mjs`: Kiểm thử connector Kho MCP, công cụ đọc/ghi, phân quyền agent và kiểm toán audit.
  - Chạy toàn bộ test suite `npm test` đảm bảo 100% test cũ và mới đều PASS.

---

## 3. Danh sách các file dự kiến sửa đổi / thêm mới

| Phân loại | Tệp | Mục đích |
|---|---|---|
| **Thêm mới** | `scripts/kho.py` | Quản lý container Baserow, lifecycle enable/disable, snapshot backup |
| **Thêm mới** | `kho/schema.py` | Script idempotent khởi tạo cấu trúc 8 bảng, formula ID và views |
| **Thêm mới** | `server/kho-mcp.mjs` | Connector MCP cổng Gen-hub cho Kho (CRUD, search theo ID, audit) |
| **Thêm mới** | `tests/kho_lifecycle_test.py` | Kiểm thử lifecycle, backup và cấu hình Compose cho Kho |
| **Thêm mới** | `tests/kho-mcp.test.mjs` | Kiểm thử các tool Kho MCP, phân quyền và audit |
| **Thêm mới** | `docs/KHO_DESIGN.md` | Tài liệu thiết kế kiến trúc và mô hình dữ liệu Kho |
| **Thêm mới** | `docs/KHO_OPERATIONS.md` | Tài liệu hướng dẫn vận hành Kho Ryan |
| **Sửa đổi** | `deploy/images.json` | Thêm digest/tag image Baserow |
| **Sửa đổi** | `scripts/runtime.py` | Bổ sung Caddy route `/kho/*`, service Baserow, hook backup |
| **Sửa đổi** | `scripts/manage.py` | Bổ sung lệnh CLI `kho-enable`, `kho-disable`, update status/doctor |
| **Sửa đổi** | `server/catalog.mjs` | Đăng ký connector `kho-mcp` và chính sách tool |
| **Sửa đổi** | `server/connectors.mjs` | Xử lý sync và dispatch cho `kho-mcp` |
| **Sửa đổi** | `public/app.js` | Thêm mục "Kho" vào menu thanh điều hướng |
| **Sửa đổi** | `server/app.mjs` | Cập nhật hướng dẫn bootstrap agent đọc/ghi Kho |

---

## 4. Các rủi ro kỹ thuật & Biện pháp kiểm soát

1. **Rủi ro tài nguyên (RAM/CPU)**:
   - *Vấn đề*: Baserow all-in-one tích hợp PostgreSQL, Redis, backend Django và web frontend. Nếu không giới hạn, container có thể chiếm nhiều RAM ảnh hưởng đến Hub và Gitea.
   - *Biện pháp*: Giới hạn cứng trong compose: `mem_limit: '1.5g'`, `pids_limit: 256`, chỉ chạy worker cần thiết, bật swap/tmpfs thích hợp.
2. **Rủi ro bảo mật & Phơi lộ Token**:
   - *Vấn đề*: Token quản trị Baserow có thể bị lộ nếu lưu trong code hoặc truyền qua biến môi trường không an toàn.
   - *Biện pháp*: Token Baserow sinh ra trong quá trình bootstrap sẽ được mã hóa và lưu trực tiếp vào Vault Gen-hub (`server/vault.mjs`) với tiền tố `vault-NNNNN`. Tuyệt đối không commit token vào Git. Kiểm tra bằng công cụ rà soát secret trước khi mở PR.
3. **Rủi ro định tuyến Caddy subpath & WebSocket**:
   - *Vấn đề*: Baserow frontend yêu cầu WebSocket để realtime updates. Nếu Caddy không chuyển tiếp header WebSocket hoặc cấu hình sai base path, giao diện web sẽ lỗi kết nối.
   - *Biện pháp*: Cấu hình Caddy reverse_proxy với `header_up Host`, `header_up X-Forwarded-Proto https`, đảm bảo WebSocket hoạt động mượt mà.
4. **Rủi ro gián đoạn môi trường Production**:
   - *Vấn đề*: Khởi động hoặc restart dịch vụ trên máy chủ đang chạy trước khi PR được duyệt.
   - *Biện pháp*: Tuyệt đối tuân thủ nguyên tắc: Không restart hoặc chạy `kho-enable` trên production `https://hub.genos.top` trước khi PR được review và merge. Toàn bộ quá trình code và kiểm thử tự động được thực hiện độc lập trong worktree `../gen-hub-kho`.

---

## 5. Tiêu chuẩn nghiệm thu bàn giao

- [ ] Toàn bộ 220+ test cũ của Gen-hub + test mới cho Kho đều PASS (`npm test`).
- [ ] Script `kho/schema.py` idempotent, chạy 2 lần liên tiếp không lỗi, giữ nguyên dữ liệu.
- [ ] Không có secret trong git log hoặc working tree.
- [ ] Báo cáo `[BÀN GIAO]` chi tiết trên PR.
