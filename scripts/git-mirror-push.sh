#!/bin/bash
# git-mirror-push: keep GitHub mirrored to prod. Prevents the unpushed-commit drift that
# caused the 2026-06 3-way divergence (deploy-lyra.sh only synced skills/notion, not code).
# Pushes when prod is ahead; ALERTS (does not auto-resolve) if histories ever diverge.
set -uo pipefail
source /root/.openclaw/.env 2>/dev/null || true
CHAT="7057922182"
cd /root/lyra-ai || exit 1
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
git fetch origin --quiet 2>/dev/null || { echo "$TS fetch-failed"; exit 0; }
LOCAL=$(git rev-parse @); REMOTE=$(git rev-parse origin/main); BASE=$(git merge-base @ origin/main)

if [ "$LOCAL" = "$REMOTE" ]; then
  echo "$TS in-sync $(git rev-parse --short @)"
elif [ "$REMOTE" = "$BASE" ]; then
  if git push origin main >/dev/null 2>&1; then echo "$TS pushed -> $(git rev-parse --short @)"
  else echo "$TS PUSH-FAILED"; fi
else
  echo "$TS DIVERGED local=$LOCAL remote=$REMOTE base=$BASE"
  [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d chat_id="$CHAT" --data-urlencode "text=⚠️ lyra-ai git DIVERGED — GitHub has commits prod lacks. Auto-push paused; reconcile manually (Hetzner is canonical)." >/dev/null 2>&1 || true
fi
