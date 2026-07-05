#!/bin/bash
# setup-private-split.sh — One-time setup of the PRIVATE companion repo on Hetzner.
#
# Seeds /root/lyra-private with the live personal layer (SOUL, MEMORY, HEARTBEAT,
# cron-jobs.json, notion IDs) and pushes it to a PRIVATE GitHub repo.
# Run this ON HETZNER, ideally BEFORE pulling the public-repo commit that removes
# these files — but it is safe in any order (falls back to workspace copies and
# git history).
#
# Prereq: create the private repo first (empty, no README):
#   gh repo create ahkedia/lyra-private --private        # or via github.com/new
#
# Usage:
#   bash scripts/setup-private-split.sh [git@github.com:ahkedia/lyra-private.git]
set -euo pipefail

PRIVATE_URL="${1:-git@github.com:ahkedia/lyra-private.git}"
PRIVATE_DIR="/root/lyra-private"
REPO_DIR="/root/lyra-ai"
WORKSPACE="/root/.openclaw/workspace"

say() { echo ">>> $1"; }

# ── 1. Clone or init the private repo ──
if [ -d "$PRIVATE_DIR/.git" ]; then
    say "Private repo already exists at $PRIVATE_DIR — reusing."
else
    if git clone "$PRIVATE_URL" "$PRIVATE_DIR" 2>/dev/null; then
        say "Cloned $PRIVATE_URL"
    else
        say "Clone failed — initialising fresh repo (create $PRIVATE_URL on GitHub if you haven't)."
        mkdir -p "$PRIVATE_DIR"
        git -C "$PRIVATE_DIR" init -b main
        git -C "$PRIVATE_DIR" remote add origin "$PRIVATE_URL"
    fi
fi

cd "$PRIVATE_DIR"
mkdir -p config notion archive

# seed <dest> <candidate...>  — copy first existing candidate into dest
seed() {
    local dest="$1"; shift
    for src in "$@"; do
        if [ -n "$src" ] && [ -f "$src" ]; then
            cp "$src" "$dest"
            say "Seeded $dest  ←  $src"
            return 0
        fi
    done
    # Last resort: recover from public git history (file may already be deleted
    # from the worktree if the split commit was pulled first).
    local histpath="${dest#./}"
    if git -C "$REPO_DIR" cat-file -e "HEAD:$histpath" 2>/dev/null; then
        git -C "$REPO_DIR" show "HEAD:$histpath" > "$dest"
        say "Seeded $dest  ←  lyra-ai git HEAD"
        return 0
    fi
    say "SKIP $dest (no source found)"
    return 0
}

# Live workspace copies are the freshest truth; repo copies are the fallback.
seed config/SOUL.md      "$WORKSPACE/SOUL.md"              "$REPO_DIR/config/SOUL.md"
seed config/MEMORY.md    "$WORKSPACE/MEMORY.md"            "$REPO_DIR/config/MEMORY.md"
seed config/HEARTBEAT.md "$WORKSPACE/HEARTBEAT.md"         "$REPO_DIR/config/HEARTBEAT.md"
seed config/cron-jobs.json ""                              "$REPO_DIR/config/cron-jobs.json"
seed notion/notion.md    "$WORKSPACE/references/notion.md" "$REPO_DIR/notion/notion.md"
# Root MEMORY.md (operator facts). If the public repo already pulled the split
# commit, the worktree copy is a pointer stub — recover the real one from history.
if [ -f "$REPO_DIR/MEMORY.md" ] && ! grep -q "moved to the private repo" "$REPO_DIR/MEMORY.md"; then
    cp "$REPO_DIR/MEMORY.md" MEMORY.md
    say "Seeded MEMORY.md  ←  $REPO_DIR/MEMORY.md"
elif [ ! -f MEMORY.md ]; then
    LAST_REAL=$(git -C "$REPO_DIR" log --format=%H -- MEMORY.md | while read -r c; do
        if ! git -C "$REPO_DIR" show "$c:MEMORY.md" 2>/dev/null | grep -q "moved to the private repo"; then echo "$c"; break; fi
    done)
    if [ -n "$LAST_REAL" ]; then
        git -C "$REPO_DIR" show "$LAST_REAL:MEMORY.md" > MEMORY.md
        say "Seeded MEMORY.md  ←  lyra-ai git history ($LAST_REAL)"
    else
        say "SKIP MEMORY.md (no pre-split version found)"
    fi
fi
# Root SOUL.md is a legacy duplicate — archive it (worktree copy, else history)
if [ -f "$REPO_DIR/SOUL.md" ]; then
    cp "$REPO_DIR/SOUL.md" archive/SOUL-root-legacy.md
    say "Seeded archive/SOUL-root-legacy.md  ←  $REPO_DIR/SOUL.md"
elif git -C "$REPO_DIR" cat-file -e "HEAD:SOUL.md" 2>/dev/null; then
    git -C "$REPO_DIR" show "HEAD:SOUL.md" > archive/SOUL-root-legacy.md
    say "Seeded archive/SOUL-root-legacy.md  ←  lyra-ai git HEAD"
fi

# ── 2. README so future-you knows what this is ──
if [ ! -f README.md ]; then
    cat > README.md <<'EOF'
# lyra-private — Lyra's personal layer (PRIVATE)

Live personal config for the public agent at github.com/ahkedia/lyra-ai.
This repo must stay PRIVATE — it contains phone numbers, personal facts,
access-control identities, and live Notion database IDs.

| Path | Purpose |
|------|---------|
| `config/SOUL.md` | Live personality, boundaries, access control |
| `config/MEMORY.md` | Live operational memory (persistent fixes, rules) |
| `config/HEARTBEAT.md` | Live cron context |
| `config/cron-jobs.json` | Cron single source of truth (real recipients) |
| `notion/notion.md` | Live Notion database IDs |
| `MEMORY.md` | Operator facts + Second Brain / Personal Wiki glossary |
| `archive/` | Pre-split legacy files kept for reference |

Synced by `lyra-ai/scripts/deploy-lyra.sh` (every 30 min) and
`lyra-ai/scripts/memory-backup.sh` (daily 3 AM). Sanitized public templates:
`lyra-ai/config/*-template.md`, `lyra-ai/config/cron-jobs.example.json`.
Design doc: `lyra-ai/docs/12-public-private-split.md`.
EOF
    say "Wrote README.md"
fi

# ── 3. Commit + push ──
git add -A
if git diff --cached --quiet; then
    say "Nothing new to commit."
else
    git commit -m "Seed private layer from Hetzner live state ($(date -u +%Y-%m-%d))"
fi
if git push -u origin main; then
    say "Pushed to $PRIVATE_URL"
else
    say "PUSH FAILED — create the private repo on GitHub, then: cd $PRIVATE_DIR && git push -u origin main"
fi

# ── 4. Install the PII pre-push hook on the PUBLIC repo ──
if [ -f "$REPO_DIR/scripts/install-git-hooks.sh" ]; then
    bash "$REPO_DIR/scripts/install-git-hooks.sh"
fi

say "Done. Verify with: bash $REPO_DIR/scripts/deploy-lyra.sh && tail -20 /tmp/lyra-deploy.log"
say "IMPORTANT: confirm the repo is Private on GitHub → Settings, and that"
say "           github.com/ahkedia/lyra-private returns 404 when logged out."
