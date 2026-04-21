# How I Run a Personal AI for €18/Month — While Everyone Else Is Getting Cut Off

*Anthropic just blocked subscription-based agents. Here's the architecture that never needed the loophole.*

---

## The crackdown, explained

This week, Anthropic ended an arrangement that the community of AI builders had been quietly exploiting for months.

The short version: third-party agent harnesses were routing through Claude subscription tokens — turning a $20–$200/month flat-rate plan into effectively unlimited API access. A single autonomous agent running overnight could consume $1,000 to $5,000 in API-equivalent compute. On a $200 subscription.

Anthropic did the math. The loophole closed.

The reaction online ranged from outrage to resignation. OpenAI — which hired OpenClaw's creator in February — is already positioning itself as the beneficiary of the churn.

But here's what I want to say: **this never had to be a problem.**

---

## The math that never worked

Subscription pricing is a bet on average usage. Netflix prices on the assumption that most subscribers watch a few hours a week, not 24/7. Claude Max at $200/month is the same bet — it assumes conversational usage patterns, not batch processing at 3am.

Autonomous agents break the bet. An agent that runs cron jobs every hour, triggers multi-step tool calls, synthesizes data across databases, and processes incoming messages is not conversational usage. It's datacenter usage on subscription pricing.

This was always going to close. The only question was when.

> The real mistake wasn't using a subscription to run agents. The mistake was building a system that needed $1,000/day of compute in the first place.

---

## How Lyra is built differently

Lyra is a personal AI chief of staff I've been running for three months on a €6/month Hetzner VPS. She manages my household, coordinates with my wife, captures my ideas, monitors herself. She handles around 260 queries a day.

Her total monthly cost: €18. Including server.

She has never needed a Claude subscription.

The architecture that makes this possible is model routing — not as a nice-to-have, but as the core design principle of the system.

---

## Four tiers. Zero subscription.

Here's how Lyra handles 260 queries/day without burning €5,000:

### Tier 0 — Python CRUD (0 tokens, ~100ms)

The first thing I ask about any new request: is this deterministic? Can a Python script do this without reasoning?

"List my reminders." "Add milk to shopping list." "Mark dentist appointment done." "Log 7h30 sleep."

None of these need an LLM. They're database reads and writes with a fixed schema. I built a Python CRUD layer (`crud/cli.py`) that handles these directly — bypassing the AI gateway entirely. Tier 0 covers around 15–20% of all daily interactions.

**Cost per query: $0.00**

### Tier 1 — MiniMax M2.7 (~87% of LLM queries, $0.0001/msg)

Most of what remains — Notion reads, simple reminders, weather, greetings, short replies — goes to MiniMax M2.7 via API. At $0.0001 per message, 260 queries costs $0.026. Per day.

MiniMax handles the volume. Claude handles the thinking.

**Cost per query: $0.0001**

### Tier 2 — Claude Haiku (~9% of LLM queries, $0.001/msg)

Email reading, calendar writes, web searches, multi-step workflows — tasks that need tool use and reasoning but not synthesis. Haiku handles these through Anthropic's pay-as-you-go API.

The key phrase is *pay-as-you-go*. Not subscription. If Lyra uses 20 Haiku queries in a day, I pay $0.02. If she uses 5, I pay $0.005. The cost is proportional to actual usage.

**Cost per query: $0.001**

### Tier 3 — Claude Sonnet (~4% of LLM queries, $0.01/msg)

Weekly synthesis, strategic analysis, long-form drafting, competitive intelligence. When Lyra writes my Sunday brief or summarizes a week of news, that's Sonnet territory. Maybe 10–20 times per week.

**Cost per query: $0.01**

---

## The actual numbers

On a typical day:

- ~40 Tier 0 (Python CRUD): $0
- ~180 MiniMax M2.7 queries: $0.018
- ~30 Haiku queries: $0.03
- ~10 Sonnet queries: $0.10

**Total API spend: ~$0.15/day → ~€4/month**

Add the €6 Hetzner VPS, MiniMax's $9.99/month flat plan (covers the volume comfortably), and small incidentals: **€18/month, all in.**

No subscription gaming. No loopholes. Just the right model for the right task.

---

## The routing engine

How does Lyra decide which tier to use? The router (`plugins/lyra-model-router/index.js`) works in three layers:

1. **Tier 0 regex matching** (<1ms, free): Checks if the prompt matches deterministic CRUD patterns. If yes, hands off to Python directly.

2. **Rule-based classifier** (<1ms, free): Matches against 400+ patterns in `config/routing-rules.yaml` covering 15 task categories — notion_write, email_read, synthesis, etc. — each pre-assigned to a tier.

3. **LLM classifier fallback** (~$0.001, ~500ms): When rule confidence is below 0.7, a Claude Haiku call classifies the task. This meta-call costs $0.001 but prevents misrouting expensive tasks to cheap models — or cheap tasks to Sonnet.

The router also handles failure gracefully. Anthropic availability starts disabled at boot and auto-detects every 30 minutes. If Anthropic is unreachable, everything falls back to MiniMax. Lyra never crashes because a provider is down.

---

## What this means for builders

The subscription crackdown creates a natural selection event in the agent ecosystem.

Systems built on subscription arbitrage — "I'll get $1,000 of Claude for $200" — are now blocked or priced correctly. Systems built on genuine cost engineering — routing, tiering, deterministic bypass — are unaffected.

There's a lesson here for every product leader thinking about deploying AI agents in their organization:

> You cannot design AI infrastructure around favorable pricing. Pricing changes. Terms change. Providers close loopholes. What remains stable is your architecture — and the discipline to measure what your system actually costs and design accordingly.

Before I added cost tracking, I assumed Claude Sonnet was expensive. Turns out 96% of my messages hit MiniMax at $0.0001 each. That measurement changed how I thought about every subsequent feature addition. It's the same discipline that made the fallback design rigorous: measure first, then decide.

The companies that get this right will build AI systems that cost what they should cost — and remain viable regardless of what any provider does to their pricing.

The companies that don't will keep getting cut off.

---

## The honest numbers

- **€18/month total** — VPS, all APIs, everything
- **~260 queries/day** handled
- **99.7% uptime** since cloud migration
- **0 subscriptions gamed**
- **1 real user besides me** — my wife, daily

---

*Lyra's full technical setup, routing config, and architecture: [github.com/ahkedia/lyra-ai](https://github.com/ahkedia/lyra-ai)*

*First post in this series: [Meet Lyra — The AI That Runs My Life](https://www.notion.so/Meet-Lyra-The-AI-That-Runs-My-Life-3247800891008172806ff858aade9eaf)*
