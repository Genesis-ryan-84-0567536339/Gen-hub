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

# Clean up domain syntax
DOMAIN="$(echo "${DOMAIN}" | tr '[:upper:]' '[:lower:]' | sed -e 's|^https://||' -e 's|^http://||' -e 's|/.*$||')"

if [[ ! "${DOMAIN}" =~ ^([a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$ && "${DOMAIN}" != "localhost" ]]; then
  echo "Lỗi: Cú pháp domain '${DOMAIN}' không hợp lệ. Vui lòng nhập FQDN đúng chuẩn." >&2
  exit 1
fi

echo "=== [Gen Hub] Bắt đầu cấu hình First-Run Domain & HTTPS (E1) ==="
echo "Domain:      ${DOMAIN}"
echo "TLS Mode:    ${TLS_MODE}"

# DNS Lookup Check
if [[ "${SKIP_DNS}" != "true" && "${DOMAIN}" != "localhost" ]]; then
  echo "Đang kiểm tra DNS readiness cho ${DOMAIN}..."
  if command -v host >/dev/null 2>&1; then
    DNS_OUTPUT=$(host "${DOMAIN}" || true)
  elif command -v nslookup >/dev/null 2>&1; then
    DNS_OUTPUT=$(nslookup "${DOMAIN}" || true)
  elif command -v getent >/dev/null 2>&1; then
    DNS_OUTPUT=$(getent hosts "${DOMAIN}" || true)
  else
    DNS_OUTPUT="Resolver utility not available on host; skipped live check"
  fi

  if [[ -z "${DNS_OUTPUT}" ]]; then
    echo "Cảnh báo: Không thể phân giải DNS cho domain ${DOMAIN}. Hãy đảm bảo bản ghi A/AAAA đã trỏ đúng IP." >&2
  else
    echo "DNS check hoàn tất."
  fi
fi

# Calculate Server URL and MCP Endpoint
if [[ "${TLS_MODE}" != "none" ]]; then
  SERVER_URL="https://${DOMAIN}"
  ENABLE_TLS="true"
else
  SERVER_URL="http://${DOMAIN}:${HTTP_PORT}"
  ENABLE_TLS="false"
fi

MCP_ENDPOINT="${SERVER_URL}/mcp"

# Write persisted environment file idempotently
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
echo ""
echo "Bạn có thể khởi động Hub với: export \$(cat ${ENV_FILE} | xargs) && ./run.sh"
