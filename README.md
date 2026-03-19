# Lyra — A Personal AI Agent for Work, Life, and a Household

![CI](https://github.com/ahkedia/lyra-ai/actions/workflows/ci.yml/badge.svg) ![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg) ![Built with OpenClaw](https://img.shields.io/badge/Built%20with-OpenClaw-blue)

> Built on [OpenClaw](https://openclaw.ai) · Powered by MiniMax M2.5 + Claude · Lives in Telegram · Thinks in Notion · Runs 24/7 on Hetzner

---

I am a product leader in fintech. I lead large teams, advise startups, and create content. My wife and I share a home, a calendar, and a running list of things we keep forgetting to tell each other.

I built Lyra to be the thing that holds it all together — a personal AI that runs 24/7 on a cloud VPS, knows the full context of my life and work, and coordinates the parts of it I share with my wife. It is not a chatbot. It does not wait for me to open an app. It shows up in my Telegram, watches for things, reminds us of tasks, and quietly organises everything into Notion.

This repo is a full write-up of what I built, why, and how. Every config, skill, and decision is documented here.

---

## What Lyra does

**For me:**
- Sends a curated morning digest at 7am — emails, fintech news, AI news, startup news, and tasks due today — directly to Telegram
- Monitors competitors weekly (Revolut, Monzo, Bunq, Starling) and surfaces only what matters
- Captures every voice note I send into a structured Second Brain in Notion (transcribe → classify → save)
- Drafts a content post reminder every day at noon, pulling from my ideas backlog
- On Sunday evening, synthesises my week — decisions made, ideas captured, patterns forming
- Reads and writes to all my Notion databases on command
- Reads and sends email via Gmail (himalaya CLI with App Password)
- Manages Google Calendar — create events, check availability, coordinate joint calendar with wife
- Can update her own memory, rules, and skills — and auto-syncs changes to this GitHub repo
- Sends a daily activity log at 9pm — what she did today, what crons ran, any issues

**For my wife (Abhigna):**
- Has her own access to Lyra on the same Telegram bot
- Gets a friendly onboarding when she first messages ("I can help with reminders, meals, health, trips, shopping")
- Can see and update the shared databases: Health & Meds, Meal Planning, Upcoming Trips, Shopping List, Shared Reminders
- Cannot see my professional databases (enforced by access rules, not by hoping the model behaves)
- Can assign tasks to me via Lyra — they get added to Shared Reminders and I get a Telegram ping
- Gets notified when I complete a task she assigned

**For both of us:**
- Joint task coordination — "Remind Abhigna to follow up with the clinic" works from my Telegram
- Notion Reminder databases (Akash / Shared / Abhigna) with IFTTT bridge to Apple Reminders on iPhone
- Shared Notion databases updated by either person, visible to both

---

## The Stack

| Layer | Tool |
|-------|------|
| Agent framework | [OpenClaw](https://openclaw.ai) v2026.3.13 |
| Default AI model | MiniMax M2.5 (fast, cost-effective) |
| Escalation models | Claude Haiku 4.5 (fallback) + Claude Sonnet 4.6 (synthesis) |
| Messaging interface | Telegram Bot |
| Databases | Notion (13 databases) |
| Email | [himalaya](https://himalaya.cli.rs) CLI (Gmail IMAP/SMTP) |
| Calendar | Google Calendar API v3 (OAuth2) |
| News & RSS | [blogwatcher](https://github.com/openclaw-ai/blogwatcher) CLI |
| Web search | Tavily API |
| Scheduled tasks | OpenClaw cron (7 jobs, Europe/Berlin timezone) |
| Hosting | Hetzner VPS (Ubuntu 24.04, 4GB RAM, €5.99/mo) |
| Persistence | systemd service + PostgreSQL (Docker) |
| Secrets | `~/.openclaw/.env` (chmod 600, excluded from git and backups) |
| Backup | Daily at 3am UTC — workspace, config, Postgres dump, 7-day retention |
| Monitoring | Health check every 15 min + status dashboard + auto-recovery |
| Self-edit sync | Bidirectional GitHub sync every 5 min (Lyra pushes self-edits, pulls remote changes) |
| Reminders bridge | Notion → IFTTT → Pushcut → Apple Reminders on iPhone |

**Monthly cost:** ~€18 (Hetzner €5.99 + MiniMax ~€3 + Claude API ~€5-8 + Tavily free tier)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         TELEGRAM                                │
│              Akash ◄──────────────────► Abhigna                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │
              ┌────────────▼────────────┐
              │          LYRA           │
              │    (OpenClaw Gateway)   │
              │    Hetzner VPS 24/7     │
              │                         │
              │  ┌───────┐ ┌─────────┐  │
              │  │MiniMax│ │ Claude   │  │
              │  │ M2.5  │ │Haiku/   │  │
              │  │default│ │Sonnet   │  │
              │  └───────┘ └─────────┘  │
              └────────────┬────────────┘
                           │
       ┌───────────────────┼────────────────────┐
       │                   │                    │
┌──────▼──────┐    ┌───────▼───────┐    ┌───────▼──────────┐
│   NOTION    │    │    CRONS      │    │   INTEGRATIONS   │
│   Cockpit   │    │               │    │                  │
│             │    │ 7am  digest   │    │ himalaya (email) │
│ 13 DBs:    │    │ noon content  │    │ blogwatcher (RSS)│
│ News       │    │ Sun  reviews  │    │ Tavily (search)  │
│ Competitors│    │ Sun  brain    │    │ wttr.in (weather)│
│ Recruiters │    │ Mon  health   │    │ IFTTT (reminders)│
│ Content    │    │ 9pm  log      │    │                  │
│ Health     │    │               │    │                  │
│ Meals      │    │ All Europe/   │    │                  │
│ Trips      │    │ Berlin tz     │    │                  │
│ Reminders  │    │               │    │                  │
│ 2nd Brain  │    │               │    │                  │
└─────────────┘    └───────────────┘    └──────────────────┘

       ┌─────────────────────────────────────────┐
       │            RESILIENCE LAYER             │
       │                                         │
       │ systemd (auto-restart on failure)        │
       │ PostgreSQL (session persistence)         │
       │ ufw firewall (SSH + gateway only)        │
       │ 2GB swap (OOM protection)                │
       │ Health check every 15 min + Telegram     │
       │ Daily backup 3am (7-day retention)       │
       │ Bidirectional GitHub sync (5 min)         │
       │ Cron failure alerting                    │
       │ Model fallback: MiniMax → Haiku → alert  │
       │ Notion failure: describe intent, retry    │
       │ Auto-recovery playbook (5 failure modes)  │
       │ Status dashboard (updates every 5 min)    │
       │ Daily cost tracking + Telegram reports    │
       │ Structured JSON logging + log rotation    │
       │ Graceful gateway shutdown wrapper          │
       │ Secret rotation script                     │
       │ Automatic security updates                 │
       │ TLS via Caddy (Let's Encrypt)             │
       │ CI pipeline (lint, routing eval, secrets)  │
       └─────────────────────────────────────────┘
```

---

## Migration story: Mac → Cloud

This setup originally ran on my Mac as a LaunchAgent daemon. I migrated it to a Hetzner VPS for 24/7 availability and to remove the dependency on my Mac being powered on.

**What changed:**
- `osascript` (Apple Reminders, Calendar) → Notion databases + IFTTT bridge to iPhones
- `mlx-whisper` (local transcription) → Planned: OpenAI Whisper API (not yet migrated)
- `himalaya` (macOS Keychain auth) → `himalaya` (Gmail App Password auth)
- LaunchAgent → systemd service
- Local LanceDB + Ollama memory → Disabled (rate limit optimisation; may re-enable with cloud embeddings)
- Default model: Claude Haiku → MiniMax M2.5 (cost reduction + speed)
- Added: bidirectional GitHub sync, daily activity log, cron failure alerting, Postgres persistence

**What stayed the same:**
- SOUL.md personality and rules
- All 13 Notion database integrations
- Multi-user access control (Akash full / Abhigna sandboxed)
- 7 scheduled cron heartbeats
- Self-edit capability
- Prompt injection defenses

See [`blog/building-lyra.md`](blog/building-lyra.md) for the full journey from idea to working agent.

---

## What makes this different

**1. Three-tier model routing**

MiniMax M2.5 handles 90% of tasks (cheap, fast). Claude Haiku catches MiniMax failures as automatic fallback. Claude Sonnet runs only for synthesis jobs (digests, analysis, complex drafts) via one-shot cron. This keeps the monthly API cost under €10 while maintaining quality where it matters.

**2. Notion as cockpit, not storage**

Every domain has a Notion database (13 total). Lyra reads and writes all of them. The databases are the source of truth; Lyra is the interface. When I say "add this competitor update" or "mark that task done", it's an actual API write to Notion — not a hallucinated confirmation.

**3. Two people, one agent, isolated access**

Lyra has two access tiers on the same bot. My wife has her own conversation, access to shared databases, and can assign tasks to me. When she completes a task I assigned, I get notified. When I complete one she assigned, she gets notified. Access control is enforced by explicit rules, not by trusting the model.

**4. Self-modifying agent with audit trail**

Lyra can edit her own SOUL.md, MEMORY.md, skills, and Notion references. Every change auto-syncs to this GitHub repo within 5 minutes. The commit history is the audit trail. If something breaks, `git revert` fixes it.

**5. Resilience-first cloud design**

The VPS has: systemd auto-restart, 15-minute health checks with Telegram alerts, automatic gateway restart on failure, daily backups with 7-day retention, 2GB swap for OOM protection, firewall blocking all unnecessary ports, Docker restart policies for Postgres, cron failure detection, and model fallback chains. This is infrastructure, not a hobby project.

**6. Graceful degradation**

When MiniMax fails → auto-retry → fall back to Haiku → inform user. When Notion is down → describe what would have been done → offer retry. When a cron job fails → alert within 15 minutes, not next Monday. The agent never silently fails.

---

## Repo structure

```
lyra-ai/
├── README.md                          ← you are here
├── blog/
│   └── building-lyra.md              ← full write-up of why and how
├── docs/
│   ├── 1-setup.md                    ← prerequisites + full install walkthrough
│   ├── 2-architecture.md             ← system design decisions
│   ├── 3-notion-cockpit.md           ← Notion database schemas + setup
│   ├── 4-household-coordination.md   ← two-person agent setup
│   ├── 5-second-brain.md             ← voice capture + weekly synthesis
│   ├── 6-heartbeats.md               ← all scheduled tasks + rationale
│   ├── 7-security.md                 ← access control + safety model
│   ├── 8-performance.md              ← token optimisation
│   └── 9-supermemory.md              ← persistent semantic memory
├── config/
│   ├── openclaw-template.json        ← OpenClaw config (secrets removed)
│   ├── SOUL-template.md              ← personality + rules template
│   ├── MEMORY-template.md            ← memory structure template
│   ├── SOUL.md                       ← live config (auto-synced from Hetzner)
│   ├── MEMORY.md                     ← live config (auto-synced from Hetzner)
│   └── HEARTBEAT.md                  ← live cron context
├── scripts/
│   ├── deploy-lyra.sh                ← bidirectional GitHub sync
│   ├── lyra-backup.sh                ← daily backup with retention
│   ├── lyra-health-check.sh          ← 15-min monitoring + alerting
│   ├── lyra-logger.sh                ← structured JSON logging
│   ├── lyra-status.sh                ← status dashboard generator
│   ├── lyra-recovery.sh              ← auto-recovery playbook
│   ├── cost-tracker.sh               ← daily cost tracking
│   ├── openclaw-wrapper.sh           ← graceful gateway shutdown
│   ├── rotate-secret.sh              ← secret rotation utility
│   ├── setup-auto-updates.sh         ← security auto-updates
│   ├── model-router.js               ← 3-tier message classifier
│   ├── gcal-auth.js                  ← Google Calendar OAuth2
│   ├── gcal-helper.js                ← Google Calendar CLI
│   └── openclaw.service              ← systemd service definition
├── skills/
│   ├── notion/SKILL.md               ← Notion API patterns
│   ├── himalaya/SKILL.md             ← email read/write
│   ├── google-calendar/SKILL.md      ← Google Calendar integration
│   ├── blogwatcher/SKILL.md          ← RSS feed monitoring
│   ├── weather/SKILL.md              ← weather via wttr.in
│   ├── self-edit/SKILL.md            ← Lyra editing her own files
│   ├── voice-capture/SKILL.md        ← voice → Second Brain pipeline
│   ├── model-router/SKILL.md         ← 3-tier routing logic
│   └── _template/SKILL.md            ← template for new skills
├── notion/
│   ├── notion.md                     ← live database IDs (auto-synced)
│   └── database-schemas.md           ← all 13 database structures
└── .gitignore
```

---

## Quick start (cloud deployment)

### Prerequisites
- A VPS (Hetzner CPX21 recommended: 4GB RAM, €5.99/mo)
- API keys: MiniMax, Anthropic (Claude), Telegram Bot, Notion, Tavily
- Gmail App Password (for email integration)
- A GitHub repo (for self-edit sync)

### Deploy

```bash
# 1. Install OpenClaw on your VPS
curl -fsSL https://get.openclaw.ai | bash
openclaw onboard

# 2. Clone this repo
git clone https://github.com/ahkedia/lyra-ai.git /root/lyra-ai

# 3. Copy config templates
cp config/SOUL-template.md ~/.openclaw/workspace/SOUL.md
cp config/MEMORY-template.md ~/.openclaw/workspace/MEMORY.md
cp config/openclaw-template.json ~/.openclaw/openclaw.json

# 4. Create .env with your secrets
cat > ~/.openclaw/.env << EOF
MINIMAX_API_KEY=your_key
ANTHROPIC_API_KEY=your_key
TELEGRAM_BOT_TOKEN=your_token
NOTION_API_KEY=your_key
TAVILY_API_KEY=your_key
GMAIL_APP_PASSWORD=your_app_password
GMAIL_EMAIL_ADDRESS=your@gmail.com
OPENCLAW_GATEWAY_TOKEN=$(openssl rand -hex 24)
NODE_ENV=production
EOF
chmod 600 ~/.openclaw/.env

# 5. Install skills
cp -r skills/ ~/.openclaw/workspace/skills/
cp notion/notion.md ~/.openclaw/workspace/references/notion.md

# 6. Set up systemd service
cp scripts/openclaw.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now openclaw

# 7. Set up monitoring
cp scripts/lyra-backup.sh scripts/lyra-health-check.sh /root/
chmod +x /root/lyra-backup.sh /root/lyra-health-check.sh
crontab -l | { cat; echo "0 3 * * * /root/lyra-backup.sh >> /tmp/lyra-backup.log 2>&1"; } | crontab -
crontab -l | { cat; echo "*/15 * * * * /root/lyra-health-check.sh >> /tmp/lyra-health-check.log 2>&1"; } | crontab -

# 8. Harden the server
ufw allow 22/tcp && ufw allow 18789/tcp && ufw --force enable
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile

# 9. Set up cron heartbeats
openclaw cron add --name "morning-digest" --cron "0 7 * * *" --tz "Europe/Berlin" --session isolated --announce --message "..."
# (see docs/6-heartbeats.md for all 7 cron configurations)

# 10. Message your bot on Telegram
```

---

## Fork & Build Your Own

Want to build your own personal AI agent? Start with the minimal template:

```bash
cp -r templates/minimal-agent/ ~/my-agent/
cd ~/my-agent/
# Edit config/SOUL.md with your personality
# Edit .env with your API keys
# Deploy: openclaw gateway
```

The template gives you a 2-tier model router, one example skill, and 5 starter eval cases. See [`templates/minimal-agent/README.md`](templates/minimal-agent/README.md) for the full guide.

For a full fork with all features:

1. Fork the repo
2. Fill in `config/SOUL-template.md` with your personality, rules, and access levels
3. Fill in `config/MEMORY-template.md` with your Notion database IDs
4. Copy `config/openclaw-template.json` to your OpenClaw config directory
5. Create your Notion databases using the schemas in `notion/database-schemas.md`
6. Set up your cron jobs for the heartbeats you want
7. Deploy to your VPS

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for how to add skills, eval cases, and routing patterns.

---

## The philosophy

I did not want another app to check. I wanted something that already knows my context, watches for things, and shows up where I already am (Telegram).

- **Reduce cognitive load, not add to it** — every response should make the next decision easier
- **Notion is the source of truth** — Lyra is the interface, not the database
- **Low friction capture** — voice notes, quick texts, no forms to fill
- **Two people, one agent** — a household has shared context; the agent should reflect that
- **Proactive, not just reactive** — crons fire whether or not you message it
- **Resilience is not optional** — health checks, backups, fallbacks, alerts
- **Self-improving** — Lyra can edit her own rules and the changes are version-controlled

---

## Author

[Akash Kedia](https://github.com/ahkedia) · Product leader in fintech · Building in public

---

## License

MIT — use it, adapt it, build on it.
