# Command Center: Draft Generation Entry Point

**Read this file first before generating any draft.**

---

## Who Is Akash

- Technical founder, product-minded engineer
- Flipkart (e-commerce, payments), N26 (neobanking), CheQ (credit), Trade Republic (brokerage)
- Based in Germany, thinking globally
- Exploring: AI products, fintech operator lessons, product strategy, career

## Active Platforms

- **Primary:** X (Twitter), 3-4 posts/week
- **Secondary:** LinkedIn, 2-4 posts/week (formats in linkedin-platform.md)
- **Long-form:** Blog (essays, blog-first sequencing per repurpose.md)
- **Outbound:** Recruiter reachouts (reachout-principles.md)

## Niche

AI products, fintech/payments operator lessons, product strategy, career transitions.

## Execution Rule

**Read all config files before writing a single word. Format chosen AFTER the first sentence, never before.**

---

## Files to Read Before Drafting

1. `voice-canon.md`: the 11 voice rules governing all surfaces
2. `MACRO_STRUCTURE.md`: blog-only skeleton (scene → pattern → claim → evidence → implication → instruction)
3. `x-platform.md`: X platform constraints and format observations
4. `linkedin-platform.md`: three LinkedIn formats (argument / aphorism / scene), 280-word cap
5. `reachout-principles.md`: cold reachout rules, 150-word cap
6. `repurpose.md`: how the named phrase travels across blog, LinkedIn, X
7. `content-types.md`: which type fits the topic
8. Voice Canon page (fetched from Personal Wiki, Type="Meta", Title contains "Voice Canon") if available
9. `NEGATIVE_STYLE.md` (from lyra-ai voice-system): what NOT to do, with Kill On Sight section at top

---

## Draft Generation Flow

1. Receive topic + domain from Topic Pool
2. Fetch wiki evidence (top 5 pages for that domain, by recency)
3. Fetch Voice Canon from wiki (if available; voice-canon.md is the canonical fallback)
4. Read all config files
5. Generate via Sonnet (wiki evidence + voice canon + negative style)
6. Humanize via Haiku (10-point checklist → score)
7. Write to Content Drafts DB
8. Send Telegram preview for approval

---

## Quality Gates

- **Min humanization score:** 7/10
- **Max retries:** 2
- **On repeated failure:** Alert Telegram, mark topic as "needs_manual"

---

## Length Caps (hard)

- Blog: 1,150 words
- Signal: 500 words
- LinkedIn post: 280 words
- Recruiter reachout: 150 words
- X: per x-platform.md (thread caps, character limits)
