# Meet Lyra: The AI That Runs My Life (and My Wife's)

*I didn't want a chatbot. I wanted a second brain that actually works.*

---

For two years, I pasted the same giant context file into ChatGPT at the start of every conversation. Here's who I am. Here's what I do. Here's what I'm working on. Every session, from scratch. Every thread, forgotten.

I lead product at a European neobank. I manage a hundred people. I have a wife, a household that needs coordinating, a content strategy across three platforms, and a head that's full. Genuinely, constantly full.

And I kept thinking: isn't this exactly what AI is supposed to fix?

Not the "write me a poem" kind of AI. The "remember that I told you last Tuesday that the electrician is coming Thursday, and tell my wife" kind. The kind that shows up in my messaging app at 7am with a news digest I didn't have to ask for. The kind that knows the difference between what my wife should see and what she shouldn't.

I wanted an operator. Not a chatbot.

So I built one. Her name is Lyra.

---

## What does Lyra actually do?

Let me show you instead of telling you.

**Monday, 7:03am.** I wake up to a Telegram message:

> *"Morning, Akash. 3 unread emails flagged. EU news: ECB digital euro pilot expands to 5 new countries. AI: Anthropic launches tool-use improvements. 2 tasks due today: renew health insurance, reply to content collaboration request. Yesterday's usage: 28 API calls, 91% MiniMax, 9% Haiku, 0 errors."*

I didn't ask for this. It just fires. Every day.

**Tuesday, 2pm.** My wife Abhigna messages Lyra on the same Telegram bot:

> *"Remind Akash to book the dentist by Friday"*

Lyra adds it to our shared Notion reminders database, then pings me on Telegram:

> *"Abhigna asked me to tell you: book the dentist by Friday."*

When I reply "Done, booked for Saturday 10am," Lyra marks it complete and tells Abhigna:

> *"Akash completed: book the dentist. He said: booked for Saturday 10am."*

**Wednesday evening.** I'm walking home and have an idea about a blog post. I send a voice note to Lyra on Telegram. She transcribes it, classifies it as an "Idea," tags it with "content," and saves it to my Second Brain database in Notion. On Sunday evening, my weekly brain brief surfaces it alongside the three other ideas I captured that week, and asks: "Pattern: you've had four content ideas about personal AI this week. Worth a series?"

**Thursday.** Abhigna asks: "What supplements am I taking again?" Lyra pulls from the Health & Meds database — the one Abhigna has access to — and replies in 3 seconds. She doesn't see my competitor analysis, my content pipeline, or my strategy notes. She doesn't even know they exist.

This is what I mean by operator, not chatbot. Lyra doesn't wait for me to visit an app. She lives in my messaging. She watches for things. She coordinates between two people. She fires on schedule. She remembers.

---

## The "new hire" mental model

Here's how I think about it: Lyra is a new hire.

When you hire someone, you don't hand them the keys to everything on day one. You give them a desk, a job description, access to what they need, and clear boundaries around what they shouldn't touch. You tell them your communication style. You tell them when to escalate.

That's exactly what I did.

**The desk** is a €6/month Hetzner VPS in Germany. Always on. No dependency on my laptop being open.

**The job description** is a file called `SOUL.md` — loaded on every conversation. It says: "I am Lyra, operator-mode AI for Akash and wife Abhigna. I act, I don't just advise." It defines her communication style (concise, direct, strong verbs), her hard boundaries (never send emails without explicit approval, never share my professional data with Abhigna), and her escalation rules.

**The access levels** are explicit. Akash: full access to all 13 databases. Abhigna: household databases only — health, meals, trips, shopping, shared reminders. The boundary isn't a suggestion in a prompt. It's a rule that the agent follows because the architecture enforces it.

**The escalation policy** is: handle it yourself unless it needs real judgement. Lyra's default model is MiniMax M2.5 — fast, cheap, handles 90% of requests. When she detects something that needs synthesis or nuance (competitor analysis, email drafting, strategic thinking), she fires a one-shot task on Claude Sonnet. She doesn't try and fail first. She routes correctly from the start.

---

## The product decisions that actually mattered

Building Lyra wasn't mostly a technical challenge. It was a series of product decisions. Here are the ones that shaped everything.

### "Where do I already spend my time?"

I chose Telegram as the interface because it's where I already am. Not Slack (work tool). Not iMessage (no bot API). Not a custom web app (another tab to check). Telegram works on every device, supports voice messages natively, costs nothing, and has a simple bot API. The best interface is the one you're already using.

### "What's the source of truth?"

Notion. Not the AI. Every action Lyra takes that creates or changes data writes to a Notion database. If Lyra breaks, the data survives. If I swap frameworks, the data survives. If Abhigna wants to check something without talking to Lyra, she opens Notion. The design principle: **Lyra is the interface, Notion is the database.**

This was probably the most important decision. It means I'm never locked in to the AI layer. Notion is the cockpit; Lyra is the pilot.

### "How much should it cost?"

Under €20/month. That was the constraint.

The breakthrough was model routing. MiniMax M2.5 costs a fraction of Claude and handles simple tasks (add a reminder, check the weather, query a database) perfectly well. Claude only runs when it's actually needed — synthesis, analysis, drafting. The result: 87% of requests go through MiniMax. Monthly API cost sits around €8–12.

The VPS is €6. Telegram is free. Notion is free for personal use. Total: roughly €18/month for a 24/7 personal AI that manages my household and professional life.

### "What happens when things break?"

This is the question most AI projects skip. I didn't.

Lyra has a three-tier fallback: MiniMax fails → automatic retry → escalate to Claude Haiku → if that fails too, tell the user honestly. She never hallucinates success. If a Notion write fails, she says "Notion is unreachable. Here's what I would have done. I'll retry." Not "Done. ✓" when nothing happened.

Every 15 minutes, a health check runs. Gateway down? Telegram alert + automatic restart. Cron job failed? Alert within 15 minutes, not next Monday. Disk full? Alert. Low memory? Alert. Postgres down? Restart it.

Daily backups at 3am. Seven-day retention. Workspace, config, database dump. If the server catches fire, I can redeploy in 30 minutes.

I treat this like production infrastructure, because it is. My wife depends on it for reminders. I depend on it for my morning briefing. When it's down, we notice.

### "Should my wife have her own bot?"

No. One bot, two access levels.

When Abhigna messages Lyra, the agent knows it's her by her Telegram ID. It adjusts what databases are visible, what tools are available, and how it communicates. She gets a friendly onboarding ("Hi Abhigna! I can help with reminders, meals, health, trips, and shopping list"). She gets disambiguation when her message is unclear ("Did you want me to: A) add a reminder, B) update shopping list, C) something else?").

She doesn't need to know about model routing or Notion schemas. She just texts. It works.

### "Can Lyra change herself?"

Yes. And this is my favourite part.

Lyra has a self-edit skill. She can modify her own personality file, her memory, her skills, and her scheduled jobs — all through a Telegram chat. "Lyra, add a new rule: never send emails on weekends." Done. The change writes to the server, syncs to GitHub within 5 minutes, and takes effect immediately.

Every self-edit is a git commit. The audit trail is the commit history. If something breaks, `git revert` fixes it.

---

## The architecture

Here's what's actually running:

![Lyra Architecture](https://s3-alpha.figma.com/thumbnails/c1a2aa42-30cf-4606-9358-ccc3cb7399a5?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAQ4GOSFWCVLWKB6UZ%2F20260315%2Fus-west-2%2Fs3%2Faws4_request&X-Amz-Date=20260315T200352Z&X-Amz-Expires=604800&X-Amz-SignedHeaders=host&X-Amz-Signature=e1c67b279b9d395fa9108761c2dcbb103b857e25d3bfda2e9ff48917c055239a)

*[Open in FigJam](https://www.figma.com/online-whiteboard/create-diagram/8fde2d63-0dbe-47b7-9f10-76e1464a25ff?utm_source=claude&utm_content=edit_in_figjam)*

**The flow:**

Two people message a Telegram bot. The bot connects to an OpenClaw gateway running 24/7 on a Hetzner VPS. The gateway routes to MiniMax M2.5 for most tasks, with Claude Haiku as automatic fallback and Sonnet for on-demand escalation. It reads and writes 13 Notion databases. Seven cron jobs fire on schedule. Integrations include Gmail (read + send), RSS feeds, web search, and weather. A resilience layer handles health monitoring, backups, and bidirectional GitHub sync.

| Layer | What | Why this one |
|-------|------|-------------|
| Framework | OpenClaw | Handles session memory, tool routing, cron, skills. Months of work I didn't have to do. |
| Default model | MiniMax M2.5 | Fast, cheap, handles 90% of tasks. Keeps monthly cost under €10. |
| Fallback | Claude Haiku 4.5 | Automatic failover. Never leaves the user hanging. |
| Escalation | Claude Sonnet 4.6 | Synthesis, strategy, complex drafting. On-demand only. |
| Interface | Telegram | Where I already am. Free. Works everywhere. Voice messages. |
| Database | Notion (13 DBs) | Source of truth. Survives if AI layer changes. Shareable. |
| Email | himalaya CLI | Full Gmail access. Read, search, reply, send (with approval). |
| Hosting | Hetzner VPS | €6/mo. Always on. No laptop dependency. |
| Persistence | PostgreSQL | Session state survives restarts. |
| Monitoring | Custom scripts | 15-min health checks, cron failure alerts, Telegram notifications. |
| Backup | Daily + 7-day | Workspace, config, DB dump. Recoverable in 30 min. |
| Sync | GitHub (bidirectional) | Self-edits push to repo. Remote changes pull to server. Every 5 min. |

---

## The migration: Mac to Cloud

Lyra started on my Mac. A LaunchAgent daemon running OpenClaw, using `osascript` for Apple Reminders and Calendar, `mlx-whisper` for voice transcription, and my Mac's always-on power for reliability.

It worked. Until I wanted to close my laptop.

The migration to Hetzner meant rethinking every Mac-specific integration. Apple Reminders via osascript? Replaced with Notion databases plus an IFTTT bridge to iPhones. Calendar via AppleScript? Replaced with Notion event tracking. Voice transcription via mlx-whisper? Still pending (OpenAI Whisper API is the plan). Email via macOS Keychain? Replaced with Gmail App Password.

The hardest part wasn't the technical migration. It was ensuring my wife didn't notice. The reminders still had to land on her iPhone. The shopping list still had to update. The cross-user messaging still had to work. From her perspective, nothing changed. From mine, the entire infrastructure underneath shifted.

---

## What I got wrong

### The AI will hallucinate confirmations

My first voice capture pipeline existed only as an instruction in SOUL.md: "transcribe → classify → save to Second Brain." When I sent a voice note, Lyra would reply: "Captured → Second Brain ✓."

She was lying. She had no transcription capability. She just said what sounded right.

The fix was building the actual pipeline — audio processing, transcription model, classification logic, Notion write. Never trust an AI to admit it can't do something. Build the guardrails so it doesn't have to.

### Prompt-based access control isn't access control

"Never share Akash's professional data with Abhigna" worked 99% of the time. The 1% is what matters. The fix was making the boundary structural: Abhigna's queries physically cannot retrieve professional databases because the retrieval path doesn't include them. Don't ask the model to refuse. Make it impossible to access.

### Loading 11,000 tokens per "what's the weather?" is insane

My early setup loaded five verbose markdown files on every single message. The weather query and the complex strategy request both consumed the same massive context. I hit API rate limits within hours.

The fix was surgical compression. From 11,000 tokens to under 2,000. An 83% reduction. Skills load on demand, not on every turn. Context is relevant, not exhaustive.

### The daemon can't read your shell

macOS daemons don't inherit `~/.zshrc`. Every API key I'd added to my shell profile was invisible to the LaunchAgent. Lyra ran for a week without Tavily, silently skipping every morning digest's web search, before I noticed.

Environment variables go in `.env`, not in your shell. Always.

---

## The honest numbers

- **Uptime since migration:** 99.7% (one config crash loop, auto-recovered)
- **Daily API calls:** ~30–50 (mostly MiniMax)
- **Monthly cost:** ~€18 (VPS + APIs)
- **Notion databases:** 13 (professional + household + reminders)
- **Cron jobs:** 7 (daily + weekly)
- **Time saved:** ~30 min/day (morning digest + voice capture + reminder coordination)
- **Wife adoption:** She uses it daily for reminders and shopping list. That's the real metric.

---

## Would I recommend building this?

If you have the patience, absolutely. But be honest about what you're signing up for.

This isn't a weekend project. The OpenClaw framework saves you months, but the integration work — Notion schemas, email config, multi-user access, cron tuning, monitoring, backups — takes real time. Each integration is simple. The compound complexity of all of them working together is not.

The payoff is real, though. I have an AI that knows my life context, manages my household with my wife, briefs me every morning, captures my ideas without me opening an app, and monitors itself when things break. It costs less than a Netflix subscription.

The insight that unlocked everything: **stop thinking about AI as a chat interface. Start thinking about it as infrastructure.** Infrastructure runs in the background. Infrastructure has monitoring and backups. Infrastructure serves multiple users. Infrastructure doesn't forget.

Lyra is infrastructure. And she's running right now, waiting for my 7am digest tomorrow.

---

*The full setup guide, config templates, and all skill files are at [github.com/ahkedia/lyra-ai](https://github.com/ahkedia/lyra-ai). Fork it and make it yours.*
