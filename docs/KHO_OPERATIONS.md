# Hướng dẫn Vận hành Kho Ryan — Refs #125

> [!NOTE]
> Tài liệu này hướng dẫn chi tiết quy trình kích hoạt, bảo trì, cấu hình MCP, kiểm tra trạng thái, sao lưu và khôi phục dữ liệu cho **Kho Ryan** (Baserow 1.33+) tích hợp trong Gen-hub.
> Tham chiếu thiết kế: [KHO_DESIGN.md](KHO_DESIGN.md), Issue [#125](https://github.com/Genesis-ryan-84-0567536339/Gen-hub/issues/125).

---

## 1. Tổng quan Lệnh Quản trị CLI

Mọi thao tác vòng đời của Kho Ryan đều được tích hợp nhất quán qua CLI `scripts/manage.py` (hoặc lệnh nhị phân `gen-hub` khi đã cài đặt trên host):

| Lệnh | Ý nghĩa & Hành vi |
| :--- | :--- |
| `python3 scripts/manage.py kho-enable` | Kích hoạt dịch vụ Kho Ryan, cấu hình route `kho.<domain>` và `/kho` trên Caddy, kéo image Baserow 1.33.2 và khởi động container. |
| `python3 scripts/manage.py kho-disable` | Dừng và gỡ bỏ container Kho Ryan, xóa route Caddy, nhưng **bảo tồn toàn bộ dữ liệu** trong volume `kho-data`. |
| `python3 scripts/manage.py kho-disable --purge` | Dừng container và **xóa vĩnh viễn dữ liệu** (yêu cầu gõ xác nhận `DELETE KHO`). |
| `python3 scripts/manage.py kho-schema` | Thực thi đồng bộ declarative schema từ `kho/schema.json` vào Baserow (idempotent, an toàn, không tạo trùng). |
| `python3 scripts/manage.py status` | Báo cáo chi tiết trạng thái Hub, Gitea và Kho Ryan (Container status, Health check, Cổng dịch vụ). |
| `python3 scripts/manage.py doctor` | Kiểm tra tính toàn vẹn hệ thống: image digest, volume `kho-data`, giới hạn RAM 2GB, kết nối nội bộ. |
| `python3 scripts/manage.py backup [file]` | Tạo bản sao lưu toàn diện dạng `.tar.gz` chứa database Hub, volume Gitea và snapshot nhất quán của volume `kho-data`. |

---

## 2. Quy trình Kích hoạt & Khởi tạo Lần đầu

### Bước 1: Kích hoạt dịch vụ trên máy chủ
Chạy lệnh kích hoạt:
```bash
python3 scripts/manage.py kho-enable
```
Lệnh sẽ:
1. Ghi nhận cờ `kho_enabled: true` vào file cấu hình cài đặt `install.json`.
2. Bổ sung service `kho` vào Docker Compose manifest với cấu hình:
   - Image: `baserow/baserow:1.33.2@sha256:ebf338dc02c06064ea463ea3545c12a461e95f8b0a28699c66818f05b8ca2890`
   - Memory limit: `mem_limit: '2g'`
   - PIDs limit: `pids_limit: 256`
   - Volume: `gen-hub-<id>-kho-data` gắn vào `/baserow/data`.
3. Bổ sung cấu hình reverse proxy vào `Caddyfile`:
   - Subdomain: `kho.<domain>` chuyển tiếp tới container `kho:80`.
   - Path redirect: `https://<domain>/kho` redirect 308 tới `https://kho.<domain>/`.
4. Áp dụng Compose và khởi động container ngầm.

### Bước 2: Thiết lập Tài khoản Quản trị Baserow
1. Mở trình duyệt truy cập: `https://kho.genos.top` (hoặc `http://localhost:3001` nếu chạy local).
2. Tạo tài khoản quản trị đầu tiên (email & mật khẩu của Boss).
3. Đăng nhập vào giao diện Workspace của Baserow.

### Bước 3: Tạo Database Token & Lưu vào Vault Gen-hub
1. Trên giao diện Baserow: Nhấn vào ảnh đại diện cá nhân → **Settings** → **API tokens** → **Create token**.
2. Đặt tên token: `Gen-hub Kho MCP Token`, cấp quyền đọc/ghi trên workspace của Kho.
3. Sao chép chuỗi token được sinh ra.
4. Mở giao diện Gen-hub tại `https://hub.genos.top/#vault`:
   - Bấm **Thêm secret**.
   - Tên gợi nhớ: `Baserow Kho API Token`.
   - Giá trị secret: Dán token vừa tạo.
   - Bấm **Tạo secret**. Token sẽ được mã hóa an toàn bằng `master.key`.

### Bước 4: Đồng bộ 8 Bảng Hạt nhân (Core Schema SSOT)
Chạy lệnh đồng bộ schema:
```bash
python3 scripts/manage.py kho-schema \
  --url http://localhost:3001 \
  --token <API_TOKEN_HOAC_JWT>
```
Lệnh sẽ tự động:
- Tạo Database "Kho Ryan" nếu chưa có.
- Kiến tạo 8 bảng hạt nhân: **Dự án** (DA), **Việc** (VIEC), **Phiên** (PHIEN), **Quyết định** (QD), **Bài học** (BAI), **Tri thức** (TT), **Tài sản** (TS), **Chỉ mục khóa** (KHOA).
- Bổ sung các trường dữ liệu bắt buộc (bao gồm 3 trường ngày `Ngày tạo`, `Ngày bắt đầu`, `Ngày xong` trên bảng Việc).
- Thiết lập chế độ xem **Kanban** trên bảng Việc và **Gallery** trên bảng Bài học.
- Nạp dữ liệu hạt giống ban đầu (Seed data: Phiên làm việc ngày 27/09/2026, Tri thức TT-1, TT-2).

---

## 3. Cấu hình Kết nối MCP cho Agent

Để Claude, agy hoặc các AI agent khác có thể truy cập Kho Ryan qua Gen-hub:

1. Mở Gen-hub tại `https://hub.genos.top/#mcps`.
2. Bấm **Thêm MCP** → Chọn kết nối **MCP HTTP tùy chỉnh (Streamable HTTP)**.
3. Cấu hình thông số:
   - Tên kết nối: `kho-ryan`
   - URL: `http://kho/api/mcp/` (hoặc `https://kho.genos.top/api/mcp/`)
   - Header Authorization: Chọn liên kết với secret `Baserow Kho API Token` từ Vault.
4. Bấm **Lưu kết nối**.
5. Trong mục **Agent & quyền** (`#agents`), cấp quyền truy cập công cụ của MCP `kho-ryan` và công cụ phụ trợ `kho_find_by_id` cho các agent mong muốn.

### Sử dụng công cụ `kho_find_by_id`:
Agent có thể tra cứu nhanh bất kỳ bản ghi nào thông qua mã ID tiền tố:
```json
{
  "id": "VIEC-1"
}
```
Tool sẽ tự động phân tích tiền tố `VIEC`, ánh xạ tới bảng tương ứng trong Kho và trả về đầy đủ các trường dữ liệu của bản ghi.

---

## 4. Sao lưu & Khôi phục Dữ liệu (Backup & Restore)

### 4.1. Quy trình Sao lưu Tự động
Lệnh sao lưu của Gen-hub đã được tích hợp module `scripts/kho.py` để tạo bản chụp nhất quán (consistent snapshot):
```bash
python3 scripts/manage.py backup
```
- Quá trình sẽ tạm dừng các thao tác ghi của Baserow.
- Đóng gói toàn bộ volume `kho-data` thành file archive `kho/volumes.tar` bên trong gói backup nén `.tar.gz`.
- Đảm bảo tính toàn vẹn 100% của cơ sở dữ liệu PostgreSQL và file tải lên của Baserow.

### 4.2. Quy trình Khôi phục Dữ liệu (Restore)
Khi cần khôi phục dữ liệu trên máy chủ mới hoặc sau sự cố:
1. Giải nén gói backup:
   ```bash
   tar -xzf gen-hub-backup-*.tar.gz
   ```
2. Khôi phục cấu hình và database của Hub theo quy trình chuẩn.
3. Tạo volume dữ liệu cho Kho:
   ```bash
   docker volume create gen-hub-<installation_id>-kho-data
   ```
4. Giải nén dữ liệu từ snapshot vào volume:
   ```bash
   docker run --rm -v gen-hub-<installation_id>-kho-data:/target -v $(pwd)/kho/volumes.tar:/backup.tar alpine \
     tar -xf /backup.tar -C /target
   ```
5. Khởi động lại dịch vụ:
   ```bash
   python3 scripts/manage.py kho-enable
   python3 scripts/manage.py doctor
   ```

---

## 5. Giám sát & Quản trị Tài nguyên

### 5.1. Giới hạn RAM & CPU
Container Baserow được thiết lập các giới hạn cứng nhằm bảo vệ hệ thống VPS khỏi tình trạng cạn kiệt tài nguyên (OOM):
- **Bộ nhớ tối đa:** `2.0 GiB` (`mem_limit: '2g'`)
- **Số tiến trình tối đa:** `256 PIDs` (`pids_limit: 256`)

Kiểm tra mức sử dụng tài nguyên thực tế:
```bash
docker stats gen-hub-kho --no-stream
```
*Mức tiêu thụ thông thường:*
- Khi vừa khởi động / idle: ~1.43 GiB.
- Khi agent thực hiện truy vấn hoặc đồng bộ: 1.5 - 1.7 GiB.

### 5.2. Xử lý Sự cố Thường gặp

**Sự cố 1: Container bị tắt do OOM**
- Kiểm tra log sự kiện: `docker inspect gen-hub-kho | grep OOMKilled`
- Nếu `OOMKilled: true`: Kiểm tra lại xem có truy vấn quét toàn bộ bảng quá lớn từ phía agent hay không, hoặc tăng nhẹ giới hạn RAM lên `2.5g` trong file cấu hình nếu máy chủ còn trống nhiều RAM.

**Sự cố 2: Agent báo lỗi không tìm thấy bản ghi qua `kho_find_by_id`**
- Kiểm tra định dạng ID truyền vào: Phải đúng cú pháp tiền tố hợp lệ (`DA`, `VIEC`, `PHIEN`, `QD`, `BAI`, `TT`, `TS`, `KHOA`) kèm dấu gạch nối và số nguyên (VD: `VIEC-12`).
- Kiểm tra lại xem token trong Vault có còn hiệu lực hoặc đã được cấp quyền đọc trên bảng tương ứng hay chưa.
