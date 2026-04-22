# Job / outreach → Gmail draft (Personal Wiki)

## When this applies

Akash asks for an **outreach message**, **cover letter**, or **Gmail draft** tied to a **job**, a **named contact**, or **former colleague** context. The Tier-0 pipeline pulls **Personal Wiki** (Voice Canon + career pages) and writes **Gmail drafts** via `himalaya` — it does **not** rely on the chat model to "find" the wiki by name.

## Session grounding — MANDATORY before every job turn

Before drafting, re-ground. Do not trust prior-turn state to still be in your context. On every turn in a job/outreach thread:

1. **Read `MEMORY.md` → Operator Facts** (email, GitHub, location, CV location). Never re-ask any of these.
2. **Query Personal Wiki** (`database_id 33d78008-9100-8183-850d-e7677ac46b63`) for:
   - Voice Canon (filter `Type = Voice Canon`) — always
   - Career pages relevant to the target (filter `Type = Career`, or `Domain = [target's domain]`)
3. **Re-read the in-thread context** — any metrics, company details, or contact notes Akash already gave you. Carry them forward; never ask him to repeat.

If you skip step 1 or 2, you will re-ask stable facts and he will escalate — this is the #1 failure mode of this skill.

## Anti-patterns (all observed in production; all forbidden)

- ❌ "I need your current phone number / Gmail / GitHub" → **these are in `MEMORY.md` Operator Facts.** Ask only if genuinely missing, and name the single missing field.
- ❌ "Path to the AI-Akash PDF" → **CV/resume is in Personal Wiki** (`Type = Career` or `Type = CV`). Query, don't ask for filesystem paths.
- ❌ "I don't see a Personal Wiki database" / "listing databases in Lyra Hub" → **wiki access is ID-based**, not search-based. Query `33d78008-…`.
- ❌ "I'm working partially blind" while in-thread context has the metrics/company/role already — reread the thread.
- ❌ Re-asking a metric Akash already typed this session (e.g. "400% exposure lift") — carry it forward.
- ❌ Drafting without fetching Voice Canon — output will drift to generic voice.

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

Do not search Notion by the string "Personal Wiki" in chat. Use IDs from `MEMORY.md` / `notion/notion.md`:

- `database_id` for Personal Wiki: `33d78008-9100-8183-850d-e7677ac46b63`
- Query + blocks; Voice Canon = `Type` = Voice Canon

## Output contract

Every job/outreach reply must include a **Grounding block** before the draft (same spirit as content-revision's Pre-flight):

```
Grounding:
• Operator facts loaded: [email, github, location confirmed from MEMORY.md]
• Wiki pages fetched: [Voice Canon title], [Career page titles], [Domain page titles]
• Thread context reused: [metrics, names, company details already in thread]
• Single missing field (if any): [e.g. "phone number" — ONLY if needed]
```

If the block is missing or any bullet is empty, the skill failed — restart.

## Code

- `crud/job_application.py` — `_JOB_TRIGGER_RE`, `handle_trigger`, `execute_pipeline`
- `crud/cli.py` — `parse` runs job pipeline after content-draft tier-0
- `plugins/lyra-model-router/index.js` — `TIER0_PATTERNS` must stay aligned with Python regex

## Failure mode checklist (if Akash says "you forgot context again")

1. Did the Grounding block appear? If not → session-grounding skipped. Re-run.
2. Did you actually query `33d78008-…` this turn? If not → you improvised. Re-query.
3. Did you re-read `MEMORY.md` Operator Facts? If not → you asked for email/phone again.
4. Did you keep the thread's metrics/names? If not → restore from scrollback.
