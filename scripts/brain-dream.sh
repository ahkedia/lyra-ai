#!/usr/bin/env bash
# Nightly dream cycle — gbrain's overnight maintenance: lint, backlinks, synthesize,
# extract facts, patterns, emotional-weight recompute, consolidate, propose takes,
# find contradictions. This is the "grows wiser overnight" daemon.
#
# Runs AFTER the nightly sync, on the same shared write lock (PGLite single-writer),
# so it never overlaps a sync or a Lyra capture. Invoked via cron-task-runner +
# run-with-openclaw-env.sh (provides ANTHROPIC_API_KEY for synthesis).
set -uo pipefail

export PATH="$HOME/.bun/bin:$PATH"
export OLLAMA_HOST="${OLLAMA_HOST:-http://127.0.0.1:11434}"
export GBRAIN_LLM_MAX_TOKENS="${GBRAIN_LLM_MAX_TOKENS:-16000}"
BRAIN_REPO="${GBRAIN_BRAIN_REPO:-/root/gbrain-brain}"

echo "=== brain-dream $(date -u) ==="

# stop the MCP serve so it doesn't hold the lock during the heavy cycle
systemctl stop gbrain-http 2>/dev/null || true
pkill -f "gbrain serve" 2>/dev/null || true
sleep 2

# Take the shared write lock; wait up to 15 min for sync/captures to clear.
exec 8>/tmp/brain-write.lock
flock -w 900 8 || { echo "[$(date -u +%T)] could not get write lock; abort dream"; exit 0; }

# Run the dream cycle (single process, single writer). --json keeps logs parseable.
gbrain dream --repo "$BRAIN_REPO" 2>&1 | tail -40

systemctl start gbrain-http 2>/dev/null || true
echo "=== brain-dream done $(date -u) ==="
