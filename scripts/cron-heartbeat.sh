#!/bin/bash
# lyra-cron-heartbeat: alert if the OpenClaw cron store ever drops to empty again.
# Background: the 2026-06 OpenClaw upgrade silently wiped the cron store; all digests
# were dead for ~2 weeks because nothing watched this subsystem. This is that watch.
set -uo pipefail
source /root/.openclaw/.env 2>/dev/null || true
source /root/lyra-ai/scripts/ops-notify.sh
CHAT_ID="${TELEGRAM_USER_ID:-}"
STATE_FILE="/tmp/lyra-cron-heartbeat-state"
MIN=${LYRA_CRON_MIN:-1}
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

alert() {
  local m="$1"
  ops_note event "Cron heartbeat" "$m"
}

JSON=$(openclaw cron list --json 2>/dev/null)
COUNT=$(printf '%s' "$JSON" | python3 -c 'import sys,json
try: print(len(json.load(sys.stdin).get("jobs",[])))
except Exception: print(-1)' 2>/dev/null)

if [ -z "$COUNT" ] || [ "$COUNT" = "-1" ]; then
  # Could not query (gateway down?) — that path is covered by lyra-health-check. Stay quiet.
  echo "$TS UNKNOWN (cron list query failed)"
  exit 0
fi

if [ "$COUNT" -lt "$MIN" ]; then
  echo "$TS ALERT cron_count=$COUNT (< $MIN)"
  if [ "$(cat "$STATE_FILE" 2>/dev/null)" != "down" ]; then
    alert "⚠️ Lyra cron subsystem EMPTY (openclaw cron list = ${COUNT}). Scheduled digests/nudges will NOT fire. Likely an OpenClaw upgrade wiped the store again — re-import: python3 /root/lyra-ai/scripts/restore-crons.py"
    echo "down" > "$STATE_FILE"
  fi
else
  echo "$TS OK cron_count=$COUNT"
  if [ "$(cat "$STATE_FILE" 2>/dev/null)" = "down" ]; then
    alert "✅ Lyra cron subsystem recovered (${COUNT} jobs scheduled)."
    rm -f "$STATE_FILE"
  fi
fi
