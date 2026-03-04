# I Built a Personal AI That Actually Remembers Me

*How I turned OpenClaw, Claude, Telegram, and Notion into a working second brain — and the edge cases that nearly broke everything.*

---

I lead ~50 PMs at N26. I'm building a lending startup in India on the side. I have a wife, a household, a job search, and a content strategy running simultaneously across three platforms. My head is full.

I've used ChatGPT for two years. I have a massive context file I paste into every new chat. Every conversation resets. Every session starts with me re-explaining who I am and what I'm doing. It's a memory problem dressed up as an AI product.

I wanted something different: an agent that runs in the background, knows my context, takes action on Telegram messages, and genuinely reduces my cognitive load. Not a chatbot I visit — an operator that works for me.

This is how I built it. Including the parts that broke.

---

## The Setup

The stack is simple on paper:

- **OpenClaw** — the agent framework that sits on my Mac and connects AI to messaging channels
- **Claude API** (Anthropic) — the AI brain, via OpenClaw
- **Telegram** — the interface. One message → one action
- **Notion** — the cockpit. Everything gets written there
- **SuperMemory** — persistent semantic memory across sessions

I named her Lyra.

She runs as a background daemon on my Mac. She wakes up when I message her on Telegram. She executes. She confirms. She goes back to sleep. Every morning at 7am she sends me a news digest unprompted. Every Sunday she does a competitor analysis.

That's the product. The engineering to get there is where it gets interesting.

---

## The Use Cases I Built For

Before writing a single line of config, I mapped what I actually needed:

**For me:**
- Daily news digest: EU financial news, AI news, startup news — filtered and tagged
- Competitor monitoring: Revolut, Monzo, Bunq, Starling, Nubank — weekly pulse
- Content operations: X daily, LinkedIn weekly, Substack weekly — idea capture and drafting
- Job search tracking: 22 active conversations, follow-up dates, priorities
- Email drafting: nuanced, position-aware, in my voice
- Second Brain: capture every thought I speak into Telegram voice messages

**For household (Abhigna, my wife):**
- Shared reminders that sync to both iPhones
- Shared calendar — joint events visible on both phones
- Health and supplement tracking
- Meal planning
- Trip logistics
- Grocery and shopping lists

**The multi-user constraint:** Abhigna should be able to use Lyra without seeing my job search, competitors, or professional strategy. Different people, different access levels, one agent.

---

## What I Got Wrong First

### 1. Static memory is a dead end

My first design: write everything about me into a `MEMORY.md` file. Name, role, job search contacts, competitors list, content strategy. Load it every message.

This worked. For about a week.

Then I realised two things:

First, it's expensive. Every "add milk to shopping list" loads a complete professional biography. That's 1,400 tokens of irrelevant context injected before Lyra can say a single word.

Second, it doesn't learn. MEMORY.md only updates when I explicitly say "remember this." Everything I tell Lyra in conversation — a decision I made, a preference I expressed, context I gave — vanishes at session end. She wakes up the next day with no memory of our exchange.

The fix was SuperMemory. Not a static file — a semantic database. After every exchange, what matters gets extracted and stored. Before every message, the 5 most relevant memories get retrieved. "Add milk" fetches household context. "Help with interview prep" fetches professional context. Relevant context, not all context.

More on this below.

### 2. I was loading 11,000 tokens per message

After a day of heavy use, Lyra started responding "API limit reached" on every other message.

I assumed it was the Claude billing limit. It wasn't. I had topped up. The problem was **tokens per minute** — Anthropic's rate limit on Sonnet (40,000 TPM on Tier 1) meant I could only send 3 messages per minute before hitting the ceiling.

The reason: every single message loaded ~11,000 tokens of context. Here's where they were hiding:

- `AGENTS.md` — OpenClaw's default instruction file (1,967 tokens). Contains advice on Discord emoji reactions and TTS voice storytelling. None of which I use.
- `BOOTSTRAP.md` — a one-time setup file OpenClaw creates and literally tells you to delete. Never deleted. 367 tokens per message.
- `NOTION-CONTEXT.md` — a 2,362-token reference file I'd put in the workspace directory, meaning it loaded on every single message including "what's the weather?"
- Verbose SOUL.md and MEMORY.md — unnecessary prose I'd written as if documenting a product, not configuring an agent

The fix was surgical: delete what shouldn't exist, move what doesn't need to be always-on, compress everything else. After the cleanup: 1,890 tokens per turn. An 83% reduction.

Then I switched the default model from Sonnet to Haiku. Haiku has 200,000 TPM on Tier 1 — five times the headroom — and handles 90% of Lyra's tasks identically. The remaining 10% (synthesis, strategy, complex drafts) run on Sonnet automatically via scheduled cron jobs.

Result: from 3 messages/minute to 69+ messages/minute without hitting any limits.

### 3. The daemon doesn't read your shell config

This took an afternoon to debug. Lyra runs as a macOS LaunchAgent daemon — a background process that starts on boot. I had added my API keys to `~/.zshrc`. They worked fine in terminal. They were invisible to the daemon.

macOS daemons do not inherit your shell environment. `~/.zshrc` is for interactive shell sessions only. The daemon runs in a clean environment.

Fix: add every API key directly to the LaunchAgent plist file under `<EnvironmentVariables>`. It's verbose but it's the only way. Learned this the hard way when Lyra reported "no Tavily API key found" for a week of morning digests.

### 4. Reminders permissions and the daemon problem

I set up Apple Reminders integration. Tested it from Terminal — worked perfectly. Lyra tried to use it — failed silently.

The issue: macOS TCC (Transparency, Consent and Control) grants app permissions per application bundle. "Terminal" has Reminders access. The OpenClaw daemon runs under Node.js with a completely different bundle identifier. When the daemon calls `remindctl`, it's a different "app" making the request, and it hadn't been granted permission.

The fix: replace `remindctl` entirely with `osascript`. AppleScript uses Apple Events, which have a more permissive permission model for background processes. The osascript path works from the daemon without any additional permission grants.

```bash
osascript << 'EOF'
tell application "Reminders"
  tell list "Shared - Akash & Abhigna"
    make new reminder with properties {name: "TASK_HERE"}
  end tell
end tell
EOF
```

Simple, reliable, daemon-compatible.

### 5. Notion API changed

I started with Notion API `2021-08-16`. Everything worked. I upgraded to `2025-09-03` because I needed newer features.

Breaking change: databases are now called "data sources." There are now two IDs per database — `database_id` (for creating pages) and `data_source_id` (for querying). They are different values. You can't use one where the other is expected.

I built `NOTION-REFERENCE.md` — a per-database reference mapping both IDs and all property names. Lyra reads it before any Notion API call. This eliminated 95% of Notion errors.

### 6. Voice capture had no implementation

I wrote a voice capture pipeline in SOUL.md: "transcribe → classify → save to Second Brain." When a voice message arrived, Lyra would say "Captured. [Title] → Second Brain ✓."

Except she wasn't capturing anything. She was hallucinating the confirmation.

OpenClaw doesn't natively transcribe Telegram voice messages. The SKILL.md said "use built-in transcription capability" — there is none. Every voice message was being acknowledged and silently discarded.

Fix: install `mlx-whisper` (Apple Silicon optimised Whisper port), add `ffmpeg` for audio conversion, write the actual pipeline:

```bash
# Convert OGG to WAV
/opt/homebrew/bin/ffmpeg -i /tmp/voice_file.ogg /tmp/voice_transcript.wav -y -loglevel quiet

# Transcribe
mlx_whisper --model mlx-community/whisper-small-mlx \
  --output-format txt --output-dir /tmp \
  /tmp/voice_transcript.wav

# Read result
cat /tmp/voice_transcript.txt
```

Now voice messages actually get transcribed, classified, and stored in Notion.

### 7. Session memory directory didn't exist

`AGENTS.md` instructed Lyra to write daily session logs to `memory/YYYY-MM-DD.md`. The directory had never been created. Every session end, Lyra attempted a write that silently failed. Zero session context was accumulating.

Fix: `mkdir -p ~/.openclaw/workspace/memory/`. One command, permanently fixed.

### 8. Multi-user access control was honour-system only

I had a rule in SOUL.md: "Never share Akash's professional data with Abhigna's queries." This worked as long as the model followed the instruction — which it almost always did.

Almost.

The real fix was SuperMemory containers. Abhigna's messages route to the `household` container by configuration. The `work` container is simply never queried when Abhigna is the sender. The boundary is enforced by retrieval, not by trusting the model to refuse.

### 9. Credentials were sitting in plaintext

The Gmail App Password lived in `~/.config/himalaya/config.toml`. API keys lived in the LaunchAgent plist. All of it readable by any process running as my user. A backup to iCloud or Time Machine would copy them too.

The fix had four parts:

**Keychain for the App Password.** Himalaya supports `backend.auth.cmd` — a shell command that returns the password at runtime. Store the password in macOS Keychain once, then point himalaya at it:

```bash
security add-generic-password -a "ahkedia@gmail.com" -s "himalaya" -w "APP_PASSWORD"
# In config.toml: backend.auth.cmd = "security find-generic-password -a 'ahkedia@gmail.com' -s 'himalaya' -w"
```

The password never touches disk. Lyra never sees it — himalaya fetches it when needed and discards it. If it leaks, revoke it in Google and create a new one.

**chmod 600 on everything.** Restrict all credential files to owner-only: `~/.config/notion/api_key`, `~/.config/himalaya/config.toml`, the LaunchAgent plist, `auth-profiles.json`, `models.json`, device auth files. Other users and services on the Mac can't read them.

**Time Machine exclusions.** Run `tmutil addexclusion` on those paths so they never get backed up to external drives or cloud.

**SOUL rule.** Add to Lyra's hard boundaries: "NEVER read, display, or repeat contents of credential files. Never cat/grep config.toml or similar." The model is instructed never to expose them, even if asked.

The API keys in the LaunchAgent plist stay there — LaunchAgents don't natively read from Keychain, and a wrapper script adds complexity. But the plist is now chmod 600 and excluded from backups. The App Password was the highest-risk credential (full Gmail access); that one is fully Keychain-protected.

---

## The Memory Architecture

We started with SuperMemory ($19/month), which solved the decay problem. But after 6 weeks at 40+ daily uses, the model economics didn't work — $228/year for a personal tool with feature restrictions and cloud lock-in.

So we built a **hybrid SQLite system** instead. The final design has three layers:

**Layer 1: Operational database (SQLite local)**
Contacts, schedules, preferences. Query-based retrieval. Loaded once per session, no context bloat. ~100 tokens.

**Layer 2: Memory store (SQLite local)**
Brain dumps, ideas, decisions, everything you've told Lyra. Retrieved by keyword + tags, not semantic embeddings. On-demand, not forced. ~150 tokens average.

**Layer 3: Skill files (on-demand)**
Detailed instructions for specific tools (Notion API patterns, Reminders osascript, calendar writes). Only loaded when the tool is actually used. Zero tokens when not needed.

### The SQLite decision

SuperMemory would have cost:
- $19/month = $228/year
- Plus retrieval token costs at 40 queries/day
- Cloud-locked data, limited exports, slow API calls

SQLite hybrid costs:
- $0/month
- Local, instant retrieval
- Full data ownership
- One-time setup cost (~4,300 tokens = $0.05)
- Saves 650 tokens per session vs. SuperMemory

**Break-even:** 7 sessions. **ROI:** $5.70+/month.

For someone using an AI agent 40 times a day, this is an instant win. The downside: semantic embeddings would require extra work to add later (we'd use Anthropic's embedding API when needed). Currently, keyword search + tagging handles 95% of use cases.

This architecture means:
- Simple commands get ~2,200 tokens of context — fast and cheap
- Complex tasks retrieve exactly the context they need, on-demand
- No cloud dependencies, no API rate limits on memory retrieval, no storage costs
- Full data ownership and offline-first operation

---

## The Cron Architecture

Lyra runs 6 automated jobs without being asked:

| Job | Time | Model | What it does |
|-----|------|-------|---|
| morning-digest | 7am daily | Sonnet | RSS feeds + overdue follow-ups + competitor news |
| content-reminder | noon daily | Sonnet | Pulls from Content Ideas, drafts an X post |
| weekly-job-review | Sun 9am | Sonnet | Recruiter tracker analysis, priority actions |
| weekly-competitor-digest | Sun 6pm | Sonnet | Deep synthesis of competitor news |
| weekly-brain-brief | Sun 8pm | Sonnet | Patterns across Second Brain + all trackers |
| health-check | Mon 9am | Haiku | Checks all cron job statuses, alerts if anything failed |

The health-check is the meta-layer: Lyra monitors herself. If any job has failed consecutively, it sends a Telegram alert. Without this, a broken morning digest would silently stop working and I'd find out weeks later.

---

## What Actually Works Now

Six weeks in, this is what I use daily:

**Telegram → action, without friction:**
- "Add almond milk to shopping list" → Notion Shopping List updated, Abhigna gets a Telegram notification
- "Block Tuesday 3pm for strategy review" → Calendar.app updated, syncs to Google Calendar
- "Remind me to follow up with Northzone on Friday" → Apple Reminders, due Friday
- [voice note about a product idea] → transcribed, classified as Idea, saved to Second Brain

**Morning digest:**
Every morning at 7am, I get a structured briefing: top stories from FT, Sifted, The Decoder; which recruiter follow-ups are overdue; any competitor moves from the week.

**Content workflow:**
At noon, instead of a useless "time to post!" nudge, Lyra pulls the strongest unused idea from my Content Ideas Notion database and drafts an actual X post in my voice. I approve, refine, or skip.

**The Second Brain:**
Every voice note I speak — on a walk, between meetings, during a commute — gets transcribed, classified (Insight/Decision/Idea/Question/Pattern), tagged, and stored in Notion. The Sunday brain brief synthesises the week's captures and surfaces patterns I'd have missed.

---

## What's Next

A few things I haven't solved yet:

- **Apple Health sync** — the schema and databases are ready; the iOS Shortcuts pipeline to push data is still deferred
- **Tailscale** — so the Mac is reachable remotely, not just on local network
- **Abhigna's full workflow** — she can use Lyra now, but some of her workflows need dedicated skill files
- **Google Calendar event reads** — writes work; bidirectional sync (reading what's in the calendar) needs gcalcli or a Google API integration

---

## The Honest Assessment

This took longer to build than I expected. The OpenClaw documentation gaps, the Notion API version changes, the macOS daemon permission model, the session memory bugs — each took real debugging time.

But the output is worth it. This isn't a chatbot I visit. It's infrastructure I live inside. The cognitive load reduction is real and measurable. My morning digest replaces 20 minutes of tab-hopping. My voice captures replace a notes app I never revisited. My follow-up tracking actually happens.

The insight that unlocked the whole thing: an AI agent is only as good as its ability to persist context across time. The moment I stopped thinking about Lyra as a chatbot and started thinking about her as a persistent operator with memory — the architecture became obvious.

---

## Stack Summary

| Layer | Tool |
|---|---|
| Agent framework | OpenClaw |
| AI model | Claude Haiku 3.5 (default) + Sonnet 4.6 (synthesis) |
| Interface | Telegram bot |
| Primary database | Notion (10 databases) |
| Memory system | SQLite (local) + Python lyra_db manager |
| Transcription | mlx-whisper (local, Apple Silicon) |
| Email | himalaya CLI |
| RSS | blogwatcher CLI |
| Calendar | osascript → Calendar.app → Google Calendar |
| Reminders | osascript → Apple Reminders → iCloud |
| Hosting | Mac mini (LaunchAgent daemon, always-on) |

All open source except the Claude API and Telegram. **Total running cost: Claude API ($5-15/month depending on usage). Memory system is free (local SQLite).**

### Why we ditched SuperMemory

Initial plan: SuperMemory Pro ($19/month) for semantic memory across sessions.

Reality after 6 weeks at 40+ daily uses:
- $228/year for the subscription alone
- Cloud-locked data without direct exports
- API call latency on every memory retrieval (200-500ms)
- Limited multi-user access control
- Feature restrictions even on paid tier

New plan: SQLite hybrid (built ourselves, free):
- $0/month
- Instant, local retrieval
- Full data ownership
- Keyword + tag search handles 95% of needs
- Semantic embeddings can be added later if needed (via Anthropic's embedding API)
- Payback on setup cost: 7 sessions (~3 hours)
- Monthly savings: $5.70+ vs SuperMemory

For a personal AI assistant running 40+ times daily, local is better than cloud.

---

*The full setup guide, config templates, and all skill files are at [github.com/ahkedia/lyra-ai](https://github.com/ahkedia/lyra-ai). Fork it and make it yours.*
