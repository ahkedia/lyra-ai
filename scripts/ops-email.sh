#!/usr/bin/env bash
# Consolidated Lyra ops email. Replaces the per-script Telegram alerts.
#   ops-email.sh daily    -> health summary + last-24h events + daily buffer
#   ops-email.sh weekly   -> weekly health rollup + weekly buffer
# Sends from ahkedia@gmail.com via himalaya (already configured for SMTP), then
# clears the buffer it just sent.
set -uo pipefail

MODE="${1:-daily}"
OPS_DIR="${OPS_DIR:-/var/lib/lyra-ops}"
TO="${OPS_EMAIL_TO:-ahkedia@gmail.com}"
FROM="Lyra Ops <ahkedia@gmail.com>"
mkdir -p "$OPS_DIR" 2>/dev/null || true

now_utc() { date -u '+%Y-%m-%d %H:%M UTC'; }

# ---- fresh health probes (point-in-time, at send) ----
health_block() {
  local gw wa cron_count billing watoken
  curl -sf --max-time 6 http://localhost:18789/health >/dev/null 2>&1 && gw="✅ up" || gw="🔴 DOWN"
  curl -sf --max-time 6 http://127.0.0.1:8091/wa/health >/dev/null 2>&1 && wa="✅ up" || wa="🔴 DOWN"
  cron_count=$(openclaw cron list --json 2>/dev/null | python3 -c 'import sys,json
try: print(len(json.load(sys.stdin).get("jobs",[])))
except Exception: print("?")' 2>/dev/null)
  [ "${cron_count:-0}" = "0" ] && cron_count="0 🔴" || cron_count="${cron_count} ✅"
  # state files maintained by the monitors
  if [ -f /tmp/lyra-anthropic-balance-state ] && [ "$(cat /tmp/lyra-anthropic-balance-state 2>/dev/null)" = "billing" ]; then
    billing="🔴 credit balance exhausted"; else billing="✅ OK"; fi
  [ -f /tmp/lyra-wa-bridge-down ] && wa="🔴 DOWN (flagged)"
  if [ -f /tmp/lyra-wa-token-bad ]; then watoken="🔴 token invalid"; else watoken="✅ valid"; fi
  printf 'SYSTEM HEALTH (as of %s)\n' "$(now_utc)"
  printf '  OpenClaw gateway : %s\n' "$gw"
  printf '  WhatsApp bridge  : %s\n' "$wa"
  printf '  WA Graph token   : %s\n' "$watoken"
  printf '  Cron jobs        : %s scheduled\n' "$cron_count"
  printf '  Anthropic billing: %s\n' "$billing"
}

# ---- exception events over a window (days) ----
events_block() {
  local days="$1" f="$OPS_DIR/events.log"
  [ -s "$f" ] || { echo "  (none)"; return; }
  local cutoff; cutoff=$(date -u -d "-${days} days" '+%Y-%m-%d %H:%M' 2>/dev/null || date -u '+%Y-%m-%d %H:%M')
  awk -v c="$cutoff" -F' \\| ' '$1 >= c' "$f" | sed 's/^/  /' | tail -50 || true
  awk -v c="$cutoff" -F' \\| ' '$1 >= c' "$f" | grep -q . || echo "  (none)"
}

send_email() {
  local subject="$1" body="$2"
  local raw
  raw=$(printf 'From: %s\nTo: %s\nSubject: %s\nContent-Type: text/plain; charset=utf-8\n\n%s\n' \
        "$FROM" "$TO" "$subject" "$body")
  printf '%s' "$raw" | himalaya message send 2>/tmp/ops-email-send.err
}

DATE_H=$(date -u '+%a %d %b %Y')

if [ "$MODE" = "weekly" ]; then
  BUF="$OPS_DIR/weekly.md"
  body="Lyra weekly ops rollup — week ending ${DATE_H}
========================================================

$(health_block)

EXCEPTION EVENTS (last 7 days)
--------------------------------------------------------
$(events_block 7)

DETAIL
--------------------------------------------------------
$( [ -s "$BUF" ] && cat "$BUF" || echo '  (no weekly reports buffered)' )
"
  send_email "Lyra Ops — Weekly ${DATE_H}" "$body" && : > "$BUF"
  echo "$(now_utc) weekly email sent to $TO"
else
  BUF="$OPS_DIR/daily.md"
  body="Lyra daily ops digest — ${DATE_H}
========================================================

$(health_block)

EXCEPTION EVENTS (last 24h)
--------------------------------------------------------
$(events_block 1)

DETAIL
--------------------------------------------------------
$( [ -s "$BUF" ] && cat "$BUF" || echo '  (no reports buffered in last 24h)' )
"
  send_email "Lyra Ops — Daily ${DATE_H}" "$body" && : > "$BUF"
  echo "$(now_utc) daily email sent to $TO"
fi
