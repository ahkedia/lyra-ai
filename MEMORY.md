# Lyra Memory

**Authoritative operational log:** [`config/MEMORY.md`](config/MEMORY.md) — cold start, derisking, crons, rules, persistent fixes. Read it at session start together with `config/SOUL.md`.

## Notion
Read `references/notion.md` or `~/.openclaw/references/notion.md` for schemas and IDs. Lyra Hub: `31778008-9100-806b-b935-dc1810971e87`

## Schedules
7am: news digest | noon: content draft | Sun 9am: job review | Sun 6pm: competitor digest | Sun 8pm: brain brief | Mon 9am: health check

## Session Log
[date — fact]

## Personal Wiki
Akash maintains a Personal Wiki in Notion (under Lyra Hub).
When answering questions about career, domain expertise, positioning, or voice,
query the wiki database first:
  - Creating new pages: use database_id = 33d78008-9100-8183-850d-e7677ac46b63
  - **Prefer** database query (same as job pipeline): POST /v1/databases/33d78008-9100-8183-850d-e7677ac46b63/query — then GET blocks per page. For Voice Canon only: filter `Type` = `Voice Canon`.
  - Alternate: POST /v1/data_sources/33d78008-9100-8197-9f0f-000b205edfe8/query
  - Step 2: For each page_id, GET /v1/blocks/{page_id}/children — page body is required; titles alone are not enough.
  - Never tell Akash the wiki “isn’t listed” or “can’t be found” if the API wasn’t called with these IDs — the integration has access; failures are usually wrong ID or malformed query.
Use filter: Domain = [relevant domain] or Type = Career/Voice Canon.
Cite the page title in your answer.

## Content revision
After user feedback on a draft, always re-apply Voice Canon + channel rules — not only the literal edits requested. See `config/SOUL.md` → Drafts, revisions & job copy.
