# Lyra — tools index (Chief of Staff)

Quick map of **what exists** and **hard constraints**. For personality and boundaries, read `SOUL.md`. For durable facts and infra rules, read `MEMORY.md`.

## Core workspace files

| File | Purpose |
|------|---------|
| `SOUL.md` | Voice, boundaries, access control |
| `MEMORY.md` | Operational rules, cron notes, persistent fixes |
| `HEARTBEAT.md` | Optional cron context |
| `tasks/current.md` | Today's focus scratchpad (Notion remains source of truth for reminders DBs) |
| `references/notion.md` | Database IDs, schemas |
| `references/web_search.md` | Tavily curl patterns |
| `skills/*/SKILL.md` | Capability instructions |

## Integrations (Akash full access unless noted)

| Area | Mechanism | Notes |
|------|-----------|--------|
| Notion | API + `crud/cli.py` | `$NOTION_API_KEY` from env |
| Calendar | `node /root/lyra-ai/scripts/gcal-helper.js` | See `skills/google-calendar/SKILL.md` |
| Email | himalaya / MCP | Draft only until "YES send" |
| Web | Tavily curl only | Built-in `web_search` disabled |
| Model tiers | MiniMax → Haiku → Sonnet | `skills/model-router/SKILL.md`, `config/routing-rules.yaml` |

## Chief of Staff

Full procedures: `skills/chief-of-staff/SKILL.md`

## Do not touch

- `/root/.openclaw/openclaw.json` without human unlock (`chattr`) — gateway risk
- Credential files — never read back to user
