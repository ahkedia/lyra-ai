# Household Coordination

One agent, two people, clear boundaries.

---

## The problem this solves

Most personal AI setups are solo. But a lot of the cognitive overhead in daily life is shared — grocery lists, trip planning, health tracking, reminders you need to pass to your partner. Having two separate AI setups means duplicating context, paying twice, and maintaining two things.

Lyra runs as a single agent on one machine with two access tiers. Both people message the same Telegram bot. The agent knows who is speaking by their numeric Telegram user ID and enforces boundaries from there.

---

## How access tiers work

Access is defined in `SOUL.md` under the `## Access Levels` section. There is no config switch — it is written in plain English in the agent's instructions, and Claude enforces it.

Example:

```markdown
## Access Levels

**Akash (Telegram ID: YOUR_ID):**
- Full access to all databases and tools
- Can act on his behalf with approval for send/delete actions

**[Partner name] (Telegram ID: PARTNER_ID):**
- Shared databases only: Health & Meds, Meal Planning, Upcoming Trips
- Tools: calendar, reminders, web search
- Cannot see: [list of private domains]
```

The rule is simple: if a query comes from the partner's Telegram ID and asks about a private domain, Lyra responds that she does not have that information available — not that it exists but is restricted.

---

## Setting up a second person

**Step 1 — Get their numeric Telegram ID**

Ask your partner to message `@userinfobot` on Telegram. They will receive a message with their numeric user ID (a 10-digit number, not their username).

**Step 2 — Add them to the OpenClaw allowlist**

In `~/.openclaw/openclaw.json`, find the Telegram channel config and add their ID:

```json
"channels": {
  "telegram": {
    "dmPolicy": "allowlist",
    "allowFrom": [YOUR_ID, PARTNER_ID],
    "groupAllowFrom": [YOUR_ID, PARTNER_ID]
  }
}
```

After editing, restart the gateway:
```bash
openclaw gateway restart
```

**Step 3 — Update SOUL.md**

Add your partner's details to the Access Levels section. Include:
- Their name and Telegram ID
- Which databases they can access
- Which databases they cannot see
- Any preferences Lyra should know (dietary needs, timezone differences, etc.)

**Step 4 — Test**

Have your partner send a message to the bot. They should receive a response. Have them ask about one of your private databases — Lyra should not reveal it.

---

## Shared Notion databases

Three databases are shared between both people:

| Database | What goes here |
|----------|---------------|
| **Health & Meds** | Supplements, daily logs, sleep, workouts for both people |
| **Meal Planning** | Weekly meal plans, grocery lists, dietary preferences |
| **Upcoming Trips** | Any travel either person is planning together |

Both people can add to and read from these via Lyra. The `Person` field in Health & Meds distinguishes entries between the two of you.

---

## Shared Apple Reminders

Create a Reminders list called `Shared - [Your Names]` on your iPhone and share it with your partner via iCloud. They accept the share on their iPhone.

Lyra writes to this list using `osascript`. Since it syncs via iCloud, both people see all tasks in their native iOS Reminders app — no app to install, no new tool to learn.

Important: the `osascript` approach requires the LaunchAgent to run in the user's login session. It will not work over SSH or from a headless server. This is a Mac-only setup.

**How task assignment works:**

From your Telegram:
> "Remind [partner] to book the dentist appointment by Friday"

Lyra adds "Book dentist appointment by Friday" to the shared Reminders list. Your partner sees it on their iPhone.

From your partner's Telegram:
> "Add milk, eggs, and olive oil to the grocery list"

Lyra adds each item to the shared Reminders list under a "Grocery" section, or to the Meal Planning Notion database — depending on how you configure the routing in `SOUL.md`.

---

## Information boundaries

The boundaries are enforced by `SOUL.md`. The key rules to include:

```markdown
## Boundaries

- NEVER share [Person A]'s [private domain] information with [Person B]'s queries
- If [Person B] asks about a private domain, say that information is not available — do not confirm or deny it exists
- Shared databases (Health, Meals, Trips) are readable and writable by both
```

Be explicit about what is private. Vague rules lead to vague enforcement.

---

## Coordination patterns that work well

**Daily:**
> Akash: "Add to the grocery list: tahini, chickpeas, Greek yoghurt"
→ Lyra adds to Notion Meal Planning and/or shared Reminders

> Abhigna: "What's on the grocery list?"
→ Lyra reads and returns the current list

**Health:**
> "Log today's health: 8,200 steps, 7.5 hours sleep, worked out for 45 minutes"
→ Lyra creates a new daily log entry in Health & Meds

> "What supplements should I take this morning?"
→ Lyra reads the supplement entries from Health & Meds filtered by person and frequency

**Trips:**
> "Add our Amsterdam trip: 2–5 June, flying KLM, staying at The Dylan"
→ Lyra creates an Upcoming Trips entry with all details

**Task handoff:**
> "Tell Abhigna I need her to confirm the dinner reservation by 6pm"
→ Lyra adds to shared Reminders with the deadline

---

## What does not work (yet)

- **Direct messages between partners via Lyra** — Lyra cannot forward a message from one person's conversation to another person's Telegram. Each person has their own separate conversation with the bot.
- **Real-time sync notifications** — Lyra does not push unsolicited updates to your partner. She responds when messaged or when a cron fires.
- **Per-person cron jobs** — all cron jobs currently deliver to one Telegram ID. To send a cron to your partner, add a separate cron job with their ID in `--to`.
