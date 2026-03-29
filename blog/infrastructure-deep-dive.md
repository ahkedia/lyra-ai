# Turning a Personal AI Agent into Production Infrastructure


*Technical companion to: [I Built My Own Chief of Staff](./building-lyra-v2.md) — engineering deep-dive for builders who want to go further.*

---

*From "it works on my server" to "this is how you'd build it if it mattered."*

---

I built Lyra as a personal AI agent. It started as a way to stop pasting context into ChatGPT every morning. But somewhere between the health checks, the model routing, and the auto-recovery playbooks, it became something else: actual infrastructure.

This post documents what I added in the past week to make Lyra production-grade — the kind of system you'd be comfortable talking about in an open-source forum without getting embarrassed by the follow-up questions.

---

## The Four Layers

### Layer 1: Infrastructure Hardening

**Problem:** Scripts logging to stdout. Gateway crashing with stale PIDs. Secrets scattered across files with no rotation path.

**What I built:**

**Structured logging** (`scripts/lyra-logger.sh`) — Every Lyra script now sources a single logging utility. All logs are JSON-structured with timestamps, levels, and component tags. They go to separate files under `/var/log/lyra/` (gateway, evals, sync, health). A `lyra-logs` system command lets you tail, filter, and search across all logs in real-time.

```json
{"ts":"2026-03-19T04:00:01Z","level":"info","component":"eval","msg":"Routing eval: 46/46 passed","meta":{"accuracy":"100%"}}
```

**Graceful shutdown wrapper** (`scripts/openclaw-wrapper.sh`) — The OpenClaw gateway used to leave stale PIDs on port 18789 when it crashed, causing the next restart to fail. The wrapper traps SIGTERM/SIGINT, sends a graceful SIGTERM to the child process, waits 10 seconds, then SIGKILL if needed, then cleans the port. No more 204-restart streaks.

**Secret rotation** (`scripts/rotate-secret.sh`) — One command rotates a secret in `.env`, updates the GitHub Actions secret, and restarts the gateway. Backs up the old `.env` first. Logs the rotation event without exposing the value.

**Automatic security updates** (`scripts/setup-auto-updates.sh`) — Configures `unattended-upgrades` for security-only patches. Auto-reboots at 5 AM UTC if a kernel update requires it. The existing health check catches the brief gateway downtime and alerts via Telegram.

### Layer 2: Observability & Reliability

**Problem:** I had a 15-minute health check that sent Telegram alerts. That's it. No dashboard, no cost visibility, no automated recovery.

**What I built:**

**Status dashboard** (`scripts/lyra-status.sh`) — Generates a self-contained dark-theme HTML page every 5 minutes. Shows: overall health (green/yellow/red), component status (gateway, Postgres, crons), last 24 hours (messages processed, routing distribution), system resources (disk, memory, uptime), and cost estimate. Served via Caddy at `/status`.

**Cost tracker** (`scripts/cost-tracker.sh`) — Reads routing decision logs, calculates daily cost by model tier, tracks 7-day rolling averages, and sends a daily summary to Telegram. Turns out I spend about $0.03/day on an AI that handles 40+ tasks.

**Auto-recovery playbook** (`scripts/lyra-recovery.sh`) — Handles 5 failure modes automatically:
1. Gateway crash → kill stale PIDs, restart systemd, verify health
2. Postgres crash → restart container, verify pg_isready
3. Disk > 85% → clean old logs, docker prune, alert
4. Memory > 90% → restart gateway (it leaks memory over time), alert
5. Network unreachable → wait 60s, retry, fallback alert

Run with `--check` to diagnose, `--fix` to auto-recover.

### Layer 3: Google Calendar Integration

**Problem:** When Lyra moved from my Mac to a cloud VPS, it lost calendar access. `osascript` doesn't work on Linux.

**What I built:**

A full Google Calendar integration using the Calendar API v3:
- **OAuth2 token manager** (`scripts/gcal-auth.js`) — First run walks you through the OAuth flow and saves the refresh token. Subsequent calls auto-refresh the access token.
- **CLI helper** (`scripts/gcal-helper.js`) — List events, create events, check free/busy slots, update, delete. All operations output clean JSON for agent parsing.
- **Smart calendar routing** — Personal events go to the primary calendar. Joint events with my wife go to the shared calendar. Work events go to the work calendar. The agent figures this out from context.
- **Routing rules** — "What's on my calendar today?" is a deterministic read — it hits Tier 0 (Python CRUD, $0/call, ~100ms). "What do I have free this week?" routes to MiniMax M2.7 (fast reasoning, cheap). "Schedule a meeting at 3pm with the team" routes to Claude Haiku 4.5 (needs multi-step reasoning for conflict checks and calendar selection).

### Layer 4: Open-Source Readiness

**Problem:** The repo was functional but not forkable. Six different deployment docs. No CI. No contributing guide. No way for someone to build their own agent from this.

**What I built:**

**CI pipeline** (`.github/workflows/ci.yml`) — Every push and PR runs: YAML config validation, SOUL.md token count check (< 700 words), skill frontmatter validation (< 30 words), hardcoded secret scanning, and all 23 router tests. All GitHub Actions pinned to SHA hashes.

**Contributing guide** (`CONTRIBUTING.md`) — How to add skills (step-by-step with template), how to add eval cases, how to run tests, PR process, code conventions.

**Fork template** (`templates/minimal-agent/`) — A stripped-down version of Lyra that anyone can deploy in 30 minutes. Includes: 4-tier routing config (Tier 0 Python CRUD bypass + MiniMax M2.7 + Claude Haiku 4.5 + Claude Sonnet 4.6), one example skill, 5 starter eval cases, and a generic SOUL.md without my personal details.

**Skill template** (`skills/_template/SKILL.md`) — Copy-paste template for creating new skills. Frontmatter, operations, decision logic, examples, error handling.

---

## What I Learned

**1. Logging is not optional.** Before structured logging, debugging a 4 AM eval failure meant SSH-ing in and grepping through stdout dumps. Now: `lyra-logs -c eval -l error -n 10`. Problem found in seconds.

**2. Recovery scripts pay for themselves.** The gateway crashed 3 times in two weeks. Each time, the health check detected it within 15 minutes and restarted it. But the recovery script also cleans up stale PIDs, which the health check didn't do — leading to 204 consecutive restart failures one time.

**3. Cost tracking changes behavior.** Before tracking, I assumed Claude Sonnet was expensive. Then I added Tier 0 — a Python CRUD layer that handles deterministic operations (list reminders, mark done, add to shopping list) at $0/call in ~100ms. Of the remaining LLM calls, 87% hit MiniMax M2.7 at $0.0001 each. The entire AI layer costs about $0.03/day. Knowing this made me less anxious about adding features — and it came from the same discipline that made the fallback design rigorous: measure first, then decide.

**4. Fork templates are harder than they look.** The main challenge is separating "my personal context" from "the framework." SOUL.md has my wife's name, my Telegram IDs, my Notion databases. The template needs to be generic but still functional. I solved this by creating a separate `templates/minimal-agent/` with placeholder configs.

---

## The Numbers

| Metric | Value |
|--------|-------|
| Scripts added | 10 |
| Total infrastructure code | ~3,500 lines |
| Router test coverage | 23 built-in + 46 ground-truth = 69 tests |
| Eval injection tests | 8 (up from 2) |
| CI checks per push | 6 |
| Failure modes auto-recovered | 5 |
| Time to deploy a fork | ~30 minutes |
| Daily API cost | ~$0.03 |
| Monthly total cost | ~€18 |

---

## The Outage That Validated Everything (March 21, 2026)

Three days after building all of this, Lyra went completely dark. Gateway unreachable. No responses. My wife texted me asking why the shopping list wasn't updating.

Root cause: Anthropic hit the spending limit on my account. Blocked until April 1. The router plugin (v13) had no fallback — it forced certain messages to Claude Haiku with no escape hatch. Haiku rejected every request. The error cascaded. The watchdog killed the gateway. Crash loop every 2 minutes.

The fix was router v14: rate-limit-aware routing. It starts with Anthropic disabled, intercepts stderr for rate limit error strings, and falls back everything to MiniMax M2.7 when Anthropic is unavailable. Auto re-checks every 30 minutes. Five minutes from diagnosis to fix deployed.

The irony: every tool I'd just built — structured logging, auto-recovery, the graceful shutdown wrapper — would have caught this faster if they'd been deployed 24 hours earlier. The outage was the best validation that the infrastructure hardening was worth doing.

**Lesson:** Your AI assistant is only as good as its worst failure mode. Every feature added after the outage was about making failures graceful, not preventing them.

---

## What's Next

- **Restaurant reservations** — Integrate with OpenTable/Resy APIs as a new skill
- **Video generation** — Connect to Runway or Pika for content creation
- **WhatsApp channel** — Alternative to Telegram for users who prefer it
- **Webhook triggers** — Let external services trigger Lyra actions
- **Multi-agent mode** — Specialist agents for email, calendar, content that coordinate through a central router

The repo is open source. Fork it, build on it, break it.

→ [github.com/ahkedia/lyra-ai](https://github.com/ahkedia/lyra-ai)

---

*Akash Kedia · Product leader in fintech · Building in public*
