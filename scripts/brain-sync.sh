#!/usr/bin/env bash
# Nightly brain sync: pull Notion-mastered DBs → brain repo markdown, then do an
# incremental PGLite sync (no wipe). Deletions from Notion are handled by explicit
# gbrain delete calls so OAuth clients stored in PGLite survive across nightly runs.
# Single-writer: stops gbrain serve first, restarts after.
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

# Take the shared brain WRITE lock (same one brain-capture.sh uses) so a sync never
# collides with a Lyra capture on the PGLite single-writer DB. Wait up to 10 min.
exec 8>/tmp/brain-write.lock
flock -w 600 8 || { echo "[$(date -u +%T)] could not get write lock; abort sync"; exit 0; }

echo "=== brain-sync $(date -u) ==="

# 1) Notion → brain repo markdown (Notion is master). Skips News Inbox + content-topics by design.
# notion_to_brain.py emits PRUNED:<slug> lines for each Notion-authored file it removes from disk.
# Hand-authored files (no notion_page_id frontmatter) are skipped by the prune logic — preserved.
PRUNED_SLUGS=()
for src in personal-wiki twitter content-drafts second-brain; do
  while IFS= read -r line; do
    if [[ "$line" == PRUNED:* ]]; then
      PRUNED_SLUGS+=("${line#PRUNED:}")
    else
      echo "[notion] $line"
    fi
  done < <(python3 "$CRUD" "$src" 2>&1)
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

# 3) Incremental PGLite sync — no wipe, so OAuth clients stored in PGLite survive.
# Notion-pruned pages are explicitly deleted from PGLite before the incremental sync
# so the DB stays consistent with the filesystem without requiring a full rebuild.
systemctl stop gbrain-http 2>/dev/null || true
pkill -f "gbrain (serve|sync|import|embed)" 2>/dev/null || true
sleep 2

if [ ${#PRUNED_SLUGS[@]} -gt 0 ]; then
  echo "[gbrain] deleting ${#PRUNED_SLUGS[@]} pruned page(s) from PGLite..."
  for slug in "${PRUNED_SLUGS[@]}"; do
    ~/.bun/bin/gbrain delete "$slug" 2>/dev/null \
      && echo "[gbrain] deleted: $slug" \
      || echo "[gbrain] skip (not in DB): $slug"
  done
fi

~/.bun/bin/gbrain sync --repo "$BRAIN_REPO" --no-pull 2>&1 | tail -5 | sed "s/^/[gbrain] /"

systemctl start gbrain-http 2>/dev/null || true
echo "=== brain-sync done $(date -u) ==="
