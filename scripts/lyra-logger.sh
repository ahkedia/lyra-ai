#!/bin/bash
# lyra-logger.sh — Unified structured logging for all Lyra scripts
#
# Usage:
#   source /root/lyra-ai/scripts/lyra-logger.sh
#   log_info "gateway" "Server started" '{"port":18789}'
#   log_warn "sync" "Pull failed, retrying"
#   log_error "eval" "Eval suite crashed" '{"exit_code":1}'
#
# Log files (all under /var/log/lyra/):
#   gateway.log  — OpenClaw gateway events
#   evals.log    — Daily eval suite runs
#   sync.log     — GitHub ↔ Hetzner sync (deploy-lyra.sh)
#   health.log   — Health check results
#
# Also provides `lyra-logs` command for tailing/searching across all logs.
#
# Setup (run once on server):
#   bash /root/lyra-ai/scripts/lyra-logger.sh --setup

set -euo pipefail

LYRA_LOG_DIR="/var/log/lyra"
LYRA_VALID_COMPONENTS="gateway eval sync health rotate security"

# ── Ensure log directory exists ──
_lyra_ensure_log_dir() {
    if [ ! -d "$LYRA_LOG_DIR" ]; then
        mkdir -p "$LYRA_LOG_DIR"
        chmod 750 "$LYRA_LOG_DIR"
    fi
}

# ── Core JSON log writer ──
# Args: level, component, message, meta (optional JSON object)
_lyra_log() {
    local level="$1"
    local component="$2"
    local msg="$3"
    local meta="${4:-{}}"
    local ts
    ts=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

    _lyra_ensure_log_dir

    # Determine log file from component
    local log_file
    case "$component" in
        gateway)  log_file="$LYRA_LOG_DIR/gateway.log" ;;
        eval)     log_file="$LYRA_LOG_DIR/evals.log" ;;
        sync)     log_file="$LYRA_LOG_DIR/sync.log" ;;
        health)   log_file="$LYRA_LOG_DIR/health.log" ;;
        rotate)   log_file="$LYRA_LOG_DIR/sync.log" ;;
        security) log_file="$LYRA_LOG_DIR/health.log" ;;
        *)        log_file="$LYRA_LOG_DIR/gateway.log" ;;
    esac

    # Escape message for JSON (handle quotes and backslashes)
    local escaped_msg
    escaped_msg=$(printf '%s' "$msg" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/\\t/g')

    # Write JSON line
    local line="{\"ts\":\"${ts}\",\"level\":\"${level}\",\"component\":\"${component}\",\"msg\":\"${escaped_msg}\",\"meta\":${meta}}"
    echo "$line" >> "$log_file"

    # Also echo to stderr for interactive use (only if terminal is attached)
    if [ -t 2 ]; then
        echo "[$ts] $level/$component: $msg" >&2
    fi
}

# ── Public logging functions ──
log_info()  { _lyra_log "info"  "$1" "$2" "${3:-{}}"; }
log_warn()  { _lyra_log "warn"  "$1" "$2" "${3:-{}}"; }
log_error() { _lyra_log "error" "$1" "$2" "${3:-{}}"; }

# ── lyra-logs: tail/search across all Lyra logs ──
# Usage:
#   lyra-logs                         # tail all logs (last 50 lines)
#   lyra-logs -f                      # follow all logs in real-time
#   lyra-logs -c gateway              # filter by component
#   lyra-logs -l error                # filter by level
#   lyra-logs -s "restart"            # search for string
#   lyra-logs -c health -l warn -n 20 # combine filters
lyra-logs() {
    local follow=false
    local component=""
    local level=""
    local search=""
    local num_lines=50

    while [[ $# -gt 0 ]]; do
        case "$1" in
            -f|--follow)    follow=true; shift ;;
            -c|--component) component="$2"; shift 2 ;;
            -l|--level)     level="$2"; shift 2 ;;
            -s|--search)    search="$2"; shift 2 ;;
            -n|--lines)     num_lines="$2"; shift 2 ;;
            -h|--help)
                echo "Usage: lyra-logs [OPTIONS]"
                echo ""
                echo "Options:"
                echo "  -f, --follow         Follow logs in real-time"
                echo "  -c, --component NAME Filter by component (gateway|eval|sync|health)"
                echo "  -l, --level LEVEL    Filter by level (info|warn|error)"
                echo "  -s, --search TEXT    Search for text in messages"
                echo "  -n, --lines NUM      Number of lines to show (default: 50)"
                echo "  -h, --help           Show this help"
                return 0
                ;;
            *) echo "Unknown option: $1"; return 1 ;;
        esac
    done

    # Determine which log files to read
    local log_files=()
    if [ -n "$component" ]; then
        case "$component" in
            gateway)  log_files=("$LYRA_LOG_DIR/gateway.log") ;;
            eval)     log_files=("$LYRA_LOG_DIR/evals.log") ;;
            sync)     log_files=("$LYRA_LOG_DIR/sync.log") ;;
            health)   log_files=("$LYRA_LOG_DIR/health.log") ;;
            *)        echo "Unknown component: $component"; return 1 ;;
        esac
    else
        log_files=("$LYRA_LOG_DIR"/*.log)
    fi

    # Check that at least one log file exists
    local existing_files=()
    for f in "${log_files[@]}"; do
        [ -f "$f" ] && existing_files+=("$f")
    done

    if [ ${#existing_files[@]} -eq 0 ]; then
        echo "No log files found in $LYRA_LOG_DIR"
        return 0
    fi

    if [ "$follow" = true ]; then
        # Real-time follow with optional filtering
        local filter_cmd="cat"
        [ -n "$level" ] && filter_cmd="grep '\"level\":\"$level\"'"
        [ -n "$search" ] && filter_cmd="$filter_cmd | grep '$search'"
        tail -f "${existing_files[@]}" | eval "$filter_cmd"
    else
        # Show last N lines, sorted by timestamp, with filters
        {
            for f in "${existing_files[@]}"; do
                cat "$f"
            done
        } | {
            if [ -n "$level" ]; then
                grep "\"level\":\"$level\""
            else
                cat
            fi
        } | {
            if [ -n "$search" ]; then
                grep "$search"
            else
                cat
            fi
        } | sort -t'"' -k4 | tail -n "$num_lines"
    fi
}

# ── Setup mode: create directories, install logrotate, install lyra-logs command ──
_lyra_logger_setup() {
    echo "=== Lyra Logger Setup ==="
    echo "Time: $(date -u '+%Y-%m-%dT%H:%M:%S UTC')"

    # 1. Create log directory
    mkdir -p "$LYRA_LOG_DIR"
    chmod 750 "$LYRA_LOG_DIR"
    echo "  Log directory: $LYRA_LOG_DIR"

    # 2. Touch all log files
    for f in gateway.log evals.log sync.log health.log; do
        touch "$LYRA_LOG_DIR/$f"
    done
    echo "  Log files created"

    # 3. Install logrotate config
    cat > /etc/logrotate.d/lyra << 'LOGROTATE'
/var/log/lyra/*.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    create 644 root root
    sharedscripts
    postrotate
        # No signal needed — scripts append to files directly
    endscript
}
LOGROTATE
    echo "  Logrotate configured (30 days, compressed)"

    # 4. Install lyra-logs as a system command
    cat > /usr/local/bin/lyra-logs << 'SCRIPT'
#!/bin/bash
# lyra-logs — Tail/search Lyra structured logs
# Wrapper that sources the logger and calls lyra-logs function
source /root/lyra-ai/scripts/lyra-logger.sh
lyra-logs "$@"
SCRIPT
    chmod +x /usr/local/bin/lyra-logs
    echo "  Installed /usr/local/bin/lyra-logs command"

    echo ""
    echo "=== Setup complete ==="
    echo "Usage in scripts:  source /root/lyra-ai/scripts/lyra-logger.sh"
    echo "  log_info \"gateway\" \"Started\" '{\"port\":18789}'"
    echo "  log_warn \"sync\" \"Retry needed\""
    echo "  log_error \"eval\" \"Suite failed\" '{\"exit_code\":1}'"
    echo ""
    echo "View logs:  lyra-logs -f              (follow all)"
    echo "            lyra-logs -c gateway       (filter component)"
    echo "            lyra-logs -l error -n 20   (last 20 errors)"
}

# If called directly with --setup, run setup
if [[ "${1:-}" == "--setup" ]]; then
    _lyra_logger_setup
fi
