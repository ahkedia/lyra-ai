#!/bin/bash
# deploy-lyra.sh — Bidirectional sync across the PUBLIC and PRIVATE repos.
# Runs every 30 minutes via cron on Hetzner VPS.
#
# Public repo  (/root/lyra-ai)      : code, skills, docs, templates → github.com/ahkedia/lyra-ai (PUBLIC)
# Private repo (/root/lyra-private) : live SOUL/MEMORY/HEARTBEAT, cron-jobs.json, notion IDs
#                                     → github.com/ahkedia/lyra-private (PRIVATE)
# See docs/12-public-private-split.md. Until the private repo exists (run
# scripts/setup-private-split.sh once), private-layer syncing is skipped and the
# workspace files are simply left alone — nothing breaks.
set -euo pipefail

REPO_DIR="/root/lyra-ai"
PRIVATE_DIR="/root/lyra-private"
WORKSPACE="/root/.openclaw/workspace"
LOG="/tmp/lyra-deploy.log"

log() { echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') $1" >> "$LOG"; }

log "Starting sync..."

HAVE_PRIVATE=false
if [ -d "$PRIVATE_DIR/.git" ]; then
    HAVE_PRIVATE=true
fi

cd "$REPO_DIR"

# ──────────────────────────────────────────────
# PHASE 1: Push local self-edits — public repo
# (skills only; personal-layer files go to the private repo in Phase 1b)
# ──────────────────────────────────────────────
PUSHED=false

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
                log "  Local skill edit: $skill_name → pushing to GitHub (public)"
            fi
        fi
    done
fi

if [ "$PUSHED" = true ]; then
    git commit -m "Auto-sync: Lyra self-edits from Hetzner ($(date -u '+%Y-%m-%d %H:%M'))" || true
    # The pre-push PII scan hook (scripts/pii-scan.sh) guards this push.
    git push origin main || log "  WARNING: public git push failed (PII scan block or network?)"
    log "  Pushed local edits to GitHub (public)"
fi

# ──────────────────────────────────────────────
# PHASE 1b: Push local self-edits — private repo
# (notion references; SOUL/MEMORY/HEARTBEAT are backed up daily by memory-backup.sh)
# ──────────────────────────────────────────────
if [ "$HAVE_PRIVATE" = true ]; then
    cd "$PRIVATE_DIR"
    PRIVATE_PUSHED=false
    if [ -f "$WORKSPACE/references/notion.md" ]; then
        mkdir -p "$PRIVATE_DIR/notion"
        if [ ! -f "$PRIVATE_DIR/notion/notion.md" ] || [ "$WORKSPACE/references/notion.md" -nt "$PRIVATE_DIR/notion/notion.md" ]; then
            if ! diff -q "$WORKSPACE/references/notion.md" "$PRIVATE_DIR/notion/notion.md" > /dev/null 2>&1; then
                cp "$WORKSPACE/references/notion.md" "$PRIVATE_DIR/notion/notion.md"
                git add "notion/notion.md"
                PRIVATE_PUSHED=true
                log "  Local edit: notion.md → pushing to GitHub (private)"
            fi
        fi
    fi
    if [ "$PRIVATE_PUSHED" = true ]; then
        git commit -m "Auto-sync: Lyra self-edits from Hetzner ($(date -u '+%Y-%m-%d %H:%M'))" || true
        git push origin main || log "  WARNING: private git push failed"
    fi
    cd "$REPO_DIR"
else
    log "  Private repo not set up yet — skipping private-layer push (run setup-private-split.sh)"
fi

# ──────────────────────────────────────────────
# PHASE 2: Pull remote changes (public, then private)
# ──────────────────────────────────────────────
git fetch origin
BEFORE=$(git rev-parse HEAD)
git pull origin main --ff-only 2>/dev/null || {
    log "WARNING: public pull --ff-only failed (merge conflict?). Skipping deploy."
    exit 0
}
AFTER=$(git rev-parse HEAD)

if [ "$HAVE_PRIVATE" = true ]; then
    cd "$PRIVATE_DIR"
    git fetch origin 2>/dev/null || log "WARNING: private fetch failed"
    git pull origin main --ff-only 2>/dev/null || log "WARNING: private pull --ff-only failed"
    cd "$REPO_DIR"
fi

# ──────────────────────────────────────────────
# PHASE 3: Always sync workspace from repos (content-based, not commit-gated)
# Personal layer comes from the PRIVATE repo; code/skills from the PUBLIC repo.
# ──────────────────────────────────────────────
SYNCED=false

# Sync config files (SOUL.md, MEMORY.md, HEARTBEAT.md) — from private repo only.
# If the private repo is absent, leave the live workspace files untouched.
if [ "$HAVE_PRIVATE" = true ]; then
    for f in SOUL.md MEMORY.md HEARTBEAT.md; do
        REPO_FILE="$PRIVATE_DIR/config/$f"
        WORKSPACE_FILE="$WORKSPACE/$f"
        if [ -f "$REPO_FILE" ]; then
            if ! diff -q "$REPO_FILE" "$WORKSPACE_FILE" > /dev/null 2>&1; then
                cp "$REPO_FILE" "$WORKSPACE_FILE"
                SYNCED=true
                log "  Synced $f from private repo (content drift fixed)"
            fi
        fi
    done
fi

# Sync AGENTS.md — content-based (public)
if [ -f "$REPO_DIR/AGENTS.md" ]; then
    if ! diff -q "$REPO_DIR/AGENTS.md" "$WORKSPACE/AGENTS.md" > /dev/null 2>&1; then
        cp "$REPO_DIR/AGENTS.md" "$WORKSPACE/AGENTS.md"
        SYNCED=true
        log "  Synced AGENTS.md (content drift fixed)"
    fi
fi

# Sync skills — content-based (public)
if [ -d "$REPO_DIR/skills" ]; then
    DIFF=$(rsync -a --checksum --dry-run --itemize-changes "$REPO_DIR/skills/" "$WORKSPACE/skills/" 2>/dev/null | grep -v '^\.' || true)
    if [ -n "$DIFF" ]; then
        rsync -a --checksum "$REPO_DIR/skills/" "$WORKSPACE/skills/"
        SYNCED=true
        log "  Synced skills"
    fi
fi

# Sync notion references — live IDs from PRIVATE repo, schemas from public
if [ "$HAVE_PRIVATE" = true ] && [ -f "$PRIVATE_DIR/notion/notion.md" ]; then
    mkdir -p "$WORKSPACE/references"
    if ! diff -q "$PRIVATE_DIR/notion/notion.md" "$WORKSPACE/references/notion.md" > /dev/null 2>&1; then
        cp "$PRIVATE_DIR/notion/notion.md" "$WORKSPACE/references/notion.md"
        SYNCED=true
        log "  Synced notion.md from private repo"
    fi
fi
if [ -f "$REPO_DIR/notion/database-schemas.md" ]; then
    mkdir -p "$WORKSPACE/references"
    if ! diff -q "$REPO_DIR/notion/database-schemas.md" "$WORKSPACE/references/database-schemas.md" > /dev/null 2>&1; then
        cp "$REPO_DIR/notion/database-schemas.md" "$WORKSPACE/references/database-schemas.md"
        SYNCED=true
        log "  Synced database-schemas.md"
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

# ──────────────────────────────────────────────
# PHASE 3b: Prune stale files from workspace that were deleted from the repo.
# rsync has no --delete so deletions don't auto-propagate; remove known dead files.
# ──────────────────────────────────────────────
DEAD_SCRIPTS=(
    "$WORKSPACE/scripts/router-hook.js"
    "$WORKSPACE/scripts/updater.py"
    "$WORKSPACE/scripts/aggregate-morning-digest.js"
    "$WORKSPACE/scripts/insight-engine.js"
    "$WORKSPACE/scripts/x-publisher.js"
    "$WORKSPACE/scripts/fetch-twitter-bookmarks.sh"
    "$WORKSPACE/scripts/bookmarks-to-notion.sh"
    "$WORKSPACE/config/routing-rules.yaml"
)
for dead in "${DEAD_SCRIPTS[@]}"; do
    if [ -f "$dead" ]; then
        rm -f "$dead"
        SYNCED=true
        log "  Pruned stale workspace file: $(basename "$dead")"
    fi
done

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
