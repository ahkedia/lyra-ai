# Claude Code — Lyra (`lyra-ai`)

## Mandatory: git before/after work

This project uses a **single Mac clone** and **GitHub `main`** as source of truth. Cursor Agent and Claude Code do **not** share chat memory—only these files do.

**Before** editing files in this repo:

```bash
git fetch origin && git pull --ff-only origin main
```

**After** a logical change set:

```bash
git add -A   # or specific paths
git commit -m "describe change"
git push origin main
```

Full rules, VPS deploy, and safety constraints: **`docs/GIT-WORKFLOW.md`**.

If `git pull --ff-only` fails, reconcile with the user before proceeding.

## Project context

- Agent instructions for the OpenClaw workspace also live in **`AGENTS.md`** (session/memory patterns for Lyra runtime).
- Product rules: **`config/SOUL.md`**, **`MEMORY.md`** (when applicable).
