# Lyra Memory

**Authoritative operational log:** [`config/MEMORY.md`](config/MEMORY.md) — cold start, derisking, crons, rules, persistent fixes. Read it at session start together with `config/SOUL.md`.

## Glossary — Two distinct knowledge stores (NEVER conflate)

Akash uses two Notion entities that are easy to confuse. They are **separate databases with separate purposes**. Never use one name for the other.

| | **Second Brain** | **Personal Wiki** (aka Personal Knowledge Base) |
|---|---|---|
| **Purpose** | Low-friction thought/idea/decision capture from Akash via Lyra. Lyra appends on every "remember this", "save this thought", voice dump. Weekly synthesis cron reviews it. | Curated reference corpus: CV, Voice Canon, career narratives, domain expertise (AI/ML, Payments, etc.), interview stories, Lenny synthesis. Akash curates it manually; Lyra reads it to ground drafts. |
| **Write direction** | Lyra writes, Akash reads | Akash writes, Lyra reads |
| **Notion database_id** | `e4027aaf-d2ff-49e1-babf-7487725e2ef4` | `33d78008-9100-8183-850d-e7677ac46b63` |
| **Notion data_source_id** | `f1ce4e0f-9e0d-43da-87f8-94dae2732962` | `33d78008-9100-8197-9f0f-000b205edfe8` |
| **Canonical doc** | `docs/5-second-brain.md` | `/Users/akashkedia/AI/projects/personal-kb-raw/WIKI-NOTION.md` |
| **When to query** | "What did I think about X last week?", weekly brain-brief cron | Voice Canon for drafts, CV for applications, career narratives for interviews, positioning for outreach |

**Rules:**
- When drafting content/outreach/applications → query **Personal Wiki** (Voice Canon, career narratives). Never "second brain" for voice/positioning.
- When capturing raw thoughts → write to **Second Brain**. Never to the wiki.
- If a user message is ambiguous ("check my knowledge base"), default to Personal Wiki and state which one you're using.
- Never say the wiki "isn't listed" or "can't be found" without actually querying `33d78008-9100-8183-850d-e7677ac46b63` first.

## Notion
Read `references/notion.md` or `~/.openclaw/references/notion.md` for schemas and IDs. Lyra Hub: `31778008-9100-806b-b935-dc1810971e87`

## Schedules
7am: news digest | noon: content draft | Sun 9am: job review | Sun 6pm: competitor digest | Sun 8pm: brain brief | Mon 9am: health check

## Session Log
[date — fact]

## Personal Wiki — query recipe

(IDs are in the glossary above. Never confuse this with Second Brain.)

When answering career / domain / positioning / voice questions:
  - **Primary:** `POST /v1/databases/33d78008-9100-8183-850d-e7677ac46b63/query` (same path as job pipeline). For Voice Canon only: filter `Type` = `Voice Canon`. Filter examples: `Domain = [relevant domain]` or `Type = Career | Voice Canon`.
  - **Alternate:** `POST /v1/data_sources/33d78008-9100-8197-9f0f-000b205edfe8/query`.
  - **Step 2:** For each page_id, `GET /v1/blocks/{page_id}/children` — page body is required; titles alone are not enough.
  - **Creating new pages:** use `database_id = 33d78008-9100-8183-850d-e7677ac46b63`.
  - Cite the page title in your answer.

## Content revision
After user feedback on a draft, always re-apply Voice Canon + channel rules — not only the literal edits requested. See `config/SOUL.md` → Drafts, revisions & job copy.
