#!/bin/bash
set -euo pipefail
source /root/.openclaw/.env 2>/dev/null || true

HEALTH_URL="http://localhost:18789/health"
BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
CHAT_ID="7057922182"
STATE_FILE="/tmp/lyra-health-state"
CRON_STATE="/tmp/lyra-cron-error-state"

send_alert() {
  local msg="$1"
  [ -z "$BOT_TOKEN" ] && return 0
  curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" -d chat_id="$CHAT_ID" --data-urlencode "text=$msg" > /dev/null 2>&1 || true
}

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$HEALTH_URL" 2>/dev/null || echo 000)

if [ "$HTTP_CODE" = "200" ]; then
  if [ -f "$STATE_FILE" ]; then
    rm -f "$STATE_FILE"
    send_alert "Lyra recovered. Gateway operational."
  fi
else
  FAIL_COUNT=0
  [ -f "$STATE_FILE" ] && FAIL_COUNT=$(cat "$STATE_FILE" 2>/dev/null || echo 0)
  FAIL_COUNT=$((FAIL_COUNT + 1))
  echo "$FAIL_COUNT" > "$STATE_FILE"
  if [ "$FAIL_COUNT" -eq 1 ] || [ $((FAIL_COUNT % 4)) -eq 0 ]; then
    send_alert "Lyra Health Alert: Gateway unreachable (HTTP $HTTP_CODE). Failure #$FAIL_COUNT. Restarting..."
    systemctl reset-failed openclaw 2>/dev/null || true
    systemctl restart openclaw 2>/dev/null || true
  fi
fi

if [ "$HTTP_CODE" = "200" ]; then
  CRON_JSON="$(openclaw cron list --json 2>/dev/null || true)"
  if [ -n "$CRON_JSON" ]; then
    ERRORS=$(printf "%s" "$CRON_JSON" | python3 -c 'import json,sys
raw=sys.stdin.read().strip()
if not raw:
 print(""); raise SystemExit(0)
try:
 data=json.loads(raw)
except Exception:
 print(""); raise SystemExit(0)
out=[]
for j in data.get("jobs",[]):
 st=j.get("state") or {}
 errs=int(st.get("consecutiveErrors") or 0)
 last=(st.get("lastRunStatus") or st.get("lastStatus") or "")
 if errs>0 or str(last).lower()=="error":
  out.append(f"{j.get('"'"'name'"'"','"'"'unknown'"'"')}: status={last}, consecutiveErrors={errs}")
print("\\n".join(out))')
    if [ -n "$ERRORS" ]; then
      PREV_ERRORS=""
      [ -f "$CRON_STATE" ] && PREV_ERRORS=$(cat "$CRON_STATE" 2>/dev/null || true)
      if [ "$ERRORS" != "$PREV_ERRORS" ]; then
        printf "%s" "$ERRORS" > "$CRON_STATE"
        send_alert "Lyra Cron Alert: Failed jobs detected:
$ERRORS"
      fi
    else
      [ -f "$CRON_STATE" ] && rm -f "$CRON_STATE"
    fi
  fi
fi

DISK_PCT=$(df / | awk 'NR==2{gsub(/%/,"",$5); print $5}')
[ "$DISK_PCT" -gt 80 ] && send_alert "Lyra: Disk usage at ${DISK_PCT}%."
AVAIL_MB=$(free -m | awk '/Mem:/{print $7}')
[ "$AVAIL_MB" -lt 200 ] && send_alert "Lyra: Low memory - ${AVAIL_MB}MB available."
if ! docker ps --format '{{.Names}}' | awk '{print $1}' | grep -qx 'lyra-postgres'; then
  send_alert "Lyra: PostgreSQL container is DOWN. Attempting restart..."
  docker start lyra-postgres 2>/dev/null || true
fi

# ── OOM detection (2026-04-21 A3) ──
# Alert once per distinct OOM event. State file stores the UNIX ts of the most
# recent OOM we have already alerted for; only new OOMs (ts > stored) fire.
OOM_STATE="/tmp/lyra-oom-state"
LATEST_OOM_TS="$(sudo journalctl -u openclaw --since '20 minutes ago' --no-pager -o short-unix 2>/dev/null | awk '/FATAL ERROR.*heap/ {ts=$1} END {if (ts) printf "%d", ts}')"
if [ -n "${LATEST_OOM_TS:-}" ]; then
  LAST_ALERTED_TS=0
  [ -f "$OOM_STATE" ] && LAST_ALERTED_TS="$(cat "$OOM_STATE" 2>/dev/null || echo 0)"
  if [ "$LATEST_OOM_TS" -gt "${LAST_ALERTED_TS:-0}" ]; then
    printf "%s" "$LATEST_OOM_TS" > "$OOM_STATE"
    OOM_WHEN_UTC="$(date -u -d "@$LATEST_OOM_TS" '+%Y-%m-%d %H:%M:%SZ' 2>/dev/null || echo unknown)"
    send_alert "Lyra gateway OOM'd and restarted at ${OOM_WHEN_UTC}. Investigate heap usage (see TODOS L-5)."
  fi
fi
