# Claude Code — Lyra (`lyra-ai`)

## Mandatory: git before/after work

**Source of truth is Hetzner production (`/root/lyra-ai`), NOT GitHub.** Lyra self-edits
on the server, so the server line is always furthest ahead. GitHub `origin/main` is a
**push-mirror** of Hetzner; the Mac clone is a downstream copy that pulls from GitHub.

> History: the old "GitHub `main` is source of truth" workflow (previously documented here)
> caused a 3-way divergence — 260+ commits on prod never pushed, plus a stale GitHub fork.
> Reconciled 2026-06-20: GitHub was force-mirrored to the prod line. Don't reintroduce the
> "GitHub is canonical" assumption.

**On Hetzner** (the canonical writer) — after a logical change set:

```bash
cd /root/lyra-ai
git add -A   # or specific paths
git commit -m "describe change"
git push origin main          # keep the GitHub mirror current
```

**On the Mac clone** (downstream, read-mostly):

```bash
git fetch origin && git pull --ff-only origin main
```

If you must edit on the Mac, commit + push there, then `git pull` on Hetzner to
re-integrate. Avoid two writers diverging — Hetzner is the default writer.

Full rules, VPS deploy, and safety constraints: **`docs/GIT-WORKFLOW.md`**.

If `git pull --ff-only` fails, reconcile with the user before proceeding (do not force-push
except a deliberate Hetzner→GitHub mirror).

## Project context

- Agent instructions for the OpenClaw workspace also live in **`AGENTS.md`** (session/memory patterns for Lyra runtime).
- Product rules: **`config/SOUL.md`**, **`MEMORY.md`** (when applicable).
