#!/bin/bash
set -euo pipefail

source /root/.openclaw/.env 2>/dev/null || true

BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
CHAT_ID="7057922182"
LOG_FILE="/var/log/lyra/openclaw-updates.log"
STATE_FILE="/var/lib/lyra/openclaw-weekly-state.json"
mkdir -p /var/lib/lyra "$(dirname "$LOG_FILE")"

log() { echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') $*" | tee -a "$LOG_FILE"; }
notify() {
  local msg="$1"
  [ -z "$BOT_TOKEN" ] && return 0
  curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" -d chat_id="$CHAT_ID" --data-urlencode "text=$msg" > /dev/null 2>&1 || true
}

extract_ver() {
  python3 -c 'import re,sys;s=sys.stdin.read();m=re.search(r"(\d{4}\.\d+\.\d+(?:[-\w]+)?)",s);print(m.group(1) if m else "unknown")'
}

canary_check() {
  # Basic health check
  curl -sf --max-time 10 http://localhost:18789/health >/dev/null || return 1
  openclaw cron list --json >/tmp/openclaw-cron-canary.json 2>/dev/null || return 1
  python3 -c 'import json; j=json.load(open("/tmp/openclaw-cron-canary.json")); assert isinstance(j,dict) and "jobs" in j' || return 1

  # Inference canary: verify actual model routing works within 15s
  # A regression (e.g. profile routing to blocked regional endpoint) causes 20s+ timeouts
  log "running inference canary..."
  local CANARY_START CANARY_END CANARY_MS CANARY_RESULT
  CANARY_START=$(date +%s%3N)
  CANARY_RESULT=$(timeout 20 openclaw agent --agent main --timeout 15 -m "canary: reply with the word ok" --json 2>/dev/null \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print('ok' if d else 'fail')" 2>/dev/null \
    || echo "fail")
  CANARY_END=$(date +%s%3N)
  CANARY_MS=$((CANARY_END - CANARY_START))
  log "inference canary: result=${CANARY_RESULT} latency=${CANARY_MS}ms"

  [ "${CANARY_RESULT}" = "ok" ] || { log "inference canary: no response from model"; return 1; }
  [ "${CANARY_MS}" -lt 18000 ] || { log "inference canary: latency ${CANARY_MS}ms > 18s — possible profile routing regression"; return 1; }
  return 0
}

log "=== weekly openclaw maintenance ==="
INSTALLED_RAW="$(openclaw --version 2>/dev/null || true)"
INSTALLED="$(printf "%s" "$INSTALLED_RAW" | extract_ver)"
LATEST="$(npm show openclaw version 2>/dev/null | tr -d ' \n' || true)"

if [ -z "$LATEST" ]; then
  log "ERROR: unable to fetch latest openclaw version"
  notify "Lyra weekly OpenClaw check failed: could not fetch latest npm version."
  exit 1
fi

log "installed=${INSTALLED} latest=${LATEST}"

if [ "$INSTALLED" = "$LATEST" ]; then
  notify "Lyra weekly OpenClaw check: already on latest ${INSTALLED}. No update applied."
  exit 0
fi

notify "Lyra weekly OpenClaw maintenance: updating ${INSTALLED} -> ${LATEST} (Sunday window)."

systemctl stop openclaw 2>/dev/null || true
sleep 2
if ! npm install -g "openclaw@${LATEST}" >> "$LOG_FILE" 2>&1; then
  log "ERROR: npm install failed"
  notify "Lyra OpenClaw update failed during install to ${LATEST}; keeping ${INSTALLED}."
  systemctl start openclaw 2>/dev/null || true
  exit 1
fi

systemctl start openclaw 2>/dev/null || true
sleep 8

if canary_check >> "$LOG_FILE" 2>&1; then
  log "canary passed"
  python3 -c "import json;print(json.dumps({'previous':'$INSTALLED','current':'$LATEST'}))" > "$STATE_FILE"
  notify "Lyra OpenClaw update successful: ${INSTALLED} -> ${LATEST}. Canary passed."
  exit 0
fi

log "canary failed, rolling back to ${INSTALLED}"
notify "Lyra OpenClaw canary failed after update to ${LATEST}. Rolling back to ${INSTALLED}."
npm install -g "openclaw@${INSTALLED}" >> "$LOG_FILE" 2>&1 || true
systemctl restart openclaw 2>/dev/null || true
sleep 8
if canary_check >> "$LOG_FILE" 2>&1; then
  notify "Lyra rollback successful. Running on ${INSTALLED}."
else
  notify "Lyra rollback failed. Manual intervention required on gateway."
  exit 1
fi
