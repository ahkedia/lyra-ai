---
marp: true
theme: default
paginate: true
style: |
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

  section {
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 26px;
    color: #1e293b;
    background: #ffffff;
    padding: 52px 64px;
  }

  h1 {
    font-size: 3.2em;
    font-weight: 700;
    color: #0f172a;
    margin-bottom: 0.1em;
    line-height: 1.1;
  }

  h2 {
    font-size: 1.5em;
    font-weight: 600;
    color: #1e293b;
    border-bottom: 3px solid #6366f1;
    padding-bottom: 0.3em;
    margin-bottom: 0.8em;
  }

  h3 {
    font-size: 1em;
    font-weight: 600;
    color: #6366f1;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 0.3em;
  }

  blockquote {
    border-left: 4px solid #6366f1;
    background: #f8faff;
    padding: 0.8em 1.2em;
    font-style: italic;
    font-size: 0.9em;
    color: #334155;
    margin: 1em 0;
    border-radius: 0 6px 6px 0;
  }

  .subtitle {
    font-size: 1.1em;
    color: #64748b;
    margin-top: 0.3em;
    margin-bottom: 1.6em;
  }

  .tag {
    display: inline-block;
    background: #ede9fe;
    color: #6d28d9;
    font-size: 0.72em;
    font-weight: 600;
    padding: 0.2em 0.7em;
    border-radius: 99px;
    margin-right: 0.4em;
  }

  .two-col {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2.5em;
    margin-top: 0.5em;
  }

  .two-col-60 {
    display: grid;
    grid-template-columns: 3fr 2fr;
    gap: 2.5em;
  }

  .card {
    background: #f8faff;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 1em 1.2em;
  }

  .card h3 {
    margin-top: 0;
  }

  .stat {
    font-size: 2em;
    font-weight: 700;
    color: #6366f1;
    line-height: 1;
  }

  .stat-label {
    font-size: 0.75em;
    color: #64748b;
    margin-top: 0.2em;
  }

  .stats-row {
    display: flex;
    gap: 2em;
    margin-top: 1em;
  }

  ul {
    margin: 0.4em 0;
    padding-left: 1.4em;
  }

  li {
    margin-bottom: 0.35em;
  }

  .decision {
    border-left: 3px solid #6366f1;
    padding-left: 1em;
    margin-bottom: 1em;
  }

  .decision .q {
    font-size: 0.82em;
    color: #64748b;
    font-style: italic;
  }

  .decision .a {
    font-weight: 600;
    color: #0f172a;
  }

  .footer-note {
    position: absolute;
    bottom: 36px;
    font-size: 0.65em;
    color: #94a3b8;
  }

  section.cover {
    background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
    color: #f1f5f9;
  }

  section.cover h1 {
    color: #ffffff;
    font-size: 4em;
    margin-bottom: 0.05em;
  }

  section.cover .subtitle {
    color: #94a3b8;
    font-size: 1.05em;
  }

  section.cover blockquote {
    background: rgba(99,102,241,0.15);
    border-left-color: #818cf8;
    color: #cbd5e1;
    font-size: 0.85em;
    max-width: 70%;
  }

  section.cover .framing {
    margin-top: 1.6em;
    font-size: 1.1em;
    font-weight: 600;
    color: #e2e8f0;
  }

  section.cover .footer-note {
    color: #475569;
  }

  section[data-marpit-pagination]::after {
    color: #94a3b8;
    font-size: 0.7em;
  }
---

<!-- _class: cover -->
<!-- _paginate: false -->

# Lyra

<div class="subtitle">Personal AI Chief of Staff &nbsp;·&nbsp; Built from scratch &nbsp;·&nbsp; Runs 24/7 &nbsp;·&nbsp; €18/month</div>

> **Monday, 7:03am.** I wake up to a Telegram message:
> *"Morning, Akash. 3 unread emails flagged. EU news: ECB digital euro pilot expands. 2 tasks due today. Yesterday: 28 API calls, 0 errors."*
>
> I didn't ask for this. It just fires. Every day.

<div class="framing">I wanted an operator. Not a chatbot.</div>

<div class="footer-note">github.com/ahkedia/lyra-ai</div>

---

## Operator, Not Chatbot

<div class="two-col">
<div class="card">

### Morning Digest
Fires at 7am every day — no prompt, no app to open. Flagged emails, news, tasks due, yesterday's API stats. Proactive by default.

</div>
<div class="card">

### Multi-User Coordination
My wife and I share one bot, with structurally separate access. She says "remind Akash to book the dentist." I mark it done. She gets the confirmation. The loop closes.

</div>
<div class="card">

### Voice → Second Brain
Voice note on Telegram → transcribed → classified → saved to Notion. On Sunday: *"You had 4 content ideas about personal AI this week. Worth a series?"*

</div>
<div class="card">

### Reminders That Close the Loop
Not just set-and-forget. Lyra assigns, tracks completion, and confirms back to the person who asked. Both people stay in sync without a group chat.

</div>
</div>

<br>

> She doesn't wait for you to visit an app. She watches for things. She fires on schedule. She remembers.

---

## Product Judgment, Not Just Code

Three decisions shaped everything.

<div class="decision">
<div class="q">"Where do people already spend their time?"</div>
<div class="a">→ Telegram. Not a custom app. The best interface is the one you're already using.</div>
</div>

<div class="decision">
<div class="q">"What's the source of truth?"</div>
<div class="a">→ Notion, not the AI. Every action Lyra takes writes to a database. If the AI layer breaks, the data survives. She never fabricates a result — she queries real data or admits she can't find it.</div>
</div>

<div class="decision">
<div class="q">"How much should it cost? What happens when it breaks?"</div>
<div class="a">→ 4-tier model routing. 87% of requests hit MiniMax at $0.0001 each. ~$0.03/day in API costs. The cost question and the reliability question are the same question: measure first, then decide.</div>
</div>

<br>

**The "new hire" mental model:** desk (€6/mo VPS) · job description (`SOUL.md`) · structural access levels · escalation policy (model routing). The agent is only as good as the system it operates in.

---

## The System

<div class="two-col-60">
<div>

**Architecture**
Two users → one gateway → 4-tier routing → 13 Notion databases

| Tier | Model | Use case | Cost |
|------|-------|----------|------|
| 0 | Python (no LLM) | CRUD ops | $0 |
| 1 | MiniMax M2.5 | Most requests | $0.0001 |
| 2 | Claude Haiku | Reasoning tasks | $0.0005 |
| 3 | Claude Sonnet | Complex synthesis | ~$0.01 |

<br>

[Interactive architecture diagram →](https://ahkedia.github.io/lyra-ai/dashboard/architecture-diagram.html)

</div>
<div>

### Solves for today
- Morning digest & email triage
- Household coordination (2 users)
- Voice capture → Second Brain
- Calendar reads & writes
- Health, meals, trips, shopping

### Could solve for tomorrow
- Restaurant reservations (OpenTable/Resy)
- Multi-agent mode — specialist agents for email, calendar, content — coordinated by a central router
- Webhook triggers — external services fire Lyra actions
- Any org's internal ops: standup summaries, task delegation, async coordination across teams

</div>
</div>

---

## The Signal

> "The gap between AI strategy and AI judgment is one deployed system."

What building Lyra demonstrates in practice:

- **Fallback logic** — rate-limit-aware routing, auto-recovery for 5 failure modes, 99.7% uptime
- **Multi-user access control** — structural RBAC, not prompt-based permissions
- **Observability** — structured logs, cost tracking, status dashboard, Telegram alerts
- **Cost architecture** — 4-tier routing, $0.03/day, built for scale not just demo

<br>

Every CPO will make these decisions for their org in the next two years — which models to route to, how to handle failures, how to control access, how to measure cost. I already have.

<br>

**Stop thinking about AI as chat. Start thinking about it as infrastructure.**

<div class="footer-note">Akash Kedia &nbsp;·&nbsp; github.com/ahkedia/lyra-ai &nbsp;·&nbsp; ahkedia@gmail.com</div>
