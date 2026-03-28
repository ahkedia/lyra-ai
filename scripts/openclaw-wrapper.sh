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
SHUTDOWN_IN_PROGRESS=false

log() { echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') $1"; }

cleanup_port() {
    fuser -k "$GATEWAY_PORT/tcp" 2>/dev/null || true
    sleep 1
}

shutdown_handler() {
    [ "$SHUTDOWN_IN_PROGRESS" = true ] && return
    SHUTDOWN_IN_PROGRESS=true
    log "INFO/supervisor: Shutdown signal received — stopping gateway (PID ${GATEWAY_PID:-unknown})"
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

# D-Bus addresses required for openclaw's internal systemctl is-enabled check.
# Without these, Node.js D-Bus bindings fail with "No medium found" inside systemd.
export DBUS_SYSTEM_BUS_ADDRESS=unix:path=/run/dbus/system_bus_socket
export DBUS_SESSION_BUS_ADDRESS=disabled:

log "INFO/supervisor: Starting — port=$GATEWAY_PORT"
cleanup_port

while true; do
    /usr/bin/openclaw gateway --allow-unconfigured &
    GATEWAY_PID=$!
    log "INFO/supervisor: Gateway started (PID=$GATEWAY_PID)"

    wait "$GATEWAY_PID" || EXIT_CODE=$?
    EXIT_CODE=${EXIT_CODE:-0}

    [ "$SHUTDOWN_IN_PROGRESS" = true ] && exit 0

    log "ERROR/supervisor: Gateway exited unexpectedly (PID=$GATEWAY_PID exit=$EXIT_CODE) — restarting in 10s"
    cleanup_port
    sleep 10
done
