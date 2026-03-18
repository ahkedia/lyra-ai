#!/bin/bash
# Lyra Eval Runner — Entry point
# Runs eval suite, aggregates results, syncs to Notion, pushes dashboard data
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== Lyra Eval Suite ==="
echo "Time: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo ""

# Source environment
if [ -f /root/.openclaw/.env ]; then
  set -a
  source /root/.openclaw/.env
  set +a
fi

# Health check: is gateway running?
if ! ss -tlnp | grep -q 18789; then
  echo "ERROR: OpenClaw gateway not running on port 18789"
  # Send Telegram alert
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_USER_ID:-}" ]; then
    curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      -d "chat_id=${TELEGRAM_USER_ID}" \
      -d "text=⚠️ Eval runner failed: gateway not running" > /dev/null 2>&1
  fi
  exit 1
fi

# Step 0: Run routing accuracy eval (offline — no API calls to Lyra, just classifier tests)
echo "Step 0: Running routing accuracy eval..."
node routing-eval.js 2>&1
ROUTING_EXIT=$?
if [ $ROUTING_EXIT -ne 0 ]; then
  echo "  ⚠️ Routing accuracy below 90% threshold"
fi
echo ""

# Step 1: Run evals
echo "Step 1: Running eval tests..."
node runner.js "$@"
EVAL_EXIT=$?

# Step 2: Aggregate results
echo ""
echo "Step 2: Aggregating results..."
OUTPUT_DIR="$SCRIPT_DIR/output" node aggregate.js

# Step 3: Sync to Notion
echo ""
echo "Step 3: Syncing to Notion..."
node notion-sync.js || echo "[warn] Notion sync failed (non-fatal)"

# Step 4: Push dashboard data
echo ""
echo "Step 4: Pushing dashboard data..."
DASHBOARD_DATA_DIR="/root/lyra-ai/docs/dashboard/data"
if [ -d "$DASHBOARD_DATA_DIR" ]; then
  cp -f "$SCRIPT_DIR/output/"*.json "$DASHBOARD_DATA_DIR/" 2>/dev/null || true

  cd /root/lyra-ai
  if git diff --quiet docs/dashboard/data/; then
    echo "  No changes to push."
  else
    git add docs/dashboard/data/
    git commit -m "Update eval dashboard data $(date +%Y-%m-%d)" > /dev/null 2>&1
    git push origin main > /dev/null 2>&1
    echo "  Dashboard data pushed to GitHub."
  fi
fi

# Step 5: Alert if pass rate < 80% or routing accuracy < 90%
ALERT_TEXT=""

if [ $EVAL_EXIT -ne 0 ]; then
  echo ""
  echo "WARNING: Pass rate below 80%!"
  SUMMARY=$(cat "$SCRIPT_DIR/output/summary.json" 2>/dev/null | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(f\"Eval pass rate: {d.get('pass_rate', 0)*100:.0f}% ({d.get('passed', 0)}/{d.get('total', 0)})\nAvg latency: {d.get('avg_latency_ms', 0)}ms\")
" 2>/dev/null || echo "Check eval logs")
  ALERT_TEXT="$SUMMARY"
fi

if [ ${ROUTING_EXIT:-0} -ne 0 ]; then
  echo ""
  echo "WARNING: Routing accuracy below 90%!"
  ROUTING_SUMMARY=$(python3 -c "
import sys, json
try:
  from datetime import date
  d = json.load(open('$SCRIPT_DIR/results/$(date +%Y-%m-%d)-routing.json'))
  gt = d.get('ground_truth', {})
  print(f\"Routing accuracy: {gt.get('accuracy', 0)*100:.0f}% ({gt.get('passed', 0)}/{gt.get('total', 0)})\nMisroutes: {gt.get('failed', 0)}\")
except: print('Check routing logs')
" 2>/dev/null || echo "Check routing logs")
  ALERT_TEXT="${ALERT_TEXT}${ALERT_TEXT:+\n}${ROUTING_SUMMARY}"
fi

if [ -n "$ALERT_TEXT" ]; then
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_USER_ID:-}" ]; then
    curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      -d "chat_id=${TELEGRAM_USER_ID}" \
      -d "text=⚠️ Lyra Eval Alert
${ALERT_TEXT}
Run: $(date -u '+%Y-%m-%d %H:%M UTC')" > /dev/null 2>&1
  fi
fi

echo ""
echo "=== Eval suite complete ==="
