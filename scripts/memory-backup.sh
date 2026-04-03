#!/bin/bash
# memory-backup.sh — Daily backup of Lyra memory files to GitHub
# Runs at 3 AM CET via cron. Does NOT restart the gateway.
# Memory files take effect on next session start — no restart needed.

WORKSPACE="/root/.openclaw/workspace"
REPO_DIR="/root/lyra-ai"
LOG_FILE="/tmp/lyra-memory-backup.log"

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $1" | tee -a "$LOG_FILE"; }

cd "$REPO_DIR" || exit 1

CHANGED=false
for f in SOUL.md MEMORY.md HEARTBEAT.md; do
    WORKSPACE_FILE="$WORKSPACE/$f"
    REPO_FILE="$REPO_DIR/config/$f"
    if [ -f "$WORKSPACE_FILE" ]; then
        if ! diff -q "$WORKSPACE_FILE" "$REPO_FILE" > /dev/null 2>&1; then
            cp "$WORKSPACE_FILE" "$REPO_FILE"
            git add "config/$f"
            CHANGED=true
            log "  Backed up: $f"
        fi
    fi
done

# Chief-of-staff workspace files (live under lyra-ai/workspace/ in repo)
for rel in TOOLS.md tasks/current.md; do
    WORKSPACE_FILE="$WORKSPACE/$rel"
    REPO_FILE="$REPO_DIR/workspace/$rel"
    if [ -f "$WORKSPACE_FILE" ]; then
        mkdir -p "$(dirname "$REPO_FILE")"
        if [ ! -f "$REPO_FILE" ] || ! diff -q "$WORKSPACE_FILE" "$REPO_FILE" > /dev/null 2>&1; then
            cp "$WORKSPACE_FILE" "$REPO_FILE"
            git add "workspace/$rel"
            CHANGED=true
            log "  Backed up: workspace/$rel"
        fi
    fi
done

if [ "$CHANGED" = true ]; then
    git commit -m "Daily memory backup: $(date -u +%Y-%m-%d)" || true
    git push origin main || log "WARNING: git push failed"
    log "Memory backup complete."
else
    log "Memory backup: no changes."
fi
