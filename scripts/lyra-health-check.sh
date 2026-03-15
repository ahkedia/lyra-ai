#!/bin/bash
# Lyra Health Check — every 15 min
# Monitors: gateway, cron failures, disk, memory, Postgres
# Alerts via Telegram on failure, auto-restarts gateway
source /root/.openclaw/.env 2>/dev/null

HEALTH_URL="http://localhost:18789/health"
BOT_TOKEN="$TELEGRAM_BOT_TOKEN"
CHAT_ID="7057922182"  # Replace with your Telegram user ID
STATE_FILE="/tmp/lyra-health-state"
CRON_STATE="/tmp/lyra-cron-error-state"

send_alert() {
    local msg="$1"
    curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
        -d chat_id="$CHAT_ID" \
        -d text="$msg" > /dev/null 2>&1
}

# ── Check 1: Gateway health ──
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$HEALTH_URL" 2>/dev/null)

if [ "$HTTP_CODE" = "200" ]; then
    if [ -f "$STATE_FILE" ]; then
        rm "$STATE_FILE"
        send_alert "Lyra recovered. Gateway operational."
    fi
else
    FAIL_COUNT=0
    [ -f "$STATE_FILE" ] && FAIL_COUNT=$(cat "$STATE_FILE")
    FAIL_COUNT=$((FAIL_COUNT + 1))
    echo "$FAIL_COUNT" > "$STATE_FILE"

    if [ "$FAIL_COUNT" -eq 1 ] || [ $((FAIL_COUNT % 4)) -eq 0 ]; then
        send_alert "Lyra Health Alert: Gateway unreachable (HTTP $HTTP_CODE). Failure #$FAIL_COUNT. Restarting..."
        systemctl restart openclaw 2>/dev/null
    fi
fi

# ── Check 2: Cron job failures ──
if [ "$HTTP_CODE" = "200" ]; then
    CRON_JSON=$(curl -s -H "Authorization: Bearer $OPENCLAW_GATEWAY_TOKEN" "http://localhost:18789/api/cron" 2>/dev/null)
    if [ -n "$CRON_JSON" ]; then
        ERRORS=$(echo "$CRON_JSON" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    jobs = data if isinstance(data, list) else data.get('jobs', data.get('data', []))
    for j in jobs:
        name = j.get('name', 'unknown')
        status = j.get('lastRunStatus', j.get('status', ''))
        errs = j.get('consecutiveErrors', 0)
        if status == 'error' or errs > 0:
            print(f'{name}: status={status}, consecutiveErrors={errs}')
except:
    pass
" 2>/dev/null)
        if [ -n "$ERRORS" ]; then
            PREV_ERRORS=""
            [ -f "$CRON_STATE" ] && PREV_ERRORS=$(cat "$CRON_STATE")
            if [ "$ERRORS" != "$PREV_ERRORS" ]; then
                echo "$ERRORS" > "$CRON_STATE"
                send_alert "Lyra Cron Alert: Failed jobs detected:
$ERRORS"
            fi
        else
            [ -f "$CRON_STATE" ] && rm "$CRON_STATE"
        fi
    fi
fi

# ── Check 3: Disk space ──
DISK_PCT=$(df / | tail -1 | awk '{print $5}' | tr -d '%')
if [ "$DISK_PCT" -gt 80 ]; then
    send_alert "Lyra: Disk usage at ${DISK_PCT}%."
fi

# ── Check 4: Memory ──
AVAIL_MB=$(free -m | awk '/Mem:/{print $7}')
if [ "$AVAIL_MB" -lt 200 ]; then
    send_alert "Lyra: Low memory - ${AVAIL_MB}MB available."
fi

# ── Check 5: Postgres ──
if ! docker ps --format '{{.Names}}' | grep -q lyra-postgres; then
    send_alert "Lyra: PostgreSQL container is DOWN. Attempting restart..."
    docker start lyra-postgres 2>/dev/null
fi
