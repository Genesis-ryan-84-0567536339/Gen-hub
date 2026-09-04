#!/usr/bin/env bash
# Gen Hub first-run wrapper. Domain validation and persistence are owned by
# the compiled domain-bootstrap command so the shell and Go paths cannot drift.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="/data/gen-hub.env"
APPLY="false"
DOMAIN_PROVIDED="false"
BOOTSTRAP_ARGS=()

usage() {
  cat <<'USAGE'
Cách dùng: bootstrap-domain.sh --domain <domain-name> [tùy chọn]

Tùy chọn:
  --domain <fqdn>         Public domain name (bắt buộc)
  --http-port <port>      HTTP port (mặc định: 8080)
  --https-port <port>     HTTPS port (mặc định: 8443)
  --tls-mode <mode>       letsencrypt | custom | none (mặc định: letsencrypt)
  --cert-path <path>      TLS certificate cho custom mode
  --key-path <path>       TLS private key cho custom mode
  --skip-dns              Bỏ qua DNS check cho local/staging
  --env-file <path>       Runtime env file (mặc định: /data/gen-hub.env)
  --apply                 Khởi động lại service hoặc Docker Compose sau khi ghi config
  -h, --help              Hiển thị trợ giúp

Có thể đặt GEN_HUB_BIN để chỉ định binary Gen Hub/Obot đã cài.
USAGE
}

require_value() {
  local flag="$1"
  local value="${2:-}"
  if [[ -z "${value}" ]]; then
    echo "Lỗi: ${flag} cần một giá trị." >&2
    exit 1
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain)
      require_value "$1" "${2:-}"
      DOMAIN_PROVIDED="true"
      BOOTSTRAP_ARGS+=("$1" "$2")
      shift 2
      ;;
    --http-port|--https-port|--tls-mode|--cert-path|--key-path)
      require_value "$1" "${2:-}"
      BOOTSTRAP_ARGS+=("$1" "$2")
      shift 2
      ;;
    --env-file)
      require_value "$1" "${2:-}"
      ENV_FILE="$2"
      shift 2
      ;;
    --skip-dns)
      BOOTSTRAP_ARGS+=("$1")
      shift
      ;;
    --apply)
      APPLY="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Lỗi: Tham số không hợp lệ: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ "${DOMAIN_PROVIDED}" != "true" ]]; then
  echo "Lỗi: --domain là bắt buộc." >&2
  usage >&2
  exit 1
fi

GEN_HUB_EXECUTABLE="${GEN_HUB_BIN:-}"
if [[ -z "${GEN_HUB_EXECUTABLE}" && -x "${REPO_ROOT}/bin/obot" ]]; then
  GEN_HUB_EXECUTABLE="${REPO_ROOT}/bin/obot"
fi
if [[ -z "${GEN_HUB_EXECUTABLE}" ]]; then
  GEN_HUB_EXECUTABLE="$(command -v obot || true)"
fi
if [[ -z "${GEN_HUB_EXECUTABLE}" || ! -x "${GEN_HUB_EXECUTABLE}" ]]; then
  echo "Lỗi: Không tìm thấy binary Gen Hub. Hãy cài release hoặc đặt GEN_HUB_BIN." >&2
  exit 1
fi

"${GEN_HUB_EXECUTABLE}" domain-bootstrap "${BOOTSTRAP_ARGS[@]}" --env-file "${ENV_FILE}"

if [[ "${APPLY}" != "true" ]]; then
  exit 0
fi

if command -v systemctl >/dev/null 2>&1 && systemctl cat gen-hub.service >/dev/null 2>&1; then
  echo "Khởi động lại gen-hub.service..."
  systemctl restart gen-hub.service
elif command -v docker >/dev/null 2>&1 && [[ -f "${REPO_ROOT}/deploy/docker-compose.prod.yaml" ]]; then
  echo "Áp dụng cấu hình bằng Docker Compose..."
  docker compose \
    --env-file "${ENV_FILE}" \
    -f "${REPO_ROOT}/deploy/docker-compose.prod.yaml" \
    up -d --remove-orphans
else
  echo "Cấu hình đã được ghi nhưng không tìm thấy gen-hub.service hoặc Docker Compose." >&2
  echo "Hãy khởi động runtime bằng env file: ${ENV_FILE}" >&2
  exit 1
fi
