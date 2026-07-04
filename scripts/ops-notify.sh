#!/usr/bin/env bash
# Shared ops-notification router. Ops scripts used to curl Telegram directly;
# now they buffer their output here for the consolidated daily/weekly email
# (scripts/ops-email.sh). Source this file and call ops_note.
#
#   ops_note daily  "<source>" "<message>"   -> daily email
#   ops_note weekly "<source>" "<message>"   -> weekly email
#   ops_note event  "<source>" "<message>"   -> events log (exception timeline,
#                                               surfaced in the daily email)

OPS_DIR="${OPS_DIR:-/var/lib/lyra-ops}"

ops_note() {
  local bucket="$1" src="$2" msg="$3"
  mkdir -p "$OPS_DIR" 2>/dev/null || true
  local ts; ts="$(date -u '+%Y-%m-%d %H:%M UTC')"
  case "$bucket" in
    daily)  printf '#### %s — %s\n%s\n\n' "$src" "$ts" "$msg" >> "$OPS_DIR/daily.md" ;;
    weekly) printf '#### %s — %s\n%s\n\n' "$src" "$ts" "$msg" >> "$OPS_DIR/weekly.md" ;;
    event)  printf '%s | %s | %s\n' "$ts" "$src" "$msg" >> "$OPS_DIR/events.log" ;;
    *)      printf '%s | %s | %s\n' "$ts" "$src" "$msg" >> "$OPS_DIR/events.log" ;;
  esac
}
