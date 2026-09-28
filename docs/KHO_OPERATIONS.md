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

## 3. Cấu hình Kết nối MCP cho Agent (Nhánh B — REST Tools Mỏng)

Để Claude, agy hoặc các AI agent khác có thể truy cập Kho Ryan qua Gen-hub:

### 3.1. Tạo Database REST Token trên Baserow
1. Trên giao diện Baserow: Vào **Settings** → **API tokens** → **Create token**, đặt tên `Gen-hub Kho API Token`.
2. Cấp quyền đọc/ghi trên workspace của Kho. Sao chép token sinh ra.
3. Mở Gen-hub tại `https://hub.genos.top/#vault` → Bấm **Thêm secret**, lưu với tên `Baserow Kho API Token`.

### 3.2. Cấu hình MCP Connector trên Gen-hub
1. Mở Gen-hub tại `https://hub.genos.top/#mcps`.
2. Bấm **Thêm MCP** → Chọn kết nối **MCP HTTP tùy chỉnh (Streamable HTTP)**.
3. Cấu hình thông số:
   - **Tên kết nối:** `kho-ryan`
   - **URL MCP / REST URL:** `http://kho` (nội bộ Docker) hoặc `https://kho.genos.top`
   - Tích chọn: **"Đây là Kho Ryan (Baserow 1.33+/2.x)"** (hoặc đặt tên `kho-ryan` để hệ thống tự động gán cờ `kind: 'kho'`, `isKho: true`).
   - **Header Authorization:** Chọn liên kết với secret `Baserow Kho API Token` từ Vault.
4. Bấm **Lưu kết nối**.

Sau khi lưu:
- Gen-hub tự động nhận diện connector Kho Ryan và cung cấp **5 công cụ REST MCP mỏng native**:
  - `kho_list`: Liệt kê các bản ghi theo bảng (`Việc`, `Dự án`, `Phiên`, v.v.).
  - `kho_get`: Tra cứu chi tiết một bản ghi theo mã ID tiền tố (`PHIEN-1`, `VIEC-12`, v.v.).
  - `kho_create`: Tạo bản ghi mới trong bảng chỉ định.
  - `kho_update`: Cập nhật các trường dữ liệu của bản ghi theo mã ID.
  - `kho_search`: Tìm kiếm toàn văn bản trên các bảng của Kho.
5. Trong mục **Agent & quyền** (`#agents`), cấp quyền truy cập các công cụ này cho các agent mong muốn.

### 3.3. Sử dụng công cụ `kho_get`:
Agent có thể tra cứu nhanh bất kỳ bản ghi nào thông qua mã ID tiền tố:
```json
{
  "id": "PHIEN-1"
}
```
Tool sẽ tự động phân tích tiền tố `PHIEN`, ánh xạ tới ID bảng tương ứng từ `kho_table_ids.json` (được sinh từ `kho-schema`), gọi REST API lấy thông tin chi tiết và trả về đầy đủ các trường dữ liệu của bản ghi.

---

## 4. Sao lưu & Khôi phục Dữ liệu (Backup & Restore)

### 4.1. Cấu trúc Gói Sao lưu Kho Ryan

Lệnh sao lưu của Gen-hub (`python3 scripts/manage.py backup` hoặc `sudo gen-hub backup`) tự động gọi module sao lưu tích hợp (`kho_snapshot`), tạo bản chụp nhất quán (consistent snapshot) của Kho Ryan mà không làm gián đoạn người dùng:
- File sao lưu toàn hệ thống: `gen-hub-backup-<timestamp>.tar.gz` (phân quyền `0600`).
- Gói sao lưu Kho Ryan nằm bên trong archive tại: `kho/volumes.tar`.
- Thành phần dữ liệu trong `kho/volumes.tar`:
  - `baserow/data/postgres/`: Toàn bộ cơ sở dữ liệu PostgreSQL (chứa schema, bảng, hàng, quan hệ, audit log, người dùng).
  - `baserow/data/media/`: Tất cả tệp đính kèm, hình ảnh, tài liệu do người dùng hoặc agent tải lên.
  - `baserow/data/redis/`: Dữ liệu trạng thái hàng đợi và websocket của Baserow.
  - `baserow/data/supervisor.sock` / logs: Các socket runtime tự động bỏ qua khi khôi phục.
- **Bảo mật:** Không chứa token API của Vault hay khóa mã hóa `master.key` trong bản sao lưu Kho dạng văn bản rõ. Khóa `master.key` được đóng gói riêng trong phân vùng bảo mật của Hub.

### 4.2. Quy trình Khôi phục Thử nghiệm vào Container Độc lập (Không đụng Kho Thật)

Để nghiệm thu hoặc định kỳ diễn tập kiểm thử tính toàn vẹn dữ liệu sao lưu mà **tuyệt đối không làm gián đoạn Kho thật và không restart production**:

#### Bước 1: Trích xuất `kho/volumes.tar` từ bản sao lưu
```bash
# Giả sử file backup đặt tại /tmp/gen-hub-backup-test.tar.gz
mkdir -p /tmp/kho-restore-test
tar -xzf /tmp/gen-hub-backup-test.tar.gz -C /tmp/kho-restore-test kho/volumes.tar
```

#### Bước 2: Tạo volume tạm và nạp dữ liệu snapshot
```bash
docker volume create test-restore-kho-data
docker run --rm \
  -v test-restore-kho-data:/target \
  -v /tmp/kho-restore-test/kho/volumes.tar:/backup.tar \
  alpine sh -c "tar -xf /backup.tar -C /target"
```

#### Bước 3: Khởi chạy container Baserow tạm thời trên cổng riêng (3002)
Sử dụng chính xác image digest Baserow đã pin trong `deploy/images.json`:
```bash
docker run -d --name test-restore-kho-run \
  -v test-restore-kho-data:/baserow/data \
  -p 3002:80 \
  -e BASEROW_PUBLIC_URL=http://localhost:3002 \
  baserow/baserow:1.33.2@sha256:ebf338dc02c06064ea463ea3545c12a461e95f8b0a28699c66818f05b8ca2890
```

#### Bước 4: Chờ Baserow tạm hoàn tất khởi động và đối chiếu số bản ghi
Chờ container sẵn sàng (khoảng 30-40 giây để Postgres khởi động và Baserow health check trả về 200 OK):
```bash
curl -s -f http://localhost:3002/api/_health/ | grep -q "OK" && echo "Container tạm sẵn sàng!"
```

Sau khi sẵn sàng, thực hiện truy vấn REST API (sử dụng Database Token quản trị) trên cả Kho thật và Container tạm để đối chiếu số lượng bản ghi của 8 bảng hạt nhân:
```bash
TOKEN="<BASEROW_API_TOKEN>"
for TABLE_ID in 559 560 561 562 563 564 565 566; do
  COUNT_PROD=$(curl -s -H "Authorization: Token $TOKEN" "http://localhost:3001/api/database/rows/table/${TABLE_ID}/?size=1" | jq .count)
  COUNT_TEST=$(curl -s -H "Authorization: Token $TOKEN" "http://localhost:3002/api/database/rows/table/${TABLE_ID}/?size=1" | jq .count)
  echo "Table $TABLE_ID: Production=$COUNT_PROD | Test=$COUNT_TEST"
done
```

#### Bước 5: Dọn dẹp sạch sẽ tài nguyên thử nghiệm
Sau khi hoàn tất đối chiếu, hủy bỏ ngay container và volume tạm để giải phóng tài nguyên RAM/disk:
```bash
docker stop test-restore-kho-run
docker rm test-restore-kho-run
docker volume rm test-restore-kho-data
rm -rf /tmp/kho-restore-test
```

### 4.3. Bảng Đối chiếu Thực tế Số bản ghi 8 Bảng Hạt nhân

Kết quả thực tế diễn tập khôi phục ngày 28/09/2026 từ snapshot volume của Kho Ryan (đối chiếu giữa container production `gen-hub-kho-1` và container thử nghiệm `test-restore-kho-run`):

| Mã tiền tố | Bảng | Table ID | Số bản ghi Kho Thật | Số bản ghi Bản Khôi phục | Kết quả Đối chiếu |
| :--- | :--- | :--- | :---: | :---: | :---: |
| **DA** | Dự án | 559 | 7 | 7 | ✅ Khớp 100% |
| **VIEC** | Việc | 560 | 6 | 6 | ✅ Khớp 100% |
| **PHIEN** | Phiên | 561 | 2 | 2 | ✅ Khớp 100% |
| **QD** | Quyết định | 562 | 1 | 1 | ✅ Khớp 100% |
| **BAI** | Bài học | 563 | 6 | 6 | ✅ Khớp 100% |
| **TT** | Tri thức | 564 | 3 | 3 | ✅ Khớp 100% |
| **TS** | Tài sản | 565 | 0 | 0 | ✅ Khớp 100% |
| **KHOA** | Chỉ mục khóa | 566 | 0 | 0 | ✅ Khớp 100% |

Toàn bộ dữ liệu PostgreSQL, các quan hệ liên kết (Link Row), trường tính toán (Formula) và view Kanban/Gallery đều nguyên vẹn 100% sau khi khôi phục.

### 4.4. Quy trình Khôi phục Thật trên Máy chủ Mới (Disaster Recovery)

Khi cần khôi phục lại toàn bộ hệ thống Gen-hub và Kho Ryan trên máy chủ mới:
1. Giải nén bản sao lưu `gen-hub-backup-<timestamp>.tar.gz`:
   ```bash
   tar -xzf gen-hub-backup-*.tar.gz
   ```
2. Khôi phục cấu hình và database Hub theo quy trình tại `docs/OPERATIONS.md`.
3. Tạo named volume đúng định dạng installation ID của Kho:
   ```bash
   INSTALL_ID=$(jq -r .id /etc/gen-hub/install.json)
   docker volume create gen-hub-${INSTALL_ID}-kho-data
   ```
4. Đổ dữ liệu từ `kho/volumes.tar` vào volume:
   ```bash
   docker run --rm \
     -v gen-hub-${INSTALL_ID}-kho-data:/target \
     -v $(pwd)/kho/volumes.tar:/backup.tar \
     alpine tar -xf /backup.tar -C /target
   ```
5. Khởi động lại toàn bộ dịch vụ:
   ```bash
   sudo gen-hub kho-enable
   sudo gen-hub restart
   sudo gen-hub doctor
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

---

## 6. Lưu ý Vận hành Quan trọng Khi Bật Kho trên Production (Checklist Triển khai)

> [!WARNING]
> Đọc kỹ các lưu ý dưới đây trước khi thực hiện kích hoạt Kho Ryan trên máy chủ production `hub.genos.top`.

### 6.1. Định tuyến Cloudflare Tunnel (Thứ tự Rule Cực kỳ Quan trọng)
- Vùng làm việc VPS hiện đang sử dụng quy tắc wildcard `*.genos.top` trỏ về Caddy của workplace.
- Khi cấu hình Cloudflare Tunnel cho Kho Ryan:
  1. Thêm một public hostname riêng: `kho.genos.top` trỏ về dịch vụ Caddy của Gen-hub (`http://127.0.0.1:80` hoặc domain của Hub).
  2. **Bắt buộc phải đặt hostname `kho.genos.top` ĐỨNG TRƯỚC quy tắc wildcard `*.genos.top`** trong bảng điều khiển Cloudflare Tunnel.
  3. Nếu đặt sau rule wildcard, toàn bộ yêu cầu tới `https://kho.genos.top` sẽ bị định tuyến nhầm vào Caddy của workplace, gây lỗi 502/404 hoặc SSL mismatch.
  4. Kiểm tra phản hồi bằng lệnh:
     ```bash
     curl -I https://kho.genos.top
     ```
     Đảm bảo phản hồi HTTP 200 hoặc 302 từ Baserow, không phải phản hồi từ workplace.

### 6.2. Ảnh hưởng khi chạy `kho-enable`
- Lệnh `kho-enable` sẽ cập nhật file `Caddyfile` và tái tạo (recreate) container `caddy`. Quá trình này gây gián đoạn vài giây cho các kết nối tới `hub.genos.top`.
- Quá trình tự động sao lưu trước khi enable sẽ tạm dừng container Gitea trong chốc lát để đảm bảo snapshot nhất quán.
- **Quy tắc bắt buộc:** Luôn thông báo và thống nhất trước với Boss Ryan về khoảng thời gian thực thi trước khi chạy `sudo gen-hub kho-enable` trên production.

### 6.3. Cập nhật Hướng dẫn Bootstrap cho Agent
- Thay đổi `DEFAULT_BOOTSTRAP_GROUPS` trong mã nguồn chỉ có hiệu lực tự động cho các bản cài đặt mới (fresh install).
- Bản cài đặt production hiện tại đang lưu cấu hình bootstrap riêng trong cơ sở dữ liệu `data/hub.db`.
- Do đó, sau khi PR được duyệt và merge, cấu hình bootstrap nhóm mặc định sẽ được cập nhật thủ công thông qua giao diện Web Gen-hub tại mục **Bootstrap** (`/#bootstrap`) để bổ sung Bước 3 "Đọc và ghi Kho Ryan". Claude sẽ hỗ trợ thao tác này khi Boss phê duyệt.

### 6.4. Checklist Nghiệm thu Thực tế SPEC §6 (Thực hiện sau khi bật Kho)
Sau khi container Kho production đã khởi chạy thành công:
- [ ] **Mở trên điện thoại di động:** Truy cập `https://kho.genos.top` trên trình duyệt điện thoại, kiểm tra giao diện đăng nhập và thao tác trên bảng Việc (Kanban), Bài học (Gallery).
- [ ] **Agent gọi qua Gen-hub MCP có Audit:** Cho Claude hoặc agy gọi thử công cụ `kho_find_by_id` và các công cụ CRUD gốc của Baserow; mở trang **Nhật ký** (`#audit`) xác nhận mọi lượt gọi có đầy đủ timestamp, actor, tool name và kết quả.
- [x] **Kiểm thử Sao lưu & Phục hồi (Hoàn thành 28/09/2026 — Refs #134):** `gen-hub backup` đã đóng gói đầy đủ `kho/volumes.tar`; đã giải nén và khôi phục thử nghiệm thành công trên container Baserow tạm, đối chiếu 8/8 bảng khớp 100% số bản ghi với Kho thật.
- [x] **Kiểm tra Dữ liệu Hạt giống (Seed Data):** Bảng Phiên có bản ghi phiên 27/09/2026, bảng Tri thức có TT-1 và TT-2.

