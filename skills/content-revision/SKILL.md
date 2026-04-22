---
name: content-revision
description: When Akash gives feedback on a draft (post, outreach, email, thread). Ensures Voice Canon + channel rules are re-applied, not only literal edits.
---

# Content Revision

**Trigger (any of these means you are in a revision turn):**
- Akash replied to a previous draft you sent, with edits, cuts, additions, or tone notes
- "rewrite", "revise", "v2", "make it shorter / tighter / crisper / less corporate"
- "use my voice", "this doesn't sound like me"
- Tone complaints ("too flat", "too salesy", "too formal")
- Specific edits ("drop the first line", "add a line about X", "soften the CTA")

When any trigger fires, **the rules below are mandatory**, not aspirational. If the final output lacks the Pre-Flight block, the skill has failed — restart.

---

## Mandatory pre-flight (emit BEFORE the revised draft)

Every revision reply must open with this exact block, filled in:

```
Pre-flight (revision):
• Voice Canon pages fetched: [page title 1], [page title 2] ...
• Channel rules applied: [platform] — [length cap] — [format notes]
• Feedback applied: [bullet each piece of his feedback]
• Context reused from thread: [metrics / names / links already in-thread that are being carried forward]
```

If any row is empty, you did not do the work. Do the work, then emit the block.

---

## Rules

### 1. Full pass, not a patch
Re-emit the full text. Apply his feedback **and** re-check:
- **Voice Canon** — query Personal Wiki (`database_id 33d78008-9100-8183-850d-e7677ac46b63`, filter `Type = Voice Canon`), fetch blocks, read before writing. Cite page titles in the Pre-flight block.
- **Channel rules** — see the table below.
- `voice-system/NEGATIVE_STYLE.md` patterns to avoid (if drafting X / long-form in repo context).

### 2. Do not drop thread context
If the thread already contains metrics (e.g. "400% exposure lift, 25% conversion"), names, links, quotes, or numbers, **keep them**. Do not ask Akash to repeat.

### 3. Do not drift to generic voice
If your revised draft sounds like it could have come from any founder on LinkedIn, you dropped Voice Canon. Start over with Voice Canon re-loaded. Generic = failure.

### 4. Second Brain is NOT Voice Canon
Voice Canon lives in **Personal Wiki** (`33d78008-…`), not Second Brain (`e4027aaf-…`). Never substitute. See root `MEMORY.md` glossary.

---

## Channel rules (apply on every revision)

| Channel | Length cap | Format | Notes |
|---------|------------|--------|-------|
| **Twitter / X post** | 280 chars per tweet; threads up to 8 unless asked | Hook in line 1; no hashtags unless Akash adds them; em-dashes OK | Never use hashtag spam; no "Thread 🧵" |
| **LinkedIn post** | 1300 chars visible before "see more" | Hook in line 1–2; short paragraphs (1–2 lines); double line break between | No emojis unless Akash asked; no corporate-speak |
| **Substack / blog** | No cap; respect Akash's draft length unless asked | H2/H3 for sections; short paragraphs; concrete examples | Voice Canon is non-negotiable here |
| **Email outreach / cover letter** | 150–250 words | Subject line; 3 short paragraphs; one clear ask | Use Personal Wiki career pages for grounding, not generic claims |
| **Telegram reply to Akash** | Short | Plain text; no markdown formatting in replies he reads on phone | Prefer 1–3 sentences |
| **SMS / WhatsApp** | Under 160 chars when possible | Plain text | Never include sign-off |

If the channel isn't declared in-thread, ask **once** (e.g. "Twitter or LinkedIn?") before drafting — do not guess.

---

## Notion paths

- **Voice Canon:** `POST /v1/databases/33d78008-9100-8183-850d-e7677ac46b63/query` with filter `{"property":"Type","select":{"equals":"Voice Canon"}}` → then `GET /v1/blocks/{page_id}/children` per result.
- **Career / domain pages:** same DB, filter `Domain = [relevant]` or `Type = Career`.
- Never narrate "I don't see a Personal Wiki" — access is by ID. See `skills/job-outreach-gmail/SKILL.md`.

---

## Failure mode checklist (if Akash says "you dropped my voice again")

1. Did your reply include the Pre-flight block? If not → the skill didn't fire. Re-run.
2. Did you actually query `33d78008-…` this turn? If not → you used cached intuition. Re-query.
3. Did you apply the channel row from the table above? If not → do it now.
4. Did you keep the thread's existing metrics/names? If not → restore them from scrollback.

If all four were done and voice still feels off, escalate: ask Akash which specific Voice Canon page you're missing.
