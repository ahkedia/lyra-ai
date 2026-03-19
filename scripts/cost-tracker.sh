#!/bin/bash
# cost-tracker.sh — Daily cost tracking from routing decisions
#
# Usage:
#   bash scripts/cost-tracker.sh              # Print today's cost summary
#   bash scripts/cost-tracker.sh --telegram   # Also send summary to Telegram
#
# Runs daily at 11 PM UTC via cron:
#   0 23 * * * /root/lyra-ai/scripts/cost-tracker.sh --telegram >> /var/log/lyra/evals.log 2>&1
#
# Reads from: logs/routing-decisions.jsonl
# Cost rates per message (approximate):
#   MiniMax M2.5:    $0.0001/msg
#   Claude Haiku:    $0.001/msg
#   Claude Sonnet:   $0.01/msg

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROUTING_LOG="${SCRIPT_DIR}/../logs/routing-decisions.jsonl"
COST_LOG="${SCRIPT_DIR}/../logs/cost-history.jsonl"
SEND_TELEGRAM=false

# Source logger
if [ -f "$SCRIPT_DIR/lyra-logger.sh" ]; then
    source "$SCRIPT_DIR/lyra-logger.sh"
else
    log_info()  { echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') INFO/$1: $2"; }
fi

# Source env for Telegram
source /root/.openclaw/.env 2>/dev/null || true

# Parse args
for arg in "$@"; do
    case "$arg" in
        --telegram) SEND_TELEGRAM=true ;;
    esac
done

send_telegram() {
    local msg="$1"
    if [ -n "${TELEGRAM_BOT_TOKEN:-}" ]; then
        curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
            -d chat_id="7057922182" \
            -d text="$msg" \
            -d parse_mode="Markdown" > /dev/null 2>&1
    fi
}

if [ ! -f "$ROUTING_LOG" ]; then
    echo "No routing log found at $ROUTING_LOG"
    exit 0
fi

# Use python for reliable JSON parsing + date math
RESULT=$(python3 << 'PYEOF'
import json, sys, os
from datetime import datetime, timedelta, timezone
from collections import defaultdict

log_path = os.environ.get("ROUTING_LOG", "logs/routing-decisions.jsonl")
cost_log = os.environ.get("COST_LOG", "logs/cost-history.jsonl")

# Cost per message by tier
COSTS = {"minimax": 0.0001, "haiku": 0.001, "sonnet": 0.01}

now = datetime.now(timezone.utc)
today = now.date()
today_counts = defaultdict(int)
week_costs = []

# Read all entries from last 7 days
seven_days_ago = now - timedelta(days=7)

with open(log_path) as f:
    for line in f:
        try:
            obj = json.loads(line.strip())
            ts = datetime.fromisoformat(obj["timestamp"].replace("Z", "+00:00"))
            # Skip test entries
            if obj.get("sender") == "test" and obj.get("channel") == "test":
                continue
            tier = obj.get("tier", "minimax")
            entry_date = ts.date()

            if entry_date == today:
                today_counts[tier] += 1

            if ts >= seven_days_ago:
                week_costs.append({"date": str(entry_date), "tier": tier})
        except:
            pass

# Today's stats
total = sum(today_counts.values())
mm = today_counts["minimax"]
hk = today_counts["haiku"]
sn = today_counts["sonnet"]
cost_mm = mm * COSTS["minimax"]
cost_hk = hk * COSTS["haiku"]
cost_sn = sn * COSTS["sonnet"]
cost_total = cost_mm + cost_hk + cost_sn

# 7-day rolling average
day_costs = defaultdict(float)
day_counts = defaultdict(int)
for entry in week_costs:
    d = entry["date"]
    t = entry["tier"]
    day_costs[d] += COSTS.get(t, 0.0001)
    day_counts[d] += 1

days_with_data = len(day_costs)
avg_7d = sum(day_costs.values()) / max(days_with_data, 1)
avg_msgs = sum(day_counts.values()) / max(days_with_data, 1)

# Format output
date_str = str(today)
summary = f"{date_str}: {total} msgs ({mm} MiniMax, {hk} Haiku, {sn} Sonnet) = ${cost_total:.4f} | 7d avg: ${avg_7d:.4f}/day ({avg_msgs:.0f} msgs/day)"

# Append to cost history
try:
    os.makedirs(os.path.dirname(cost_log), exist_ok=True)
    with open(cost_log, "a") as cf:
        entry = {
            "date": date_str,
            "total_messages": total,
            "minimax": mm,
            "haiku": hk,
            "sonnet": sn,
            "cost_usd": round(cost_total, 4),
            "avg_7d_usd": round(avg_7d, 4),
        }
        cf.write(json.dumps(entry) + "\n")
except:
    pass

print(summary)
PYEOF
)

echo "$RESULT"
log_info "eval" "Daily cost: $RESULT"

if [ "$SEND_TELEGRAM" = true ]; then
    send_telegram "📊 Lyra Cost Report
$RESULT"
    echo "  Sent to Telegram"
fi
