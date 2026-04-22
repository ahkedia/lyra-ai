# Content Engine

Unified content pipeline: topic discovery from 4 collector sources (+ bookmark rows in the same Topic Pool) → wiki-grounded blog drafts (+ tweet/LinkedIn copy) → AI doodle visuals → Telegram approval gates → publishing.

## Quick Start

```bash
# Local development
cp .env.example .env   # fill in secrets
npm install
npm test

# Deploy to Hetzner
git push origin main
ssh hetzner "cd /root/content-engine && git pull && npm install"
```

## Architecture

```
Topic Sources (4)          Topic Pool DB        Draft Generator                Visual Generator    Publishing
─────────────────────────────────────────────────────────────────────────────────────────────────────────────
Personal Wiki ─────┐
Lenny KB ──────────┤
Twitter Insights ──┼──► topic-collector.js ──► Notion DB ──► draft-generator.js ──► visual-generator.js
Second Brain ──────┘       (07:30) Candidates  Shortlisted   (hourly 09:00-22:00)    (on text approval)
Bookmarks content_create ──► same Topic Pool (classify-and-route) ──► Candidate
                                  │                ▲
                                  └── topic-quality-gate.js (Q2 Haiku, max 2 Shortlisted/day)
                                                                  │
                                           Output per topic:       ▼
                                           • Full blog (800-1500 words) — page body under "Full blog (for X Articles / copy edit)"
                                           • blog_content property — first ~2000 chars preview (Notion limit)
                                           • tweet_copy / linkedin_copy — social copy in properties
                                                                  │
                                                                  ▼
                                                        Telegram approval gates
                                                        (APPROVE/SKIP/REDO)
```

## Scripts

| Script | Purpose | Cron |
|--------|---------|------|
| `topic-collector.js` | Aggregate topics from 4 sources → Topic Pool as **Candidate** (Wiki/Lenny stay Candidate until manual Shortlist); **ingest cap** default **5** new rows/run (`topicPool.queue.ingestCap`) | 07:30 daily |
| `topic-quality-gate.js` | Q2 Haiku score ≥ 7; promote Twitter / SecondBrain **Candidate** → **Shortlisted**; **max 2** Shortlisted per calendar day (`Shortlisted on` date) | ~07:45 daily (after collector) |
| `draft-generator.js` | Wiki-grounded blog + tweet + LinkedIn via Sonnet/Haiku; Topic Pool **Author brief** injected into blog prompt; full Voice Canon from wiki blocks; if Haiku score is below 8, Sonnet voice rewrite before social copy | Hourly 09:00-22:00 |
| `visual-generator.js` | Gemini image → Imgur URL if needed → Notion `visual_url` + page block | Triggered by text approval |
| `approval-bot.js` | Poll Telegram for APPROVE/SKIP/FEEDBACK/REDO/HOT/HELP/STATUS | Every 5 min |

## Telegram Commands

| Command | When | Effect |
|---------|------|--------|
| `APPROVE` | Text pending | Approve draft, trigger visual generation |
| `APPROVE` | Visual pending | Approve visual, mark ready for publishing |
| `SKIP` | Text pending | Skip this draft (rejected) |
| `SKIP` | Visual pending | Skip visual, text-only publish |
| `REDO` | Visual pending | Regenerate visual |
| `REDO <hint>` | Visual pending | Regenerate with specific hint (e.g., "REDO more colorful") |
| `FEEDBACK <text>` | Text pending | Record structural feedback, affects future drafts |
| `HOT <topic>` | Any | If daily Shortlist slots remain, **Shortlisted** + draft generator; else saved as **Candidate** (cap includes auto + HOT) |
| `STATUS` | Any | Show queue status |
| `HELP` | Any | Show command list |

## Recency and queue

Topics get **collector score** = source weight + recency tier bonus (24h / 48h / 7d). That sorts **Candidates** for the quality gate.

| Age | Bonus | Effect |
|-----|-------|--------|
| Last 24h | +2.0 | Higher rank among Candidates |
| Last 48h | +1.5 | Fresh |
| Last 7d | +0.5 | Recent |

**Shortlisted** (draft-eligible) comes from: (1) **topic-quality-gate.js** — Haiku Q2 ≥ 7, only **Twitter / SecondBrain**, max **2 per day** with **Shortlisted on** set; (2) **manual** Shortlist in Notion for Wiki/Lenny or any row; (3) **HOT** if slots remain that day.

**Config:** `config/sources.json` → `topicPool.queue` (`dailyShortlistCap`, `qualityMinScore`, `autoPromoteSources`).

**Notion:** Topic Pool needs date property **Shortlisted on** (and optional number **Quality score**). Without **Shortlisted on**, the gate and HOT cap cannot count correctly.

## Feedback Loop

When you provide `FEEDBACK <text>`, the system:
1. Stores feedback in the Notion page's `feedback` property
2. Adds to `config/learnings.json` (last 20 feedbacks kept)
3. Future drafts automatically incorporate cumulative learnings in the prompt

Example: `FEEDBACK blogs need more specific examples from CheQ - vague claims don't land`

## Image on the Notion draft page

**Goal:** You can open the draft in Notion, **see the generated image**, and **copy or save it** for your manual posts (X Articles, LinkedIn, etc.).

The pipeline stores the image in two places on the draft page:

1. **`visual_url`** — direct link you can open or paste if needed.
2. **Page body** — an image block under **Generated Visual** so the picture renders inline in Notion (same idea as pasting a normal image).

If the image model returns **base64** instead of a URL, the script briefly sends it to **Imgur** only to get a normal **https://…** link that Notion’s image block can display. You do not need to think about Imgur for day-to-day use; optional env `IMGUR_CLIENT_ID` is only if you want your own Imgur app instead of the built-in default.

## Full blog in Notion

Notion **rich_text database properties** cap at **2000 characters** per segment. Long posts therefore use:

- **`blog_content` / `Content`**: truncated preview + `…(full blog in page body)` when needed.
- **Page body**: heading **Full blog (for X Articles / copy edit)** plus paragraph blocks for the **entire** draft (chunked and batched within API limits).

Edit or copy the full article from the open draft page, not only the table columns.

## Notion DBs

| DB | ID | Purpose |
|----|----|----|
| Content Topic Pool | `33f78008-9100-812a-acae-c0a61d8caf3a` | Single staging DB for candidates (merged former Content Ideas; bookmarks `content_create` → here) |
| Content Drafts | `8135676dd15c4ef4925336cf484567ac` | Drafts: preview in `blog_content`; full blog on page body; tweet/LinkedIn copy; approvals |
| Personal Wiki | `33d78008-9100-8183-850d-e7677ac46b63` | Grounding evidence + topic source |
| Twitter Insights | `32d78008-9100-8191-b853-d73aea132065` | Topic source (content_create marked) |
| Second Brain | `e4027aaf-d2ff-49e1-babf-7487725e2ef4` | Topic source |

## Lockfiles

All scripts use lockfiles to prevent concurrent runs:
- `/tmp/content-topic-collector.lock`
- `/tmp/content-draft-generator-script.lock` (script-level lock; cron-task-runner uses `/tmp/content-draft-generator.lock`)
- `/tmp/content-approval-bot-script.lock` (script-level lock; cron-task-runner uses `/tmp/content-approval-bot.lock`)

## Config Files

- `config/sources.json` — source DB IDs, filters, scoring weights
- `config/doodle-prompts.json` — domain → doodle style prompt mapping
- `config/opening-principles.md` — voice-grounded opening principles
- `config/x-platform.md` — X format observations and platform rules
- `config/repurpose.md` — repurposing chain: X → LinkedIn → newsletter
- `config/content-types.md` — format observations (prose thread, short take, etc.)
- `config/command-center.md` — orchestration entry point

## Hetzner Deployment

**Server path:** `/root/content-engine/`
**GitHub:** `ahkedia/content-engine` (private)
**Logs:** `/var/log/content-engine.log`
**Deploy key:** `~/.ssh/content_engine_deploy` (read-only)

### Crons Registered (Hetzner)

**Env:** `/root/.openclaw/.env` must include `CONTENT_TOPIC_POOL_DB_ID` (and may keep legacy `CONTENT_IDEAS_DB_ID` for older scripts). Bookmarks `classify-and-route.sh` reads the same file via `run-with-openclaw-env.sh`.

```bash
# 07:30 Berlin (05:30 UTC) — Topic collector then Q2 quality gate (single cron)
30 5 * * * cron-task-runner.sh content-topic-pipeline 420 2 /bin/bash -c '/root/lyra-ai/scripts/run-with-openclaw-env.sh node /root/content-engine/scripts/topic-collector.js && /root/lyra-ai/scripts/run-with-openclaw-env.sh node /root/content-engine/scripts/topic-quality-gate.js' >> /var/log/content-engine.log 2>&1

# Hourly 09:00-22:00 Berlin (07:00-20:00 UTC) — Draft generation
0 7-20 * * * cron-task-runner.sh content-draft-generator 600 2 ... draft-generator.js

# Every 5 min — Approval polling
*/5 * * * * cron-task-runner.sh content-approval-bot 180 2 ... approval-bot.js
```

Local equivalent: `npm run topic-pipeline-daily` (from repo root, with `.env` loaded).

### Server ops (done)

- **Legacy crons:** InsightEngine and `x-publisher` jobs were already disabled; the crontab section was cleaned so only the Content Engine pipeline + JobLog cleanup remain (no duplicate / confusing `# DISABLED` lines).
- **Posting:** You publish manually; no X OAuth required on the server for this pipeline.

## Implementation Status

See plan: `~/.claude/plans/abstract-plotting-cupcake.md`

### Current Checkpoint

**Last updated:** 2026-04-12
**Status:** Operational — Blog format + 4 collector sources + Topic Pool merge

**Completed:**
- Project scaffold (package.json, CLAUDE.md, configs)
- Content Topic Pool DB created (ID: 33f78008-9100-812a-acae-c0a61d8caf3a)
- Content Drafts DB extended with: blog_content, tweet_copy, linkedin_copy, visual_url, etc.
- scripts/lib/: notion, telegram, anthropic, sanitize, lockfile, image (Nano Banana + DALL-E)
- scripts/topic-collector.js — **4-source** aggregator (Wiki, Lenny, Twitter, SecondBrain); ingest cap **5**
- scripts/draft-generator.js — generates **blog + tweet copy + LinkedIn copy** via Sonnet/Haiku
- scripts/visual-generator.js — Nano Banana (Gemini) primary, DALL-E fallback
- scripts/approval-bot.js — Telegram polling + state machine
- Hetzner: repo cloned, crons registered, GOOGLE_AI_API_KEY configured
- InsightEngine cron disabled (cutover complete)

**Content output format:**
1. **Full blog** — entire post in the draft page body (see above).
2. **`blog_content` property** — short preview for gallery / quick scan.
3. **`tweet_copy` / `linkedin_copy`** — social copy in properties.

**Optional later:** OpenAI (DALL-E fallback), X OAuth (automated publish), your own Imgur app via `IMGUR_CLIENT_ID` — not required for manual posting or seeing images in Notion.

### Resume Instructions

To continue this implementation in Claude Code CLI:
```bash
cd /Users/akashkedia/AI/projects/content-engine
# Read the plan
cat ~/.claude/plans/abstract-plotting-cupcake.md
# Check TODO progress in this file
```
