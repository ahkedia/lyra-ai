#!/bin/bash
# memory-backup.sh — Daily backup of Lyra memory files to GitHub
# Runs at 3 AM CET via cron. Does NOT restart the gateway.
# Memory files take effect on next session start — no restart needed.
#
# SOUL/MEMORY/HEARTBEAT contain personal data → they back up to the PRIVATE
# repo (/root/lyra-private). Chief-of-staff scratchpads stay in the public repo.
# See docs/12-public-private-split.md.

WORKSPACE="/root/.openclaw/workspace"
REPO_DIR="/root/lyra-ai"
PRIVATE_DIR="/root/lyra-private"
LOG_FILE="/tmp/lyra-memory-backup.log"

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $1" | tee -a "$LOG_FILE"; }

# ── Personal layer → PRIVATE repo ──
if [ -d "$PRIVATE_DIR/.git" ]; then
    cd "$PRIVATE_DIR" || exit 1
    PRIVATE_CHANGED=false
    mkdir -p "$PRIVATE_DIR/config"
    for f in SOUL.md MEMORY.md HEARTBEAT.md; do
        WORKSPACE_FILE="$WORKSPACE/$f"
        REPO_FILE="$PRIVATE_DIR/config/$f"
        if [ -f "$WORKSPACE_FILE" ]; then
            if ! diff -q "$WORKSPACE_FILE" "$REPO_FILE" > /dev/null 2>&1; then
                cp "$WORKSPACE_FILE" "$REPO_FILE"
                git add "config/$f"
                PRIVATE_CHANGED=true
                log "  Backed up (private): $f"
            fi
        fi
    done
    if [ "$PRIVATE_CHANGED" = true ]; then
        git commit -m "Daily memory backup: $(date -u +%Y-%m-%d)" || true
        git push origin main || log "WARNING: private git push failed"
    fi
else
    log "WARNING: private repo missing at $PRIVATE_DIR — memory files NOT backed up."
    log "         Run scripts/setup-private-split.sh once. Refusing to push personal data to the public repo."
fi

# ── Chief-of-staff scratchpads → PUBLIC repo (no personal data) ──
cd "$REPO_DIR" || exit 1
CHANGED=false
for rel in TOOLS.md tasks/current.md; do
    WORKSPACE_FILE="$WORKSPACE/$rel"
    REPO_FILE="$REPO_DIR/workspace/$rel"
    if [ -f "$WORKSPACE_FILE" ]; then
        mkdir -p "$(dirname "$REPO_FILE")"
        if [ ! -f "$REPO_FILE" ] || ! diff -q "$WORKSPACE_FILE" "$REPO_FILE" > /dev/null 2>&1; then
            cp "$WORKSPACE_FILE" "$REPO_FILE"
            git add "workspace/$rel"
            CHANGED=true
            log "  Backed up (public): workspace/$rel"
        fi
    fi
done

if [ "$CHANGED" = true ]; then
    git commit -m "Daily memory backup: $(date -u +%Y-%m-%d)" || true
    git push origin main || log "WARNING: public git push failed"
    log "Memory backup complete."
else
    log "Memory backup: no public changes."
fi
