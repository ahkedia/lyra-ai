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


## Cron Schedule (updated 2026-03-29)
Infrastructure crons:
- deploy-lyra.sh: Every 30 minutes (was 5 min) — syncs GitHub changes and Lyra self-edits
- lyra-health-check.sh: Every 15 minutes — gateway health, memory, disk, agent cleanup
- lyra-backup.sh: Daily 3am — workspace + config backup (7-day retention)
- eval-precheck: Daily 3:50am — verify gateway before 4am eval run
- eval-runner: Daily 4am — routing eval daily, full evals on odd days only
- openclaw-version-check.sh: Every Sunday 9am UTC — checks npm for new version, auto-upgrades with rollback, then triggers Sonnet capability analysis sent to Telegram

Log rotation: Enabled for all /tmp/lyra-*.log and /var/log/lyra-evals.log (daily, 7-day retention, compressed)

Token usage estimate: ~45,900/day (mostly from user-facing digests/briefs, not infrastructure)

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

## Notion API Access — Critical
- NOTION_API_KEY in .env grants full access to ALL databases (Second Brain, Recruiter Tracker, Content Ideas, Relocation Tasks, etc.)
- **DO NOT ask Akash to "share databases" in Notion UI** — that is for human collaborators, not API access
- API key access is INDEPENDENT of Notion sharing settings — you have access via API even if databases aren't "shared" in the UI
- All database IDs are documented in references/notion.md — use them directly
- If a Notion query fails: check error message. DO NOT assume it's a sharing issue. Common causes: wrong database_id, malformed query, API rate limit

## Persistent Fixes (DO NOT REVERT)
- [2026-03-21] Disabled built-in web_search tool (Brave not configured). Use Tavily curl instead.
- [2026-03-21] Fixed notion.md API key pattern: use $NOTION_API_KEY env var, not cat ~/.config/notion/api_key.
- [2026-03-21] Removed invalid gateway.env key from openclaw.json (crashed gateway). Config sanitizer script now auto-fixes before restarts.
- [2026-03-21] Router v14 deployed: rate-limit-aware, MiniMax fallback when Anthropic unavailable.
- [2026-03-21] Systemd: RestartSec=30, StartLimitBurst=5, graceful shutdown wrapper.

## Session Log
[2026-03-21 — Major fixes applied: web search, Notion access, memory persistence, router v14]

## Eval Pipeline Config (updated 2026-03-22)
- Anthropic API credits are available — use Anthropic (Haiku/Sonnet) for LLM judge evaluations
- The ANTHROPIC_API_KEY in .env is active and funded
- All eval runs should use LLM judge validators (requires Anthropic API) going forward
- DO NOT skip LLM judge due to missing credits — credits are maintained
