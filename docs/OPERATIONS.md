# Vận hành Gen-hub Linux

## Dịch vụ

`gen-hub.service` backend loopback 127.0.0.1:3080; `gen-hub-caddy.service` reverse proxy; `gen-hub-tunnel.service` chỉ cho máy cá nhân. Unit tự khởi động theo systemd, tự restart khi lỗi. Source thuộc root; service không sửa source.

VPS: Internet → Caddy 80/443 (HTTPS) → Hub 3080. Cần mở firewall ở OS và nhà cung cấp; bộ cài không tự thay đổi firewall đang có. DNS-only trong bước kiểm tra DNS.

Máy cá nhân: Internet HTTPS → Cloudflare → cloudflared → Caddy loopback 8080 → Hub loopback 3080. Không cần mở cổng inbound. Kết nối outbound tới Cloudflare phải hoạt động (thông thường 7844 TCP/UDP theo cấu hình tunnel). Cloudflare terminate HTTPS public; Caddy phía local dùng HTTP loopback để tránh redirect loop.

## Khi cài lỗi

Chạy lại cùng lệnh cài. State giữ trong `/etc/gen-hub/install.json`; chỉ có thể tạo owner sau khi HTTPS trả đúng installation ID. DNS cần thời gian cập nhật. Nếu hostname đã có bản ghi khác, sửa thủ công hoặc chọn hostname khác trước khi cài tiếp; không tự ghi đè.

`sudo gen-hub status` và `sudo gen-hub logs` xem dịch vụ. Không gửi `master.key`, database, hub.env hoặc tunnel.token lên issue/chat. Khi cần đổi hostname/mode, sao lưu trước, dừng dịch vụ rồi sửa cấu hình qua người quản trị; bản đầu không có wizard đổi domain.

## Sao lưu và khôi phục

`sudo gen-hub backup /root/backup.tar.gz` dùng SQLite VACUUM INTO tạo snapshot nhất quán, kèm master.key và cấu hình; file mode 0600. Có key mới giải mã được dữ liệu. Bảo quản bản backup như credential.

Khôi phục trên bản cài cùng revision: dừng dịch vụ `sudo systemctl stop gen-hub`; giải nén backup vào thư mục root-only tạm, thay `hub.db` và `master.key` trong `/var/lib/gen-hub`; xóa WAL/SHM cũ sau khi dịch vụ đã dừng; sửa ownership genhub:genhub, mode thư mục 0700 và files 0600; khởi động lại. Không đặt DB mới cạnh WAL cũ. Nếu chuyển máy/domain, cần cấu hình DNS/tunnel/HTTPS và OAuth callback tương ứng.

## Cập nhật

`sudo gen-hub update` tải bootstrap của repo SSOT và hỏi xác nhận. Source được resolve thành commit SHA trước khi tải archive. Phiên bản Node/Caddy/cloudflared tải từ nguồn chính thức và kiểm SHA256. Các binary đã có được giữ; cần kiểm tra cập nhật bảo mật binary riêng khi nâng phiên bản vận hành.

`rollback` quay source về revision trước, không tự hạ schema DB. Bản đầu schema v1; khi có migration thay đổi phải đọc release notes trước rollback. Khuyên sao lưu trước cập nhật.

## Gỡ

`uninstall` chỉ dừng/gỡ các unit và source của Gen-hub; giữ DB, key, cấu hình và tunnel/DNS. Muốn xóa dữ liệu hoặc Cloudflare resources, kiểm tra đúng installation rồi xóa thủ công. Không ảnh hưởng Caddy/cloudflared của ứng dụng khác.

## Phạm vi bảo vệ

Đổi password vô hiệu hóa session owner. Thu hồi agent vô hiệu hóa token access và refresh. Mã hóa credential không bảo vệ khi attacker có root hoặc đọc được cả master.key và DB. Owner có quyền thêm endpoint mạng riêng; chỉ cấp khi tin tưởng.
