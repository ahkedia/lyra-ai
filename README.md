# Lyra — A Personal AI Agent for Work, Life, and a Household

> Built on [OpenClaw](https://openclaw.ai) · Powered by Claude · Lives in Telegram · Thinks in Notion

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
- Reminds me about content every day at noon
- On Sunday evening, synthesises my week — decisions made, ideas captured, patterns forming
- Reads and writes to all my Notion databases on command
- Can update her own memory and rules when I tell her to

**For my wife (Abhigna):**
- Has her own access to Lyra on the same Telegram bot
- Can see and update the shared databases: Health & Meds, Meal Planning, Upcoming Trips
- Cannot see my professional databases (by design)
- Either of us can ask Lyra to add a task to our shared Reminders list

**For both of us:**
- Joint task coordination — "Remind Abhigna to follow up with the clinic" works from my Telegram
- Shared Reminders list (`Shared - Akash & Abhigna`) syncs to both our iPhones via iCloud
- Shared Notion databases updated by either person, visible to both

---

## The Stack

| Layer | Tool |
|-------|------|
| Agent framework | [OpenClaw](https://openclaw.ai) |
| AI model | Claude Sonnet (Anthropic API) |
| Messaging interface | Telegram Bot |
| Memory & databases | Notion |
| News & RSS | [blogwatcher](https://github.com/openclaw-ai/blogwatcher) CLI |
| Email | [himalaya](https://himalaya.cli.rs) CLI |
| Reminders | `osascript` (Apple Reminders via AppleScript) |
| Web search | Tavily API |
| Scheduled tasks | OpenClaw cron |
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
         │   Claude Sonnet     │
         └──────────┬──────────┘
                    │
        ┌───────────┼───────────┐
        │           │           │
   ┌────▼────┐ ┌────▼────┐ ┌───▼────────┐
   │ NOTION  │ │  TOOLS  │ │   CRONS    │
   │ Cockpit │ │ • RSS   │ │ 7am digest │
   │         │ │ • Email │ │ noon nudge │
   │ 9 DBs + │ │ • Web   │ │ Sun review │
   │ Second  │ │ • Cal   │ │ brain brief│
   │ Brain   │ │ • Remind│ └────────────┘
   └─────────┘ └─────────┘

        ┌──────────────────┐
        │   WORKSPACE      │
        │  SOUL.md         │  ← personality + rules
        │  MEMORY.md       │  ← permanent context
        │  NOTION-CONTEXT  │  ← DB IDs + patterns
        │  skills/         │  ← modular capabilities
        └──────────────────┘
```

---

## What makes this different

**1. Notion as the cockpit, not just a storage layer**

Every domain of my life has a Notion database. Lyra reads and writes all of them. When I say "add this competitor update" or "mark that task done", it happens — not as a suggestion, but as an actual write to Notion. The databases are the source of truth; Lyra is the interface.

**2. It runs for two people, not one**

Most personal AI setups are solo. Lyra has two access tiers on the same bot. My wife has her own Telegram conversation with Lyra, access to the shared databases, and can assign tasks to me. The information boundaries are enforced in `SOUL.md` — she cannot see my professional context, and I cannot accidentally leak it to her queries.

**3. Voice → structured knowledge**

Every voice message sent to Lyra on Telegram is transcribed, classified (Insight / Decision / Idea / Question / Pattern), titled, tagged, and saved to the Second Brain Notion database. The bar for capturing is low — if it crossed my mind twice, it goes in. The Sunday brain brief surfaces it.

**4. It can update itself**

Lyra has a `self-edit` skill. When I say "remember that I've decided X" or "add a rule that you never suggest Y", she appends to `MEMORY.md` or `SOUL.md` directly. New cron jobs, new rules, new context — all from Telegram.

---

## Repo structure

```
lyra-ai/
├── README.md                      ← you are here
├── docs/
│   ├── 1-setup.md                 ← prerequisites + full install walkthrough
│   ├── 2-architecture.md          ← system design decisions
│   ├── 3-notion-cockpit.md        ← Notion database schemas + setup
│   ├── 4-household-coordination.md ← two-person agent setup
│   ├── 5-second-brain.md          ← voice capture + weekly synthesis
│   ├── 6-heartbeats.md            ← all scheduled tasks + rationale
│   └── 7-security.md              ← access control + safety model
├── config/
│   ├── openclaw-template.json     ← OpenClaw config (secrets removed)
│   ├── SOUL-template.md           ← personality + rules template
│   └── MEMORY-template.md         ← memory structure template
├── skills/
│   ├── voice-capture/SKILL.md     ← voice → Second Brain pipeline
│   ├── self-edit/SKILL.md         ← Lyra editing her own files
│   └── apple-reminders/SKILL.md   ← Reminders via osascript
└── notion/
    └── database-schemas.md        ← all 9 database structures
```

---

## Quick start

See [`docs/1-setup.md`](docs/1-setup.md) for the full walkthrough. The short version:

1. Install [OpenClaw](https://openclaw.ai) and run `openclaw onboard`
2. Create a Telegram bot via [@BotFather](https://t.me/BotFather)
3. Set up a [Notion integration](https://notion.so/my-integrations) and create your databases
4. Get an [Anthropic API key](https://console.anthropic.com) and a [Tavily API key](https://tavily.com)
5. Copy the config template, fill in your keys, deploy `SOUL.md` and `MEMORY.md`
6. Install skills: `notion`, `blogwatcher`, `himalaya`, `apple-reminders`
7. Add your cron jobs
8. Done — message your bot on Telegram

---

## The philosophy

I did not want another app to check. I wanted something that already knows my context, watches for things, and shows up where I already am (Telegram).

The design principles:

- **Reduce cognitive load, not add to it** — every response should make the next decision easier
- **Notion is the source of truth** — Lyra is the interface, not the database
- **Low friction capture** — voice notes, quick texts, no forms to fill
- **Two people, one agent** — a household has shared context; the agent should reflect that
- **Proactive, not just reactive** — crons fire whether or not you message it

---

## Author

[Akash Kedia](https://github.com/ahkedia) · Product leader in fintech · Building in public

---

## License

MIT — use it, adapt it, build on it.
