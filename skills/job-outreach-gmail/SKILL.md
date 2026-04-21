# Job / outreach → Gmail draft (Personal Wiki)

## When this applies

Akash asks for an **outreach message**, **cover letter**, or **Gmail draft** tied to a **job**, a **named contact**, or **former colleague** context. The Tier-0 pipeline pulls **Personal Wiki** (Voice Canon + career pages) and writes **Gmail drafts** via `himalaya` — it does **not** rely on the chat model to “find” the wiki by name.

## Tier-0 triggers (non-exhaustive)

Phrases that should route to `python3 /root/lyra-ai/crud/cli.py parse "<msg>"` / `job_application.py`:

- Apply / job link / LinkedIn jobs URL / cover letter
- `draft … outreach to|for …`
- `draft|write|creating … message to|for [Name]`
- `outreach … to|for [Name]`
- `message to|for [Name]` (capitalized name works best)
- `gmail draft`
- `help me with … message` (outreach / job context)

**Phase B** (after clarification): replies like `1`, `2`, `3`, `both`, `outreach only`, `cover only`, `message only`, optionally with a short tone hint.

## Fixed Notion IDs

Do not search Notion by the string “Personal Wiki” in chat. Use IDs from `MEMORY.md` / `notion/notion.md`:

- `database_id` for Personal Wiki
- Query + blocks; Voice Canon = `Type` = Voice Canon

## Anti-patterns

- Do **not** say “I don’t see a Personal Wiki database” or “listing databases in Lyra Hub” — that is incorrect; wiki access is **ID-based**.
- Do **not** re-ask metrics or facts already in the **current Telegram thread**.

## Code

- `crud/job_application.py` — `_JOB_TRIGGER_RE`, `handle_trigger`, `execute_pipeline`
- `crud/cli.py` — `parse` runs job pipeline after content-draft tier-0
- `plugins/lyra-model-router/index.js` — `TIER0_PATTERNS` must stay aligned with Python regex
