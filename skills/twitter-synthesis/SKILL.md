# Twitter Bookmarks Synthesis

Analyze bookmarked tweets and generate 3-style content bytes + Claude setup improvement suggestions.

## FrontMatter

```yaml
name: Twitter Bookmarks Synthesis
description: Classify each bookmark into workflow routes (Lyra, work/personal Claude setup, work productivity, content, etc.), then synthesize outputs per route. Also produce content-byte styles where applicable and Claude-setup suggestions.
category: content-generation
tags:
  - twitter
  - content
  - synthesis
  - recruiter
---
```

## Operations

### Input
```json
{
  "bookmarks": [
    {
      "id": "1234567890",
      "text": "The tweet content...",
      "author": { "username": "user", "name": "User Name" },
      "created_at": "2026-03-20T10:00:00Z",
      "public_metrics": {
        "like_count": 42,
        "retweet_count": 5
      }
    }
  ],
  "user_context": {
    "work_focus": ["AI", "fintech", "recruiting"],
    "recent_projects": ["Lyra AI", "OpenClaw"],
    "tools_used": ["Claude", "Notion", "Telegram"]
  }
}
```

### Processing

For each bookmark, perform these steps in order.

#### Step 0: Workflow routing (before themes and bytes)

X does not store *why* the user bookmarked a post—**infer** intent from tweet text, author, and (if provided) light user context from SOUL/MEMORY. Output structured classification for every bookmark:

**`primary_workflow`** (exactly one Notion select value):

| Value | Meaning |
|-------|---------|
| `lyra_capability` | Improves Lyra / gateway / OpenClaw / skills / MCP / Telegram automations |
| `work_claude_setup` | Improves **employer** Claude Code / Cursor / repo rules / team tooling |
| `work_productivity` | Work outcomes: process, scaling, efficiency, leadership—**not** primarily editor config |
| `personal_claude_setup` | Personal / side-project Claude or Cursor setup |
| `content_create` | Something worth turning into **your** post (thread, LinkedIn, etc.) |
| `research_read_later` | Save for deep read; no immediate artifact |
| `tool_eval` | Evaluate buy/build/adopt a tool or vendor |
| `market_competitor` | Market or competitor intel |

**`secondary_workflows`:** 0–3 additional values from the same list (omit if none).

**`workflow_confidence`:** `High` | `Medium` | `Low`

**`workflow_rationale`:** One short sentence (for debugging; user may delete in Notion).

**`content_mode`** (only when `content_create` is primary or secondary): `Quote OK` | `Commentary only` | `N/A`

**`needs_review`:** `true` if confidence is Low or primary choice is ambiguous; else `false`.

Use **multi-signal** hints: words like OpenClaw, skill, MCP, Lyra → `lyra_capability`; employer/product context vs personal projects → work vs personal Claude; strong opinion or thread worth sharing → `content_create`.

#### Step 1: Theme Extraction
Extract 3-5 themes from the tweet:
- Primary theme: AI, fintech, product, recruiting, personal, hiring, infrastructure, etc.
- Sub-themes: specific topics mentioned
- Relevance to user's work: High (directly relevant), Medium, Low

**Example:**
```
Tweet: "Batch processing is 10x cheaper than streaming for non-realtime ML workloads"
Themes:
  - Primary: infrastructure
  - Sub: cost optimization, ML, batch vs streaming
  - Relevance: High (user runs ML evals)
```

#### Step 2: Content Type Classification
Classify the tweet into one or more types:
- **Problem-Solving:** Tweet describes a problem + solution or best practice
- **Thought Leadership:** Tweet is an opinion, hot take, or contrarian view
- **Journey-Based:** Tweet is about the author's personal experience or learning

**Example:**
```
Tweet: "Batch processing is 10x cheaper..."
Type: Problem-Solving (best practice described)
```

#### Step 2b: Per-workflow artifact (in addition to or instead of generic bytes)

After classification, tailor **My Take** and **Full Byte** (or a second body field) to the **primary workflow**:

- **`lyra_capability`:** Concrete proposal—skill name, files or services to touch, acceptance check, risk.
- **`work_claude_setup` / `personal_claude_setup`:** Specific setup change—rule path, skill, command, or doc to add; no employer secrets.
- **`work_productivity`:** One habit, metric, or process change at work (may mention AI only if central).
- **`content_create`:** Use the Problem-Solving / Thought Leadership / Journey templates below; set **content_mode** guidance (quote vs commentary-only).
- **`research_read_later`:** 2 bullets—what to read and why it matters; no fake post.
- **`tool_eval` / `market_competitor`:** Decision-oriented summary—options, criteria, recommended next step.

You may **skip** the three recruiter-style content byte templates when primary workflow is not `content_create` and a different artifact is more useful—still fill **Full Byte** with the best single actionable block.

#### Step 3: Generate 3 Content Bytes (content_create emphasis)
For each applicable **content** type, generate a recruiter-ready or audience-ready byte:

**Problem-Solving Format:**
```
Here's the problem: [1-2 sentence problem statement from tweet]

Here's how I solved it: [Your angle/experience applying this principle]

Why it matters: [Business impact or lesson learned]
```

**Thought Leadership Format:**
```
Hot take: [Tweet's main opinion/claim]

In practice: [Your perspective or experience with this topic]

What I'm watching: [Related trend or next evolution]
```

**Journey-Based Format:**
```
Inspired by this insight: [Tweet's core idea]

My approach: [How you're applying or have applied this]

What I learned: [Key lesson or outcome]
```

#### Step 4: Cross-Correlate with Claude Setup
Analyze whether this tweet suggests workflow improvements:

**Questions to answer:**
- Does this tweet's domain overlap with user's recent work? (Check against Notion databases)
- Could implementing this idea optimize token usage?
- Does this suggest a new skill or automation opportunity?
- Is this relevant to recruiter positioning?

**Example Analysis:**
```
Tweet about batch processing (infrastructure) ✓ Matches user's eval pipeline work
Could this optimize?: Maybe - could batch Twitter fetch with other daily tasks
Recruiter angle?: Yes - shows infrastructure optimization thinking
Suggestion: "Consider batching all daily cron tasks to reduce server startup overhead"
```

#### Step 5: Save to Twitter Insights Database
Create **one Notion page per bookmark** (or per generated byte if you intentionally split—default is one row per bookmark).

**Fields:**
- **Content Byte** (title): 1-line summary (≤80 chars)—aligned with primary workflow
- **Source Tweet** (url): `https://x.com/{username}/status/{id}` (use API id + expansion author if available)
- **Type** (select): Problem-Solving / Thought Leadership / Journey-Based / Mixed
- **Themes** (multi_select): Tags from Step 1
- **Original Tweet Summary** (text): Full tweet text
- **My Take** (text): Analysis + angle, **including workflow rationale in one clause if helpful**
- **Full Byte** (text): Best single artifact—content byte **or** Lyra/setup/productivity brief per Step 2b
- **For Recruiter** (checkbox): True when content supports hiring narrative (often `content_create` + strong professional signal)
- **Recruiter Notes** (text): How to use in outreach, or `N/A`
- **Status** (select): Default **Draft** until user reviews; use Ready when confident
- **Generated At** (date): Today (ISO date)
- **Workflow** (multi_select): All values that apply (`lyra_capability`, `work_claude_setup`, …)
- **Primary workflow** (select): Must match one **Workflow** option exactly (use the internal names above)
- **Workflow confidence** (select): High / Medium / Low
- **Content mode** (select): Quote OK / Commentary only / N/A (use N/A when not content_create)
- **Workflow rationale** (text): Same one-liner as in structured output
- **Needs review** (checkbox): Set from Step 0

### Output

```json
{
  "content_bytes": [
    {
      "id": "byte-001",
      "tweet_id": "1234567890",
      "primary_workflow": "lyra_capability",
      "secondary_workflows": ["work_productivity"],
      "workflow_confidence": "High",
      "workflow_rationale": "Tweet is about batching cron jobs; maps to gateway automation.",
      "content_mode": "N/A",
      "needs_review": false,
      "type": "Problem-Solving",
      "themes": ["infrastructure", "cost-optimization"],
      "content_byte": "Batch processing is 10x cheaper than streaming for non-realtime workloads. How I'm using this: optimizing Lyra's eval pipeline to batch queries and reduce server startup overhead.",
      "for_recruiter": true,
      "recruiter_angle": "Shows infrastructure optimization thinking + cost awareness"
    }
  ],
  "claude_setup_suggestions": [
    {
      "theme": "infrastructure",
      "observation": "Multiple bookmarks about batch processing and cost optimization",
      "suggestion": "Consider consolidating all 7am cron tasks into a single batch operation to reduce server startup overhead",
      "estimated_impact": "Could reduce 5% of daily infrastructure costs"
    }
  ],
  "stats": {
    "bookmarks_processed": 15,
    "content_bytes_generated": 23,
    "themes_extracted": ["infrastructure", "AI", "product", "recruiting"],
    "recruiter_ready_count": 8,
    "setup_suggestions": 2
  }
}
```

## Error Handling

- **No bookmarks found:** Return empty array, log "No bookmarks to process"
- **Tweet text parsing error:** Skip tweet, log error, continue with next
- **Notion API rate limit:** Retry with exponential backoff (1s, 2s, 4s, 8s)
- **Invalid theme classification:** Default to "personal", log warning
- **Synthesis fails:** Return partial results with error log

## Setup

### Requirements
- X API bookmarks data (from `fetch-twitter-bookmarks.sh`)
- Claude API key (for synthesis)
- NOTION_API_KEY (for saving to database)
- Twitter Insights database ID

### Environment Variables
```bash
export CLAUDE_API_KEY="..."           # Anthropic API key
export NOTION_API_KEY="..."           # Notion API key
export TWITTER_INSIGHTS_DB_ID="..."   # Notion database ID
```

### Configuration
```bash
# Model for synthesis (use Sonnet for better quality)
MODEL="claude-sonnet-4-6"

# Max bookmarks to process per run
MAX_BOOKMARKS=100

# Min engagement threshold (optional)
MIN_LIKES=0

# Retry attempts for API calls
MAX_RETRIES=3
```

## Integration

This skill is triggered by the `twitter-insights-daily` cron at 7am:

```bash
openclaw cron add \
  --at "0 7 * * *" \
  --model anthropic/claude-sonnet-4-6 \
  --name "twitter-insights-daily" \
  --message "[Call twitter-synthesis with bookmarks from fetch script]"
```

Output is included in the morning digest with a "📱 TWITTER INSIGHTS" section showing:
- Top 3 content bytes (problem-solving, thought leadership, journey-based)
- 1-2 Claude setup improvement suggestions
- Link to full Twitter Insights database
