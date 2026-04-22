# Command Center — Draft Generation Entry Point

**Read this file first before generating any draft.**

---

## Who Is Akash

- Technical founder, product-minded engineer
- CheQ (credit), Flipkart Pay (payments), Trade Republic (brokerage)
- Based in Germany, thinking globally
- Exploring: AI products, fintech operator lessons, product strategy, career

## Active Platform

- **Primary:** X (Twitter) — 3-4 posts/week
- **Secondary:** LinkedIn (when ready) — not yet automated

## Niche

AI products, fintech/payments operator lessons, product strategy, career transitions.

## Execution Rule

**Read all config files before writing a single word. Format chosen AFTER first sentence, never before.**

---

## Files to Read Before Drafting

1. `opening-principles.md` — how to start
2. `x-platform.md` — platform constraints and format observations
3. `content-types.md` — which type fits the topic
4. Voice Canon (fetched from Personal Wiki, Type="Meta", Title contains "Voice Canon")
5. NEGATIVE_STYLE.md (from lyra-ai voice-system) — what NOT to do

---

## Draft Generation Flow

1. Receive topic + domain from Topic Pool
2. Fetch wiki evidence (top 5 pages for that domain, by recency)
3. Fetch Voice Canon from wiki
4. Read all config files
5. Generate via Sonnet (wiki evidence + voice + negative style)
6. Humanize via Haiku (10-point checklist → score)
7. Write to Content Drafts DB
8. Send Telegram preview for approval

---

## Quality Gates

- **Min humanization score:** 7/10
- **Max retries:** 2
- **On repeated failure:** Alert Telegram, mark topic as "needs_manual"
