---
name: chief-of-staff
description: Chief of Staff workflows — morning prep, inbox triage, calendar sanity, canonical today focus, recruiter/outreach discipline. Use when Akash asks for EA mode, daily brief, or operations-style help.
metadata: {"clawdbot":{"emoji":"📋"}}
---

# Chief of Staff (Lyra)

Orchestration skill for **day-to-day operations**: triage, scheduling context, task focus, and outreach hygiene. This skill **does not replace** other skills — it **coordinates** them.

### At a glance (use vs not)
| Use this skill | Use something else |
|----------------|-------------------|
| Morning brief, EA mode, inbox/calendar **context**, recruiter hygiene, “what should I focus on” | Tier-0 reminders/lists/shopping → `crud/cli.py` + router rules |
| Cross-tool **orchestration** when Akash wants a prep pass | Abhigna requests → SOUL access matrix only |
| Pipeline / `tasks/current.md` / Notion alignment | Raw health metrics → `skills/health-coach/SKILL.md` |

## When to load this skill

- Akash asks for: morning brief, daily prep, "chief of staff", "EA mode", inbox triage, week plan, recruiter pipeline review
- A cron message says: `chief-of-staff` or references morning prep / daily operations (keep cron bodies short; full steps live here)

## When *not* to use this skill

- **Tier 0** reminder/list CRUD ("list my reminders", "add milk to shopping") → use `crud/cli.py` per `skills/model-router/SKILL.md` and `config/routing-rules.yaml`
- **Abhigna** requests → follow `SOUL.md` access rules only; do not surface Akash-only databases
- **Health logging** → `skills/health-coach/SKILL.md` only

## Canonical surfaces (no conflicts)

| Surface | Role |
|--------|------|
| **Notion** (`references/notion.md`) | System of record for reminders, recruiter tracker, projects |
| **`tasks/current.md`** | Human-editable **today focus** — promote 3–5 items; dedupe against Notion before acting |
| **`TOOLS.md`** | Quick index of tools and constraints — read if unsure what exists |

Repo copies live under `lyra-ai/workspace/`; server copies under `~/.openclaw/workspace/`. Deploy syncs via `scripts/deploy-lyra.sh`.

## Operating rules (non-negotiable)

### Email (himalaya / Gmail MCP)

- Prefer **message-level** understanding: do not assume one thread = one decision; scan recent messages that match the task
- **Draft first**; never send without explicit **"YES send"** (see `SOUL.md`)

### Calendar (`skills/google-calendar/SKILL.md`, `scripts/gcal-helper.js`)

- Before proposing or confirming a time: consider **all relevant calendars** (personal, shared, work) per SOUL routing
- Surface conflicts explicitly; do not assume "free" on one calendar means free overall

### Recruiter / outreach (Notion Recruiter Tracker)

- **Update the tracker** (status, last touch, next step) **before** treating a reply or thread as "handled"
- Do not mark outreach "done" in chat without a Notion update (or explicit Akash instruction to skip)

### Tasks / Today

- When promoting items into **## Today** in `tasks/current.md`: **remove duplicates** already captured as Notion reminders if they are the same work
- Cap **## Today** at ~5 items; move overflow to **## Backlog** or Notion

## Workflow: morning prep (Akash, full access)

1. Read `tasks/current.md` and top open items in Notion reminders (Akash DBs only)
2. Calendar snapshot: next 48h across relevant calendars — conflicts, prep needed, travel
3. Email: high-signal subject/sender scan (no send) — flag urgent, FYI, needs reply
4. Recruiter Tracker: rows needing follow-up or stale (>7d no touch)
5. Output: **max 3 priorities**, then **secondary list** (bullet, short)

## Workflow: daily task management

- **Capture** → Notion appropriate DB (reminders, tasks, etc.) per `references/notion.md`
- **Prioritize** → sync with `tasks/current.md` ## Today
- **Close loop** → mark done in Notion + trim `tasks/current.md`

## Workflow: business development / networking

- One place for pipeline state: **Recruiter Tracker** (and other BD DBs if listed in notion.md)
- Every outbound or reply: log **date + next step** in Notion when applicable
- For deep drafting (emails, strategy): escalate model per `skills/model-router/SKILL.md` / `SOUL.md` (Sonnet cron if needed)

## Cron messages (keep short)

Good: `Run chief-of-staff morning prep for Akash per skills/chief-of-staff/SKILL.md`

Bad: Pasting the entire morning checklist into `--message` (costly, brittle)

## Related skills

- `skills/notion/SKILL.md` — API patterns
- `skills/google-calendar/SKILL.md` — calendar CLI
- `skills/himalaya/SKILL.md` or email docs — mail
- `skills/model-router/SKILL.md` — tiering and Sonnet escalation
- `skills/self-edit/SKILL.md` — editing MEMORY, SOUL, skills (not openclaw.json)

## Error handling

- Notion unreachable → report, suggest retry; do not fabricate task state
- Email/calendar tool errors → summarize error, propose fallback (e.g. narrower query)
