# Memory Architecture — MEMORY.md, SuperMemory, and gbrain

> **History note:** this doc originally described a planned SQLite hybrid memory
> (`lyra_db.py`). That design was never deployed. What actually shipped is the
> layered setup below; the SQLite write-up is preserved in git history.

## The memory problem with OpenClaw

Every OpenClaw agent runs fresh each session. The built-in solutions — `MEMORY.md`, `session-memory` hook, `qmd` — all share the same fundamental flaw: they're **static files loaded wholesale into context**.

This creates two problems:

1. **Token waste** — "Add milk to the shopping list" loads your full professional biography, job hunt tracker, and content strategy. None of it is relevant.

2. **Static decay** — MEMORY.md only updates when you explicitly say "remember this." Everything said in conversation — decisions made, preferences expressed, context given — evaporates at session end.

After building Lyra and using it for real, this became the most painful limitation. Lyra would forget context from sessions two days ago. You'd re-explain the same background repeatedly.

## What was tried

**SuperMemory Pro ($19/month)** solved recall elegantly — semantic embeddings, auto-capture, dynamic recall — but at ~40 interactions/day the subscription plus retrieval token overhead didn't justify itself for a personal agent, and the cloud lock-in (no direct export) added friction. Dropped after a 6-week trial.

**SQLite hybrid** (contacts/schedules/memories tables + CLI) was designed as the replacement but never went to production — Notion already held the structured data, and a second structured store meant two sources of truth.

## What actually runs today

Three layers, each with a different job:

### Layer 1: Notion — structured domain data
Reminders, groceries, meals, health, job pipeline, content drafts, second brain entries.
Queried live per request (much of it via the Tier-0 CRUD bypass in `crud/`, zero LLM tokens).
Notion is the source of truth; nothing structured is duplicated elsewhere.

### Layer 2: gbrain — narrative long-term memory
A separate brain pipeline on the server (`/root/gbrain-brain/`):

- A nightly distillation job (`brain-dream.sh`, system crontab) summarizes the day's
  sessions into durable notes — like a human consolidating the day into long-term memory.
- On a brain-intent message ("ask my brain…", "/brain", "what does my brain know about…"),
  the model-router plugin calls `crud/cli.py brain "<msg>"`, retrieves matching notes at
  zero LLM cost, and injects them into the prompt so whichever tier answers is grounded
  in remembered context (retrieve-then-synthesize, see `plugins/lyra-model-router/index.js`).

### Layer 3: Workspace files — identity and operating rules
`SOUL.md` (personality, access rules) and `MEMORY.md` (curated durable facts) are loaded
every session; both live in the **private** repo and sync to the workspace. Skills load
on demand. `MEMORY.md` stays small and curated — raw history belongs to gbrain, structured
data to Notion.

## What to put where

| Content type | Where it lives | Notes |
|---|---|---|
| Who you are, access rules, tone | `SOUL.md` (private repo) | Loaded every session |
| Durable curated facts and preferences | `MEMORY.md` (private repo) | Loaded every session; keep small |
| Structured domain data (tasks, meals, jobs…) | Notion | Queried live; Tier-0 handles CRUD |
| Conversational history, decisions, context | gbrain | Nightly distillation; retrieved on demand |
| Live database IDs | `lyra-private/notion/notion.md` | Synced to workspace references |
| Tool instructions, API patterns | Skill files (public repo) | Loaded on-demand only |

## Verifying it works

```bash
# Brain retrieval (on the server)
python3 /root/lyra-ai/crud/cli.py brain "what did we decide about the move?"

# Distillation logs
ls /root/gbrain-brain/ && tail -20 /var/log/lyra/brain-dream.log 2>/dev/null

# Router injection path
grep -n "fetchBrainContext" /root/lyra-ai/plugins/lyra-model-router/index.js
```
