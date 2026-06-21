#!/bin/bash
# git-autopush.sh — keep the GitHub mirror current after every Hetzner commit.
# Invoked DETACHED by .git/hooks/post-commit so it never blocks a commit.
# Fast-forward push only; on rejection/failure it ALERTS and NEVER force-pushes.
set -uo pipefail
source /root/.openclaw/.env 2>/dev/null || true

REPO="/root/lyra-ai"
CHAT_ID="7057922182"
LOG="/tmp/lyra-git-autopush.log"
LOCK="/tmp/lyra-git-autopush.lock"
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

alert() {
  local msg="$1"
  [ -z "${TELEGRAM_BOT_TOKEN:-}" ] && return 0
  curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d chat_id="$CHAT_ID" --data-urlencode "text=$msg" > /dev/null 2>&1 || true
}

cd "$REPO" 2>/dev/null || exit 0

# only ever mirror the canonical branch
[ "$(git rev-parse --abbrev-ref HEAD 2>/dev/null)" = "main" ] || exit 0

# serialize concurrent pushes (two quick commits won't race)
exec 9>"$LOCK"
flock -w 60 9 || exit 0

if out=$(git push origin main 2>&1); then
  echo "$TS auto-push OK -> $(git rev-parse --short HEAD)" >> "$LOG"
else
  echo "$TS auto-push FAIL: $out" >> "$LOG"
  alert "⚠️ Lyra git auto-push FAILED on $(hostname): local main $(git rev-parse --short HEAD) did NOT reach GitHub. Likely GitHub diverged or a network error. Resolve manually — do NOT force-push. ($(echo "$out" | tail -n1))"
fi
