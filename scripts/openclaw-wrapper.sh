#!/bin/bash
# openclaw-wrapper.sh — Graceful shutdown wrapper for OpenClaw gateway
#
# Replaces raw `openclaw gateway` in systemd to handle SIGTERM/SIGINT properly.
# Prevents stale PID issues and ensures clean port release on restart.
#
# Usage:
#   ExecStart=/root/lyra-ai/scripts/openclaw-wrapper.sh
#   (update openclaw.service to point here instead of /usr/bin/openclaw gateway)
#
# What it does:
#   1. Starts `openclaw gateway` as a child process
#   2. Traps SIGTERM/SIGINT for graceful shutdown
#   3. On signal: sends SIGTERM to gateway, waits 10s, then SIGKILL if needed
#   4. Cleans up port 18789 to prevent bind failures on restart
#   5. Logs all lifecycle events via lyra-logger

set -euo pipefail

GATEWAY_PORT=18789
GATEWAY_PID=""
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHUTDOWN_IN_PROGRESS=false

# Source structured logger
if [ -f "$SCRIPT_DIR/lyra-logger.sh" ]; then
    source "$SCRIPT_DIR/lyra-logger.sh"
else
    # Fallback if logger not available
    log_info()  { echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') INFO/$1: $2"; }
    log_warn()  { echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') WARN/$1: $2"; }
    log_error() { echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') ERROR/$1: $2"; }
fi

# ── Clean up any stale processes on the gateway port ──
cleanup_port() {
    local pids
    pids=$(ss -tlnp "sport = :$GATEWAY_PORT" 2>/dev/null | grep -oP 'pid=\K[0-9]+' || true)
    if [ -n "$pids" ]; then
        log_warn "gateway" "Found stale process(es) on port $GATEWAY_PORT: $pids — killing"
        for pid in $pids; do
            kill -9 "$pid" 2>/dev/null || true
        done
        sleep 1
    fi
}

# ── Graceful shutdown handler ──
shutdown_gateway() {
    if [ "$SHUTDOWN_IN_PROGRESS" = true ]; then
        return
    fi
    SHUTDOWN_IN_PROGRESS=true

    log_info "gateway" "Shutdown signal received. Initiating graceful shutdown..." "{\"pid\":$GATEWAY_PID}"

    if [ -n "$GATEWAY_PID" ] && kill -0 "$GATEWAY_PID" 2>/dev/null; then
        # Step 1: SIGTERM — ask nicely
        log_info "gateway" "Sending SIGTERM to gateway (PID $GATEWAY_PID)"
        kill -TERM "$GATEWAY_PID" 2>/dev/null || true

        # Step 2: Wait up to 10 seconds for clean exit
        local waited=0
        while [ $waited -lt 10 ] && kill -0 "$GATEWAY_PID" 2>/dev/null; do
            sleep 1
            waited=$((waited + 1))
        done

        # Step 3: SIGKILL if still alive
        if kill -0 "$GATEWAY_PID" 2>/dev/null; then
            log_warn "gateway" "Gateway did not exit after 10s. Sending SIGKILL." "{\"pid\":$GATEWAY_PID}"
            kill -9 "$GATEWAY_PID" 2>/dev/null || true
            sleep 1
        else
            log_info "gateway" "Gateway exited cleanly after ${waited}s." "{\"pid\":$GATEWAY_PID}"
        fi
    fi

    # Step 4: Final port cleanup (catch any orphaned children)
    cleanup_port

    log_info "gateway" "Shutdown complete. Port $GATEWAY_PORT released."
    exit 0
}

# ── Main ──
main() {
    log_info "gateway" "OpenClaw wrapper starting..." "{\"port\":$GATEWAY_PORT}"

    # Clean up any stale processes from previous crashes
    cleanup_port

    # Trap shutdown signals
    trap shutdown_gateway SIGTERM SIGINT SIGHUP

    # Source environment
    if [ -f /root/.openclaw/.env ]; then
        set -a
        source /root/.openclaw/.env
        set +a
    fi

    # Explicitly set D-Bus addresses so Node.js can find the system bus.
    # Without this, openclaw's internal service check (systemctl is-enabled)
    # fails with "No medium found" when running inside a systemd service context.
    export DBUS_SYSTEM_BUS_ADDRESS=unix:path=/run/dbus/system_bus_socket
    export DBUS_SESSION_BUS_ADDRESS=disabled:

    # Start the gateway
    log_info "gateway" "Launching openclaw gateway..."
    /usr/bin/openclaw gateway --allow-unconfigured &
    GATEWAY_PID=$!
    log_info "gateway" "Gateway started." "{\"pid\":$GATEWAY_PID,\"port\":$GATEWAY_PORT}"

    # Wait for gateway to be ready (up to 30s)
    local ready_wait=0
    while [ $ready_wait -lt 30 ]; do
        if curl -s -o /dev/null --max-time 2 "http://localhost:$GATEWAY_PORT/health" 2>/dev/null; then
            log_info "gateway" "Gateway is healthy and accepting requests." "{\"startup_time_s\":$ready_wait}"
            break
        fi
        sleep 1
        ready_wait=$((ready_wait + 1))
    done

    if [ $ready_wait -ge 30 ]; then
        log_warn "gateway" "Gateway did not become healthy within 30s. Continuing anyway."
    fi

    # Wait for the gateway process — this keeps the wrapper alive
    # `wait` will return when the child exits or a signal is caught
    wait "$GATEWAY_PID" || true

    # If we get here without shutdown_in_progress, the gateway crashed
    if [ "$SHUTDOWN_IN_PROGRESS" = false ]; then
        local exit_code=$?
        log_error "gateway" "Gateway exited unexpectedly." "{\"pid\":$GATEWAY_PID,\"exit_code\":$exit_code}"
        cleanup_port
        exit "$exit_code"
    fi
}

main "$@"
