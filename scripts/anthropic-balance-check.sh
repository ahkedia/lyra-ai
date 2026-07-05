#!/bin/bash
set -euo pipefail
source /root/.openclaw/.env 2>/dev/null || true
source /root/lyra-ai/scripts/ops-notify.sh

CHAT_ID="${TELEGRAM_USER_ID:-}"
STATE_FILE="/tmp/lyra-anthropic-balance-state"
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

alert() {
  local msg="$1"
  ops_note event "Anthropic billing" "$msg"
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
