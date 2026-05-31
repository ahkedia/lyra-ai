#!/bin/bash
# shadow-scan.sh — Phase 2 shadow data collection.
# Classifies each new commit on the current branch since the last scan and appends the
# eval-coverage gate decision to a persistent JSONL. Runs daily from run-evals.sh.
# Idempotent: a state file tracks the last-scanned SHA.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

STATE="$SCRIPT_DIR/logs/.last-scanned-sha"
LOG="$SCRIPT_DIR/logs/shadow-decisions.jsonl"
mkdir -p "$SCRIPT_DIR/logs"

HEAD_SHA="$(git rev-parse HEAD)"
LAST="$(cat "$STATE" 2>/dev/null || true)"
if [ -z "$LAST" ] || ! git cat-file -e "$LAST" 2>/dev/null; then
  LAST="$(git rev-parse HEAD~1 2>/dev/null || git rev-parse HEAD)"
fi

COUNT=0
for sha in $(git rev-list --reverse "$LAST..$HEAD_SHA" 2>/dev/null); do
  # Skip root commits with no parent (can't diff).
  if git rev-parse --verify --quiet "${sha}^" >/dev/null; then
    node "$SCRIPT_DIR/check-eval-coverage.js" --range "${sha}^...${sha}" --log "$LOG" --quiet || true
    COUNT=$((COUNT + 1))
  fi
done

git rev-parse HEAD > "$STATE"
echo "[shadow-scan] logged $COUNT new commit decision(s) since ${LAST:0:8} → $LOG"
