# I Built My Own Chief of Staff. Here's What Every Product Builder Needs to Know About Personal AI.

*Or: I Run a Personal AI on €18/Month. Here's Why Every Product Builder Should Build One.*

---

**Monday, 7:03am.** I wake up to a Telegram message:

> "Morning, Akash. 3 unread emails flagged. EU news: ECB digital euro pilot expands to 5 new countries. 2 tasks due today: renew health insurance, reply to content collaboration request. Yesterday: 28 API calls, 0 errors."

I didn't ask for this. It just fires. Every day.

Her name is Lyra. She is a personal AI chief of staff I built over the last 5 weeks and run for €18/month. She manages my household, coordinates with my wife, captures my ideas, and monitors herself when things break.

This post is not a tutorial. It is a product builder's field report on what AI actually looks like when you stop treating it as a chat interface and start treating it as infrastructure. Every product builder will be managing AI agents in their organizations in the next three years. I wanted to understand what that actually means by doing it myself — not by reading about it.

---

## I wanted an operator. Not a chatbot.

I lead product at a European neobank. I manage a hundred people. I have a wife, a household, a content strategy, and a head that's full. And I kept thinking: isn't this exactly what AI is supposed to fix?

Not the "write me a poem" kind of AI. The "remember that I told you last Tuesday that the electrician is coming Thursday, and tell my wife" kind. The kind that shows up at 7am with a news digest I didn't have to ask for.

I wanted an operator. Not a chatbot.

---

## What Lyra actually does

Let me show you instead of telling you.

**Monday, 7:03am.** I wake up to that Telegram message above. I didn't ask for this. It just fires. Every day.

**Tuesday, 2pm.** My wife Abhigna messages Lyra on the same Telegram bot:

> "Remind Akash to pay PP today"

Lyra adds it to our shared Notion reminders database, then pings me on Telegram:

> "Abhigna asked me to tell you: book the dentist by Friday."

When I reply "Done, booked for Saturday 10am," Lyra marks it complete and tells Abhigna:

> "Akash completed: book the dentist. He said: booked for Saturday 10am."

**Wednesday evening.** I'm walking home and have an idea about a blog post. I send a voice note to Lyra on Telegram. She transcribes it, classifies it as an "Idea," tags it with "content," and saves it to my Second Brain database in Notion. On Sunday, my weekly brief surfaces it alongside three other ideas I captured that week, and asks: "Pattern: you've had four content ideas about personal AI this week. Worth a series?"

This is what I mean by operator, not chatbot. Lyra doesn't wait for me to visit an app. She lives in my messaging. She watches for things. She coordinates between two people. She fires on schedule. She remembers.

---

## The "new hire" mental model

Here's how I thought about building this: Lyra is a new hire.

When you hire someone, you don't hand them the keys to everything on day one. You give them a desk, a job description, access to what they need, and clear boundaries. You tell them your communication style. You tell them when to escalate.

**The desk** is a €6/month Hetzner VPS. Always on. No dependency on my laptop being open.

**The job description** is a file called `SOUL.md` — loaded on every conversation. Defines her communication style (concise, direct, strong verbs), her hard boundaries (never send emails without explicit approval), and her escalation rules.

**The access levels** are explicit. I get full access to all 13 databases. Abhigna gets household databases only — health, meals, trips, shopping, shared reminders. The boundary isn't a suggestion in a prompt. It's structural: Abhigna's queries physically cannot retrieve my professional databases because the retrieval path doesn't include them.

**The escalation policy** is: handle it yourself unless it needs real judgment. Lyra's default model is MiniMax M2.5 — fast, cheap, handles 90% of requests. When she detects something that needs synthesis or nuance, she routes to Claude Sonnet. She doesn't try and fail first. She routes correctly from the start.

This is the same mental model I apply to product teams: context before access, escalation before failure. The agent — like the hire — is only as good as the system it operates in.

---

## Three product decisions that shaped everything

### "Where do I already spend my time?"

I chose Telegram as the interface because it's where I already am. Not Slack. Not a custom web app. The best interface is the one you're already using.

### "What's the source of truth?"

Notion. Not the AI. Every action Lyra takes writes to a Notion database. If Lyra breaks, the data survives. If I swap frameworks, the data survives. The design principle: **Lyra is the interface, Notion is the database.**

This was the most important decision. It means I'm never locked into the AI layer. It also means the answer is never hallucinated — Lyra queries actual data or tells me she couldn't find it. She never fabricates a result.

### "How much should it cost? What happens when it breaks?"

Under €20/month — that was the constraint. The breakthrough was model routing: 87% of requests go through MiniMax at a fraction of Claude's cost. Monthly API spend sits around €8–12. The entire system costs less than a Netflix subscription.

The cost question and the reliability question turn out to be the same question. Before I added cost tracking, I assumed Claude Sonnet was expensive. Turns out 96% of messages hit MiniMax at $0.0001 each. Knowing this made me less anxious about adding features — and it came from the same discipline that made the fallback design rigorous: measure first, then decide.

---

## The architecture

<img width="1262" height="652" alt="Screenshot 2026-03-28 at 21 13 30" src="https://github.com/user-attachments/assets/84a190c4-468f-4eda-b313-3c25898d83b3" />

*Two users, one gateway, three model tiers, 13 Notion databases, full resilience layer. [Interactive version →](https://ahkedia.github.io/lyra-ai/dashboard/architecture-diagram.html)*

---

## When it broke

Three days after I finished hardening Lyra's infrastructure, it went completely dark. Gateway unreachable. No responses. My wife texted me asking why the shopping list wasn't updating.

Root cause: Anthropic hit the spending limit on my account. The router had no fallback — it forced certain messages to Claude Haiku with no escape hatch. Haiku rejected every request. The error cascaded. Crash loop every 2 minutes.

Fix: five minutes from diagnosis to deployed. Router v14 starts with Anthropic disabled, detects rate-limit errors in real-time, falls back everything to MiniMax, and auto re-checks every 30 minutes.

**Your AI assistant is only as good as its worst failure mode.**

Two other things I got wrong:

**The AI will hallucinate confirmations.** My first voice capture pipeline existed only as an instruction in `SOUL.md`. When I sent a voice note, Lyra replied: "Captured → Second Brain ✓." She was lying — she had no transcription capability. She just said what sounded right. The fix: build the actual pipeline. Never trust an AI to admit it can't do something. Build the guardrails so it doesn't have to.

**Prompt-based access control isn't access control.** "Never share my professional data with Abhigna" worked 99% of the time. The 1% is what matters. The fix: make the boundary structural, not instructional. Don't ask the model to refuse. Make access impossible.

Both failures taught me the same thing: constraints that matter belong in the architecture, not the prompt.

---

## The honest numbers

- **99.7% uptime** since cloud migration (one config crash, auto-recovered)
- **€18/month** total cost — VPS, all APIs, everything
- **~30 minutes saved daily** — morning digest, voice capture, reminder coordination
- **One real user besides me** — my wife uses it daily. That's the metric that matters.

---

## Why product builders should care

Would I recommend building this? Only if you have the patience for it. The integrations — Notion schemas, multi-user access, monitoring, backups — take real time. Each piece is simple. The compound complexity is not.

But here's what you actually get: I now understand how to design AI systems with fallback logic, multi-user access control, observability, and cost architecture. That is not a hobby skill. Those are the exact decisions a CPO/CPTO will need to make in the next two years as AI agents move from demos into organizational infrastructure.

You learn this by building, not by reading. The gap between "AI strategy" and "AI judgment" is one deployed system.

---

**Stop thinking about AI as chat. Start thinking about it as infrastructure.**

Infrastructure runs in the background. Infrastructure has monitoring and backups. Infrastructure serves multiple users. Infrastructure doesn't forget.

Lyra is infrastructure. And she's running right now, waiting for my 7am digest tomorrow.

---

*Full technical setup, config templates, and skill files: [github.com/ahkedia/lyra-ai](https://github.com/ahkedia/lyra-ai)*
