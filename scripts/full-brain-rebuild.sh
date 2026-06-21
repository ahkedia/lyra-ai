#!/usr/bin/env bash
# Emergency / weekly full brain rebuild: wipe PGLite, full sync, restore OAuth clients.
# Use when incremental sync has drifted and needs a clean slate.
# Normally run weekly (Sunday 02:00 UTC) or manually after a corruption.
#
# Usage: bash /root/lyra-ai/scripts/full-brain-rebuild.sh
set -uo pipefail

export PATH="$HOME/.bun/bin:$PATH"
export OLLAMA_HOST="${OLLAMA_HOST:-http://127.0.0.1:11434}"
BRAIN_REPO="${GBRAIN_BRAIN_REPO:-/root/gbrain-brain}"
LOCK="/tmp/brain-sync.lock"

if [ -e "$LOCK" ] && kill -0 "$(cat "$LOCK" 2>/dev/null)" 2>/dev/null; then
  echo "[$(date -u +%T)] brain-sync already running — cannot do full rebuild; exit"
  exit 1
fi
echo $$ > "$LOCK"
trap 'rm -f "$LOCK"' EXIT

exec 8>/tmp/brain-write.lock
flock -w 600 8 || { echo "[$(date -u +%T)] could not get write lock; abort"; exit 1; }

echo "=== full-brain-rebuild $(date -u) ==="

# 1) Stop everything that touches PGLite
systemctl stop gbrain-http 2>/dev/null || true
pkill -f "gbrain (serve|sync|import|embed)" 2>/dev/null || true
sleep 3

# 2) Archive and wipe PGLite
mkdir -p /root/gbrain-archive/full-rebuilds
mv /root/.gbrain/brain.pglite \
  "/root/gbrain-archive/full-rebuilds/brain.pglite.$(date +%Y%m%d-%H%M)" 2>/dev/null || true
ls -1dt /root/gbrain-archive/full-rebuilds/brain.pglite.* 2>/dev/null | tail -n +4 | xargs -r rm -rf

# 3) Re-init and full sync
~/.bun/bin/gbrain init --pglite \
  --embedding-model ollama:nomic-embed-text \
  --repo "$BRAIN_REPO" >/dev/null 2>&1
echo "PGLite re-initialized"
~/.bun/bin/gbrain sync --repo "$BRAIN_REPO" --no-pull --full 2>&1 | tail -5 | sed "s/^/[gbrain] /"

# 4) Re-register OAuth clients and restart services
bash /root/lyra-ai/scripts/restore-oauth-clients.sh

echo "=== full-brain-rebuild done $(date -u) ==="
