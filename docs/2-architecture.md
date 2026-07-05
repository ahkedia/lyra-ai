# Architecture

How Lyra is designed and why each decision was made. (Updated for the current
Hetzner deployment — the original Mac-hosted, Telegram-only design is in git history.)

---

## Core design decisions

### 1. OpenClaw as the agent runtime

OpenClaw handles the hard parts: session memory, tool routing, multi-channel delivery, cron scheduling, and the skill system. Building all of this from scratch would take months and still be worse. The tradeoff is that you are constrained to what OpenClaw supports — but for a personal agent, it covers everything you actually need.

The key things OpenClaw provides that matter here:
- **Workspace files** (`SOUL.md`, `MEMORY.md`) loaded on every conversation — persistent personality and context
- **Cron scheduler** — no external cron service needed, runs inside the same process
- **Skill system** — drop a folder into `~/.openclaw/workspace/skills/` and Lyra gains a new capability
- **Session memory hook** — automatically compacts and retains context across conversations
- **Plugin hooks** — the model router and Tier-0 CRUD bypass live in `plugins/lyra-model-router/`
- **systemd service** — survives reboots; watchdog + recovery scripts handle crashes

### 2. Hetzner VPS as the host

Lyra runs 24/7 on a small Hetzner cloud VPS (~€4/month) as a systemd service. The original build ran on a Mac (zero hosting cost, Apple Reminders/Calendar access), but a laptop that sleeps is a bad pager. The cloud move traded `osascript` integrations for always-on reliability; reminders and calendar moved to Notion + Google Calendar.

### 3. Telegram + WhatsApp as the interfaces

- **Telegram** is the primary chat interface: free, allowlist-based (numeric user IDs), native voice messages, works everywhere.
- **WhatsApp** is delivery-focused: scheduled digests and the household channel go out via the Meta WhatsApp Cloud API through a small webhook bridge (`whatsapp-webhook/server.cjs`), authenticated with a shared secret.

### 4. Notion as the cockpit

Notion is not just storage. It is the single source of truth for every domain. The design principle: **Lyra is the interface, Notion is the database**. Every action Lyra takes that creates or changes information writes to Notion. This means:
- The data survives if the agent setup changes
- You can view, edit, and share data without going through Lyra
- Other tools can read and write the same data

The Notion API (version `2025-09-03`) introduces a dual-ID system:
- `database_id` — used when creating new pages (`parent: {"database_id": "..."}`)
- `data_source_id` — used when querying or reading (`POST /v1/data_sources/{id}/query`)

Live database IDs are private and live in the `lyra-private` repo (`notion/notion.md`), synced to the workspace at runtime. Public schema documentation: `notion/database-schemas.md`.

### 5. Four-tier model routing (cost control)

Every inbound message passes through `plugins/lyra-model-router/`:

| Tier | What | Cost |
|------|------|------|
| **Tier 0** | Deterministic CRUD (reminders, groceries, meals…) via `crud/cli.py` — no LLM at all | ~0 tokens |
| **MiniMax M2.7** | Simple single-action tasks (~85%+ of LLM traffic) | cheap |
| **Claude Haiku 4.5** | Moderate complexity, partner-ACL traffic | moderate |
| **Claude Sonnet 4.6** | Synthesis, judgment, strategic work, content drafts | premium |

Routing decisions are logged to JSONL and audited by the eval framework in `evals/`. See `docs/11-model-routing.md`.

### 6. Two access tiers, one agent

Rather than running two separate bots, both people in the household message the same bot. OpenClaw's allowlist identifies who is speaking by their numeric user ID. `SOUL.md` (private repo) defines what each person can see and do; the router additionally pins partner traffic to the Haiku tier.

### 7. Public/private repo split

Code, skills, docs, and evals are public (`lyra-ai`). Live personal config — `SOUL.md`, `MEMORY.md`, `HEARTBEAT.md`, `cron-jobs.json`, live Notion IDs — lives in a private companion repo (`lyra-private`). A pre-push PII hook and CI checks guard the boundary. See `docs/12-public-private-split.md`.

---

## Data flow

### Inbound message
```
Telegram message → OpenClaw gateway → model router plugin
→ Tier 0? execute crud/cli.py, reply directly (no LLM)
→ otherwise: SOUL.md + MEMORY.md + notion context loaded, tier selected
→ model processes with full context, tool calls executed (Notion, bash, web)
→ response delivered back via Telegram
```

### Inbound voice message
```
Telegram voice message → OpenClaw receives audio
→ transcribed (OpenAI Whisper API)
→ voice-capture skill pipeline activated
→ classified (Insight/Decision/Idea/Question/Pattern)
→ saved to Second Brain Notion database
→ confirmation sent back to Telegram
```

### Scheduled task (cron fires)
```
OpenClaw cron scheduler (jobs mirrored in lyra-private/config/cron-jobs.json)
→ isolated agent turn, lightweight context
→ task executed (Notion queries, research scripts, health data)
→ digest delivered via WhatsApp (household) or Telegram/email (ops)
```

---

## Workspace file roles

| File | Loaded when | Purpose | Repo |
|------|------------|---------|------|
| `SOUL.md` | Every conversation | Personality, rules, access levels | private |
| `MEMORY.md` | Every conversation | Permanent facts and preferences | private |
| `references/notion.md` | Every conversation | All database IDs and property names | private |
| `HEARTBEAT.md` | Cron runs only | Lightweight context for scheduled tasks | private |
| `skills/*/SKILL.md` | On demand | Modular capability definitions | public |

---

## Long-term memory (gbrain)

Alongside Notion, a separate brain pipeline (`/root/gbrain-brain/` on the server) keeps
distilled long-term memory: a nightly job (`brain-dream.sh`) summarizes the day's
sessions into durable notes the router can inject as context. Notion holds structured
domain data; gbrain holds narrative memory. See `docs/9-supermemory.md`.

---

## Security boundaries

```
┌─────────────────────────────────┐
│  Channel allowlists             │
│  Telegram numeric IDs;          │
│  WhatsApp webhook shared secret │
└────────────┬────────────────────┘
             │
┌────────────▼────────────────────┐
│  SOUL.md access control         │
│  Person A → all databases       │
│  Person B → shared databases    │
│  (+ router pins partner tier)   │
└────────────┬────────────────────┘
             │
┌────────────▼────────────────────┐
│  Gateway constraints            │
│  denyCommands, token auth,      │
│  localhost-bound services       │
└─────────────────────────────────┘
```

See [`docs/7-security.md`](7-security.md) for the full security model.

---

## Skills architecture

Skills are markdown files that tell the agent how to use a tool. They live in `~/.openclaw/workspace/skills/{skill-name}/SKILL.md`. When a relevant request comes in, the skill is loaded into context and the agent follows its instructions.

The key insight: **skills are documentation, not code**. The agent reads the skill, understands what commands to run, and executes them via the bash tool. This means:
- Skills are easy to write and read
- They can include examples, decision logic, and edge cases
- You can update a skill by editing a markdown file

The live skill set is in `skills/` (one folder per skill). Heavier logic that shouldn't burn tokens — CRUD, content generation, research — lives in versioned scripts (`crud/`, `content-engine/`, `scripts/`) that skills and crons invoke.
