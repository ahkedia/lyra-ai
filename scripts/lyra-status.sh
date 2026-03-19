#!/bin/bash
# Lyra Status API + Dashboard Generator
# Runs every 5 minutes via cron. Generates:
#   - /var/www/lyra-status/status.json  (machine-readable status)
#   - /var/www/lyra-status/index.html   (self-contained dark-theme dashboard)
#
# Usage:
#   bash scripts/lyra-status.sh                          (on the server)
#   crontab: */5 * * * * /root/lyra-ai/scripts/lyra-status.sh
#
# Caddy config: handle_path /status/* { root * /var/www/lyra-status; file_server }

set -euo pipefail

# ── Config ──
OUTPUT_DIR="/var/www/lyra-status"
STATUS_JSON="$OUTPUT_DIR/status.json"
STATUS_HTML="$OUTPUT_DIR/index.html"
ROUTING_LOG="/root/lyra-ai/logs/routing-decisions.jsonl"
EVAL_LOG="/var/log/lyra-evals.log"
BACKUP_DIR="/root/lyra-backups"
HEALTH_URL="http://localhost:18789/health"

mkdir -p "$OUTPUT_DIR"

NOW=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
NOW_EPOCH=$(date +%s)

# ── Helper: safe numeric ──
safe_int() { echo "${1:-0}" | tr -cd '0-9'; }

# ── Check 1: OpenClaw Gateway ──
GW_STATUS="down"
GW_HTTP="000"
GW_HTTP=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$HEALTH_URL" 2>/dev/null || echo "000")
if [ "$GW_HTTP" = "200" ]; then
    GW_STATUS="up"
fi

# ── Check 2: Postgres ──
PG_STATUS="down"
if docker exec lyra-postgres pg_isready -U postgres > /dev/null 2>&1; then
    PG_STATUS="up"
fi

# ── Check 3: Disk usage ──
DISK_PCT=$(df / | tail -1 | awk '{print $5}' | tr -d '%')
DISK_TOTAL=$(df -h / | tail -1 | awk '{print $2}')
DISK_USED=$(df -h / | tail -1 | awk '{print $3}')

# ── Check 4: Memory ──
MEM_TOTAL_MB=$(free -m | awk '/Mem:/{print $2}')
MEM_USED_MB=$(free -m | awk '/Mem:/{print $3}')
MEM_AVAIL_MB=$(free -m | awk '/Mem:/{print $7}')
MEM_PCT=$(( (MEM_USED_MB * 100) / (MEM_TOTAL_MB > 0 ? MEM_TOTAL_MB : 1) ))

# ── Check 5: System uptime ──
UPTIME_SEC=$(awk '{print int($1)}' /proc/uptime)
UPTIME_DAYS=$(( UPTIME_SEC / 86400 ))
UPTIME_HRS=$(( (UPTIME_SEC % 86400) / 3600 ))
UPTIME_STR="${UPTIME_DAYS}d ${UPTIME_HRS}h"

# ── Check 6: Last eval run ──
LAST_EVAL_TIME="unknown"
LAST_EVAL_RESULT="unknown"
if [ -f "$EVAL_LOG" ]; then
    LAST_EVAL_LINE=$(grep -a "Eval suite complete" "$EVAL_LOG" 2>/dev/null | tail -1 || true)
    if [ -n "$LAST_EVAL_LINE" ]; then
        LAST_EVAL_TIME=$(grep -aB5 "Eval suite complete" "$EVAL_LOG" 2>/dev/null | grep -o '[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\} [0-9]\{2\}:[0-9]\{2\}:[0-9]\{2\}' | tail -1 || echo "unknown")
        if echo "$LAST_EVAL_LINE" | grep -q "full run"; then
            LAST_EVAL_RESULT="full-pass"
        else
            LAST_EVAL_RESULT="routing-only"
        fi
    fi
fi

# ── Check 7: Last backup ──
LAST_BACKUP_TIME="unknown"
LAST_BACKUP_AGE_H=999
if [ -d "$BACKUP_DIR" ]; then
    LATEST_BACKUP=$(ls -1dt "$BACKUP_DIR"/backup-* 2>/dev/null | head -1 || true)
    if [ -n "$LATEST_BACKUP" ] && [ -d "$LATEST_BACKUP" ]; then
        BACKUP_EPOCH=$(stat -c %Y "$LATEST_BACKUP" 2>/dev/null || echo "0")
        LAST_BACKUP_AGE_H=$(( (NOW_EPOCH - BACKUP_EPOCH) / 3600 ))
        LAST_BACKUP_TIME=$(date -u -d "@$BACKUP_EPOCH" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || echo "unknown")
    fi
fi

# ── Check 8: Cron health (check last deploy sync) ──
LAST_SYNC_TIME="unknown"
DEPLOY_LOG="/tmp/lyra-deploy.log"
if [ -f "$DEPLOY_LOG" ]; then
    LAST_SYNC_LINE=$(tail -5 "$DEPLOY_LOG" | head -1 || true)
    LAST_SYNC_TIME=$(echo "$LAST_SYNC_LINE" | grep -o '[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}T[0-9]\{2\}:[0-9]\{2\}:[0-9]\{2\}Z' || echo "unknown")
fi

# ── Check 9: Routing decisions (last 24h) ──
MSGS_24H=0
MINIMAX_24H=0
HAIKU_24H=0
SONNET_24H=0
if [ -f "$ROUTING_LOG" ]; then
    YESTERDAY=$(date -u -d "24 hours ago" '+%Y-%m-%dT%H:%M' 2>/dev/null || date -u '+%Y-%m-%dT00:00')
    # Use python for reliable JSON + date parsing
    read -r MSGS_24H MINIMAX_24H HAIKU_24H SONNET_24H <<< $(python3 -c "
import json, sys
from datetime import datetime, timedelta, timezone

cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
total = mm = hk = sn = 0
with open('$ROUTING_LOG') as f:
    for line in f:
        try:
            obj = json.loads(line.strip())
            ts = datetime.fromisoformat(obj['timestamp'].replace('Z','+00:00'))
            if ts < cutoff:
                continue
            # Skip test entries
            if obj.get('sender') == 'test' and obj.get('channel') == 'test':
                continue
            total += 1
            tier = obj.get('tier','')
            if tier == 'minimax': mm += 1
            elif tier == 'haiku': hk += 1
            elif tier == 'sonnet': sn += 1
        except: pass
print(f'{total} {mm} {hk} {sn}')
" 2>/dev/null || echo "0 0 0 0")
fi

# ── Cost estimate (today) ──
COST_MINIMAX=$(python3 -c "print(f'{$MINIMAX_24H * 0.0001:.4f}')" 2>/dev/null || echo "0.0000")
COST_HAIKU=$(python3 -c "print(f'{$HAIKU_24H * 0.001:.4f}')" 2>/dev/null || echo "0.0000")
COST_SONNET=$(python3 -c "print(f'{$SONNET_24H * 0.01:.4f}')" 2>/dev/null || echo "0.0000")
COST_TOTAL=$(python3 -c "print(f'{$MINIMAX_24H * 0.0001 + $HAIKU_24H * 0.001 + $SONNET_24H * 0.01:.4f}')" 2>/dev/null || echo "0.0000")

# ── Overall status ──
OVERALL="green"
if [ "$GW_STATUS" = "down" ] || [ "$PG_STATUS" = "down" ]; then
    OVERALL="red"
elif [ "$DISK_PCT" -gt 85 ] || [ "$MEM_PCT" -gt 90 ]; then
    OVERALL="red"
elif [ "$DISK_PCT" -gt 70 ] || [ "$MEM_PCT" -gt 75 ] || [ "$LAST_BACKUP_AGE_H" -gt 25 ]; then
    OVERALL="yellow"
fi

# ── Generate status.json ──
cat > "$STATUS_JSON" << ENDJSON
{
  "timestamp": "$NOW",
  "overall": "$OVERALL",
  "components": {
    "gateway": { "status": "$GW_STATUS", "http_code": "$GW_HTTP" },
    "postgres": { "status": "$PG_STATUS" },
    "crons": { "last_sync": "$LAST_SYNC_TIME", "last_eval": "$LAST_EVAL_TIME", "eval_result": "$LAST_EVAL_RESULT" }
  },
  "system": {
    "uptime": "$UPTIME_STR",
    "uptime_seconds": $UPTIME_SEC,
    "disk_percent": $DISK_PCT,
    "disk_total": "$DISK_TOTAL",
    "disk_used": "$DISK_USED",
    "memory_total_mb": $MEM_TOTAL_MB,
    "memory_used_mb": $MEM_USED_MB,
    "memory_available_mb": $MEM_AVAIL_MB,
    "memory_percent": $MEM_PCT
  },
  "last_24h": {
    "messages_total": $MSGS_24H,
    "routing": {
      "minimax": $MINIMAX_24H,
      "haiku": $HAIKU_24H,
      "sonnet": $SONNET_24H
    }
  },
  "backup": {
    "last_time": "$LAST_BACKUP_TIME",
    "age_hours": $LAST_BACKUP_AGE_H
  },
  "cost": {
    "today_usd": $COST_TOTAL,
    "breakdown": {
      "minimax": $COST_MINIMAX,
      "haiku": $COST_HAIKU,
      "sonnet": $COST_SONNET
    }
  }
}
ENDJSON

# ── Generate index.html ──
# Map status to colors and icons
STATUS_COLOR="green"
STATUS_ICON="&#10004;"
STATUS_LABEL="All Systems Operational"
if [ "$OVERALL" = "yellow" ]; then
    STATUS_COLOR="#f0ad4e"
    STATUS_ICON="&#9888;"
    STATUS_LABEL="Degraded Performance"
elif [ "$OVERALL" = "red" ]; then
    STATUS_COLOR="#d9534f"
    STATUS_ICON="&#10008;"
    STATUS_LABEL="System Issues Detected"
fi

GW_DOT="&#9679; Up"
GW_DOT_COLOR="#5cb85c"
if [ "$GW_STATUS" = "down" ]; then
    GW_DOT="&#9679; Down"
    GW_DOT_COLOR="#d9534f"
fi

PG_DOT="&#9679; Up"
PG_DOT_COLOR="#5cb85c"
if [ "$PG_STATUS" = "down" ]; then
    PG_DOT="&#9679; Down"
    PG_DOT_COLOR="#d9534f"
fi

BACKUP_DOT="&#9679; OK"
BACKUP_DOT_COLOR="#5cb85c"
if [ "$LAST_BACKUP_AGE_H" -gt 25 ]; then
    BACKUP_DOT="&#9679; Stale (${LAST_BACKUP_AGE_H}h ago)"
    BACKUP_DOT_COLOR="#d9534f"
fi

cat > "$STATUS_HTML" << ENDHTML
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lyra Status</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace; background: #0d1117; color: #c9d1d9; min-height: 100vh; padding: 2rem 1rem; }
  .container { max-width: 720px; margin: 0 auto; }
  h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 0.25rem; color: #e6edf3; }
  .subtitle { color: #8b949e; font-size: 0.85rem; margin-bottom: 2rem; }
  .status-banner { padding: 1rem 1.25rem; border-radius: 8px; margin-bottom: 1.5rem; border-left: 4px solid ${STATUS_COLOR}; background: #161b22; display: flex; align-items: center; gap: 0.75rem; }
  .status-banner .icon { font-size: 1.5rem; color: ${STATUS_COLOR}; }
  .status-banner .label { font-size: 1.1rem; font-weight: 500; color: #e6edf3; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 1.25rem; margin-bottom: 1rem; }
  .card-title { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: #8b949e; margin-bottom: 0.75rem; font-weight: 600; }
  .row { display: flex; justify-content: space-between; padding: 0.4rem 0; border-bottom: 1px solid #21262d; }
  .row:last-child { border-bottom: none; }
  .row .key { color: #8b949e; }
  .row .val { color: #e6edf3; font-weight: 500; font-variant-numeric: tabular-nums; }
  .dot { font-size: 0.9rem; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem; }
  @media (max-width: 500px) { .grid { grid-template-columns: 1fr; } }
  .meter { height: 6px; background: #21262d; border-radius: 3px; margin-top: 0.35rem; overflow: hidden; }
  .meter-fill { height: 100%; border-radius: 3px; }
  .footer { text-align: center; color: #484f58; font-size: 0.75rem; margin-top: 2rem; }
</style>
</head>
<body>
<div class="container">
  <h1>Lyra Status</h1>
  <p class="subtitle">Updated ${NOW}</p>

  <div class="status-banner">
    <span class="icon">${STATUS_ICON}</span>
    <span class="label">${STATUS_LABEL}</span>
  </div>

  <!-- Components -->
  <div class="card">
    <div class="card-title">Components</div>
    <div class="row"><span class="key">Gateway (OpenClaw)</span><span class="val dot" style="color:${GW_DOT_COLOR}">${GW_DOT}</span></div>
    <div class="row"><span class="key">PostgreSQL</span><span class="val dot" style="color:${PG_DOT_COLOR}">${PG_DOT}</span></div>
    <div class="row"><span class="key">Backup</span><span class="val dot" style="color:${BACKUP_DOT_COLOR}">${BACKUP_DOT}</span></div>
    <div class="row"><span class="key">Last Eval</span><span class="val">${LAST_EVAL_TIME} (${LAST_EVAL_RESULT})</span></div>
    <div class="row"><span class="key">Last Deploy Sync</span><span class="val">${LAST_SYNC_TIME}</span></div>
  </div>

  <!-- Last 24h -->
  <div class="card">
    <div class="card-title">Last 24 Hours</div>
    <div class="row"><span class="key">Messages Processed</span><span class="val">${MSGS_24H}</span></div>
    <div class="row"><span class="key">MiniMax M2.5</span><span class="val">${MINIMAX_24H}</span></div>
    <div class="row"><span class="key">Haiku</span><span class="val">${HAIKU_24H}</span></div>
    <div class="row"><span class="key">Sonnet</span><span class="val">${SONNET_24H}</span></div>
  </div>

  <!-- System Resources -->
  <div class="grid">
    <div class="card">
      <div class="card-title">Disk</div>
      <div class="row"><span class="key">Usage</span><span class="val">${DISK_USED} / ${DISK_TOTAL} (${DISK_PCT}%)</span></div>
      <div class="meter"><div class="meter-fill" style="width:${DISK_PCT}%;background:$([ "$DISK_PCT" -gt 85 ] && echo '#d9534f' || ([ "$DISK_PCT" -gt 70 ] && echo '#f0ad4e' || echo '#5cb85c'))"></div></div>
    </div>
    <div class="card">
      <div class="card-title">Memory</div>
      <div class="row"><span class="key">Usage</span><span class="val">${MEM_USED_MB}MB / ${MEM_TOTAL_MB}MB (${MEM_PCT}%)</span></div>
      <div class="meter"><div class="meter-fill" style="width:${MEM_PCT}%;background:$([ "$MEM_PCT" -gt 90 ] && echo '#d9534f' || ([ "$MEM_PCT" -gt 75 ] && echo '#f0ad4e' || echo '#5cb85c'))"></div></div>
    </div>
  </div>

  <!-- Uptime & Cost -->
  <div class="grid">
    <div class="card">
      <div class="card-title">Uptime</div>
      <div class="row"><span class="key">System</span><span class="val">${UPTIME_STR}</span></div>
    </div>
    <div class="card">
      <div class="card-title">Cost (Today Est.)</div>
      <div class="row"><span class="key">Total</span><span class="val">\$${COST_TOTAL}</span></div>
      <div class="row"><span class="key">MiniMax</span><span class="val">\$${COST_MINIMAX}</span></div>
      <div class="row"><span class="key">Haiku</span><span class="val">\$${COST_HAIKU}</span></div>
      <div class="row"><span class="key">Sonnet</span><span class="val">\$${COST_SONNET}</span></div>
    </div>
  </div>

  <div class="footer">Lyra AI &middot; Hetzner VPS &middot; Auto-refreshes every 5 min</div>
</div>
</body>
</html>
ENDHTML

echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') Status page generated → $OUTPUT_DIR"
