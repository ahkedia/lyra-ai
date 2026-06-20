#!/bin/bash
set -euo pipefail
source /root/.openclaw/.env 2>/dev/null || true

CHAT_ID="7057922182"
STATE_FILE="/tmp/lyra-anthropic-balance-state"
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

alert() {
  local msg="$1"
  [ -z "${TELEGRAM_BOT_TOKEN:-}" ] && return 0
  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d chat_id="$CHAT_ID" --data-urlencode "text=$msg" > /dev/null 2>&1 || true
}

RESP=$(curl -sS --max-time 15 https://api.anthropic.com/v1/messages \
  -H "x-api-key: ${ANTHROPIC_API_KEY}" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-haiku-4-5","max_tokens":10,"messages":[{"role":"user","content":"hi"}]}' 2>&1)

if echo "$RESP" | grep -qi "credit balance"; then
  echo "$TS BILLING_FAIL"
  if [ ! -f "$STATE_FILE" ] || [ "$(cat "$STATE_FILE" 2>/dev/null)" != "billing" ]; then
    alert "Anthropic credit balance exhausted. Crons will silently fall back to MiniMax. Top up at console.anthropic.com to restore Anthropic-preferred paths."
    echo "billing" > "$STATE_FILE"
  fi
elif echo "$RESP" | grep -q '"type":"message"'; then
  echo "$TS OK"
  if [ -f "$STATE_FILE" ] && [ "$(cat "$STATE_FILE" 2>/dev/null)" = "billing" ]; then
    alert "Anthropic credits restored. Anthropic-preferred paths re-enabled."
    rm -f "$STATE_FILE"
  fi
else
  echo "$TS OTHER_ERROR: ${RESP:0:200}"
fi
