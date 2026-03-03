# Architecture

How Lyra is designed and why each decision was made.

---

## Core design decisions

### 1. OpenClaw as the agent runtime

OpenClaw handles the hard parts: session memory, tool routing, multi-channel delivery, cron scheduling, and the skill system. Building all of this from scratch would take months and still be worse. The tradeoff is that you are constrained to what OpenClaw supports — but for a personal agent, it covers everything you actually need.

The key things OpenClaw provides that matter here:
- **Workspace files** (`SOUL.md`, `MEMORY.md`) loaded on every conversation — persistent personality and context
- **Cron scheduler** — no external cron service needed, runs inside the same process
- **Skill system** — drop a folder into `~/.openclaw/workspace/skills/` and Lyra gains a new capability
- **Session memory hook** — automatically compacts and retains context across conversations
- **LaunchAgent daemon** — one command to make it survive reboots

### 2. Telegram as the only interface

Telegram was chosen over iMessage, WhatsApp, or a web UI because:
- No monthly cost (WhatsApp Business API costs money at scale)
- Works on iOS, Android, Mac, and web — same interface everywhere
- Supports voice messages natively (critical for the voice capture pipeline)
- Allowlist-based access means only specific numeric user IDs can message Lyra
- Streaming can be turned off for cleaner message delivery

### 3. Notion as the cockpit

Notion is not just storage. It is the single source of truth for every domain. The design principle: **Lyra is the interface, Notion is the database**. Every action Lyra takes that creates or changes information writes to Notion. This means:
- The data survives if the agent setup changes
- You can view, edit, and share data without going through Lyra
- Other tools can read and write the same data

The Notion API (version `2025-09-03`) introduces a dual-ID system:
- `database_id` — used when creating new pages (`parent: {"database_id": "..."}`)
- `data_source_id` — used when querying or reading (`POST /v1/data_sources/{id}/query`)

This distinction is documented in `NOTION-CONTEXT.md` so Lyra always uses the right one.

### 4. Mac as the host, not the cloud

Running on a Mac that is always on (or wakes for scheduled tasks) instead of a cloud server means:
- Zero hosting cost
- Access to local tools — Apple Reminders via `osascript`, Apple Calendar, the local filesystem
- The agent can modify its own workspace files (self-edit capability)
- LaunchAgent ensures it runs in the user's session context, which matters for macOS TCC permissions

The one downside: if your Mac is off, Lyra is off. For most personal use cases this is acceptable.

### 5. Two access tiers, one agent

Rather than running two separate bots, both people in the household message the same Telegram bot. OpenClaw's allowlist identifies who is speaking by their numeric Telegram user ID. `SOUL.md` defines what each person can see and do. The information boundaries are enforced in the agent's instructions, not in config.

This is simpler to maintain than two separate deployments and keeps the shared databases accessible to both without duplication.

---

## Data flow

### Inbound message (Akash or partner sends a text)
```
Telegram message → OpenClaw gateway → agent turn starts
→ SOUL.md + MEMORY.md + NOTION-CONTEXT.md loaded
→ relevant skills available in context
→ Claude Sonnet processes with full context
→ tool calls executed (Notion, osascript, blogwatcher, etc.)
→ response delivered back via Telegram
```

### Inbound voice message
```
Telegram voice message → OpenClaw receives audio
→ transcribed to text
→ voice-capture skill pipeline activated
→ classified (Insight/Decision/Idea/Question/Pattern)
→ saved to Second Brain Notion database
→ confirmation sent back to Telegram
```

### Scheduled task (cron fires)
```
OpenClaw cron scheduler → isolated agent turn
→ only HEARTBEAT.md loaded (lightweight context)
→ task executed (RSS fetch, Notion query, web search)
→ summary delivered to Telegram via announce
```

---

## Workspace file roles

| File | Loaded when | Purpose |
|------|------------|---------|
| `SOUL.md` | Every conversation | Personality, rules, access levels, tool instructions |
| `MEMORY.md` | Every conversation | Permanent facts about you, your context, your preferences |
| `NOTION-CONTEXT.md` | Every conversation | All database IDs and property names |
| `HEARTBEAT.md` | Cron runs only | Lightweight context for scheduled tasks |
| `skills/*/SKILL.md` | On demand | Modular capability definitions |

---

## Security boundaries

```
┌─────────────────────────────────┐
│  Telegram allowlist             │
│  Only numeric IDs in allowFrom  │
│  can send messages              │
└────────────┬────────────────────┘
             │
┌────────────▼────────────────────┐
│  SOUL.md access control         │
│  Person A → all databases       │
│  Person B → shared databases    │
│             only                │
└────────────┬────────────────────┘
             │
┌────────────▼────────────────────┐
│  denyCommands in gateway        │
│  Blocks: camera, screen record, │
│  contacts.add                   │
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

Custom skills in this setup:
- `voice-capture` — the voice → Second Brain pipeline
- `self-edit` — instructions for Lyra to modify her own workspace files
- `apple-reminders` — Reminders via `osascript` (not `remindctl`, which has macOS TCC issues when running as a daemon)

---

## Why osascript instead of remindctl

`remindctl` is a well-built CLI for Apple Reminders but relies on macOS TCC (Transparency, Consent, and Control) permissions tied to the calling application's bundle ID. When OpenClaw runs as a LaunchAgent (background daemon process), the calling context is `node` — not Terminal.app. Even if you grant Terminal permission, the daemon is blocked.

`osascript` (Apple Events / AppleScript) uses a different permission model. It runs under the user's session and inherits the broader Apple Events permissions which the daemon process can access. Testing confirmed `osascript` works; `remindctl` does not from the daemon context.

This is documented in the `apple-reminders` skill so Lyra never attempts to use `remindctl`.
