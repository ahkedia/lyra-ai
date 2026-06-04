#!/usr/bin/env bash
# Nightly brain sync: pull Notion-mastered DBs → brain repo markdown, then rebuild
# the PGLite DB cleanly (gbrain sync does NOT prune deleted files, so we wipe+resync
# to keep DB == filesystem). Single-writer: stops any gbrain serve first, restarts after.
#
# Invoked via cron-task-runner.sh + run-with-openclaw-env.sh (provides NOTION_API_KEY).
# Off-hours only (PGLite single-writer; must not overlap user queries / Lyra reads).
set -uo pipefail

export PATH="$HOME/.bun/bin:$PATH"
export OLLAMA_HOST="${OLLAMA_HOST:-http://127.0.0.1:11434}"
BRAIN_REPO="${GBRAIN_BRAIN_REPO:-/root/gbrain-brain}"
CRUD="/root/lyra-ai/crud/notion_to_brain.py"
LOCK="/tmp/brain-sync.lock"

# prevent overlapping runs
if [ -e "$LOCK" ] && kill -0 "$(cat "$LOCK" 2>/dev/null)" 2>/dev/null; then
  echo "[$(date -u +%T)] brain-sync already running (pid $(cat "$LOCK")); exit"; exit 0
fi
echo $$ > "$LOCK"
trap 'rm -f "$LOCK"' EXIT

echo "=== brain-sync $(date -u) ==="

# 1) Notion → brain repo markdown (Notion is master). Skips News Inbox + content-topics by design.
for src in personal-wiki twitter content-drafts second-brain; do
  python3 "$CRUD" "$src" 2>&1 | sed "s/^/[notion] /"
done

# 2) commit repo (system of record)
cd "$BRAIN_REPO" || exit 1
if ! git diff --quiet || [ -n "$(git status --porcelain)" ]; then
  git add -A
  git -c user.email=brain@local -c user.name=brain commit -q -m "nightly notion→brain sync $(date -u +%F)" || true
  echo "[git] committed brain repo"
else
  echo "[git] no repo changes"
fi

# 3) clean DB rebuild (wipe avoids stale rows from prior syncs), then embed
pkill -f "gbrain (serve|sync|import|embed)" 2>/dev/null; sleep 2
mkdir -p /root/gbrain-archive/db-rotations
mv /root/.gbrain/brain.pglite "/root/gbrain-archive/db-rotations/brain.pglite.$(date +%Y%m%d-%H%M)" 2>/dev/null || true
# keep only the 3 most recent DB rotations
ls -1dt /root/gbrain-archive/db-rotations/brain.pglite.* 2>/dev/null | tail -n +4 | xargs -r rm -rf
gbrain init --pglite --embedding-model ollama:nomic-embed-text --repo "$BRAIN_REPO" >/dev/null 2>&1
gbrain sync --repo "$BRAIN_REPO" --no-pull --full 2>&1 | tail -3 | sed "s/^/[gbrain] /"

echo "=== brain-sync done $(date -u) ==="
