---
name: preposition-trainer
description: Grade Akash's daily preposition drill answers and capture real preposition slips. Trigger when he replies to a fill-in-the-blank drill or misuses a preposition in chat.
metadata: {"clawdbot":{"emoji":"🧩"}}
---

# preposition-trainer

Akash is training his prepositions. A **command cron** (`preposition-drill`, 08:00 Europe/Berlin)
sends him one fill-in-the-blank exercise per day on Telegram. This skill covers the two
things *you* do: **grade his reply**, and **capture real slips** he makes in normal chat.

All state lives in two Notion DBs (`Preposition Bank`, `Preposition Practice`). The engine
handles every Notion write and all scheduling math — you only run its commands and write the
human reply. Never write to those DBs directly.

---

## How drill selection works (the core logic)

The `Preposition Bank` has a **`Preposition` select field** (values: `in`, `on`, `at`, `into`,
`of`, `to`, `for`, `by`, `from`, `with`, `about`, `other`). Every active row has this field
set. The `drill` command picks the next item using this sort order:

1. **Hardest first** — `Difficulty 3` items (contrast traps) come before `2`, before `1`
2. **Preposition grouping** — within the same difficulty band, items are ordered by their
   preposition alphabetically (`at` → `by` → `for` → `from` → `in` → `into` → `of` →
   `on` → `to` → `with`). Akash works through one preposition's hardest contrasts before
   moving to the next, building systematic intuition rather than random scatter.
3. **Due date** — within the same preposition, earliest `Next review` first (spaced repetition)

The practical effect: a run of all `in`-related hardest items, then `on`, then `at`, etc. —
not a mixed bag every day.

---

## When to grade

If there is an **open exercise** and Akash's next message looks like an answer (a single word
like "at", "on", "of", or a short "is it on?"), grade it.

1. Check there's an open exercise:
   ```bash
   python3 $ENGINE current
   ```
   → prints the open exercise as JSON, or `none`. If `none`, do NOT grade — reply normally.

2. Extract the **single preposition** he chose and grade it:
   ```bash
   python3 $ENGINE grade at
   ```
   → returns JSON. The engine has already logged the result and rescheduled the item.

3. Compose the reply from that JSON:
   - **correct** → confirm warmly, restate the one-line `rule`, offer one bonus sentence
     using the same collocation. ~2 lines.
   - **wrong** → be encouraging, give the `correct_answer`, explain the `rule` plainly,
     show the `example` plus one you invent. Say something like:
     *"Remember: [core rule]. Keep practicing — it comes back tomorrow."*

Do not reveal the answer before grading. One exercise per day — if he asks for more, tell
him tomorrow's is already scheduled; don't run `drill` manually.

---

## Organic capture (personalization)

In **any** normal conversation, if Akash misuses a preposition (e.g. writes "depend of",
"good in maths", "married with her"), silently add that collocation:

```bash
python3 $ENGINE add "depend on" "on" \
    "'Depend' is always followed by 'on'." "It depends on the weather." verb+prep 1
```

Args: `add "<collocation>" "<correct prep>" "<rule>" "<example>" [category] [difficulty]`.
The `Preposition` field is set automatically from `correct prep`. Duplicates are skipped.

---

## Weekly recap

A separate command cron (`preposition-weekly-recap`, Sundays 19:00 Europe/Berlin) emails Akash
a plain-text recap. If he asks mid-week how he's doing, run:
```bash
python3 $ENGINE stats
```

---

## Engine commands

```
ENGINE=/root/.openclaw/workspace/skills/preposition-trainer/prep.py
```

| Command | What it does |
|---|---|
| `drill` | Pick/create today's exercise, print Telegram message |
| `grade <word>` | Grade Akash's answer, update Notion + spaced repetition |
| `current` | Print open exercise as JSON, or `none` |
| `add <args...>` | Add a collocation to the bank (organic capture) |
| `stats` | 7-day summary: total, correct, wrong, missed collocations |
| `weekly` | Plain-text weekly recap email body |
| `backfill-prep` | One-time: set `Preposition` on rows missing it (idempotent) |

---

## Error handling

- `grade` prints `{"error":"no open exercise"}` → nothing was open; reply normally.
- Any engine error → tell Akash the drill hit a snag; never fake a "logged" confirmation.
- The daily send is a separate command cron — you never send the exercise yourself.
