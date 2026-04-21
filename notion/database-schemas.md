# Notion Database Schemas

All databases live as inline databases inside your **Lyra Hub** parent page. Create the hub page first, share it with your Lyra integration, then create each database inside it.

The Notion API (`2025-09-03`) requires two IDs per database:
- `database_id` — from the URL when you open the database in Notion
- `data_source_id` — retrieve via `GET /v1/databases/{database_id}` → `data_sources[0].id`

Both go into your `NOTION-CONTEXT.md` workspace file.

---

## Personal Databases

### News Inbox

Stores stories from RSS feeds, tagged for action.

| Property | Type | Options |
|----------|------|---------|
| Title | title | — |
| Summary | rich_text | — |
| Category | select | Fintech, AI, Startup, Macro, Other |
| Source | rich_text | — |
| Topics | multi_select | — |
| Date | date | — |
| Link | url | — |
| Action | select | Read, Share, Ignore |

**How Lyra uses it:** Morning digest writes new entries here. You can query "what's tagged action from this week" to surface follow-ups.

---

### Competitor Tracker

Weekly snapshots of what competitors are doing.

| Property | Type | Options |
|----------|------|---------|
| Update | title | — |
| Competitor | select | [your competitor list] |
| Update Type | select | Product, Funding, Expansion, Partnership, Regulatory |
| Summary | rich_text | — |
| Date | date | — |
| Link | url | — |
| Relevance | select | High, Medium, Low |
| Notes | rich_text | — |

**How Lyra uses it:** Sunday competitor digest writes new entries. Query by competitor name to see their full history.

---

### Content Ideas

Post and article ideas in various stages.

| Property | Type | Options |
|----------|------|---------|
| Idea | title | — |
| Channel | select | X, LinkedIn, Substack, Other |
| Status | select | Idea, Drafting, Ready, Published |
| Tags | multi_select | [your topic tags] |
| Rough Notes | rich_text | — |
| Notes | rich_text | — |
| Link | url | — |

**How Lyra uses it:** When you say "save this content idea", Lyra creates an entry here. Query "what content ideas are ready?" before posting.

---

### Content Drafts

Drafts in progress with scheduling.

| Property | Type | Options |
|----------|------|---------|
| Draft | title | — |
| Platform | select | X, LinkedIn, Substack, Other |
| Status | select | Drafting, Review, Scheduled, Published |
| Content | rich_text | — |
| Channel | select | [same as above] |
| Target date | date | — |
| Scheduled Date | date | — |
| Notes | rich_text | — |
| Performance | rich_text | — |

---

### Topic Library

Visible inventory of Lenny-derived topics before they become execution candidates.

| Property | Type | Options |
|----------|------|---------|
| Name | title (topic) | — |
| Topic Key | rich_text | — |
| Status | select | Backlog, Curated, Selected, Rejected, Archived |
| Pillar | select | AI Product, Product Strategy, Growth/Distribution, Operator Lessons, Build in Public |
| Angle Type | select | ai_update, operator_disagreement, growth_system, builder_workflow, reference_to_claim |
| Source Count | number | — |
| Primary Source | rich_text | — |
| Supporting Sources | rich_text | — |
| One-Line Thesis | rich_text | — |
| Why Now | rich_text | — |
| Proof From Me Prompt | rich_text | — |
| Candidate Format | select | Post, Thread, Essay |
| Score | number | — |
| Reviewed Week | date | — |
| Selected This Week | checkbox | — |
| Notes | rich_text | — |

**How Lyra uses it:** This is the visible 50-ish topic pool. Agents can refresh computed fields and scores, while Akash can manually curate, select, reject, or archive rows without touching code.

---

### Weekly Shortlist

Explicit weekly queue pulled from Topic Library before promotion into Content Ideas.

| Property | Type | Options |
|----------|------|---------|
| Name | title (topic) | — |
| Topic Key | rich_text | — |
| Week | date | — |
| Recommendation Rank | number | — |
| Selection Reason | rich_text | — |
| Chosen By | select | Agent, Akash, Both |
| Advance To Content Ideas | checkbox | — |
| Status | select | Queued, Approved for Idea, Skipped, Merged |
| Topic Library Page ID | rich_text | — |
| Candidate Format | select | Post, Thread, Essay |
| Content Idea URL | url | — |
| Notes | rich_text | — |

**How Lyra uses it:** Agents or Akash can create a small weekly review queue here. Only rows explicitly approved move onward into Content Ideas.

---

### Second Brain

The long-term knowledge capture database. See [`docs/5-second-brain.md`](../docs/5-second-brain.md) for full details.

| Property | Type | Options |
|----------|------|---------|
| Name | title | — |
| Type | select | Insight, Decision, Idea, Question, Pattern |
| Source | select | Voice, Telegram, Manual, Weekly Synthesis |
| Date | date | — |
| Tags | multi_select | Customise to your life domains (8–12 tags) |
| Notes | rich_text | Full verbatim transcription or text |

**Suggested tags:** `work`, `content`, `personal`, `ai`, `health`, `finance`, `relationships`, `product`, `strategy`

**How Lyra uses it:** Every voice note is saved here. Sunday brain brief reads from here. Query by type or tag at any time.

---

## Shared Databases

These are accessible to both people in a household setup.

### Health & Meds

Daily logs, supplements, workouts, and sleep for both people.

| Property | Type | Options |
|----------|------|---------|
| Item | title | — |
| Type | select | Daily Log, Supplement, Medication |
| Person | select | [Person A name], [Person B name] |
| Date | date | — |
| Frequency | select | Daily, Weekly, As Needed |
| Notes | rich_text | — |
| Steps | number | — |
| Active Calories | number | — |
| Sleep Hours | number | — |
| Sleep Quality | select | Great, Good, Average, Poor |
| Workouts This Week | number | — |
| Workout Duration (min) | number | — |
| Weight (kg) | number | — |
| Resting Heart Rate | number | — |
| Standing Hours | number | — |
| Refill Date | date | — |

**How Lyra uses it:** "Log today's health: 8000 steps, 7 hours sleep, worked out 45 mins" → creates a Daily Log entry. "What supplements should I take this morning?" → queries entries filtered by person and frequency.

---

### Meal Planning

Weekly meal plans and grocery lists.

| Property | Type | Options |
|----------|------|---------|
| Meal Plan | title | — |
| Date | date | — |
| Breakfast | rich_text | — |
| Lunch | rich_text | — |
| Dinner | rich_text | — |
| Grocery Needed | rich_text | — |
| Notes | rich_text | — |

**How Lyra uses it:** "Plan meals for this week" → creates a new entry for the week. "What do we need from the grocery store?" → queries this week's entry for the Grocery Needed field.

---

### Upcoming Trips

Any travel either person is planning, together or individually.

| Property | Type | Options |
|----------|------|---------|
| Trip Name | title | — |
| Destination | rich_text | — |
| Start Date | date | — |
| End Date | date | — |
| Status | select | Planning, Confirmed, Completed |
| Flights | rich_text | — |
| Accommodation | rich_text | — |
| Packing List | rich_text | — |
| Notes | rich_text | — |

**How Lyra uses it:** "Add our Paris trip: 10–14 July, staying at Hotel X, flying Air France" → creates a trip entry. "What do we need to pack for our next trip?" → reads the upcoming trip's Packing List.

---

## Creating databases via the Notion API

If you prefer to create databases programmatically:

```bash
NOTION_KEY=$(cat ~/.config/notion/api_key)
LYRA_HUB_PAGE_ID="YOUR_LYRA_HUB_PAGE_ID"

curl -s -X POST "https://api.notion.com/v1/databases" \
  -H "Authorization: Bearer $NOTION_KEY" \
  -H "Notion-Version: 2025-09-03" \
  -H "Content-Type: application/json" \
  -d '{
    "parent": {"type": "page_id", "page_id": "'"$LYRA_HUB_PAGE_ID"'"},
    "title": [{"type": "text", "text": {"content": "Second Brain"}}],
    "is_inline": true,
    "properties": {
      "Name": {"title": {}},
      "Type": {"select": {"options": [
        {"name": "Insight"}, {"name": "Decision"},
        {"name": "Idea"}, {"name": "Question"}, {"name": "Pattern"}
      ]}},
      "Source": {"select": {"options": [
        {"name": "Voice"}, {"name": "Telegram"},
        {"name": "Manual"}, {"name": "Weekly Synthesis"}
      ]}},
      "Date": {"date": {}},
      "Tags": {"multi_select": {}},
      "Notes": {"rich_text": {}}
    }
  }'
```

Repeat for each database, adjusting the title and properties.
