# Lyra Memory — moved to the private repo

This repo is public. Lyra's live memory (operator facts, personal context, the
operational log) now lives in the **private** companion repo:

- `lyra-private/MEMORY.md` — operator facts + glossary (Second Brain vs Personal Wiki)
- `lyra-private/config/MEMORY.md` — operational log: cold start, cron notes, persistent fixes
- `lyra-private/config/SOUL.md` — live personality, boundaries, access control

On Hetzner the private repo is cloned at `/root/lyra-private` and synced into the
OpenClaw workspace by `scripts/deploy-lyra.sh`. At runtime nothing changes: the
workspace copies (`~/.openclaw/workspace/SOUL.md`, `MEMORY.md`, …) are still loaded
on every session.

Public templates for forkers: [`config/SOUL-template.md`](config/SOUL-template.md),
[`config/MEMORY-template.md`](config/MEMORY-template.md),
[`config/cron-jobs.example.json`](config/cron-jobs.example.json).

Full design and runbook: [`docs/12-public-private-split.md`](docs/12-public-private-split.md).
