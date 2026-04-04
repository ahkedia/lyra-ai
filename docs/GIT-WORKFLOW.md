# Git & deploy workflow (canonical)

**Audience:** Cursor Agent, Claude Code, and any automation touching `lyra-ai`.  
**Rule:** GitHub `main` is the single source of truth. This file is the contract—follow it before commit/push/deploy.

## Before editing code (every session / every handoff)

1. `cd` to the repo: `/Users/akashkedia/AI/lyra-ai` (or the single clone you use).
2. `git fetch origin`
3. `git status`
4. `git pull --ff-only origin main`  
   - If this fails (non–fast-forward): stop and reconcile (merge/rebase) before making new edits.

## After a coherent change

1. `git add` only what belongs to this change.
2. `git commit -m "short imperative description"`
3. `git push origin main`
4. If deploy is needed: `ssh hetzner 'cd /root/lyra-ai && git pull --ff-only origin main'` then restart gateway if required (see `skills/deploy-lyra` / `scripts/deploy-lyra.sh`).

## Hard rules

- **Do not** force-push to `main`.
- **Do not** create unpushed commits only on the VPS—develop and commit from the Mac clone; VPS should `pull --ff-only` from `main`.
- **Do not** let two parallel sessions edit the same files without a fresh pull between them—serialise: pull → edit → commit → push.

## Cursor vs Claude Code

Both tools use the **same repo folder** and the same rules: **`.cursor/rules/lyra-git-workflow.mdc`**, this file, and root **`CLAUDE.md`**. There is no separate “memory” that syncs them—files in the repo do.

## Optional global Git safety

```bash
git config --global pull.ff only
```

Refuses ambiguous pulls so branch divergence is caught early.
