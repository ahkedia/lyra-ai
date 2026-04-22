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

## Operator Facts (NEVER re-ask these — read this block first)

These are stable facts about Akash. Lyra must read this block before drafting any outreach/application/cover letter. If a field is missing, ask for **that specific field** — never list 4 of them as if all are unknown.

- **Name:** Akash Kedia
- **Email:** ahkedia@gmail.com
- **GitHub:** github.com/ahkedia
- **Location:** Germany (Europe/Berlin)
- **Wife:** Abhigna Bararia (abhighnabararia@gmail.com)
- **Phone:** (not in repo — if needed, ask once; do not list alongside facts that ARE known)
- **Current CV / resume:** stored in Personal Wiki (`33d78008-…`), `Type = Career` or `Type = CV`. Query Personal Wiki before asking for a filesystem path.
- **Voice Canon:** Personal Wiki, filter `Type = Voice Canon`.
- **Career context:** Personal Wiki, filter `Type = Career`. Key employers: CheQ, Flipkart Pay, Trade Republic.
- **Domain pages:** Personal Wiki, filter `Domain = [AI/ML | Payments | ...]`.

**Rule:** if a draft needs Akash's contact details, pull from this block + Personal Wiki. Do NOT re-ask email, GitHub, location, CV, or Voice Canon. If a field is genuinely missing, name it in one line and continue drafting with placeholder.

## Notion
Read `references/notion.md` or `~/.openclaw/references/notion.md` for schemas and IDs. Lyra Hub: `31778008-9100-806b-b935-dc1810971e87`

## Schedules
7am: news digest | noon: content draft | Sun 9am: job review | Sun 6pm: competitor digest | Sun 8pm: brain brief | Mon 9am: health check

## Session Log
[date — fact]

## Personal Wiki — query recipe

(IDs are in the glossary above. Never confuse this with Second Brain.)

**Lenny episode synthesis (Type = Lenny Synthesis):** The wiki stores curated “Lenny Synthesis” pages (per-episode and theme notes) alongside other types. For **zero-token** lookups from Telegram, messages matching natural phrases (e.g. *what does Lenny say about …*) route to `crud/cli.py parse` → `wiki_notion.lenny_wiki_search`, which queries the Personal Wiki data source for `Type = Lenny Synthesis` and `Title` contains the topic, then pulls block text for excerpts. **CLI (debug):** `python3 crud/cli.py wiki-lenny "<topic>"`. **Related Tier 0:** `wiki-lint` (orphan / stale / “My take” scan) and `wiki-dedup "<keywords>"` (similar titles before creating a new page). Router patterns live in `plugins/lyra-model-router/index.js` (`WIKI_TIER0_PATTERNS`).

**News Inbox — arXiv auto-intake (dedupe on Link):** `python3 crud/cli.py news-inbox-rss [max_new]` runs `crud/news_inbox_rss.py` (latest **cs.LG** from arXiv Atom, skip if `Link` already exists). Suitable for a daily cron on Hetzner.

When answering career / domain / positioning / voice questions (general LLM path):
  - **Primary:** `POST /v1/databases/33d78008-9100-8183-850d-e7677ac46b63/query` (same path as job pipeline). For Voice Canon only: filter `Type` = `Voice Canon`. Filter examples: `Domain = [relevant domain]` or `Type = Career | Voice Canon`.
  - **Alternate:** `POST /v1/data_sources/33d78008-9100-8197-9f0f-000b205edfe8/query`.
  - **Step 2:** For each page_id, `GET /v1/blocks/{page_id}/children` — page body is required; titles alone are not enough.
  - **Creating new pages:** use `database_id = 33d78008-9100-8183-850d-e7677ac46b63`.
  - Cite the page title in your answer.

## Content revision
After user feedback on a draft, always re-apply Voice Canon + channel rules — not only the literal edits requested. See `config/SOUL.md` → Drafts, revisions & job copy.
