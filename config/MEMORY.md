# Lyra Memory

## Notion
Read `references/notion.md` for schemas and IDs. Lyra Hub: `31778008-9100-806b-b935-dc1810971e87`
- Use `$NOTION_API_KEY` env var (already loaded from .env via systemd)
- All 13 databases are shared with OpenClaw-Lyra integration
- Reminders-Akash, Reminders-Shared, Recruiter Tracker: ALL accessible (confirmed March 21, 2026)

## Web Search
- Built-in `web_search` tool is DISABLED — do NOT use it
- Use Tavily API via curl commands — see `references/web_search.md`
- `$TAVILY_API_KEY` env var is available in all sessions

## Schedules
7am: morning digest | noon: content reminder | 9pm: daily activity log | Mon 9am: health check | Sun 9am: job review | Sun 6pm: competitor digest | Sun 8pm: brain brief

## Model Routing
- Default: MiniMax M2.5 (all crons + DMs)
- Fallback: Claude Haiku 4.5 (auto-escalation on MiniMax failure)
- Escalation: Claude Sonnet 4.6 (on-demand via chat command only)
- Anthropic spending limit hit March 20, 2026 — router v14 handles gracefully

## Operational Rules
- NEVER modify /root/.openclaw/openclaw.json — adding unknown keys crashes the gateway permanently. If you need env vars, they are already in /root/.openclaw/.env and loaded automatically.
- NEVER use the built-in `web_search` tool — use curl + Tavily
- NEVER add eval/test crons as OpenClaw crons — use system crontab
- Environment variables are loaded from `/root/.openclaw/.env` via systemd EnvironmentFile
- All env vars (NOTION_API_KEY, TAVILY_API_KEY, etc.) are available in ALL sessions including isolated cron jobs
- Self-edits auto-sync to GitHub within 5 minutes

## Persistent Fixes (DO NOT REVERT)
- [2026-03-21] Disabled built-in web_search tool (Brave not configured). Use Tavily curl instead.
- [2026-03-21] Removed stale "NOT ACCESSIBLE" warnings from notion.md for Reminders-Akash and Recruiter Tracker.
- [2026-03-21] Fixed notion.md API key pattern: use $NOTION_API_KEY env var, not cat ~/.config/notion/api_key.
- [2026-03-21] Removed invalid gateway.env key from openclaw.json (crashed gateway). Config sanitizer script now auto-fixes before restarts.
- [2026-03-21] Router v14 deployed: rate-limit-aware, MiniMax fallback when Anthropic unavailable.
- [2026-03-21] Systemd: RestartSec=30, StartLimitBurst=5, graceful shutdown wrapper.

## Session Log
[2026-03-21 — Major fixes applied: web search, Notion access, memory persistence, router v14]
