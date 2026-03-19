#!/bin/bash
# lyra-recovery.sh — Automated recovery for common failure modes
#
# Usage:
#   ./lyra-recovery.sh --check   # Diagnose only (no changes)
#   ./lyra-recovery.sh --fix     # Auto-recover + alert
#
# Recovery playbook:
#   1. Gateway crash → kill stale PID, restart systemd, verify health
#   2. Postgres crash → restart container, verify pg_isready
#   3. Disk > 85% → clean old logs, docker prune, alert
#   4. Memory > 90% → restart gateway (memory leak), alert
#   5. Network unreachable → wait, retry, fallback alert

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE="${1:---check}"
ISSUES=()
FIXES=()

# Source logger
if [ -f "$SCRIPT_DIR/lyra-logger.sh" ]; then
    source "$SCRIPT_DIR/lyra-logger.sh"
else
    log_info()  { echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') INFO/$1: $2"; }
    log_warn()  { echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') WARN/$1: $2"; }
    log_error() { echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') ERROR/$1: $2"; }
fi

# Source env for Telegram
source /root/.openclaw/.env 2>/dev/null || true

send_alert() {
    local msg="$1"
    if [ -n "${TELEGRAM_BOT_TOKEN:-}" ]; then
        curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
            -d chat_id="7057922182" \
            -d text="$msg" > /dev/null 2>&1
    fi
}

report() {
    local level="$1" msg="$2"
    echo "  [$level] $msg"
    if [ "$level" = "ISSUE" ]; then
        ISSUES+=("$msg")
    elif [ "$level" = "FIXED" ]; then
        FIXES+=("$msg")
    fi
}

echo "=== Lyra Recovery $([ "$MODE" = "--fix" ] && echo "(AUTO-FIX)" || echo "(CHECK ONLY)") ==="
echo "Time: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo ""

# ── 1. Gateway Health ──
echo "Checking gateway..."
GW_HTTP=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "http://localhost:18789/health" 2>/dev/null || echo "000")

if [ "$GW_HTTP" = "200" ]; then
    echo "  [OK] Gateway healthy (HTTP 200)"
else
    report "ISSUE" "Gateway unreachable (HTTP $GW_HTTP)"
    if [ "$MODE" = "--fix" ]; then
        # Kill any stale processes on the port
        STALE_PIDS=$(ss -tlnp "sport = :18789" 2>/dev/null | grep -oP 'pid=\K[0-9]+' || true)
        if [ -n "$STALE_PIDS" ]; then
            for pid in $STALE_PIDS; do
                kill -9 "$pid" 2>/dev/null || true
                report "FIXED" "Killed stale PID $pid on port 18789"
            done
            sleep 2
        fi

        # Restart via systemd
        systemctl restart openclaw 2>/dev/null || true
        sleep 10

        # Verify
        GW_RETRY=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "http://localhost:18789/health" 2>/dev/null || echo "000")
        if [ "$GW_RETRY" = "200" ]; then
            report "FIXED" "Gateway restarted and healthy"
            log_info "health" "Recovery: gateway restarted successfully"
        else
            report "ISSUE" "Gateway still down after restart (HTTP $GW_RETRY)"
            log_error "health" "Recovery: gateway restart failed"
        fi
    fi
fi

# ── 2. PostgreSQL ──
echo "Checking PostgreSQL..."
if docker exec lyra-postgres pg_isready -U postgres > /dev/null 2>&1; then
    echo "  [OK] PostgreSQL accepting connections"
elif docker ps --format '{{.Names}}' | grep -q lyra-postgres; then
    report "ISSUE" "PostgreSQL container running but not accepting connections"
    if [ "$MODE" = "--fix" ]; then
        docker restart lyra-postgres 2>/dev/null || true
        sleep 5
        if docker exec lyra-postgres pg_isready -U postgres > /dev/null 2>&1; then
            report "FIXED" "PostgreSQL restarted and healthy"
            log_info "health" "Recovery: postgres restarted"
        else
            report "ISSUE" "PostgreSQL still unhealthy after restart"
        fi
    fi
else
    report "ISSUE" "PostgreSQL container not running"
    if [ "$MODE" = "--fix" ]; then
        docker start lyra-postgres 2>/dev/null || docker compose -f /root/lyra-ai/docker-compose.yml up -d postgres 2>/dev/null || true
        sleep 5
        if docker exec lyra-postgres pg_isready -U postgres > /dev/null 2>&1; then
            report "FIXED" "PostgreSQL container started"
            log_info "health" "Recovery: postgres container started"
        else
            report "ISSUE" "Could not start PostgreSQL"
        fi
    fi
fi

# ── 3. Disk Space ──
echo "Checking disk..."
DISK_PCT=$(df / | tail -1 | awk '{print $5}' | tr -d '%')

if [ "$DISK_PCT" -lt 70 ]; then
    echo "  [OK] Disk at ${DISK_PCT}%"
elif [ "$DISK_PCT" -lt 85 ]; then
    report "ISSUE" "Disk at ${DISK_PCT}% (warning)"
else
    report "ISSUE" "Disk at ${DISK_PCT}% (critical)"
    if [ "$MODE" = "--fix" ]; then
        # Clean old logs (>14 days)
        CLEANED_LOGS=$(find /var/log/lyra/ -name "*.log.*" -mtime +14 -delete -print 2>/dev/null | wc -l)
        CLEANED_EVAL=$(find /var/log/ -name "lyra-evals.log.*" -mtime +14 -delete -print 2>/dev/null | wc -l)

        # Docker cleanup
        DOCKER_FREED=$(docker system prune -f 2>/dev/null | grep "Total reclaimed" || echo "0B")

        report "FIXED" "Cleaned ${CLEANED_LOGS} old logs, ${CLEANED_EVAL} eval logs, Docker: ${DOCKER_FREED}"
        log_info "health" "Recovery: disk cleanup performed" "{\"cleaned_logs\":$CLEANED_LOGS,\"disk_before\":$DISK_PCT}"

        # Re-check
        DISK_AFTER=$(df / | tail -1 | awk '{print $5}' | tr -d '%')
        echo "  Disk after cleanup: ${DISK_AFTER}%"
    fi
fi

# ── 4. Memory ──
echo "Checking memory..."
MEM_TOTAL=$(free -m | awk '/Mem:/{print $2}')
MEM_AVAIL=$(free -m | awk '/Mem:/{print $7}')
MEM_PCT=$(( ((MEM_TOTAL - MEM_AVAIL) * 100) / (MEM_TOTAL > 0 ? MEM_TOTAL : 1) ))

if [ "$MEM_PCT" -lt 75 ]; then
    echo "  [OK] Memory at ${MEM_PCT}% (${MEM_AVAIL}MB available)"
elif [ "$MEM_PCT" -lt 90 ]; then
    report "ISSUE" "Memory at ${MEM_PCT}% (${MEM_AVAIL}MB available)"
else
    report "ISSUE" "Memory critical at ${MEM_PCT}% (${MEM_AVAIL}MB available)"
    if [ "$MODE" = "--fix" ]; then
        # Gateway restart (handles memory leak)
        systemctl restart openclaw 2>/dev/null || true
        sleep 10
        MEM_AFTER=$(free -m | awk '/Mem:/{print $7}')
        report "FIXED" "Gateway restarted to free memory. Available: ${MEM_AVAIL}MB → ${MEM_AFTER}MB"
        log_info "health" "Recovery: gateway restarted for memory (${MEM_AVAIL}MB → ${MEM_AFTER}MB)"
    fi
fi

# ── 5. Network Connectivity ──
echo "Checking network..."
NET_OK=false
for target in "api.telegram.org" "api.notion.com" "1.1.1.1"; do
    if curl -s -o /dev/null --max-time 5 "https://$target" 2>/dev/null || ping -c 1 -W 3 "$target" > /dev/null 2>&1; then
        NET_OK=true
        break
    fi
done

if [ "$NET_OK" = true ]; then
    echo "  [OK] Network connectivity"
else
    report "ISSUE" "Network unreachable (all targets failed)"
    if [ "$MODE" = "--fix" ]; then
        echo "  Waiting 60s for network recovery..."
        sleep 60
        if curl -s -o /dev/null --max-time 10 "https://api.telegram.org" 2>/dev/null; then
            report "FIXED" "Network recovered after 60s wait"
        else
            report "ISSUE" "Network still unreachable after 60s"
            log_error "health" "Recovery: network unreachable for >60s"
        fi
    fi
fi

# ── Summary ──
echo ""
echo "=== Summary ==="
if [ ${#ISSUES[@]} -eq 0 ]; then
    echo "  All systems healthy. No issues found."
else
    echo "  Issues found: ${#ISSUES[@]}"
    for issue in "${ISSUES[@]}"; do
        echo "    - $issue"
    done
fi

if [ ${#FIXES[@]} -gt 0 ]; then
    echo ""
    echo "  Auto-fixes applied: ${#FIXES[@]}"
    for fix in "${FIXES[@]}"; do
        echo "    + $fix"
    done

    # Alert on fixes
    ALERT_MSG="🔧 Lyra Recovery (auto-fix):
$(printf '%s\n' "${FIXES[@]}" | sed 's/^/• /')"

    if [ ${#ISSUES[@]} -gt ${#FIXES[@]} ]; then
        REMAINING=$((${#ISSUES[@]} - ${#FIXES[@]}))
        ALERT_MSG="$ALERT_MSG

⚠️ ${REMAINING} issue(s) still need attention"
    fi

    send_alert "$ALERT_MSG"
fi
