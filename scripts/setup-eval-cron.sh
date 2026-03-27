#!/bin/bash
# Setup the 4 AM UTC daily eval cron job on the Hetzner server.
# This script is idempotent — safe to run multiple times.
#
# Usage:
#   bash scripts/setup-eval-cron.sh          (on the server)
#   ssh root@<HETZNER_IP> 'bash /root/lyra-ai/scripts/setup-eval-cron.sh'  (remote)
#
# What it does:
#   1. Adds a system crontab entry for daily 4 AM UTC eval run
#   2. Adds a 3:50 AM UTC pre-check (verify gateway is up, restart if needed)
#   3. Logs output to /var/log/lyra-evals.log with rotation
#   4. Verifies cron is installed and running

set -euo pipefail

EVAL_SCRIPT="/root/lyra-ai/evals/run-evals.sh"
LOG_FILE="/var/log/lyra-evals.log"
CRON_MARKER="# lyra-eval-4am"
PRECHECK_MARKER="# lyra-eval-precheck"

echo "=== Lyra Eval Cron Setup ==="
echo "Time: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"

# 1. Verify eval script exists
if [ ! -f "$EVAL_SCRIPT" ]; then
  echo "ERROR: Eval script not found at $EVAL_SCRIPT"
  echo "Make sure the repo is synced to /root/lyra-ai/"
  exit 1
fi

# 2. Make eval script executable
chmod +x "$EVAL_SCRIPT"
echo "✅ Eval script is executable"

# 3. Setup log rotation
if [ ! -f /etc/logrotate.d/lyra-evals ]; then
  cat > /etc/logrotate.d/lyra-evals << 'LOGROTATE'
/var/log/lyra-evals.log {
    daily
    rotate 14
    compress
    missingok
    notifempty
    create 644 root root
}
LOGROTATE
  echo "✅ Log rotation configured (14 days)"
else
  echo "✅ Log rotation already configured"
fi

# 4. Remove any existing Lyra eval cron entries (idempotent)
CURRENT_CRON=$(crontab -l 2>/dev/null || true)
CLEANED_CRON=$(echo "$CURRENT_CRON" | grep -v "$CRON_MARKER" | grep -v "$PRECHECK_MARKER" || true)

# 5. Add the eval cron jobs
STATUS_MARKER="# lyra-status-5min"
COST_MARKER="# lyra-cost-daily"
CLEANED_CRON=$(echo "$CLEANED_CRON" | grep -v "$STATUS_MARKER" | grep -v "$COST_MARKER" || true)

NEW_CRON="$CLEANED_CRON
# --- Lyra Daily Evals ---
# Pre-check: verify gateway is running 10 min before evals
50 3 * * * /bin/bash -c 'systemctl restart openclaw 2>/dev/null && sleep 20' >> $LOG_FILE 2>&1 $PRECHECK_MARKER
# Main eval run: daily at 4 AM UTC (includes infra checks, recovery, status refresh)
0 4 * * * /bin/bash -c 'echo \"=== Eval Run: \$(date -u) ===\" >> $LOG_FILE && cd /root/lyra-ai/evals && bash run-evals.sh >> $LOG_FILE 2>&1' $CRON_MARKER
# Status dashboard: refresh every 5 minutes
*/5 * * * * /bin/bash /root/lyra-ai/scripts/lyra-status.sh >> /var/log/lyra/health.log 2>&1 $STATUS_MARKER
# Cost report: daily at 11 PM UTC
0 23 * * * /bin/bash /root/lyra-ai/scripts/cost-tracker.sh --telegram >> /var/log/lyra/evals.log 2>&1 $COST_MARKER"

# Remove leading/trailing blank lines
NEW_CRON=$(echo "$NEW_CRON" | sed '/^$/N;/^\n$/d')

echo "$NEW_CRON" | crontab -
echo "✅ Cron jobs installed:"
echo "   - 3:50 AM UTC: Gateway pre-check"
echo "   - 4:00 AM UTC: Full eval suite (run-evals.sh) + infra checks"
echo "   - */5 min:     Status dashboard refresh"
echo "   - 11:00 PM UTC: Daily cost report"

# 6. Verify cron daemon is running
if command -v systemctl &>/dev/null; then
  if systemctl is-active --quiet cron 2>/dev/null || systemctl is-active --quiet crond 2>/dev/null; then
    echo "✅ Cron daemon is running"
  else
    systemctl start cron 2>/dev/null || systemctl start crond 2>/dev/null || true
    echo "⚠️ Started cron daemon"
  fi
else
  echo "⚠️ Cannot verify cron daemon (no systemctl). Check manually: service cron status"
fi

# 7. Verify the cron entry exists
if crontab -l 2>/dev/null | grep -q "$CRON_MARKER"; then
  echo "✅ Cron entry verified in crontab"
else
  echo "❌ ERROR: Cron entry not found after install!"
  exit 1
fi

# 8. Touch the log file
touch "$LOG_FILE"
echo "✅ Log file: $LOG_FILE"

echo ""
echo "=== Setup complete ==="
echo "Next eval run: tomorrow at 4:00 AM UTC"
echo "To verify: crontab -l | grep lyra"
echo "To check logs: tail -50 $LOG_FILE"
echo "To run manually: cd /root/lyra-ai/evals && bash run-evals.sh"
