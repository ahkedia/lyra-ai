#!/usr/bin/env bash
# Lyra WhatsApp bridge heartbeat.
# Every run: check the bridge is alive (localhost:8091/wa/health).
# With --deep (daily): also verify the Graph API token still works.
# Failures are buffered to the consolidated ops email (scripts/ops-notify.sh -> ops-email.sh).
# State files prevent alert spam; a recovery message is sent once when it clears.
set -euo pipefail

ENV_FILE="/root/.openclaw/.env"
WA_ENV_FILE="/root/.openclaw/wa-webhook.env"
HEALTH_URL="http://127.0.0.1:8091/wa/health"
STATE_DOWN="/tmp/lyra-wa-bridge-down"
STATE_TOKEN="/tmp/lyra-wa-token-bad"

# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; . "$WA_ENV_FILE"; set +a

BOT="${TELEGRAM_BOT_TOKEN:-}"
CHAT="${TELEGRAM_USER_ID:-}"
source /root/lyra-ai/scripts/ops-notify.sh

alert() {
  local msg="$1"
  ops_note event "WA bridge" "$msg"
}

# --- liveness ---
if curl -sf --max-time 10 "$HEALTH_URL" >/dev/null 2>&1; then
  if [ -f "$STATE_DOWN" ]; then
    alert "✅ Lyra WhatsApp bridge is back up."
    rm -f "$STATE_DOWN"
  fi
else
  if [ ! -f "$STATE_DOWN" ]; then
    alert "🔴 Lyra WhatsApp bridge is DOWN (health check failed on ${HEALTH_URL}). WhatsApp crons + DMs will not deliver."
    touch "$STATE_DOWN"
  fi
  exit 0   # bridge down — skip token check
fi

# --- deep: token validity (daily) ---
if [ "${1:-}" = "--deep" ]; then
  code=$(curl -s -o /dev/null --max-time 15 -w '%{http_code}' \
    "https://graph.facebook.com/${WA_GRAPH_VERSION}/${WA_PHONE_NUMBER_ID}?fields=id" \
    -H "Authorization: Bearer ${WA_TOKEN}" || echo "000")
  if [ "$code" = "200" ]; then
    if [ -f "$STATE_TOKEN" ]; then
      alert "✅ Lyra WhatsApp Graph token is valid again."
      rm -f "$STATE_TOKEN"
    fi
  else
    if [ ! -f "$STATE_TOKEN" ]; then
      alert "🔴 Lyra WhatsApp Graph token check FAILED (HTTP ${code}). Token may be revoked/expired — WhatsApp sends will silently fail."
      touch "$STATE_TOKEN"
    fi
  fi
fi
