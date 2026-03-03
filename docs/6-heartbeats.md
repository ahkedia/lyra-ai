# Heartbeats — Scheduled Intelligence

Lyra does not wait to be asked. Five cron jobs fire on schedule and deliver to Telegram whether or not you have messaged the bot that day.

---

## Design principle

Each heartbeat does one thing well. The temptation is to bundle everything into the morning digest — news, tasks, competitors, health, calendar. This leads to timeouts, incomplete responses, and a wall of text you stop reading.

Each cron has a single focused job. Combined, they cover your week.

---

## The five heartbeats

### 1. Morning Digest — 7am daily

**What it does:** Checks RSS feeds for today's top stories across your configured sources. Then checks Notion for any tasks or follow-ups due today or overdue.

**Why separate from competitors:** News changes daily; competitor updates change weekly. Mixing them means either stale competitor data or wasted API calls.

**Cron expression:** `0 7 * * *`

**Message prompt template:**
```
Morning digest:
1) Check RSS feeds for today's top 3-5 stories. For each: headline + 1-line summary + tag as [read/share/action].
2) Check Notion [YOUR_TASKS_DB] for anything due today or overdue. List: Name | Due | Action needed.
Keep total response under 400 words.
```

**Recommended timeout:** 240 seconds

---

### 2. Content Reminder — Noon daily

**What it does:** Asks if you have posted today. If not, suggests 3 post ideas based on your content themes and recent news.

**Why noon:** Early enough to act on it, late enough that you have had morning context. Adjust to your posting habits.

**Cron expression:** `0 12 * * *`

**Message prompt template:**
```
Content reminder: Have you posted on [your platforms] today?
If not, suggest 3 post ideas based on [your content themes].
Keep each idea to one punchy sentence.
```

**Recommended timeout:** 60 seconds

---

### 3. Weekly Competitor Digest — Sunday 6pm

**What it does:** Web searches for news about your competitors from the past 7 days. For each with relevant news: what happened, why it matters to you, any action needed.

**Why Sunday:** Sets context for the week ahead. You walk into Monday knowing what moved in your competitive landscape.

**Cron expression:** `0 18 * * 0`

**Message prompt template:**
```
Weekly competitor digest: Search for news this week on [Competitor A], [Competitor B], [Competitor C].
For each with news: what happened, why it matters, any action needed.
Skip companies with no news. Keep it tight.
```

**Recommended timeout:** 180 seconds

---

### 4. Weekly Job / Goals Review — Sunday 9am

**What it does:** Pulls from your primary tracking database and summarises the state of play. In my case this is professional tracking — adapt it to your primary goal domain.

**Why Sunday morning:** Quieter than Friday, gives you time to action anything before the week starts.

**Cron expression:** `0 9 * * 0`

**Message prompt template:**
```
Weekly review: Check Notion [YOUR_TRACKING_DB] and give me:
1) Total active items
2) Anyone/anything I haven't touched in 7+ days
3) Key meetings or milestones this week
4) Top 3 priority actions for next week
Be direct.
```

**Recommended timeout:** 120 seconds

---

### 5. Weekly Brain Brief — Sunday 8pm

**What it does:** Synthesises your week from the Second Brain database and other active databases. Produces: decisions made, ideas captured, a pattern observed, one thing to carry forward.

**Why Sunday evening:** The week is done. This is reflection time, not action time.

**Cron expression:** `0 20 * * 0`

**Message prompt template:**
```
Weekly brain brief: Query the Second Brain database (data_source_id: YOUR_DS_ID) for all entries from this week.
Also scan [OTHER_ACTIVE_DBS] for anything new this week.
Synthesise: 1) Decisions made (max 3), 2) Best ideas (max 3), 3) A pattern across domains, 4) One thing to carry into next week.
Max 300 words.
```

**Recommended timeout:** 240 seconds

---

## Adding a heartbeat

```bash
openclaw cron add \
  --name "your-job-name" \
  --cron "CRON_EXPRESSION" \
  --tz "YOUR_IANA_TIMEZONE" \
  --message "YOUR_PROMPT" \
  --announce \
  --to YOUR_TELEGRAM_ID \
  --channel telegram \
  --agent main \
  --timeout-seconds 120 \
  --description "Short description"
```

Common IANA timezones: `Europe/Berlin`, `Europe/London`, `America/New_York`, `America/Los_Angeles`, `Asia/Kolkata`

---

## Managing heartbeats

```bash
# List all jobs
openclaw cron list

# Edit a job
openclaw cron edit --id JOB_ID --message "new prompt"

# Disable without deleting
openclaw cron disable --id JOB_ID

# Run immediately for testing
openclaw cron run --id JOB_ID

# See run history
openclaw cron runs --id JOB_ID

# Remove
openclaw cron rm --id JOB_ID
```

---

## Timeout tuning

If a heartbeat times out:
1. Check the run history: `openclaw cron runs --id JOB_ID`
2. Simplify the prompt — one task, not three
3. Increase `--timeout-seconds` (up to ~300 for complex tasks)
4. Split into two separate jobs if needed

The most common cause of timeouts is asking the agent to do multiple Notion queries + a web search in a single turn. Split these across separate cron jobs.

---

## One-shot reminders

For a time-specific reminder that only fires once:

```bash
openclaw cron add \
  --name "reminder-name" \
  --at "+2h" \
  --message "Reminder: follow up with X about Y" \
  --announce \
  --to YOUR_TELEGRAM_ID \
  --channel telegram
```

Or at a specific time:
```bash
openclaw cron add \
  --name "friday-reminder" \
  --at "2026-06-05T09:00:00+02:00" \
  --message "Today is the conference. Key talking points: ..." \
  --announce \
  --to YOUR_TELEGRAM_ID \
  --channel telegram
```

These are also how Lyra sets reminders when you ask her to in conversation — she runs `openclaw cron add` with `--at` to create a one-shot job.
