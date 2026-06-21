#!/bin/bash
# git-divergence-check.sh — backstop alarm for prod<->GitHub drift.
# Run from system crontab every ~15 min. DETECTION ONLY: never merges, pulls,
# or force-pushes. Alerts once (+ a recovery message) if divergence persists past
# a grace window — so a broken auto-push can't silently rot for months like the
# drift discovered 2026-06-20.
set -uo pipefail
source /root/.openclaw/.env 2>/dev/null || true

REPO="/root/lyra-ai"
CHAT_ID="7057922182"
STATE_FILE="/tmp/lyra-git-divergence-state"     # epoch when divergence was first seen
ALERT_FILE="/tmp/lyra-git-divergence-alerted"   # epoch of last alert (throttle)
GRACE_SECONDS=1800                               # 30 min: tolerate in-flight push/pull lag
REALERT_SECONDS=3600                             # while diverged, re-alert at most hourly
LOG="/tmp/lyra-git-divergence.log"
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
NOW=$(date +%s)

alert() {
  local msg="$1"
  [ -z "${TELEGRAM_BOT_TOKEN:-}" ] && return 0
  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d chat_id="$CHAT_ID" --data-urlencode "text=$msg" > /dev/null 2>&1 || true
}

cd "$REPO" 2>/dev/null || exit 0
git fetch origin --quiet 2>/dev/null || { echo "$TS fetch-failed" >> "$LOG"; exit 0; }

AHEAD=$(git rev-list --count origin/main..HEAD 2>/dev/null || echo 0)    # unpushed prod commits
BEHIND=$(git rev-list --count HEAD..origin/main 2>/dev/null || echo 0)   # unpulled GitHub commits

# converged
if [ "$AHEAD" -eq 0 ] && [ "$BEHIND" -eq 0 ]; then
  echo "$TS OK 0/0" >> "$LOG"
  if [ -f "$STATE_FILE" ]; then
    rm -f "$STATE_FILE" "$ALERT_FILE"
    alert "✅ Lyra git re-converged: prod == GitHub ($(git rev-parse --short HEAD))."
  fi
  exit 0
fi

# diverged — start/continue the grace timer
[ -f "$STATE_FILE" ] || echo "$NOW" > "$STATE_FILE"
FIRST=$(cat "$STATE_FILE" 2>/dev/null || echo "$NOW")
ELAPSED=$(( NOW - FIRST ))
echo "$TS DIVERGED ahead=$AHEAD behind=$BEHIND elapsed=${ELAPSED}s" >> "$LOG"

if [ "$ELAPSED" -ge "$GRACE_SECONDS" ]; then
  LAST=$(cat "$ALERT_FILE" 2>/dev/null || echo 0)
  if [ $(( NOW - LAST )) -ge "$REALERT_SECONDS" ]; then
    alert "⚠️ Lyra git DIVERGED >$(( GRACE_SECONDS/60 ))min: prod ahead $AHEAD (unpushed), behind $BEHIND (unpulled). prod $(git rev-parse --short HEAD) vs GitHub $(git rev-parse --short origin/main). Push from Hetzner / pull as needed. Do NOT force-push."
    echo "$NOW" > "$ALERT_FILE"
  fi
fi
