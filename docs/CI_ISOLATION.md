# CI cách ly — Refs #23

PR này cung cấp bootstrap và vòng đời runner, cùng registry để PR deploy-approval
đọc action đã được owner đăng ký. Không cài runner khi update Hub; owner chạy
bootstrap riêng sau review. Gitea storage/SSO hiện tại và pipeline updater Hub
vẫn dùng cấu hình của chúng.

## Runtime

`genhub-ci` là system user riêng, locked/no-login, không supplementary group.
Bootstrap từ chối account/thư mục có sẵn không thuộc installation, và từ chối
mọi quyền sudo phát hiện được. Docker daemon **rootless riêng** chạy trong user
manager của UID này, endpoint `/run/user/<uid>/docker.sock`. Runner binary chạy
dưới cùng user, chỉ có label `genhub-ci:docker://<image@sha256>`. Đây là Docker
execution mode của Gitea Runner; không có host label.

Job/action containers không nhận socket: `container.docker_host: "-"`,
`valid_volumes: []`, `privileged: false`, bỏ capabilities và bật
`no-new-privileges`. Không dùng `runtime.DOCKER` để chạy CI. Bind mounts do
workflow yêu cầu không được allowlist. Docker rootless yêu cầu cgroup v2 với
driver systemd; thiếu điều kiện sẽ dừng, không fallback.

Giới hạn cố định:

| Phạm vi | Giới hạn |
| --- | --- |
| Toàn UID (runner, daemon, job, sidecar) | 2 CPU, RAM 6 GiB, swap 0, 512 tasks |
| Workspace + Docker images/layers/volumes | tmpfs 4 GiB, nosuid/nodev; mất khi unmount/reboot |
| `/tmp`, `/var/tmp` của user manager | tmpfs 128 MiB mỗi nơi |
| Job container mặc định | 2 CPU, 2 GiB RAM, swap 0, 256 PIDs |
| Job | 20 phút, capacity 1 |
| Drain | SIGTERM ngừng fetch, đợi tối đa 21 phút; systemd kill sau 22 phút |

Workflow options có thể điều chỉnh tài nguyên container, nhưng không thể nới
giới hạn tổng của UID do system manager quản lý. tmpfs tính vào RAM; OOM hoặc
hết workspace làm job thất bại. Dùng image build gọn để đủ cả image và workspace.
Không bật cache chia sẻ giữa job. Docker local logs giới hạn 2 × 5 MiB/container.

User manager có filesystem chỉ đọc ngoài workspace/runtime UID, che `/var/lib/gen-hub`,
`/etc/gen-hub` (gồm update.env/tunnel.token), `/etc/cloudflared`, `/root`, `/opt`,
runtime Docker/containerd socket và `/etc/gen-hub-deploy`. Runner config,
binary, unit files và toàn bộ cây cấu hình user manager do root sở hữu.
RootlessKit tắt host loopback. Đây không phải firewall egress: job vẫn có mạng
để clone Gitea và lấy dependencies. Không đưa secret host vào repository/Actions
secrets. Kernel/container escape cần nghiệm thu độc lập; mock tests không chứng
minh được ranh giới kernel trên host thật.

## Bootstrap sau review (chỉ owner thực thi)

Prerequisites: systemd + cgroup v2, Docker rootless extras tại `/usr/bin`,
rootlesskit/slirp4netns, uidmap, dbus user sessions. Bootstrap không gọi apt/dnf,
không thay Docker runtime và không tải/chạy binary từ URL không kiểm digest.
Owner chuẩn bị Gitea Runner **3.x** trong đường dẫn root-owned, không symlink,
không group/world-writable; xác minh checksum từ release chính thức. Job image
phải có Node 24, Git, Bash và Python 3, pin digest, chẳng hạn biến thể Node 24
bookworm đầy đủ sau khi xác minh digest trên registry.

```sh
gen-hub ci-bootstrap --repo OWNER/REPO \
  --runner-binary /usr/local/src/gitea-runner \
  --runner-sha256 <64-hex-checksum> \
  --job-image docker.io/library/node:24-bookworm@sha256:<64-hex-digest>
```

CLI root hỏi Gitea API credential bằng getpass. Credential cần quản trị repo
đã chọn (scope repository phù hợp), dùng để tạo registration token, xem runner/job,
bật Actions của repo và deregister. Nó nằm tại `/etc/genhub-ci/api-token`, root
0600, không được cấp cho CI. Registration token lấy bằng **POST**
`/repos/{owner}/{repo}/actions/runners/registration-token`, truyền stdin; output
đăng ký không ghi journal/terminal. `.runner` cuối cùng root:genhub-ci 0640 ở
ngoài workspace. Bootstrap kiểm lại runner ID bằng endpoint của đúng repo.

Bootstrap bật Actions trong Gitea Compose và repo được chọn. Cờ
`gitea_actions_enabled` giữ cấu hình này qua manifest regeneration. Mỗi installation
hiện có một runner cho một repo; thêm repo/đổi runtime cần thay đổi được review,
không tự chuyển thành instance runner. Chạy lại cùng cấu hình để resume; không
đăng ký trùng khi đã có `.runner`. Thay binary/image/repo bị từ chối.

## Vòng đời và phục hồi

| Lệnh | Hành vi CI |
| --- | --- |
| `status` | repo, registration ID, trạng thái Gitea và job ID của đúng runner; lỗi API không báo idle |
| `doctor` | như status, thêm kiểm binary/config/unit và rootless/cgroup/tmpfs thực tế |
| `restart` | drain trước restart Hub/Gitea; chỉ nhận job lại khi health thành công |
| `uninstall` | drain, DELETE runner ở đúng repo, dừng daemon/user manager, unmount workspace; giữ cấu hình để bootstrap lại |
| `uninstall --purge` | như trên rồi xóa đúng user/storage/units/binary của CI; giữ action registry owner đăng ký |
| Update Hub | runner binary/image độc lập; không tự upgrade runner |
| Backup/restore CI | owner lưu `/etc/genhub-ci`, `/var/lib/genhub-ci/.runner` và binary/checksum riêng, bảo vệ như credential; không sao lưu workspace tmpfs |

Nếu DELETE runner lỗi, dừng cleanup và giữ credential/state để retry, không xóa
Gitea trước khi deregister thành công. Lỗi restart/health giữ runner ngừng nhận
job; owner chạy lại bootstrap sau khi sửa. Backup Hub hiện không gộp CI: không
restore cùng `.runner` vào hai máy đang chạy. Với máy thay thế, deregister runner
cũ rồi bootstrap mới. Không tự hạ phiên bản Gitea hoặc runtime CI.

## Action registry chuẩn bị cho PR 2

`gen-hub deploy-action-register /root/web-action.json` chỉ nhận schema:

```json
{
  "actionId": "web",
  "version": "1",
  "repo": 17,
  "environments": ["staging"],
  "executable": "/usr/local/lib/gen-hub-actions/web",
  "sha256": "<64 hex digest của executable>",
  "timeoutSeconds": 60
}
```

Registry tại `/etc/gen-hub-deploy/actions`. Input, executable và mọi ancestor
phải root-owned, không symlink, không group/world-writable. Đổi nội dung phải đổi
version; loader kiểm lại checksum. Registry không chứa argv/shell template và
PR này không thực thi deploy. Owner chịu trách nhiệm giữ cả dependency mà script
import và service/runtime nó quản lý ngoài vùng CI ghi được. PR 2 sẽ ràng buộc
approval vào SHA/artifact/action version; việc đăng ký action không cấp giấy duyệt.

## Kiểm thử và nghiệm thu

`tests/ci_runner_test.py` chạy bootstrap/lifecycle bằng filesystem tạm và mock
mọi subprocess/API/ownership. Các test gồm secret stdin, repo scope, Docker
rootful bị chặn, limits, sudo/group grants, retry, drain, deregister lỗi,
purge giữ registry và kiểm version/digest action. Không chạy sudo/systemctl
hay cài account/service thật trên máy phát triển.

Workflow thủ công `.gitea/workflows/ci-isolation.yml` để owner/reviewer chạy
trên VM thử sau khi cài bootstrap: clone source, kiểm đường dẫn secret/socket
và chạy syntax + npm test/check thật. Cần ghi lại run/job ID, host `genhub-ci`
UID, kết quả `sudo -l` không có lệnh cho phép, `doctor` và bằng chứng job không
đọc được secret/socket. Path không tồn tại trong job là kết quả mong đợi vì
không mount host data; dùng secret sentinel trong VM để kiểm thêm bind-mount
âm tính và service containers. Chưa coi mock pass là job CI thật đã nghiệm thu.

Tài liệu API/cấu hình được đối chiếu: [Gitea Runner configuration](https://docs.gitea.com/runner/reference/config-example/),
[registration](https://docs.gitea.com/runner/registration/),
[Gitea 1.27.3 API schema](https://github.com/go-gitea/gitea/blob/v1.27.3/templates/swagger/v1_json.tmpl),
[Docker rootless](https://docs.docker.com/engine/security/rootless/).
