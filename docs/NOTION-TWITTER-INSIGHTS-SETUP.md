# Notion Twitter Insights Database Setup

Create the "Twitter Insights" database for storing synthesized content bytes.

## Quick Setup (5 minutes)

### Option 1: Manual (GUI)

1. Open Notion → your Lyra Hub workspace
2. Click **+ New** → **Database** → **Table**
3. Name it: **Twitter Insights**
4. Add these properties:

| Property | Type | Description |
|----------|------|-------------|
| **Content Byte** | Title | The generated content snippet (auto-filled from page name) |
| **Source Tweet** | URL | Link to original tweet on X |
| **Type** | Select | Problem-Solving / Thought Leadership / Journey-Based / Mixed |
| **Themes** | Multi-select | AI, fintech, product, recruiting, personal, infrastructure, etc. |
| **Original Tweet Summary** | Text | What the tweet was about (full tweet text) |
| **My Take** | Text | Your analysis + suggested angle |
| **Full Byte** | Text | Complete content byte ready to share |
| **For Recruiter** | Checkbox | Flag if good for outreach |
| **Recruiter Notes** | Text | How to use in recruiter conversation |
| **Status** | Select | Draft / Ready / Published / Archived (default Draft at creation) |
| **Generated At** | Date | When Lyra created it |
| **Workflow** | Multi-select | See workflow options below (all that apply) |
| **Primary workflow** | Select | Single best route (must be one of the Workflow options) |
| **Workflow confidence** | Select | High / Medium / Low |
| **Content mode** | Select | Quote OK / Commentary only / N/A |
| **Workflow rationale** | Text | One-line model rationale (optional to keep after review) |
| **Needs review** | Checkbox | True when classification is uncertain |

5. Save the database

### Option 2: API (Programmatic)

From the `lyra-ai` repo (requires `NOTION_API_KEY` and your Notion integration **must have access** to [Lyra Hub](https://www.notion.so/akashkedia/Lyra-Hub-317780089100806bb935dc1810971e87)):

```bash
cd /path/to/lyra-ai
export NOTION_API_KEY="secret_..."   # or rely on env
node scripts/setup-twitter-insights-db.cjs
```

This creates **Twitter Insights** as a **full page** under Lyra Hub (`is_inline: false`) so it nests in the sidebar. It includes all base fields plus the six workflow fields (**Workflow**, **Primary workflow**, **Workflow confidence**, **Content mode**, **Workflow rationale**, **Needs review**) with the correct select/multi-select options.

If the script errors with **object_not_found** on the parent page, open Lyra Hub in Notion → **⋯** → **Connections** → add your integration.

---

## Database ID Configuration

After creating the database, you need to tell Lyra where it is:

### Find the Database ID

1. Open Twitter Insights database in Notion
2. In the URL, find the ID between `/database/` and `?`:
   ```
   https://www.notion.so/your-workspace/[DATABASE_ID]?...
   ```
3. Copy the 32-character ID (before the `?`)

### Save to Environment

1. Open `/root/.openclaw/.env`
2. Add:
   ```bash
   TWITTER_INSIGHTS_DB_ID="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
   ```
3. Restart OpenClaw:
   ```bash
   ssh hetzner "sudo systemctl restart openclaw"
   ```

---

## Property Definitions

### Content Byte (Title)
- **Type:** Title
- **Description:** The main title of the database
- **Used by:** Notion UI, synthesis script
- **Example:** "Batch processing is 10x cheaper for non-realtime ML workloads"

### Source Tweet (URL)
- **Type:** URL
- **Description:** Direct link to the original tweet on X
- **Used by:** Deduplication, recruiter reference
- **Example:** `https://x.com/username/status/1234567890`

### Type (Select)
- **Type:** Select (Multi-select NOT recommended - use single select)
- **Options:**
  - `Problem-Solving` (Green) - Describes a problem + solution
  - `Thought Leadership` (Blue) - Opinion or hot take
  - `Journey-Based` (Purple) - Personal experience or learning
  - `Mixed` (Gray) - Combines multiple types
- **Used by:** Filtering, recruiter positioning
- **Default:** "Ready"

### Themes (Multi-select)
- **Type:** Multi-select
- **Suggested options:**
  - `ai` - Artificial intelligence, ML, LLMs
  - `fintech` - Finance, payments, banking
  - `product` - Product management, UX, design
  - `recruiting` - Hiring, careers, interviews
  - `personal` - Learning, lifestyle, mindset
  - `infrastructure` - Servers, deployment, DevOps
  - `hiring` - Building teams, retention
  - `leadership` - Management, org design
  - `startup` - Entrepreneurship, fundraising
- **Used by:** Analysis, correlation with work patterns
- **Default:** Empty (auto-filled by synthesis)

### Original Tweet Summary (Text)
- **Type:** Text (or Rich Text)
- **Description:** The full text of the original tweet
- **Used by:** Reference, understanding context
- **Max length:** 280+ characters
- **Example:** The full tweet text

### My Take (Rich Text)
- **Type:** Rich text
- **Description:** Lyra's analysis of the tweet + suggested angle for recruiter use
- **Used by:** Synthesis decisions, recruiter positioning
- **Example:** "Infrastructure angle - shows understanding of cost optimization and scaling challenges"

### Full Byte (Rich Text)
- **Type:** Rich text
- **Description:** The complete, polished content byte (3 styles generated, choose best one)
- **Used by:** Copy-paste for recruiter outreach
- **Format:** Markdown friendly
- **Example:**
  ```
  Here's the problem: Non-realtime ML workloads are expensive on streaming infrastructure.

  Here's how I solved it: At Lyra, we batch bookmark processing with our eval pipeline, reducing costs by 60% and improving data quality through better aggregation.

  Why it matters: Infrastructure decisions directly impact product viability and team productivity.
  ```

### For Recruiter (Checkbox)
- **Type:** Checkbox
- **Description:** Is this content byte good for recruiter outreach?
- **Used by:** Filtering high-quality bytes for recruiting
- **Auto-checked when:** Type is Problem-Solving or Thought Leadership
- **Manual override:** Can toggle if something doesn't fit recruiter narrative

### Recruiter Notes (Text)
- **Type:** Rich text
- **Description:** Meta notes on how to use this byte in recruiter conversations
- **Used by:** You, when reaching out to recruiters
- **Example:** "Lead with this if discussing infrastructure scaling experience"

### Status (Select)
- **Type:** Select
- **Options:**
  - `Draft` - Synthesis created it, needs review
  - `Ready` - Reviewed and ready to use for outreach
  - `Published` - Already used with a recruiter
  - `Archived` - Old/stale content
- **Used by:** Filtering, workflow management
- **Default:** "Draft"

### Generated At (Date)
- **Type:** Date
- **Description:** When Lyra synthesized this content byte
- **Used by:** Timeline, deduplication
- **Auto-filled:** By synthesis script
- **Example:** 2026-03-22

### Workflow (Multi-select)
- **Options (use exact names for API/skill alignment):**
  - `lyra_capability`
  - `work_claude_setup`
  - `personal_claude_setup`
  - `work_productivity`
  - `content_create`
  - `research_read_later`
  - `tool_eval`
  - `market_competitor`
- **Used by:** Routing digest and future automation; see `skills/twitter-synthesis/SKILL.md`

### Primary workflow (Select)
- **Type:** Select — **same option strings** as Workflow (single value)
- **Used by:** Primary routing, digest “Workflow mix” line in `aggregate-morning-digest.js`

### Workflow confidence (Select)
- **Options:** `High`, `Medium`, `Low`

### Content mode (Select)
- **Options:** `Quote OK`, `Commentary only`, `N/A` (use `N/A` when primary path is not content)

### Workflow rationale (Text)
- **Description:** One sentence from the model; safe to clear after you correct the row

### Needs review (Checkbox)
- **Description:** Check when classification should be double-checked

---

## Views (Optional)

Create these views for easier navigation:

### View 1: For Recruiter
- **Filter:** `For Recruiter` = checked
- **Sort by:** `Generated At` (descending)
- **Purpose:** Quick access to outreach-ready content

### View 2: By Type
- **Group by:** `Type`
- **Sort by:** `For Recruiter` (descending)
- **Purpose:** See what types of bytes you're generating

### View 3: Status Pipeline
- **Group by:** `Status`
- **Sort by:** `Generated At` (descending)
- **Purpose:** Track review/publishing workflow

### View 4: By Theme
- **Group by:** `Themes`
- **Sort by:** `For Recruiter` (descending)
- **Purpose:** See theme distribution

### View 5: By Primary workflow
- **Group by:** `Primary workflow`
- **Sort by:** `Generated At` (descending)
- **Purpose:** Triage Lyra vs work vs content rows

### View 6: Needs review
- **Filter:** `Needs review` = checked
- **Sort by:** `Generated At` (descending)

---

## Integration Points

This database is read/written by:

1. **Fetch script** (`fetch-twitter-bookmarks.sh`)
   - Reads: Source Tweet URLs from Notion (first 100 rows) for deduplication by tweet id
   - Writes: JSON at `/tmp/lyra-bookmarks-YYYY-MM-DD.json`
   - Requires: `jq`, `TWITTER_INSIGHTS_DB_ID` (env) or `~/.twitter-insights-db-id` (legacy)

2. **Synthesis skill** (`skills/twitter-synthesis/SKILL.md`)
   - Reads: Generated At (to find recent entries)
   - Writes: All properties (creates new entries)

3. **Analysis script** (`analyze-claude-setup.js`)
   - Reads: All properties (for pattern analysis)
   - Writes: None

4. **Digest aggregation** (`aggregate-morning-digest.js`)
   - Reads: Top 3 entries (For Recruiter + Generated At)
   - Writes: None

5. **You (manual)**
   - Reads: All properties
   - Writes: Status, Recruiter Notes (for tracking)

---

## Data Flow Example

```
Tweet bookmarked on X → fetch-twitter-bookmarks.sh fetches it
                      → analyze-claude-setup.js checks for duplicates
                      → synthesis skill generates 3 content bytes
                      → saves to Twitter Insights DB (Status: "Draft")
                      → aggregate-morning-digest.js includes top 3 in digest
                      → you read digest, mark good ones as "Ready"
                      → you use "Ready" bytes for recruiter outreach
                      → mark as "Published" when sent
```

---

## Troubleshooting

### "Database not found" error
- Check `TWITTER_INSIGHTS_DB_ID` in `.env` is correct (32 hex chars)
- Verify database exists in your Notion workspace
- Restart OpenClaw after changing ID

### "Not authorized to access database"
- `NOTION_API_KEY` must be set and valid
- The API key must have access to the database
- Check: `ssh hetzner "echo $NOTION_API_KEY"`

### "Cannot write to database"
- Notion API key might be read-only
- Recreate with full read-write access
- Verify integration credentials

### "Duplicate entries being created"
- Check `Source Tweet` property is unique
- Run: `select distinct where "Source Tweet" != empty`

---

## Backup & Export

To backup this database:

```bash
# Export to CSV
curl -s -X POST "https://api.notion.com/v1/databases/${TWITTER_INSIGHTS_DB_ID}/query" \
  -H "Authorization: Bearer ${NOTION_API_KEY}" \
  -H "Notion-Version: 2022-06-28" | jq '.results[] | [.properties.Content Byte, .properties.Type, .properties."Generated At"]' > twitter-insights-backup.csv
```

---

## Parent Database Connection

This database should be a child of your **Lyra Hub** database:

1. In Lyra Hub, add a relation:
   - **Property name:** `Twitter Insights`
   - **Database:** Twitter Insights
   - **Type:** Many-to-one (each insight belongs to Lyra Hub)

2. This lets you filter by date range and see insights in context of other Lyra data

---

## Next Steps

1. ✅ Create Twitter Insights database
2. ✅ Configure database ID in `.env`
3. ⏭️ Complete X API OAuth2 setup (see `oauth-setup.md`)
4. ⏭️ Deploy fetch script and synthesis skill
5. ⏭️ Test with manual run: `/root/fetch-twitter-bookmarks.sh`
