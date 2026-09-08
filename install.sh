#!/usr/bin/env bash
set -Eeuo pipefail
GENHUB_AUTO=0
GENHUB_REVISION=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    --auto) GENHUB_AUTO=1; shift ;;
    --revision) GENHUB_REVISION=${2:?Thiếu revision}; shift 2 ;;
    --help) break ;;
    *) echo "Tham số không hợp lệ: $1" >&2; exit 1 ;;
  esac
done
if [[ ${1:-} == --help ]]; then
  echo 'Gen-hub: chạy ./install.sh để cài hoặc cập nhật qua TUI Docker Compose.'
  exit 0
fi
# Download one coherent source revision; interactive input is always /dev/tty.
if [[ "$(uname -s)" != Linux ]]; then echo 'Gen-hub hỗ trợ Linux.' >&2; exit 1; fi
if [[ $GENHUB_AUTO -eq 0 ]] && ! ( : </dev/tty ) 2>/dev/null; then echo 'Cần terminal tương tác để cài Gen-hub.' >&2; exit 1; fi
if [[ $GENHUB_AUTO -eq 1 && ${EUID} -ne 0 ]]; then echo "Auto update cần root." >&2; exit 1; fi
if [[ ${EUID} -eq 0 ]]; then SUDO=(); else
  if ! command -v sudo >/dev/null; then echo "Cần sudo hoặc chạy bằng root." >&2; exit 1; fi
  SUDO=(sudo)
fi
if ! command -v curl >/dev/null || ! command -v python3 >/dev/null || ! command -v tar >/dev/null; then
  if [[ $GENHUB_AUTO -eq 1 ]]; then echo 'Thiếu công cụ bootstrap; chạy install.sh tương tác để sửa.' >&2; exit 1; fi
  if command -v apt-get >/dev/null; then
    "${SUDO[@]}" apt-get update
    "${SUDO[@]}" apt-get install -y curl ca-certificates python3 tar xz-utils
  elif command -v dnf >/dev/null; then
    "${SUDO[@]}" dnf install -y curl ca-certificates python3 tar xz
  else echo 'Cài curl, python3, tar, xz và chạy lại.' >&2; exit 1; fi
fi
umask 077
TMPDIR_GENHUB=$(mktemp -d)
trap 'rm -rf "$TMPDIR_GENHUB"' EXIT
if [[ -n $GENHUB_REVISION ]]; then
  [[ $GENHUB_REVISION =~ ^[0-9a-f]{40}$ ]] || { echo 'Revision không hợp lệ.' >&2; exit 1; }
  GENHUB_SHA=$GENHUB_REVISION
else
  curl --proto '=https' --tlsv1.2 --fail --silent --show-error --retry 3 https://api.github.com/repos/Genesis-ryan-84-0567536339/Gen-hub/commits/main -o "$TMPDIR_GENHUB/commit.json"
GENHUB_SHA=$(python3 -c 'import json,sys,re; s=json.load(open(sys.argv[1]))["sha"]; assert re.fullmatch("[0-9a-f]{40}",s); print(s)' "$TMPDIR_GENHUB/commit.json")
fi
curl --proto '=https' --tlsv1.2 --fail --silent --show-error --retry 3 "https://codeload.github.com/Genesis-ryan-84-0567536339/Gen-hub/tar.gz/$GENHUB_SHA" -o "$TMPDIR_GENHUB/source.tar.gz"
mkdir "$TMPDIR_GENHUB/source"
tar -xzf "$TMPDIR_GENHUB/source.tar.gz" --strip-components=1 -C "$TMPDIR_GENHUB/source"
if [[ $GENHUB_AUTO -eq 1 ]]; then
  python3 "$TMPDIR_GENHUB/source/scripts/install.py" --source "$TMPDIR_GENHUB/source" --revision "$GENHUB_SHA" --auto </dev/null
else
  "${SUDO[@]}" python3 "$TMPDIR_GENHUB/source/scripts/install.py" --source "$TMPDIR_GENHUB/source" --revision "$GENHUB_SHA" </dev/tty
fi
