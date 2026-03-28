#!/bin/bash
# Lyra Eval Runner — Entry point
# Runs eval suite, aggregates results, syncs to Notion, pushes dashboard data
#
# Cost optimization:
#   - Routing eval (Step 0) runs DAILY — it's free (offline, no API calls)
#   - Full Lyra eval (Step 1) runs on ODD days only (1st, 3rd, 5th, etc.)
#   - This cuts eval LLM costs from ~$10.80/month to ~$5.40/month
#   - Override: pass --force to run full evals regardless of day
#
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

export NODE_OPTIONS='--max-old-space-size=384'

# Determine if today is a full eval day (odd days: 1st, 3rd, 5th, ...)
DAY_OF_MONTH=$(date -u +%-d)
FORCE_FULL="${1:-}"
IS_FULL_EVAL_DAY=false

if [ "$FORCE_FULL" = "--force" ]; then
  IS_FULL_EVAL_DAY=true
  echo "Mode: FORCED full eval run"
  shift  # Remove --force from args
elif [ $((DAY_OF_MONTH % 2)) -eq 1 ]; then
  IS_FULL_EVAL_DAY=true
  echo "Mode: Full eval (odd day: $DAY_OF_MONTH)"
else
  echo "Mode: Routing-only (even day: $DAY_OF_MONTH) — full eval skipped to save costs"
  echo "  Tip: Run with --force to override"
fi
echo ""

# Health check: wait for gateway to be healthy
MAX_WAIT=300
WAITED=0
echo "Waiting for gateway to be healthy..."
until curl -sf http://localhost:18789/health | grep -q '"ok":true'; do
  if [ "$WAITED" -ge "$MAX_WAIT" ]; then
    echo "ERROR: Gateway not healthy after ${MAX_WAIT}s -- aborting evals"
    if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_USER_ID:-}" ]; then
      curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
        -d "chat_id=${TELEGRAM_USER_ID}" \
        -d "text=Eval runner failed: gateway not healthy after ${MAX_WAIT}s" > /dev/null 2>&1
    fi
    exit 1
  fi
  sleep 5
  WAITED=$((WAITED + 5))
done
echo "Gateway healthy (waited ${WAITED}s)"

# Step 0: Run routing accuracy eval (ALWAYS — offline, free, no API calls)
echo "Step 0: Running routing accuracy eval..."
node routing-eval.js 2>&1 || ROUTING_EXIT=$?
ROUTING_EXIT=${ROUTING_EXIT:-0}
if [ $ROUTING_EXIT -ne 0 ]; then
  echo "  ⚠️ Routing accuracy below 90% threshold"
fi
echo ""

# Step 1: Run full evals (only on odd days or --force)
EVAL_EXIT=0
if [ "$IS_FULL_EVAL_DAY" = true ]; then
  echo "Step 1: Running full eval tests..."
  EVAL_EXIT=0
  node runner.js "$@" || EVAL_EXIT=$?

  # Step 2: Aggregate results
  echo ""
  echo "Step 2: Aggregating results..."
  OUTPUT_DIR="$SCRIPT_DIR/output" node aggregate.js || echo "[warn] Aggregation failed (non-fatal)"

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
      git commit -m "Update eval dashboard data $(date +%Y-%m-%d)" > /dev/null 2>&1 || true
      git push origin main > /dev/null 2>&1 || echo "[warn] Git push failed (non-fatal)"
      echo "  Dashboard data pushed to GitHub."
    fi
  fi
else
  echo "Step 1: Skipped (even day — routing-only mode)"
  echo "Steps 2-4: Skipped"
fi

# Step 5: Alert if pass rate < 80% or routing accuracy < 90%
ALERT_TEXT=""

if [ "$IS_FULL_EVAL_DAY" = true ] && [ $EVAL_EXIT -ne 0 ]; then
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

# Step 6: Infrastructure checks (always run — free)
echo ""
echo "Step 6: Infrastructure checks..."

# 6a: Run recovery check (diagnose only, no auto-fix during eval)
if [ -x /root/lyra-ai/scripts/lyra-recovery.sh ]; then
  RECOVERY_ISSUES=$({ /root/lyra-ai/scripts/lyra-recovery.sh --check 2>&1 | grep -c "\[ISSUE\]"; } 2>/dev/null || echo "0")
  RECOVERY_ISSUES=$(echo "$RECOVERY_ISSUES" | tail -1)
  if [ "$RECOVERY_ISSUES" -gt 0 ]; then
    echo "  ⚠️ $RECOVERY_ISSUES infrastructure issue(s) detected — running auto-fix"
    /root/lyra-ai/scripts/lyra-recovery.sh --fix 2>&1 | tail -5
  else
    echo "  ✓ All infrastructure healthy"
  fi
fi

# 6b: Refresh status dashboard
if [ -x /root/lyra-ai/scripts/lyra-status.sh ]; then
  /root/lyra-ai/scripts/lyra-status.sh 2>&1 | tail -1
  echo "  ✓ Status dashboard updated"
fi

# Step 7: Cost report (on full eval days)
if [ "$IS_FULL_EVAL_DAY" = true ] && [ -x /root/lyra-ai/scripts/cost-tracker.sh ]; then
  echo ""
  echo "Step 7: Cost report..."
  /root/lyra-ai/scripts/cost-tracker.sh --telegram 2>&1
fi

echo ""
if [ "$IS_FULL_EVAL_DAY" = true ]; then
  echo "=== Eval suite complete (full run) ==="
else
  echo "=== Eval suite complete (routing-only, next full run tomorrow) ==="
fi

# Step 6: Kill any leftover eval agent processes
echo 
echo Step 6: Cleaning up agent processes...
STALE_PIDS=$(pgrep -f 'openclaw-agent' 2>/dev/null | head -20)
if [ -n "$STALE_PIDS" ]; then
  echo "$STALE_PIDS" | xargs kill -9 2>/dev/null
  echo "  Killed $(echo "$STALE_PIDS" | wc -w) stale agent processes"
else
  echo "  No stale agents found"
fi
