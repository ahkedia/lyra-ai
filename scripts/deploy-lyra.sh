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

# Memory files (SOUL.md, MEMORY.md, HEARTBEAT.md) are synced separately
# by the daily memory-backup cron (3 AM) — not every 30 min.
# Changes take effect on next session start; no restart or immediate sync needed.

# Check skills (use checksum comparison to avoid false positives from timestamp drift)
if [ -d "$WORKSPACE/skills" ]; then
    for skill_dir in "$WORKSPACE/skills"/*/; do
        skill_name=$(basename "$skill_dir")
        if [ -d "$REPO_DIR/skills/$skill_name" ]; then
            DIFF=$(rsync -a --checksum --dry-run --itemize-changes "$skill_dir" "$REPO_DIR/skills/$skill_name/" 2>/dev/null | grep -v '^\.' || true)
            if [ -n "$DIFF" ]; then
                rsync -a --checksum "$skill_dir" "$REPO_DIR/skills/$skill_name/"
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

# ──────────────────────────────────────────────
# PHASE 3: Always sync workspace from repo (content-based, not commit-gated)
# This ensures workspace stays in sync even when BEFORE == AFTER
# (e.g. after a rebase that resolved with "already up to date")
# ──────────────────────────────────────────────
SYNCED=false

# Sync config files (SOUL.md, MEMORY.md, HEARTBEAT.md) — content-based
for f in SOUL.md MEMORY.md HEARTBEAT.md; do
    REPO_FILE="$REPO_DIR/config/$f"
    WORKSPACE_FILE="$WORKSPACE/$f"
    if [ -f "$REPO_FILE" ]; then
        if ! diff -q "$REPO_FILE" "$WORKSPACE_FILE" > /dev/null 2>&1; then
            cp "$REPO_FILE" "$WORKSPACE_FILE"
            SYNCED=true
            log "  Synced $f (content drift fixed)"
        fi
    fi
done

# Sync AGENTS.md — content-based
if [ -f "$REPO_DIR/AGENTS.md" ]; then
    if ! diff -q "$REPO_DIR/AGENTS.md" "$WORKSPACE/AGENTS.md" > /dev/null 2>&1; then
        cp "$REPO_DIR/AGENTS.md" "$WORKSPACE/AGENTS.md"
        SYNCED=true
        log "  Synced AGENTS.md (content drift fixed)"
    fi
fi

# Sync skills — content-based
if [ -d "$REPO_DIR/skills" ]; then
    DIFF=$(rsync -a --checksum --dry-run --itemize-changes "$REPO_DIR/skills/" "$WORKSPACE/skills/" 2>/dev/null | grep -v '^\.' || true)
    if [ -n "$DIFF" ]; then
        rsync -a --checksum "$REPO_DIR/skills/" "$WORKSPACE/skills/"
        SYNCED=true
        log "  Synced skills"
    fi
fi

# Sync notion references — content-based
if [ -d "$REPO_DIR/notion" ]; then
    DIFF=$(rsync -a --checksum --dry-run --itemize-changes "$REPO_DIR/notion/" "$WORKSPACE/references/" 2>/dev/null | grep -v '^\.' || true)
    if [ -n "$DIFF" ]; then
        mkdir -p "$WORKSPACE/references"
        rsync -a --checksum "$REPO_DIR/notion/" "$WORKSPACE/references/"
        SYNCED=true
        log "  Synced notion references"
    fi
fi

# Sync workspace extras (TOOLS.md, tasks/current.md — chief-of-staff)
if [ -d "$REPO_DIR/workspace" ]; then
    mkdir -p "$WORKSPACE/tasks"
    if [ -f "$REPO_DIR/workspace/TOOLS.md" ]; then
        if ! diff -q "$REPO_DIR/workspace/TOOLS.md" "$WORKSPACE/TOOLS.md" > /dev/null 2>&1; then
            cp "$REPO_DIR/workspace/TOOLS.md" "$WORKSPACE/TOOLS.md"
            SYNCED=true
            log "  Synced TOOLS.md"
        fi
    fi
    if [ -f "$REPO_DIR/workspace/tasks/current.md" ]; then
        if ! diff -q "$REPO_DIR/workspace/tasks/current.md" "$WORKSPACE/tasks/current.md" > /dev/null 2>&1; then
            cp "$REPO_DIR/workspace/tasks/current.md" "$WORKSPACE/tasks/current.md"
            SYNCED=true
            log "  Synced tasks/current.md"
        fi
    fi
fi

if [ "$BEFORE" = "$AFTER" ] && [ "$PUSHED" = false ] && [ "$SYNCED" = false ]; then
    log "No changes in either direction."
    exit 0
fi

if [ "$BEFORE" != "$AFTER" ]; then
    log "Deploying $BEFORE -> $AFTER"

    # Sync router plugin to live location
    PLUGIN_SRC="$REPO_DIR/plugins/lyra-model-router"
    PLUGIN_DEST="/root/lyra-model-router"
    if [ -d "$PLUGIN_SRC" ]; then
        if ! diff -rq "$PLUGIN_SRC" "$PLUGIN_DEST" > /dev/null 2>&1; then
            rsync -a "$PLUGIN_SRC/" "$PLUGIN_DEST/"
            log "  Router plugin synced"
        fi
    fi

    # Only restart gateway if code/config changed — not for content-only updates
    # (SOUL.md, MEMORY.md, skills, notion refs are hot-loaded; no restart needed)
    RESTART_PATHS="scripts/ plugins/ evals/ config/openclaw.json"
    NEEDS_RESTART=false
    for path in $RESTART_PATHS; do
        if git diff --name-only "$BEFORE" "$AFTER" | grep -q "^$path"; then
            NEEDS_RESTART=true
            log "  Restart trigger: $path changed"
            break
        fi
    done

    if [ "$NEEDS_RESTART" = true ]; then
        systemctl reset-failed openclaw 2>/dev/null || true
        systemctl restart openclaw 2>/dev/null || {
            log "WARNING: systemctl restart failed, trying manual restart"
            pkill -9 -f 'openclaw gateway' 2>/dev/null || true
            sleep 3
            systemctl start openclaw
        }
        MAX_WAIT=120
        WAITED=0
        until curl -sf http://localhost:18789/health 2>/dev/null | grep -q ok; do
            if [ "$WAITED" -ge "$MAX_WAIT" ]; then
                log "WARNING: Gateway not healthy after ${MAX_WAIT}s!"
                break
            fi
            sleep 5
            WAITED=$((WAITED + 5))
        done
        log "Deploy complete. Gateway healthy (${WAITED}s)."
    else
        log "Deploy complete. Content-only changes — gateway restart skipped."
    fi

    # Ensure eval cron is installed (idempotent — only installs if missing)
    if [ -f "$REPO_DIR/scripts/setup-eval-cron.sh" ]; then
        if ! crontab -l 2>/dev/null | grep -q "lyra-eval-4am"; then
            bash "$REPO_DIR/scripts/setup-eval-cron.sh" >> "$LOG" 2>&1
            log "  Installed eval cron (was missing)"
        fi
    fi
fi
