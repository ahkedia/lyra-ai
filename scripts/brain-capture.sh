#!/usr/bin/env bash
# Serialized gbrain capture — write path via HTTP MCP (put_page).
# Replaced subprocess/CLI path 2026-06-20 — gbrain-http.service holds PGLite
# permanently; direct CLI calls deadlock. Now uses write-scoped OAuth token.
#
# Usage (unchanged from previous version):
#   brain-capture.sh inline "<text>" [type] [slug-prefix]
#   echo "<text>" | brain-capture.sh stdin [type] [slug-prefix]
set -uo pipefail

LOG="/var/log/lyra/brain-capture.log"
mkdir -p /var/log/lyra 2>/dev/null || true

source /root/.openclaw/.env 2>/dev/null || true

GBRAIN_URL="${GBRAIN_HTTP_URL:-http://localhost:3131}"
WRITE_ID="${LYRA_GBRAIN_WRITE_CLIENT_ID:-}"
WRITE_SECRET="${LYRA_GBRAIN_WRITE_CLIENT_SECRET:-}"

mode="${1:-}"; shift || true

if [ "$mode" = "inline" ]; then
  CONTENT="${1:-}"; TYPE="${2:-note}"; PREFIX="${3:-lyra}"
else
  CONTENT="$(cat)"; TYPE="${1:-note}"; PREFIX="${2:-lyra}"
fi

TRIMMED="$(printf '%s' "$CONTENT" | tr -d '[:space:]')"
if [ "${#TRIMMED}" -lt 20 ]; then
  echo "[$(date -u +%T)] skip: content too short" >> "$LOG"
  exit 0
fi

if [ -z "$WRITE_ID" ] || [ -z "$WRITE_SECRET" ]; then
  echo "[$(date -u +%T)] ERROR: write client creds not set" >> "$LOG"
  exit 1
fi

SLUG="${PREFIX}/$(date -u +%Y-%m-%d)-$(printf '%s' "$CONTENT" | md5sum | cut -c1-8)"

python3 /root/lyra-ai/scripts/brain_capture_http.py \
  "$GBRAIN_URL" "$WRITE_ID" "$WRITE_SECRET" "$SLUG" "$TYPE" "$CONTENT" >> "$LOG" 2>&1

EXIT=$?
echo "[$(date -u +%T)] captured $SLUG exit=$EXIT" >> "$LOG"
