# Second Brain

Low-friction capture. Automatic classification. Weekly synthesis.

---

## The problem

Good ideas happen in the shower, on a walk, mid-meeting. By the time you open an app, they are gone. Even if you capture them, they sit in a notes folder you never reopen.

Lyra's Second Brain pipeline is designed around two truths:
1. The bar for capturing should be as low as possible — if it crossed your mind twice, capture it
2. You should never have to search it manually — Lyra surfaces what is relevant when you need it

---

## Voice capture pipeline

Send a voice note to Lyra on Telegram. That is the entire user action. Everything else is automatic.

```
Voice message on Telegram
        ↓
OpenClaw receives audio + transcribes
        ↓
voice-capture skill activates
        ↓
Claude classifies the content:
  Insight / Decision / Idea / Question / Pattern
        ↓
Extracts: title (5–10 words) + relevant tags
        ↓
Saves to Second Brain Notion database
  - Name: short title
  - Type: the classification
  - Source: Voice
  - Date: today
  - Tags: from your domain list
  - Notes: full verbatim transcription
        ↓
Confirms: "Captured. Idea: [title] → Second Brain ✓"
```

The full transcription is always saved in Notes. The title is just the retrieval handle.

---

## The five types

| Type | When to use | Example |
|------|-------------|---------|
| **Insight** | A realization, lesson, or shift in understanding | "The reason X keeps failing is because we're measuring the wrong thing" |
| **Decision** | Something decided or being weighed | "I've decided I won't take a role unless it has Y" |
| **Idea** | A new concept, feature, product thought | "What if Lyra could automatically draft my weekly post from my voice notes?" |
| **Question** | An open question worth investigating | "I keep wondering why nobody has solved Z for SMEs" |
| **Pattern** | A recurring observation across time | "Every time I try to do X daily, I burn out after 3 weeks" |

If unclear, Claude defaults to Insight.

---

## Text capture (no voice required)

You can also add to the Second Brain by text:

> "Save to Second Brain: decided I'm going to stop attending stand-ups that don't have a written agenda beforehand"

Lyra classifies it as a Decision, titles it, and saves it. Same pipeline, no audio step.

---

## Weekly brain brief (Sunday 8pm)

Every Sunday evening, a cron job fires and Lyra synthesises your week:

1. Queries Second Brain for all entries from the past 7 days
2. Scans other relevant databases for what changed this week
3. Produces a structured brief delivered to Telegram:

```
🧠 Weekly Brain Brief — [date]

Decisions this week:
• [decision 1]
• [decision 2]

Best ideas captured:
• [idea 1]
• [idea 2]

Pattern I noticed:
[One paragraph observation across your domains]

One thing to carry into next week:
[The most important thing]
```

This is the compounding layer. A thought captured on a Tuesday resurfaces in Sunday's brief. A pattern spotted in week 4 connects to an idea from week 1.

---

## Surfacing on demand

Ask Lyra to pull from Second Brain at any point:

> "What ideas have I captured in the last month about [topic]?"

> "What decisions have I made about [domain] this year?"

> "Show me the last 10 things I captured"

> "Any patterns you've noticed in what I've been thinking about?"

Lyra queries the `data_source_id` for Second Brain with the relevant filter and returns the results.

---

## Before a big decision

Before an important call, choosing between options, or writing something substantial:

> "Before I write this post, what have I captured about [topic]?"

> "I'm deciding between A and B — what have I noted that's relevant?"

Lyra queries Second Brain and surfaces relevant entries. This is where the investment in low-friction capture pays off.

---

## Notion database setup

The Second Brain database has this schema:

```
Name        (title)
Type        (select: Insight, Decision, Idea, Question, Pattern)
Source      (select: Voice, Telegram, Manual, Weekly Synthesis)
Date        (date)
Tags        (multi_select — customise to your life domains)
Notes       (rich_text — always contains the full original text)
```

Create it inside your Lyra Hub page so Lyra can write to it. Customise the Tags to your actual life domains — what matters to you. Keep it to 8–12 tags maximum or retrieval gets noisy.

---

## What it is not for

- Meeting notes → those belong in a dedicated notes app or their own Notion page
- Day-to-day tasks → those belong in a task list or your domain databases
- Shopping lists → Meal Planning database or shared Reminders

Second Brain is only for thoughts that might compound in value over time: things you notice, decide, or imagine that connect to who you are and what you are building.
