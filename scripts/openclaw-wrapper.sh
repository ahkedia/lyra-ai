#!/bin/bash
# openclaw-wrapper.sh — While-loop supervisor for OpenClaw gateway
#
# Architecture: Option A supervisor pattern
#   - Runs openclaw as a tracked child (& + GATEWAY_PID)
#   - On crash: cleans port, waits 10s, restarts automatically
#   - On SIGTERM (systemctl stop): forwards signal to openclaw, waits, cleans port, exits
#   - The supervisor itself never exits on gateway crashes, so systemd's
#     StartLimitBurst is never consumed by openclaw failures
#
# Usage:
#   ExecStart=/root/lyra-ai/scripts/openclaw-wrapper.sh
#
set -euo pipefail

GATEWAY_PORT=18789
GATEWAY_PID=""
ORPHAN_SWEEPER_PID=""
ORPHAN_SWEEP_INTERVAL=30
SHUTDOWN_IN_PROGRESS=false

log() { echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') $1"; }

# Any openclaw-gateway whose parent is PID 1 (init/systemd) is not supervised by this
# wrapper and fights Telegram long-poll + port ownership with the real child.
remove_orphan_openclaw_gateways() {
    local pid ppid
    while read -r pid ppid; do
        [ -z "$pid" ] && continue
        [ "$ppid" = "1" ] || continue
        if [ -n "${GATEWAY_PID:-}" ] && [ "$pid" = "$GATEWAY_PID" ]; then
            kill -0 "$pid" 2>/dev/null && continue
        fi
        log "WARN/supervisor: Terminating orphan openclaw-gateway pid=$pid (PPID=1)"
        kill -TERM "$pid" 2>/dev/null || true
    done < <(ps -eo pid=,ppid=,args= 2>/dev/null | awk '/[o]penclaw-gateway/ {print $1,$2}')
}

cleanup_port() {
    fuser -k "$GATEWAY_PORT/tcp" 2>/dev/null || true
    sleep 1
}

# Background sweeper — catches orphans that openclaw spawns LATE in startup
# (e.g. mDNS/bonjour advertiser, plugin subprocesses that reparent to PID 1).
# The three synchronous cleanup calls (startup, pre-spawn, +2s post-spawn) miss
# orphans that appear ~6s+ after spawn. This sidecar covers the rest of the
# gateway's lifetime.
start_orphan_sweeper() {
    (
        while kill -0 "$GATEWAY_PID" 2>/dev/null; do
            sleep "$ORPHAN_SWEEP_INTERVAL"
            kill -0 "$GATEWAY_PID" 2>/dev/null || exit 0
            remove_orphan_openclaw_gateways
        done
    ) &
    ORPHAN_SWEEPER_PID=$!
}

stop_orphan_sweeper() {
    if [ -n "$ORPHAN_SWEEPER_PID" ] && kill -0 "$ORPHAN_SWEEPER_PID" 2>/dev/null; then
        kill -TERM "$ORPHAN_SWEEPER_PID" 2>/dev/null || true
    fi
    ORPHAN_SWEEPER_PID=""
}

shutdown_handler() {
    [ "$SHUTDOWN_IN_PROGRESS" = true ] && return
    SHUTDOWN_IN_PROGRESS=true
    log "INFO/supervisor: Shutdown signal received — stopping gateway (PID ${GATEWAY_PID:-unknown})"
    stop_orphan_sweeper
    if [ -n "$GATEWAY_PID" ] && kill -0 "$GATEWAY_PID" 2>/dev/null; then
        kill -TERM "$GATEWAY_PID" 2>/dev/null || true
        # Wait up to 10s for clean exit
        local waited=0
        while [ $waited -lt 10 ] && kill -0 "$GATEWAY_PID" 2>/dev/null; do
            sleep 1; waited=$((waited + 1))
        done
        if kill -0 "$GATEWAY_PID" 2>/dev/null; then
            log "WARN/supervisor: Gateway still alive after 10s — SIGKILL"
            kill -9 "$GATEWAY_PID" 2>/dev/null || true
        else
            log "INFO/supervisor: Gateway exited cleanly after ${waited}s"
        fi
    fi
    cleanup_port
    log "INFO/supervisor: Shutdown complete"
    exit 0
}

trap shutdown_handler SIGTERM SIGINT SIGHUP

# Source environment
if [ -f /root/.openclaw/.env ]; then
    set -a; source /root/.openclaw/.env; set +a
fi

# V8 heap limit (JavaScript). Must stay BELOW systemd MemoryMax — Node also uses native RAM
# outside this heap. Previously 512MB caused heap OOM under eval load while cgroup allowed 1.2GB.
# Aligned with scripts/openclaw-memory-limit.conf (MemoryMax=1536M).
export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--max-old-space-size=896"

# D-Bus addresses required for openclaw's internal systemctl is-enabled check.
# Without these, Node.js D-Bus bindings fail with "No medium found" inside systemd.
export DBUS_SYSTEM_BUS_ADDRESS=unix:path=/run/dbus/system_bus_socket
export DBUS_SESSION_BUS_ADDRESS=disabled:

log "INFO/supervisor: Starting — port=$GATEWAY_PORT"
cleanup_port
remove_orphan_openclaw_gateways

while true; do
    remove_orphan_openclaw_gateways
    /usr/bin/openclaw gateway --allow-unconfigured &
    GATEWAY_PID=$!
    log "INFO/supervisor: Gateway started (PID=$GATEWAY_PID)"
    sleep 2
    remove_orphan_openclaw_gateways
    start_orphan_sweeper
    log "INFO/supervisor: Orphan sweeper started (PID=$ORPHAN_SWEEPER_PID, interval=${ORPHAN_SWEEP_INTERVAL}s)"

    wait "$GATEWAY_PID" || EXIT_CODE=$?
    EXIT_CODE=${EXIT_CODE:-0}

    stop_orphan_sweeper
    [ "$SHUTDOWN_IN_PROGRESS" = true ] && exit 0

    log "ERROR/supervisor: Gateway exited unexpectedly (PID=$GATEWAY_PID exit=$EXIT_CODE) — restarting in 10s"
    cleanup_port
    remove_orphan_openclaw_gateways
    sleep 10
done
