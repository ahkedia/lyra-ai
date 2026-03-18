#!/bin/bash
# deploy-lyra.sh — Bidirectional sync: push local edits to GitHub, then pull updates
# Runs every 5 minutes via cron on Hetzner VPS
set -euo pipefail

REPO_DIR="/root/lyra-ai"
WORKSPACE="/root/.openclaw/workspace"
LOG="/tmp/lyra-deploy.log"

log() { echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') $1" >> "$LOG"; }

log "Starting sync..."

cd "$REPO_DIR"

# ──────────────────────────────────────────────
# PHASE 1: Push local self-edits to GitHub first
# ──────────────────────────────────────────────
PUSHED=false

# Check if any workspace files were edited locally (newer than repo copies)
for f in SOUL.md MEMORY.md HEARTBEAT.md; do
    WORKSPACE_FILE="$WORKSPACE/$f"
    REPO_FILE="$REPO_DIR/config/$f"
    if [ -f "$WORKSPACE_FILE" ] && [ -f "$REPO_FILE" ]; then
        if [ "$WORKSPACE_FILE" -nt "$REPO_FILE" ]; then
            cp "$WORKSPACE_FILE" "$REPO_FILE"
            git add "config/$f"
            PUSHED=true
            log "  Local edit detected: $f → pushing to GitHub"
        fi
    fi
done

# Check skills
if [ -d "$WORKSPACE/skills" ]; then
    for skill_dir in "$WORKSPACE/skills"/*/; do
        skill_name=$(basename "$skill_dir")
        if [ -d "$REPO_DIR/skills/$skill_name" ]; then
            if find "$skill_dir" -newer "$REPO_DIR/skills/$skill_name" -name "*.md" | grep -q .; then
                rsync -a "$skill_dir" "$REPO_DIR/skills/$skill_name/"
                git add "skills/$skill_name/"
                PUSHED=true
                log "  Local skill edit: $skill_name → pushing to GitHub"
            fi
        fi
    done
fi

# Check notion references
if [ -f "$WORKSPACE/references/notion.md" ] && [ -f "$REPO_DIR/notion/notion.md" ]; then
    if [ "$WORKSPACE/references/notion.md" -nt "$REPO_DIR/notion/notion.md" ]; then
        cp "$WORKSPACE/references/notion.md" "$REPO_DIR/notion/notion.md"
        git add "notion/notion.md"
        PUSHED=true
        log "  Local edit: notion.md → pushing to GitHub"
    fi
fi

if [ "$PUSHED" = true ]; then
    git commit -m "Auto-sync: Lyra self-edits from Hetzner ($(date -u '+%Y-%m-%d %H:%M'))" || true
    git push origin main || log "  WARNING: git push failed"
    log "  Pushed local edits to GitHub"
fi

# ──────────────────────────────────────────────
# PHASE 2: Pull remote changes from GitHub
# ──────────────────────────────────────────────
git fetch origin
BEFORE=$(git rev-parse HEAD)
git pull origin main --ff-only 2>/dev/null || {
    log "WARNING: pull --ff-only failed (merge conflict?). Skipping deploy."
    exit 0
}
AFTER=$(git rev-parse HEAD)

if [ "$BEFORE" = "$AFTER" ] && [ "$PUSHED" = false ]; then
    log "No changes in either direction."
    exit 0
fi

if [ "$BEFORE" != "$AFTER" ]; then
    log "Deploying $BEFORE -> $AFTER"

    # Sync skills (repo → workspace)
    if [ -d "$REPO_DIR/skills" ]; then
        rsync -a "$REPO_DIR/skills/" "$WORKSPACE/skills/"
        log "  Synced skills"
    fi

    # Sync notion references
    if [ -d "$REPO_DIR/notion" ]; then
        mkdir -p "$WORKSPACE/references"
        rsync -a "$REPO_DIR/notion/" "$WORKSPACE/references/"
        log "  Synced notion references"
    fi

    # Sync workspace markdown files
    for f in SOUL.md MEMORY.md HEARTBEAT.md; do
        if [ -f "$REPO_DIR/config/$f" ]; then
            cp "$REPO_DIR/config/$f" "$WORKSPACE/$f"
            log "  Synced $f"
        fi
    done

    # Restart gateway to pick up changes
    systemctl restart openclaw 2>/dev/null || {
        log "WARNING: systemctl restart failed, trying manual restart"
        pkill -9 -f 'openclaw gateway' 2>/dev/null || true
        sleep 3
        systemctl start openclaw
    }
    sleep 5

    if curl -s http://localhost:18789/health | grep -q '"ok":true'; then
        log "Deploy complete. Gateway healthy."
    else
        log "WARNING: Gateway may not be healthy after deploy!"
    fi

    # Ensure eval cron is installed (idempotent — only installs if missing)
    if [ -f "$REPO_DIR/scripts/setup-eval-cron.sh" ]; then
        if ! crontab -l 2>/dev/null | grep -q "lyra-eval-4am"; then
            bash "$REPO_DIR/scripts/setup-eval-cron.sh" >> "$LOG" 2>&1
            log "  Installed eval cron (was missing)"
        fi
    fi
fi
