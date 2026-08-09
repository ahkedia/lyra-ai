#!/bin/bash
set -euo pipefail
source /root/.openclaw/.env 2>/dev/null || true
source /root/lyra-ai/scripts/ops-notify.sh
STATE_FILE="/tmp/lyra-cron-heartbeat-state"
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
CRITICAL='["health-morning-bundle","health-evening-checkin","preposition-drill","preposition-weekly-recap"]'
JSON=$(openclaw cron list --json 2>/dev/null || true)
RESULT=$(printf '%s' "$JSON" | python3 -c '
import json,sys
try:
 d=json.load(sys.stdin); names=set(json.loads(sys.argv[1])); bad=[]
 for j in d.get("jobs",[]):
  if j.get("name") in names:
   s=j.get("state",{}); status=s.get("lastStatus"); delivered=s.get("lastDeliveryStatus")
   if status != "ok" or (j.get("delivery",{}).get("mode")=="announce" and delivered != "delivered"):
    bad.append(f"{j["name"]}: status={status}, delivery={delivered}")
 print("; ".join(bad) if bad else "OK")
except Exception: print("UNKNOWN")
' "$CRITICAL")
if [ "$RESULT" = "OK" ]; then echo "$TS OK critical_crons"; rm -f "$STATE_FILE"; exit 0; fi
echo "$TS ALERT $RESULT"
if [ "$(cat "$STATE_FILE" 2>/dev/null || true)" != "$RESULT" ]; then
  ops_note event "Cron heartbeat" "⚠️ Critical cron failure: $RESULT"
  printf '%s' "$RESULT" > "$STATE_FILE"
fi
