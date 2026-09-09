# Quy trình phối hợp đa agent trên Gen-hub

Chốt ngày 2026-09-09. Áp dụng cho mọi agent làm việc trên repo này.

## SSOT: repo này, không phải nơi nào khác

Toàn bộ trạng thái công việc (đang làm gì, ai làm, xong chưa) nằm ở
**Issues + Pull Request + Project board của chính repo Gen-hub** — không
phải file log ở nơi khác. Lý do: repo này đã có sẵn cơ chế commit/branch/PR/
CI hoạt động thật (xem lịch sử PR #1, #2, #5), không cần phát minh thêm kênh
nào khác.

- Project board dùng chung: **Genesis - Control Plane** (đã liên kết với repo
  này). Cột trạng thái: Backlog → Ready → In Progress → Review → Done.
- Label xác định ai xử lý Issue nào: `agent:claude`, `agent:astra-web`,
  `agent:codex`, `agent:agy`, `agent:ryan`.

## Vai trò từng agent

| Label | Ai/gì | Dùng khi nào |
|---|---|---|
| `agent:ryan` | Chủ dự án | Quyết định cuối, credentials thật, cài đặt tương tác (sudo, domain, OAuth thật) — không agent nào tự làm được |
| `agent:claude` | Claude Code | Viết spec/epic, review kiến trúc-bảo mật-logic, tự verify (không chỉ tin báo cáo), merge quyết định. Model đắt — chỉ dùng cho việc cần phán đoán, không dùng cho việc thực thi nặng |
| `agent:astra-web` | ChatGPT (bản trình duyệt) | Feature lớn cần giữ context liên tục qua nhiều phiên — chủ lực code chính hiện tại. Không có hook tự động; chủ dự án nhắc "check repo" khi có việc mới |
| `agent:codex` | Codex CLI (model gpt-6-astra, chạy local) | Việc vừa/nặng cần chất lượng cao, dispatch được qua script — không cần nhắc tay |
| `agent:agy` | Antigravity CLI / Gemini (chạy local, nhiều tài khoản) | Việc thực thi nặng nhưng đơn giản hơn — rẻ nhất, mặc định cho việc mới trừ khi cần chất lượng cao hơn |

## Quy tắc bắt buộc khi dispatch cho agent CLI (codex/agy)

1. **Luôn làm trong git worktree riêng** (`git worktree add ../<ten>-epic-X -b epic/X`),
   không sửa trực tiếp trên thư mục làm việc chính đang có agent khác (kể cả
   `agent:astra-web`) có thể đang sửa cùng lúc. Đã có tiền lệ thật: 1 lần
   không cách ly, `App.jsx` bị ghi đè ngoài ý muốn.
2. Agent CLI đọc đúng Issue (`gh issue view <n>`) trước khi làm, không đoán
   yêu cầu.
3. Xong việc: commit trên nhánh riêng, mở PR tham chiếu Issue
   (`Refs #<n>`), comment tóm tắt `[BÀN GIAO]`, dừng lại — **không tự merge**.
4. `agent:claude` review PR đó: đọc diff thật, tự chạy lại/verify độc lập
   (không chỉ tin báo cáo của agent CLI) trước khi merge — đây là lý do
   Claude giữ vai trò gác cổng cuối dù đắt tiền hơn.
5. **Bí thì dừng và báo lại, đừng tự điều tra sâu không giới hạn.** Tiền lệ
   thật (2026-09-09): giao cho 2 `agy` chạy song song đóng vai Agent/Kiểm
   toán viên, cả hai đều sa vào vòng lặp tự dò ngược binary nội bộ và xem
   trộm tmux session của agent khác thay vì báo lại khi bí — tốn thời gian/
   token vô ích, và xem trộm session khác là vi phạm ranh giới không nên có.
   Quy tắc: nếu 1 hướng tiếp cận không ra kết quả sau ~3-4 bước thử, dừng
   lại và báo cáo cụ thể đã thử gì/bí ở đâu, để người điều phối (Claude)
   quyết định hướng khác — không tự ý đào sâu thêm hoặc quan sát tiến trình/
   session của agent khác.

## Vì sao không dùng Brain (`Genesis-ryan-84-0567536339/Brain`) làm nơi ghi việc

Brain là hạ tầng dùng chung cho **nhiều dự án Genesis**, không riêng Gen-hub.
Theo đúng quy tắc của chính Brain
(`skills/work-style/subskills/project-workflow/SKILL.md`): Brain giữ
tài liệu nền tảng (vision, standards, rules dùng chung), **không giữ nhật ký
việc-đang-làm riêng cho từng dự án** — việc đó thuộc về repo dự án
(ở đây là Gen-hub). `Project/gen-hub/` trong Brain chỉ cập nhật ở các mốc lớn
(pivot kiến trúc, quyết định phạm vi), không phải theo từng task.
