# Notion Context — Lyra's Cockpit

This file is your single reference for all Notion operations. Read it before any Notion API call.

## API Key

**Use environment variable:** `NOTION_API_KEY` (already set on server)

**Cron Jobs**: Environment variables (including NOTION_API_KEY) are loaded from `/root/.openclaw/.env` via systemd EnvironmentFile. Available in ALL sessions including isolated cron jobs.

**Note:** Notion API uses 32-character IDs (no dashes) for block operations. 36-character IDs (with dashes) are for page URLs only.

---

## Lyra Hub — Your Home Base in Notion

**Page ID:** `31778008-9100-806b-b935-dc1810971e87`
**URL:** https://www.notion.so/akashkedia/Lyra-Hub-317780089100806bb935dc1810971e87
**Parent:** Top-level workspace page

This is your home in Akash's Notion. You can:
- Create new sub-pages here for any new topic or project
- Create new databases here when Akash asks for a new tracker or log
- Add content blocks to existing pages under this hub

**Not for health logs.** Meals, workouts, weight, sleep, steps, calories, energy, body snapshots → use **Lyra Health Coach** only: `skills/health-coach/SKILL.md` + `cd /root/lyra-ai/crud && python3 cli.py …`. Do not create a normal Notion page under Lyra Hub for those (they belong as rows in the four Health Coach databases).

### Create a new sub-page inside Lyra Hub
```bash
NOTION_KEY=$NOTION_API_KEY
curl -s -X POST "https://api.notion.com/v1/pages" \
  -H "Authorization: Bearer $NOTION_KEY" \
  -H "Notion-Version: 2025-09-03" \
  -H "Content-Type: application/json" \
  -d '{
    "parent": {"page_id": "31778008-9100-806b-b935-dc1810971e87"},
    "properties": {
      "title": {"title": [{"text": {"content": "New Page Name"}}]}
    },
    "children": [
      {"object": "block", "type": "paragraph", "paragraph": {"rich_text": [{"text": {"content": "Page content here"}}]}}
    ]
  }'
```

### Create a new database inside Lyra Hub
```bash
NOTION_KEY=$NOTION_API_KEY
curl -s -X POST "https://api.notion.com/v1/databases" \
  -H "Authorization: Bearer $NOTION_KEY" \
  -H "Notion-Version: 2025-09-03" \
  -H "Content-Type: application/json" \
  -d '{
    "parent": {"type": "page_id", "page_id": "31778008-9100-806b-b935-dc1810971e87"},
    "title": [{"type": "text", "text": {"content": "New Database Name"}}],
    "is_inline": true,
    "properties": {
      "Name": {"title": {}},
      "Status": {"select": {"options": [{"name": "Todo"}, {"name": "Done"}]}},
      "Date": {"date": {}},
      "Notes": {"rich_text": {}}
    }
  }'
```

---

## Lyra Health Coach — structured fitness and nutrition

**Page ID:** `32c78008-9100-8100-9c81-fb7254abc9ae`  
**URL:** https://www.notion.so/akashkedia/Lyra-Health-Coach-32c78008910081009c81fb7254abc9ae

The Daily Log, Food Log, Workout Log, and Progress Snapshots databases live on this page. Lyra must write **rows** into those databases via `crud/cli.py`, not new freeform pages under Lyra Hub.

**Commands:** `skills/health-coach/SKILL.md` (same as `config/SOUL.md` health rule).

---

## Critical Rule: Two IDs Per Database

Every database has two IDs. Use the right one depending on what you're doing:

- **`database_id`** → use when **creating a new page** (`parent: {"database_id": "..."}`)
- **`data_source_id`** → use when **querying, reading, or updating schema** (`/v1/data_sources/{id}/query`)

---

## Database Reference

### News Inbox
- **database_id:** `8a900cb78c0c4be996347c5dfebec375`
- **data_source_id:** `99e5d9c6-857f-42b6-b195-8f298938c4ea`
- **Properties:** Title (title), Summary (rich_text), Category (select), Source (rich_text), Topics (multi_select), Date (date), Link (url), Action (select)
- **Who can access:** Akash only

### Competitor Tracker
- **database_id:** `9a7e80a037544a2f929b295c37fa43f8`
- **data_source_id:** `f9ab2d4e-b111-4b3b-8d26-1ca2656af151`
- **Properties:** Update (title), Competitor (select), Update Type (select), Summary (rich_text), Date (date), Source (url), Link (url), Relevance (select), Notes (rich_text)
- **Who can access:** Akash only

### Tracker - Co
- **database_id:** `31778008910080c09b6fec080955cf00`
- **data_source_id:** `31778008-9100-8007-8b65-000b2abf7d15`
- **Properties:** Contact Name (title), Company (rich_text), Status (select), Channel (select), Contact Type (select), Next Action (rich_text), Next Action Date (date), Last Action (rich_text), Notes (rich_text), AI Portfolio Sent (checkbox)
- **Who can access:** Akash only

### Content Ideas
- **database_id:** `27fc8e00643a4b9390f7ce8b9a345c62`
- **data_source_id:** `f008d0bb-ac81-401d-889d-4e8f508ab134`
- **Properties:** Idea (title), Channel (select), Status (select), Tags (multi_select), Rough Notes (rich_text), Notes (rich_text), Link (url)
- **Who can access:** Akash only

### Content Drafts
- **database_id:** `8135676dd15c4ef4925336cf484567ac`
- **data_source_id:** `553cecf2-69dd-44b9-a46e-43e761407fb4`
- **Properties:** Draft (title), Platform (select), Channel (select), Status (select), Content (rich_text), Notes (rich_text), Target date (date), Scheduled Date (date), Performance (rich_text)
- **Who can access:** Akash only

### US Relocation Tasks
- **database_id:** `6138e85b5d9d4ccab7ff741c75d3e63a`
- **data_source_id:** `95a33b1d-4a91-41e4-8082-9aafa3f4f8e1`
- **Properties:** Task (title), Category (select: Visa, Documents, Logistics, Housing), Status (status: Todo, In Progress, Done), Due (date), Notes (rich_text)
- **Who can access:** Akash only

### Health & Meds
- **database_id:** `3d61b7c2edfe4525a6a57ed6f0b4996b`
- **data_source_id:** `ede4569a-5f84-4109-a22d-efd70f38ea1e`
- **Properties:** Item (title), Type (select), Person (select), Date (date), Frequency (select), Dosage (rich_text or number), Notes (rich_text), Steps (number), Active Calories (number), Sleep Hours (number), Sleep Quality (select), Workouts This Week (number), Workout Duration (min) (number), Weight (kg) (number), Resting Heart Rate (number), Standing Hours (number), Refill Date (date), Time (rich_text)
- **Who can access:** Akash and Abhigna (shared)

### Meal Planning
- **database_id:** `bac662c07cf0496a8cb54870ddf58abf`
- **data_source_id:** `cd1931aa-2b08-40e3-acf2-4453d0694727`
- **Properties:** Meal Plan (title), Date (date), Breakfast (rich_text), Lunch (rich_text), Dinner (rich_text), Grocery Needed (rich_text), Notes (rich_text)
- **Who can access:** Akash and Abhigna (shared)

### Upcoming Trips
- **database_id:** `64215718b5944945a7f7241a20e89eb1`
- **data_source_id:** `f9cfc4ff-5a74-4955-baab-144943962a99`
- **Properties:** Trip Name (title), Destination (rich_text), Start Date (date), End Date (date), Status (select), Flights (rich_text), Accommodation (rich_text), Packing List (rich_text), Notes (rich_text)
- **Who can access:** Akash and Abhigna (shared)


### Second Brain
- **database_id:** `e4027aaf-d2ff-49e1-babf-7487725e2ef4`
- **data_source_id:** `f1ce4e0f-9e0d-43da-87f8-94dae2732962`

### AI Evals Dashboard
- **database_id:** `a028ad4e-43d2-4406-bae7-65f9b41f006f`
- **data_source_id:** `63d1d1cd-a7d9-4518-b91e-b3013fea9171`
- **Properties:** Date (date), Total Tests (number), Passed (number), Failed (number), Pass Rate (number), Avg Latency (ms) (number), Top Failure (rich_text), Notes (rich_text)
- **Purpose:** Track Lyra's performance over time for the AI portfolio
- **Properties:** Name (title), Type (select: Insight, Decision, Idea, Question, Pattern), Source (select: Voice, Telegram, Manual, Weekly Synthesis), Date (date), Tags (multi_select: job-hunt, relocation, content, n26, sme-lending, ai, personal, abhigna), Notes (rich_text)
- **Who can access:** Akash only
- **Purpose:** Long-term thinking capture — voice notes, spontaneous ideas, key decisions, patterns. This is the core of the second brain.

### Reminders - Akash
- **database_id:** `95e1d0de-496f-478e-9fe4-2e2a356c7970`
- **data_source_id:** `32678008-9100-8171-8940-000b30243ddd`
- **Properties:** Task (title), Due (date), Priority (select: High, Medium, Low), Done (checkbox), List (select: Personal, Work, Health, Finance, Travel, Relocation), Recurrence (select: Once, Daily, Weekly, Monthly), Assigned By (select: Akash, Abhigna, Lyra), Notes (rich_text)
- **Who can access:** Akash only
- **Purpose:** Akash's personal reminders and tasks.

### Reminders - Shared
- **database_id:** `2054e39c-3f09-431d-8821-0e6a7513913a`
- **data_source_id:** `9f206d71-7b25-408b-ad20-02daf0b43da0`
- **Properties:** Task (title), Due (date), Priority (select: High, Medium, Low), Done (checkbox), List (select: Groceries, Household, Bills, Travel, Shopping), Recurrence (select: Once, Daily, Weekly, Monthly), For (select: Akash, Abhigna, Both), Assigned By (select: Akash, Abhigna, Lyra), Notes (rich_text)
- **Who can access:** Akash and Abhigna
- **Purpose:** Shared household reminders — shopping, bills, joint tasks.

### Reminders - Abhigna
- **database_id:** `5d6732b1-7e30-4856-b56b-edbf9c3df229`
- **data_source_id:** `1e74f66d-cb24-40f5-8697-84a3ad8ad1bc`
- **Properties:** Task (title), Due (date), Priority (select: High, Medium, Low), Done (checkbox), List (select: Personal, Health, Shopping, Appointments), Recurrence (select: Once, Daily, Weekly, Monthly), Assigned By (select: Akash, Abhigna, Lyra), Notes (rich_text)
- **Who can access:** Abhigna only
- **Purpose:** Abhigna's personal reminders and tasks.

---

## Common Operation Patterns

### Create a new entry
```bash
NOTION_KEY=$NOTION_API_KEY
curl -s -X POST "https://api.notion.com/v1/pages" \
  -H "Authorization: Bearer $NOTION_KEY" \
  -H "Notion-Version: 2025-09-03" \
  -H "Content-Type: application/json" \
  -d '{
    "parent": {"database_id": "DATABASE_ID_HERE"},
    "properties": {
      "TITLE_PROPERTY_NAME": {"title": [{"text": {"content": "value"}}]},
      "Status": {"status": {"name": "Todo"}},
      "Notes": {"rich_text": [{"text": {"content": "details"}}]}
    }
  }'
```

### Query / read entries
```bash
NOTION_KEY=$NOTION_API_KEY
curl -s -X POST "https://api.notion.com/v1/data_sources/DATA_SOURCE_ID_HERE/query" \
  -H "Authorization: Bearer $NOTION_KEY" \
  -H "Notion-Version: 2025-09-03" \
  -H "Content-Type: application/json" \
  -d '{"page_size": 20}'
```

### Update an existing entry (by page_id)
```bash
NOTION_KEY=$NOTION_API_KEY
curl -s -X PATCH "https://api.notion.com/v1/pages/PAGE_ID_HERE" \
  -H "Authorization: Bearer $NOTION_KEY" \
  -H "Notion-Version: 2025-09-03" \
  -H "Content-Type: application/json" \
  -d '{"properties": {"Status": {"status": {"name": "Done"}}}}'
```

### Find a page by title (to get its page_id for updating)
```bash
NOTION_KEY=$NOTION_API_KEY
curl -s -X POST "https://api.notion.com/v1/data_sources/DATA_SOURCE_ID_HERE/query" \
  -H "Authorization: Bearer $NOTION_KEY" \
  -H "Notion-Version: 2025-09-03" \
  -H "Content-Type: application/json" \
  -d '{
    "filter": {
      "property": "TITLE_PROPERTY_NAME",
      "title": {"contains": "search term"}
    }
  }'
```

---

## Example: Add a recruiter to Tracker - Co
```bash
NOTION_KEY=$NOTION_API_KEY
curl -s -X POST "https://api.notion.com/v1/pages" \
  -H "Authorization: Bearer $NOTION_KEY" \
  -H "Notion-Version: 2025-09-03" \
  -H "Content-Type: application/json" \
  -d '{
    "parent": {"database_id": "31778008910080c09b6fec080955cf00"},
    "properties": {
      "Contact Name": {"title": [{"text": {"content": "Jane Smith"}}]},
      "Company": {"rich_text": [{"text": {"content": "Stripe"}}]},
      "Status": {"select": {"name": "Active"}},
      "Channel": {"select": {"name": "LinkedIn"}},
      "Notes": {"rich_text": [{"text": {"content": "Reached out via DM"}}]}
    }
  }'
```

## Example: Mark a relocation task as In Progress
```bash
# Step 1: Find the page_id by searching
NOTION_KEY=$NOTION_API_KEY
curl -s -X POST "https://api.notion.com/v1/data_sources/95a33b1d-4a91-41e4-8082-9aafa3f4f8e1/query" \
  -H "Authorization: Bearer $NOTION_KEY" \
  -H "Notion-Version: 2025-09-03" \
  -H "Content-Type: application/json" \
  -d '{"filter": {"property": "Task", "title": {"contains": "attorney"}}}' | python3 -c "import json,sys; r=json.load(sys.stdin); print(r['results'][0]['id'])"

# Step 2: Update status using the page_id from above
curl -s -X PATCH "https://api.notion.com/v1/pages/PAGE_ID_HERE" \
  -H "Authorization: Bearer $NOTION_KEY" \
  -H "Notion-Version: 2025-09-03" \
  -H "Content-Type: application/json" \
  -d '{"properties": {"Status": {"status": {"name": "In Progress"}}}}'
```

### Lyra Dev Log
- **page_id:** `3257800891008166a2c1db67b324f25e`
- **Type:** Page (not a database) — content is appended as blocks
- **Who can access:** Akash only
- **Purpose:** Running log of Lyra improvements. Updated automatically by GitHub Actions on every push to main. Each entry is a heading_3 (date) + paragraph (conversational summary).

---

## Troubleshooting Notion Queries

**If a database query returns empty or errors:**

1. **Check database_id** — use the 32-char ID from this file, not the URL ID
2. **Verify the API key** — NOTION_API_KEY is set in .env and grants FULL API access
3. **DO NOT assume it's a sharing issue** — API access is INDEPENDENT of UI sharing
4. **Common causes:** wrong database_id, malformed query, rate limit, API key expired

**If error mentions "sharing" or "permissions":**
- This is almost always a wrong database_id, NOT a sharing issue
- The NOTION_API_KEY grants access to ALL databases regardless of UI sharing
- Never ask user to "share databases in Notion UI" — that is for humans, not APIs

### Daily Log (Health Coach)
- **Parent page:** [Lyra Health Coach](https://www.notion.so/akashkedia/Lyra-Health-Coach-32c78008910081009c81fb7254abc9ae) (`32c78008-9100-8100-9c81-fb7254abc9ae`) — not Lyra Hub
- **database_id:** `53f53768-6e94-493a-9508-42cc41973ba5`
- **data_source_id:** `53f53768-6e94-493a-9508-42cc41973ba5`
- **Properties:** Date (date), Weight kg (number), Steps (number), Active Calories (number), Sleep Hours (number), Sleep Quality (select: Poor/Fair/Good/Great), Resting Heart Rate (number), Energy Level (select: Low/Medium/High), Workout Done (checkbox), Notes (rich_text), Data Source (select: Apple Health/Manual/Lyra), Logged At (rich_text)
- **Who can access:** Akash only
- **Purpose:** One row per day, auto-filled by Apple Health Shortcut or manual Telegram commands

### Food Log (Health Coach)
- **database_id:** `7072c178-d7f1-42f9-8d76-0acea82a93d2`
- **data_source_id:** `7072c178-d7f1-42f9-8d76-0acea82a93d2`
- **Properties:** Date (date), Meal Type (select: Breakfast/Lunch/Dinner/Snack), Description (rich_text), Calories est (number), Protein g (number), Notes (rich_text)
- **Who can access:** Akash only
- **Purpose:** One row per meal, logged via Telegram commands

### Workout Log (Health Coach)
- **database_id:** `e72572d2-f201-4cb1-9460-5b636ba07ad6`
- **data_source_id:** `e72572d2-f201-4cb1-9460-5b636ba07ad6`
- **Properties:** Date (date), Type (select: Run/Gym/Cycling/Walk/Yoga/Other), Duration min (number), Exercises (rich_text), Muscle Groups (multi_select), Effort (select: Easy/Moderate/Hard), Calories Burned (number), Notes (rich_text)
- **Who can access:** Akash only
- **Purpose:** One row per workout session, logged via Telegram commands

### Progress Snapshots (Health Coach)
- **database_id:** `eee245a6-f17b-4bc9-ad70-9a79d3be4cb8`
- **data_source_id:** `eee245a6-f17b-4bc9-ad70-9a79d3be4cb8`
- **Properties:** Date (date), Weight kg (number), Body Fat pct (number), Waist cm (number), Notes (rich_text), Source (select: Manual/Lab/DXA), Photo (files)
- **Who can access:** Akash only
- **Purpose:** Monthly body measurements and lab result snapshots
