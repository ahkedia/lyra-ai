#!/bin/bash
# Lyra Usage Tracker — parses session logs for model usage and API health
# Called by cron jobs (daily digest, weekly report)
# Usage: lyra-usage-tracker.sh [daily|weekly]

source /root/.openclaw/.env 2>/dev/null

MODE="${1:-daily}"
SESSIONS_DIR="/root/.openclaw/agents/main/sessions"
LOG_FILE="/tmp/lyra-usage-stats.log"

if [ "$MODE" = "daily" ]; then
    SINCE=$(date -u -d "24 hours ago" '+%Y-%m-%dT%H:%M')
    LABEL="Today"
else
    SINCE=$(date -u -d "7 days ago" '+%Y-%m-%dT%H:%M')
    LABEL="This week"
fi

# Parse all session files for model usage and timing
python3 - "$MODE" << 'PYEOF'
import json, glob, sys, os
from datetime import datetime, timedelta, timezone

mode = sys.argv[1] if len(sys.argv) > 1 else "daily"
if mode == "daily":
    since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=24)
    label = "Today"
else:
    since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=7)
    label = "This week"

sessions_dir = "/root/.openclaw/agents/main/sessions"
files = glob.glob(os.path.join(sessions_dir, "*.jsonl"))

# Counters
model_requests = {}     # model -> count of assistant messages
model_tool_calls = {}   # model -> count of tool calls
model_errors = {}       # model -> count of errors
total_messages = 0
total_tool_calls = 0
total_errors = 0
total_timeouts = 0
sessions_active = 0
current_model = None

for f in files:
    session_in_range = False
    try:
        with open(f) as fh:
            for line in fh:
                try:
                    obj = json.loads(line.strip())
                except:
                    continue

                ts_str = obj.get("timestamp", "")
                if not ts_str:
                    continue

                try:
                    ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00").replace("+00:00", ""))
                except:
                    continue

                if ts < since:
                    continue

                session_in_range = True
                evt_type = obj.get("type", "")

                # Track model changes
                if evt_type == "model_change":
                    provider = obj.get("provider", "unknown")
                    model_id = obj.get("modelId", "unknown")
                    current_model = f"{provider}/{model_id}"

                # Track assistant messages (= API calls)
                if evt_type == "message":
                    msg = obj.get("message", {})
                    role = msg.get("role", "")
                    if role == "assistant":
                        model_key = current_model or "unknown"
                        model_requests[model_key] = model_requests.get(model_key, 0) + 1
                        total_messages += 1

                        # Count tool calls in this message
                        content = msg.get("content", [])
                        if isinstance(content, list):
                            for block in content:
                                if isinstance(block, dict) and block.get("type") == "toolCall":
                                    model_tool_calls[model_key] = model_tool_calls.get(model_key, 0) + 1
                                    total_tool_calls += 1

                # Track errors
                if evt_type == "custom":
                    custom_type = obj.get("customType", "")
                    if "error" in custom_type.lower() or "fail" in custom_type.lower():
                        model_key = current_model or "unknown"
                        model_errors[model_key] = model_errors.get(model_key, 0) + 1
                        total_errors += 1
                    if "timeout" in custom_type.lower():
                        total_timeouts += 1

    except Exception as e:
        pass

    if session_in_range:
        sessions_active += 1

# Calculate percentages
total_req = sum(model_requests.values()) or 1

# Build report
print(f"📊 Lyra Usage Report — {label}")
print(f"{'='*40}")
print(f"Sessions active: {sessions_active}")
print(f"Total API calls: {total_messages}")
print(f"Total tool calls: {total_tool_calls}")
print()

print("Model breakdown:")
for model, count in sorted(model_requests.items(), key=lambda x: -x[1]):
    pct = (count / total_req) * 100
    tools = model_tool_calls.get(model, 0)
    errors = model_errors.get(model, 0)
    short_name = model.split("/")[-1] if "/" in model else model
    print(f"  {short_name}: {count} calls ({pct:.0f}%) | {tools} tool calls | {errors} errors")

print()
print(f"Errors: {total_errors} | Timeouts: {total_timeouts}")
success_rate = ((total_messages - total_errors) / total_req) * 100 if total_messages > 0 else 100
print(f"Success rate: {success_rate:.1f}%")

PYEOF
