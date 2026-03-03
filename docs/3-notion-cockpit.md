# Notion as the Cockpit

Notion is not a filing cabinet — it is the live state of everything. Lyra reads and writes it directly. Every domain has a database. Every database has a defined schema. Nothing lives only in the agent's memory.

---

## The databases

| Database | Purpose | Access |
|----------|---------|--------|
| News Inbox | Curated stories from RSS feeds, tagged for action | Personal |
| Competitor Tracker | Weekly updates on competitors, relevance-tagged | Personal |
| Content Ideas | Post and article ideas with status | Personal |
| Content Drafts | Drafts in progress with platform and schedule | Personal |
| Second Brain | Voice-captured thoughts, decisions, insights, patterns | Personal |
| Health & Meds | Daily logs, supplements, sleep, workouts | Shared |
| Meal Planning | Weekly meal plans and grocery lists | Shared |
| Upcoming Trips | Travel with flights, accommodation, packing | Shared |

All databases live under a single parent page — the **Lyra Hub** — which is shared with the Lyra Notion integration. This means you only need to share one page, and all child databases inherit access.

---

## The Lyra Hub page

Create a page in Notion called "Lyra Hub". This is the home for all Lyra-managed databases. Share it with your Lyra integration (click `...` → `Connect to` → your integration name).

All databases should be created as inline databases within this hub page. Lyra can also create new sub-pages and databases here dynamically when you ask it to.

---

## Database schemas

Full schemas are in [`notion/database-schemas.md`](../notion/database-schemas.md). Here is the summary:

### News Inbox
```
Title (title) | Category (select) | Source (rich_text) | Date (date)
Link (url) | Summary (rich_text) | Topics (multi_select) | Action (select)
```
Action options: `Read`, `Share`, `Ignore`
Category options: `Fintech`, `AI`, `Startup`, `Macro`, `Other`

### Competitor Tracker
```
Update (title) | Competitor (select) | Update Type (select) | Date (date)
Summary (rich_text) | Link (url) | Relevance (select) | Notes (rich_text)
```
Update Type options: `Product`, `Funding`, `Expansion`, `Partnership`, `Regulatory`

### Content Ideas
```
Idea (title) | Channel (select) | Status (select) | Tags (multi_select)
Rough Notes (rich_text) | Notes (rich_text) | Link (url)
```
Channel options: `X`, `LinkedIn`, `Substack`, `Other`
Status options: `Idea`, `Drafting`, `Ready`, `Published`

### Content Drafts
```
Draft (title) | Platform (select) | Status (select) | Content (rich_text)
Target date (date) | Scheduled Date (date) | Notes (rich_text) | Performance (rich_text)
```

### Second Brain
```
Name (title) | Type (select) | Source (select) | Date (date)
Tags (multi_select) | Notes (rich_text)
```
Type options: `Insight`, `Decision`, `Idea`, `Question`, `Pattern`
Source options: `Voice`, `Telegram`, `Manual`, `Weekly Synthesis`
Tags: `work`, `content`, `personal`, `ai`, `health`, `finance`, `relationship` (customise to your life)

### Health & Meds
```
Item (title) | Type (select) | Person (select) | Date (date)
Frequency (select) | Notes (rich_text) | Steps (number) | Active Calories (number)
Sleep Hours (number) | Sleep Quality (select) | Workouts This Week (number)
Workout Duration (min) (number) | Weight (kg) (number) | Resting Heart Rate (number)
Standing Hours (number) | Refill Date (date)
```
Type options: `Daily Log`, `Supplement`, `Medication`

### Meal Planning
```
Meal Plan (title) | Date (date) | Breakfast (rich_text) | Lunch (rich_text)
Dinner (rich_text) | Grocery Needed (rich_text) | Notes (rich_text)
```

### Upcoming Trips
```
Trip Name (title) | Destination (rich_text) | Start Date (date) | End Date (date)
Status (select) | Flights (rich_text) | Accommodation (rich_text)
Packing List (rich_text) | Notes (rich_text)
```

---

## The NOTION-CONTEXT.md file

This is the most important file for making Lyra actually work with Notion. It lives in `~/.openclaw/workspace/NOTION-CONTEXT.md` and contains:

1. **Your Notion API key path** — `cat ~/.config/notion/api_key`
2. **Your Lyra Hub page ID** — so Lyra can create new pages/databases inside it
3. **Both IDs for each database** — `database_id` (for creating pages) and `data_source_id` (for querying)
4. **All property names and types** — so Lyra uses the exact right property name when writing
5. **Ready-to-run curl patterns** for create, query, update, and search

The reason this exists as a separate file: the Notion API version `2025-09-03` introduced a dual-ID system. Without knowing both IDs and which to use when, every API call either fails or returns unexpected results.

### How to get your data_source_id

After creating a database, call the databases endpoint:
```bash
NOTION_KEY=$(cat ~/.config/notion/api_key)
curl "https://api.notion.com/v1/databases/YOUR_DATABASE_ID" \
  -H "Authorization: Bearer $NOTION_KEY" \
  -H "Notion-Version: 2025-09-03" \
  | python3 -c "import json,sys; r=json.load(sys.stdin); print(r['data_sources'][0]['id'])"
```

---

## Adding Lyra to an existing Notion workspace

If you already have Notion databases you want Lyra to use:

1. Open the database in Notion
2. Click `...` (top right) → `Connect to` → your Lyra integration
3. Get the `database_id` from the URL: `notion.so/yourworkspace/DATABASE_ID?v=...`
4. Get the `data_source_id` via the API call above
5. Add both to `NOTION-CONTEXT.md` with the property schema

---

## What Lyra can do with Notion

**Read:**
- Query databases with filters (e.g., "tasks due today", "entries from this week")
- Get all entries from a database
- Search by title or property value

**Write:**
- Create new pages (database entries) with all properties filled
- Update existing entries (change status, add notes, set dates)
- Create new sub-pages under the Lyra Hub
- Create entirely new databases under the Lyra Hub

**What it cannot do:**
- Change database view settings (UI-only, not in API)
- Move pages between databases
- Delete entries (blocked by SOUL.md boundary — requires explicit confirmation)
