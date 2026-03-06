# Lyra — A Personal AI Agent for Work, Life, and a Household

> Built on [OpenClaw](https://openclaw.ai) · Powered by Claude · Lives in Telegram · Thinks in Notion · Remembers with LanceDB + Ollama (local)

---

I am a product leader in fintech. I lead large teams, advise startups, and create content. My wife and I share a home, a calendar, and a running list of things we keep forgetting to tell each other.

I built Lyra to be the thing that holds it all together — a personal AI that runs 24/7 on my Mac, knows the full context of my life and work, and coordinates the parts of it I share with my wife. It is not a chatbot. It does not wait for me to open an app. It shows up in my Telegram, watches for things, reminds us of tasks, and quietly organises everything into Notion.

This repo is a full write-up of what I built, why, and how. Every config, skill, and decision is documented here.

---

## What Lyra does

**For me:**
- Sends a curated news digest every morning at 7am — fintech, AI, startups — directly to Telegram
- Monitors competitors weekly and surfaces only what matters
- Captures every voice note I send into a structured Second Brain in Notion (transcribe → classify → save)
- Drafts a content post every day at noon, pulling from my ideas backlog
- On Sunday evening, synthesises my week — decisions made, ideas captured, patterns forming
- Reads and writes to all my Notion databases on command
- Can update her own memory and rules when I tell her to

**For my wife (Abhigna):**
- Has her own access to Lyra on the same Telegram bot
- Can see and update the shared databases: Health & Meds, Meal Planning, Upcoming Trips, Shopping List
- Cannot see my professional databases (enforced at the memory layer, not just by prompt)
- Can assign tasks to me via Lyra — they get added to my Reminders and I get a Telegram ping

**For both of us:**
- Joint task coordination — "Remind Abhigna to follow up with the clinic" works from my Telegram
- Shared Apple Reminders list syncs to both iPhones via iCloud
- Shared Notion databases updated by either person, visible to both
- Joint calendar events added to Apple Calendar, sync to Google Calendar

---

## The Stack

| Layer | Tool |
|-------|------|
| Agent framework | [OpenClaw](https://openclaw.ai) |
| AI model | Claude Haiku 4.5 (default) + Claude Sonnet 4.6 (synthesis tasks) |
| Messaging interface | Telegram Bot |
| Memory & databases | Notion (10 databases) |
| Persistent memory | LanceDB + Ollama (local, free, semantic embeddings) |
| News & RSS | [blogwatcher](https://github.com/openclaw-ai/blogwatcher) CLI |
| Transcription | mlx-whisper (local, Apple Silicon) |
| Email | [himalaya](https://himalaya.cli.rs) CLI |
| Reminders | `osascript` (Apple Reminders via AppleScript) |
| Calendar | `osascript` → Calendar.app → Google Calendar |
| Web search | Tavily API |
| Scheduled tasks | OpenClaw cron |
| Secrets | `~/.openclaw/.env` (excluded from backup) |
| Backup & monitoring | Daily backup to ~/Documents/lyra-backups; health check every 15 min with Telegram alerts |
| Runs on | Mac (LaunchAgent daemon, auto-starts on boot) |

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   TELEGRAM                          │
│         Akash ←──────────────── Abhigna            │
└───────────────────┬─────────────────────────────────┘
                    │
         ┌──────────▼──────────┐
         │        LYRA         │
         │   (OpenClaw Agent)  │
         │   Mac LaunchAgent   │
         │   Haiku / Sonnet    │
         └──────────┬──────────┘
                    │
    ┌───────────────┼────────────────┐
    │               │                │
┌───▼────┐   ┌──────▼──────┐  ┌────▼──────────┐
│LANCEDB │   │   NOTION    │  │   CRONS        │
│+Ollama │   │  Cockpit    │  │ 7am digest     │
│local   │   │             │  │ noon content   │
│memory  │   │ 10 DBs +    │  │ Sun reviews    │
│auto    │   │ Second Brain│  │ brain brief    │
│capture │   │             │  │ Mon health chk │
│recall  │   └─────────────┘  └───────────────┘
└────────┘
         ┌──────────────────────────┐
         │       WORKSPACE          │
         │  SOUL.md    (~699 tokens)│  ← rules + routing
         │  MEMORY.md  (~357 tokens)│  ← Notion IDs only
         │  skills/ (on-demand)     │  ← Notion, Calendar,
         │  references/notion.md    │    Reminders, Voice
         └──────────────────────────┘
```

**Context per turn: ~2,900 tokens** (down from ~11,000 before optimisation)

---

## What makes this different

**1. Local memory, not a static file**

Most agent setups put a massive `MEMORY.md` file in the workspace and load it on every message. This is expensive (every "add milk" loads your full professional biography) and static (it only knows what you explicitly told it to remember).

LanceDB + Ollama changes this: after every exchange, relevant context is extracted and stored as semantic embeddings. Before every message, only the most relevant memories are retrieved. "Add milk" fetches household context. "Help with interview prep" fetches professional context. The agent learns from every conversation automatically.

**2. Dual-model routing**

Haiku handles 90% of tasks. Sonnet runs only for synthesis jobs (digests, analysis, complex drafts). Lyra self-routes: if a live Telegram message needs deep reasoning, she fires a one-shot Sonnet cron that delivers the result in 15 seconds. This reduces cost by ~80% and increases capacity from 3 to 69+ messages/minute on Claude's Tier 1 limits.

**3. Notion as cockpit, not storage**

Every domain has a Notion database. Lyra reads and writes all of them. The databases are the source of truth; Lyra is the interface. When I say "add this competitor update" or "mark that task done", it happens as an actual write to Notion.

**4. Two people, one agent, isolated memory**

Lyra has two access tiers on the same bot. My wife has her own conversation with Lyra, access to shared databases, and can assign tasks to me. Access control is enforced at the memory layer — she cannot retrieve professional context because it lives in a container her sessions never touch.

**5. Voice → structured knowledge, automatically**

Every voice message sent to Lyra on Telegram is transcribed locally (mlx-whisper, no data sent off-device), classified (Insight / Decision / Idea / Question / Pattern), titled, tagged, and saved to the Second Brain Notion database. The Sunday brain brief surfaces patterns across the week's captures.

**6. Self-monitoring and backup**

A Monday 9am cron checks the status of all other cron jobs. If any has failed consecutively, Lyra sends a Telegram alert. A separate health check runs every 15 minutes and alerts if the gateway or Ollama is down. Daily backups of memory, workspace, and config keep everything safe.

---

## Repo structure

```
lyra-ai/
├── README.md
├── blog/
│   └── building-lyra.md           ← full write-up of why and how
├── docs/
│   ├── 1-setup.md                 ← prerequisites + full install walkthrough
│   ├── 2-architecture.md          ← system design decisions
│   ├── 3-notion-cockpit.md        ← Notion database schemas + setup
│   ├── 4-household-coordination.md ← two-person agent setup
│   ├── 5-second-brain.md          ← voice capture + weekly synthesis
│   ├── 6-heartbeats.md            ← all scheduled tasks + rationale
│   ├── 7-security.md              ← access control + safety model
│   ├── 8-performance.md           ← token optimisation (74% reduction)
│   └── 9-supermemory.md           ← persistent semantic memory (LanceDB + Ollama)
├── config/
│   ├── openclaw-template.json     ← OpenClaw config (secrets removed)
│   ├── SOUL-template.md           ← personality + rules template
│   └── MEMORY-template.md         ← memory structure template
├── skills/
│   ├── voice-capture/SKILL.md     ← voice → Second Brain pipeline
│   ├── self-edit/SKILL.md         ← Lyra editing her own files
│   ├── apple-calendar/SKILL.md    ← calendar events via osascript
│   └── apple-reminders/SKILL.md   ← Reminders via osascript
└── notion/
    └── database-schemas.md        ← all 10 database structures
```

---

## Quick start

See [`docs/1-setup.md`](docs/1-setup.md) for the full walkthrough. The short version:

1. Install [OpenClaw](https://openclaw.ai) and run `openclaw onboard`
2. Create a Telegram bot via [@BotFather](https://t.me/BotFather)
3. Set up a [Notion integration](https://notion.so/my-integrations) and create your databases
4. Get an [Anthropic API key](https://console.anthropic.com) and a [Tavily API key](https://tavily.com)
5. Install [Ollama](https://ollama.ai) and run `ollama pull nomic-embed-text` for local memory
6. Copy the config template, add secrets to `~/.openclaw/.env`, deploy `SOUL.md` and `MEMORY.md`
7. Install memory-lancedb-ollama (or use built-in memory-lancedb with Ollama baseUrl)
8. Install skills: `apple-reminders`, `apple-calendar`, `voice-capture`, `self-edit`
9. Set up your cron jobs (news digest, content reminder, weekly reviews)
10. Optional: enable backup and health-check LaunchAgents
11. Done — message your bot on Telegram

---

## Fork it

This repo is designed to be forked. All personal information has been replaced with `[PLACEHOLDER]` values in the config templates. To adapt it:

1. Fork the repo
2. Fill in your values in `config/SOUL-template.md` and `config/MEMORY-template.md`
3. Copy `config/openclaw-template.json` to `~/.openclaw/openclaw.json` and add your API keys to `~/.openclaw/.env`
4. Create your Notion databases using the schemas in `notion/database-schemas.md`
5. Set up LanceDB + Ollama for memory
6. Follow `docs/1-setup.md`

---

## The philosophy

I did not want another app to check. I wanted something that already knows my context, watches for things, and shows up where I already am (Telegram).

The design principles:

- **Reduce cognitive load, not add to it** — every response should make the next decision easier
- **Notion is the source of truth** — Lyra is the interface, not the database
- **Low friction capture** — voice notes, quick texts, no forms to fill
- **Two people, one agent** — a household has shared context; the agent should reflect that
- **Proactive, not just reactive** — crons fire whether or not you message it
- **Performance first** — every addition must justify its token cost
- **Local-first where possible** — memory and embeddings run on-device when feasible

---

## Author

[Akash Kedia](https://github.com/ahkedia) · Product leader in fintech · Building in public

---

## License

MIT — use it, adapt it, build on it.
