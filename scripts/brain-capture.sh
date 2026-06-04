#!/usr/bin/env bash
# Serialized gbrain capture — the ONLY write path Lyra uses into the brain.
# PGLite is single-writer: flock guarantees captures never collide with each other,
# the nightly sync, or the dream cycle (they all take /tmp/brain-write.lock).
#
# Usage:
#   brain-capture.sh inline "<text>" [type] [slug-prefix]
#   echo "<text>" | brain-capture.sh stdin [type] [slug-prefix]
# Fire-and-forget friendly: detaches the heavy work, returns fast. Never throws into Lyra.
set -uo pipefail

export PATH="$HOME/.bun/bin:$PATH"
export OLLAMA_HOST="${OLLAMA_HOST:-http://127.0.0.1:11434}"
LOCK="/tmp/brain-write.lock"
LOG="/var/log/lyra/brain-capture.log"
mkdir -p /var/log/lyra 2>/dev/null || true

mode="${1:-}"; shift || true

read_content() {
  case "$mode" in
    inline) printf '%s' "${1:-}";;
    stdin)  cat;;
    *) echo ""; return 1;;
  esac
}

if [ "$mode" = "inline" ]; then
  CONTENT="${1:-}"; TYPE="${2:-note}"; PREFIX="${3:-lyra}"
else
  CONTENT="$(cat)"; TYPE="${1:-note}"; PREFIX="${2:-lyra}"
fi

# guard: skip trivial/empty captures
TRIMMED="$(printf '%s' "$CONTENT" | tr -d '[:space:]')"
if [ "${#TRIMMED}" -lt 20 ]; then
  echo "[$(date -u +%T)] skip: content too short" >> "$LOG"
  exit 0
fi

SLUG="${PREFIX}/$(date -u +%Y-%m-%d)-$(printf '%s' "$CONTENT" | md5sum | cut -c1-8)"

# Serialize on the write lock; wait up to 5 min for any sync/dream/other capture to finish.
(
  flock -w 300 9 || { echo "[$(date -u +%T)] lock timeout, skipped" >> "$LOG"; exit 0; }
  printf '%s' "$CONTENT" | gbrain capture --stdin --type "$TYPE" --slug "$SLUG" >> "$LOG" 2>&1
  echo "[$(date -u +%T)] captured $SLUG (type=$TYPE)" >> "$LOG"
) 9>"$LOCK"
