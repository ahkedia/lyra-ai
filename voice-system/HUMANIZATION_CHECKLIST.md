# Humanization Checklist

The humanization pass (run by Haiku after Sonnet's draft) checks for these patterns and corrects them. The score (0-10) reflects how many of the 10 items below pass after humanization. Stored as `humanization_score` on the Content Drafts row.

---

## The 10-Point Check

### 1. Lowercase where it feels natural (2 pts)
- First word of a sentence: OK to capitalize
- Twitter-style lowercase throughout: OK if consistent
- Mixing randomly: not OK
- "AI", "X", "API", proper nouns: always uppercase

### 2. Sentence rhythm is uneven (1 pt)
- Not every sentence is the same length
- At least one sentence under 8 words
- At least one sentence over 20 words
- No three consecutive sentences of similar length

### 3. No AI symmetry patterns (2 pts)
- Cross-check against NEGATIVE_STYLE.md banned words list
- No tidy 3x3 bullet patterns
- No "not X, but Y" pairs appearing more than once

### 4. At least one incomplete or informal structure (1 pt)
- A sentence that starts with "And" or "But" is fine
- A sentence fragment used for emphasis is fine
- Not every sentence needs to be grammatically complete

### 5. No filler opener (1 pt)
- First sentence is NOT "In today's...", "As we navigate...", "It's worth noting..."
- First sentence makes the claim or states the observation directly

### 6. No CTA or engagement-bait closer (1 pt)
- Does NOT end with "What do you think?", "Agree?", "Drop your thoughts below"
- Does NOT end with a hashtag
- The last line is a thought, not a prompt

### 7. Specificity check (1 pt)
- At least one concrete detail (a number, a company name, a specific product, a named mechanism)
- Vague claims without grounding fail this check

### 8. Voice consistency with VOICE.md (1 pt)
- Haiku checks: does this sound like the target voice spec?
- High-conviction, not hedgy
- Lowercase-leaning, not corporate
- Intelligent but not academic

---

## Scoring

| Score | Interpretation |
|-------|----------------|
| 9-10  | Ready. Minor polish only. |
| 7-8   | Good. One pass of cleanup needed. |
| 5-6   | Borderline. Needs humanization retry or manual edit. |
| 3-4   | AI-sounding. Do not publish without significant rework. |
| 0-2   | Reject draft. Re-generate from scratch. |
| null  | Humanization pass failed (Haiku error). Pre-humanization draft used. |

---

## Haiku Self-Assessment Prompt Template

```
You are a style editor. Score this draft 0-10 on the humanization checklist below.
Return only: {"score": N, "fails": ["item1", "item2"]}

Checklist:
1. Lowercase feels natural (no random caps)
2. Sentence rhythm is uneven
3. No AI symmetry patterns (bullets, "not X but Y", tidy parallel structure)
4. At least one informal/incomplete structure
5. No filler opener
6. No CTA or engagement-bait closer
7. At least one concrete specific detail
8. High-conviction voice, not hedgy

DRAFT:
{{draft_text}}
```
