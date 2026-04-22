# Content engine playbook (happy path)

## 1. Topic intake

- **topic-collector.js** (daily cron) scores sources from `config/sources.json` and writes rows to **Content Topic Pool** as **Candidate** (including Wiki and Lenny).
- **topic-quality-gate.js** (after collector, e.g. 07:45): Haiku **Q2** scores each **Twitter / SecondBrain** candidate; promotes to **Shortlisted** if score ≥ 7, until **daily cap** (default **2** per calendar day, `CONTENT_TZ` default Europe/Berlin). Sets **Shortlisted on** and optional **Quality score**. (Former **Content Ideas** DB is merged into Topic Pool — one source of truth.)
- **Hot path:** `HOT <topic>` uses the **same daily cap**. If slots remain, **Shortlisted** + **Shortlisted on** + spawns **draft-generator.js**; if cap reached, saves **Candidate** and Telegram explains.

## 2. Human curation

- **Wiki / Lenny:** stay **Candidate** until you set **Shortlisted** in Notion (no automatic Q2 promotion).
- Set **Shortlisted** when you want **draft-generator** to pick the row soon (max **3** Shortlisted processed per hourly run).
- Fill **Author brief** (rich text) on the Topic Pool row when you have a strong angle: stats to cite, bans, links, tone, or structure. The draft generator injects this into the blog prompt as binding context and copies a truncated version into Draft **Notes**.

## 3. Draft generation

- **draft-generator.js** (hourly when shortlisted rows exist):
  - Pulls wiki evidence (Personal Wiki by Domain, else Second Brain fallback).
  - Loads **Voice Canon** from Personal Wiki (Type = Voice Canon): full page body via Notion blocks (capped by `VOICE_CANON_MAX_CHARS`).
  - Sonnet writes the blog; Haiku humanizes + scores 0–10.
  - If Haiku **score is below 8**, Sonnet runs a **voice rewrite** on the humanized body (Voice Canon + NEGATIVE_STYLE + Author brief).
  - Tweet and LinkedIn copy are generated **after** that final blog body.
- Output: **Content Drafts** DB with preview properties, full blog in page body, Telegram preview.

## 4. Approvals

- **Text:** `APPROVE` / `SKIP` / `FEEDBACK <text>` (approval-bot).
- **Visual:** separate step after text approval (not combined with text in one Telegram step).
- `FEEDBACK` appends to `config/learnings.json` and refreshes **cumulativeLearnings** for the next runs.

## 5. Notion properties to maintain

| Location            | Property       | Purpose                                      |
|---------------------|----------------|----------------------------------------------|
| Topic Pool          | **Shortlisted on** | **Date**; required for daily cap + HOT counting |
| Topic Pool          | **Quality score** | Optional number; set by quality gate (Haiku Q2) |
| Topic Pool          | **Author brief** | Deep intent for the piece (optional; Q3 may require for auto-promote) |
| Content Drafts      | Notes          | Evidence + truncated Author brief          |
| Personal Wiki       | Type = Voice Canon | Living voice rules (full block tree)   |

## 6. Style contracts (code-enforced)

- No em dash (U+2014); no en dash as em-dash substitute.
- All-lowercase body default for blog, tweet, LinkedIn (see `NEGATIVE_STYLE` in `draft-generator.js`).
