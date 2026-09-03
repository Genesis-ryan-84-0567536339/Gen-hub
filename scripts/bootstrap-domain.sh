#!/usr/bin/env bash
# Gen Hub - E1 First-Run Domain & HTTPS Bootstrap
# Idempotent bootstrap CLI helper for clean VPS & container deployments.

set -euo pipefail

usage() {
  cat << USAGE
Cách dùng: $0 --domain <domain-name> [tùy chọn]

Tùy chọn:
  --domain <fqdn>         Public domain name (ví dụ: mcp.yourdomain.com) [bắt buộc]
  --http-port <port>      HTTP port (mặc định: 8080)
  --https-port <port>     HTTPS port (mặc định: 8443)
  --tls-mode <mode>       TLS mode: letsencrypt | custom | none (mặc định: letsencrypt)
  --cert-path <path>      Đường dẫn cert (khi dùng custom TLS)
  --key-path <path>       Đường dẫn private key (khi dùng custom TLS)
  --skip-dns              Bỏ qua bước xác minh DNS lookup
  --env-file <path>       File lưu trữ cấu hình runtime (mặc định: /data/gen-hub.env)
  --apply                 Tự động áp dụng/khởi động runtime sau khi ghi cấu hình
  -h, --help              Hiển thị trợ giúp này

Ví dụ:
  $0 --domain mcp.example.com --tls-mode letsencrypt
USAGE
  exit 1
}

DOMAIN=""
HTTP_PORT="8080"
HTTPS_PORT="8443"
TLS_MODE="letsencrypt"
CERT_PATH=""
KEY_PATH=""
SKIP_DNS="false"
ENV_FILE="/data/gen-hub.env"
APPLY="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain)
      DOMAIN="$2"
      shift 2
      ;;
    --http-port)
      HTTP_PORT="$2"
      shift 2
      ;;
    --https-port)
      HTTPS_PORT="$2"
      shift 2
      ;;
    --tls-mode)
      TLS_MODE="$2"
      shift 2
      ;;
    --cert-path)
      CERT_PATH="$2"
      shift 2
      ;;
    --key-path)
      KEY_PATH="$2"
      shift 2
      ;;
    --skip-dns)
      SKIP_DNS="true"
      shift 1
      ;;
    --env-file)
      ENV_FILE="$2"
      shift 2
      ;;
    --apply)
      APPLY="true"
      shift 1
      ;;
    -h|--help)
      usage
      ;;
    *)
      echo "Lỗi: Tham số không hợp lệ: $1" >&2
      usage
      ;;
  esac
done

if [[ -z "${DOMAIN}" ]]; then
  echo "Lỗi: --domain là bắt buộc." >&2
  usage
fi

# Clean up and normalize domain syntax
DOMAIN="$(echo "${DOMAIN}" | tr '[:upper:]' '[:lower:]' | sed -e 's|^https://||' -e 's|^http://||' -e 's|/.*$||')"

if [[ ! "${DOMAIN}" =~ ^([a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$ && "${DOMAIN}" != "localhost" ]]; then
  echo "Lỗi: Cú pháp domain '${DOMAIN}' không hợp lệ. Vui lòng nhập FQDN đúng chuẩn." >&2
  exit 1
fi

# Normalize TLS mode
TLS_MODE="$(echo "${TLS_MODE}" | tr '[:upper:]' '[:lower:]')"
case "${TLS_MODE}" in
  none)
    SERVER_URL="http://${DOMAIN}:${HTTP_PORT}"
    ENABLE_TLS="false"
    ;;
  letsencrypt)
    SERVER_URL="https://${DOMAIN}"
    ENABLE_TLS="true"
    ;;
  custom)
    SERVER_URL="https://${DOMAIN}"
    ENABLE_TLS="true"
    if [[ -z "${CERT_PATH}" || -z "${KEY_PATH}" ]]; then
      echo "Lỗi: --tls-mode custom bắt buộc phải có --cert-path và --key-path." >&2
      exit 1
    fi
    if [[ ! -f "${CERT_PATH}" ]]; then
      echo "Lỗi: Không tìm thấy TLS certificate tại '${CERT_PATH}'." >&2
      exit 1
    fi
    if [[ ! -f "${KEY_PATH}" ]]; then
      echo "Lỗi: Không tìm thấy TLS private key tại '${KEY_PATH}'." >&2
      exit 1
    fi
    ;;
  *)
    echo "Lỗi: --tls-mode '${TLS_MODE}' không hợp lệ. Chỉ chấp nhận 'letsencrypt', 'custom' hoặc 'none'." >&2
    exit 1
    ;;
esac

echo "=== [Gen Hub] Bắt đầu cấu hình First-Run Domain & HTTPS (E1) ==="
echo "Domain:      ${DOMAIN}"
echo "TLS Mode:    ${TLS_MODE}"
echo "Server URL:  ${SERVER_URL}"

# DNS Lookup Check (Factual & Strict)
if [[ "${SKIP_DNS}" != "true" && "${DOMAIN}" != "localhost" ]]; then
  echo "Đang kiểm tra DNS readiness cho ${DOMAIN}..."
  RESOLVED=""
  if command -v host >/dev/null 2>&1; then
    if host "${DOMAIN}" >/dev/null 2>&1; then
      RESOLVED="true"
    fi
  elif command -v nslookup >/dev/null 2>&1; then
    if nslookup "${DOMAIN}" >/dev/null 2>&1; then
      RESOLVED="true"
    fi
  elif command -v getent >/dev/null 2>&1; then
    if getent hosts "${DOMAIN}" >/dev/null 2>&1; then
      RESOLVED="true"
    fi
  fi

  if [[ "${RESOLVED}" != "true" ]]; then
    echo "Lỗi: Không thể phân giải DNS cho domain '${DOMAIN}'." >&2
    echo "Yêu cầu: Hãy cấu hình bản ghi A/AAAA trỏ về địa chỉ IP của máy chủ này trước, hoặc truyền cờ '--skip-dns' nếu đang cài đặt offline/staging." >&2
    exit 1
  fi
  echo "Xác minh DNS readiness thành công."
fi

MCP_ENDPOINT="${SERVER_URL}/mcp"

# Write persisted environment file idempotently with 0600 permissions
echo "Ghi cấu hình runtime vào ${ENV_FILE}..."
mkdir -p "$(dirname "${ENV_FILE}")" 2>/dev/null || ENV_FILE="${HOME}/.gen-hub.env"

cat << ENV_CONTENT > "${ENV_FILE}"
# Gen Hub Persisted Runtime Configuration (E1)
# Generated at $(date -u +"%Y-%m-%dT%H:%M:%SZ")
GEN_HUB_DOMAIN=${DOMAIN}
OBOT_SERVER_HOSTNAME=${SERVER_URL}
OBOT_SERVER_UI_HOSTNAME=${SERVER_URL}
GEN_HUB_MCP_ENDPOINT=${MCP_ENDPOINT}
GEN_HUB_ENABLE_TLS=${ENABLE_TLS}
GEN_HUB_TLS_MODE=${TLS_MODE}
GEN_HUB_HTTP_PORT=${HTTP_PORT}
GEN_HUB_HTTPS_PORT=${HTTPS_PORT}
GEN_HUB_TLS_CERT_PATH=${CERT_PATH}
GEN_HUB_TLS_KEY_PATH=${KEY_PATH}
ENV_CONTENT

chmod 600 "${ENV_FILE}"

echo ""
echo "=== [Gen Hub] Cấu hình hoàn tất thành công ==="
echo "Server URL:    ${SERVER_URL}"
echo "MCP Endpoint:  ${MCP_ENDPOINT}"
echo "Env File:      ${ENV_FILE}"

if [[ "${APPLY}" == "true" ]]; then
  echo ""
  echo "Đang áp dụng cấu hình runtime vào Gen Hub service..."
  if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet gen-hub 2>/dev/null; then
    echo "Khởi động lại service gen-hub qua systemd..."
    systemctl restart gen-hub
  elif [[ -f "deploy/docker-compose.prod.yaml" ]] && command -v docker >/dev/null 2>&1; then
    echo "Khởi động container stack qua docker compose..."
    export GEN_HUB_DOMAIN="${DOMAIN}"
    docker compose -f deploy/docker-compose.prod.yaml up -d --remove-orphans
  else
    echo "Cấu hình đã sẵn sàng. Chạy 'export \$(cat ${ENV_FILE} | xargs) && ./run.sh' để khởi động Hub."
  fi
fi
