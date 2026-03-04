# Memory Architecture — From SuperMemory to SQLite

## The memory problem with OpenClaw

Every OpenClaw agent runs fresh each session. The built-in solutions — `MEMORY.md`, `session-memory` hook, `qmd` — all share the same fundamental flaw: they're **static files loaded wholesale into context**.

This creates two problems:

1. **Token waste** — "Add milk to the shopping list" loads your full professional biography, job hunt tracker, and content strategy. None of it is relevant.

2. **Static decay** — MEMORY.md only updates when you explicitly say "remember this." Everything said in conversation — decisions made, preferences expressed, context given — evaporates at session end.

After building Lyra and using it for real, this becomes the most painful limitation. Lyra would forget context from sessions two days ago. You'd re-explain the same background repeatedly. The "second brain" promise broke down at precisely the moment it mattered most.

## Why we moved away from SuperMemory

We started with [SuperMemory](https://supermemory.ai) Pro ($19/month). It solves the memory problem elegantly — semantic embeddings, auto-capture, dynamic recall. But after 6 weeks of heavy use (40+ daily interactions), two constraints became unbearable:

**1. Cost scaling issue**
- SuperMemory Pro: $19/month (fixed)
- Our usage: 40 queries/day × 365 days = 14,600 queries/year
- Per-session context cost: loading 500 tokens of static context + 250 tokens of recalled memories
- At our usage level: **$228/year on SuperMemory + token costs for context retrieval**

For a personal assistant, that's expensive. And the free tier (very limited) doesn't scale beyond a few interactions.

**2. Feature restrictions on paid tier**
- No direct data export (cloud-locked)
- Custom containers limited (multi-user access control was harder than it should be)
- No way to batch operations (every recall is a single API call)
- Limited insight into what's actually being stored

For a system you live inside every day, these restrictions add friction.

## The solution: SQLite hybrid approach

We built a **SQLite-backed memory system** that gets 90% of the semantic memory benefits for 10% of the cost:

**Layer 1: Operational database (SQLite)**
- Contacts, schedules, preferences
- Query-based retrieval (not semantic)
- Runs entirely local, on-machine
- Zero API costs

**Layer 2: Semantic layer (optional SuperMemory OR built-in search)**
- Stores brain dumps, ideas, decisions
- Can be extended to semantic embeddings later if needed
- Currently use keyword search + tagging

**Layer 3: Skill files (on-demand)**
- Detailed instructions for specific tools
- Only loaded when actually used

### Cost comparison

| Metric | SuperMemory Pro | SQLite Hybrid |
|--------|-----------------|---------------|
| Monthly cost | $19 | $0 |
| Per-session token overhead | ~750 tokens | ~100 tokens |
| Query speed | API-dependent (200-500ms) | Instant (local) |
| Data ownership | Cloud | Local machine |
| Setup time | 15 min | 30 min |
| **Monthly cost at 40 daily uses** | $19 + retrieval costs | $0 |
| **Annual savings** | — | **$228+** |

### Implementation

The SQLite setup includes:

```bash
# Database manager with full CLI
python3 lyra_db.py add-contact <id> <name> [company] [role]
python3 lyra_db.py search-contacts "query"
python3 lyra_db.py add-memory <id> <title> <content> <type>
python3 lyra_db.py backup  # Auto-backup to ~/Documents/lyra-backups/
```

**Payback analysis:**
- Setup token cost: ~4,300 tokens ($0.05)
- Savings per session: 650 tokens (~$0.008)
- Break-even: 7 sessions (~3 hours of heavy use)
- **Monthly ROI: $5.70+ saved vs SuperMemory subscription**

For personal assistants with daily use, this pays for itself in the first day.

## Setup: SQLite Hybrid Memory

### 1. Initialize the database

```bash
cd ~/.openclaw/workspace
python3 lyra_db.py  # Creates ~/.openclaw/workspace/lyra.db
```

### 2. Migrate your existing data

If you're coming from MEMORY.md or SuperMemory:

```bash
# Add contacts
python3 lyra_db.py add-contact "contact_id" "Name" "Company" "Role" "email@example.com"

# Add schedules
python3 lyra_db.py add-schedule "sched_1" "Morning digest" "07:00" "daily"

# Add memories (brain dumps, ideas)
python3 lyra_db.py add-memory "idea_001" "Idea title" "Full description" "idea" "tag1,tag2"
```

### 3. Enable automatic backups

Backups are created automatically in `~/Documents/lyra-backups/`:

```bash
# Manual backup
python3 lyra_db.py backup

# View backups
ls ~/Documents/lyra-backups/
```

### 4. (Optional) Extended semantic layer

If you want semantic search later (embeddings):

```python
# Add this to lyra_db.py when needed:
import anthropic

def embed_memory(memory_id, content):
    client = anthropic.Anthropic()
    embedding = client.embeddings.create(
        model="text-embedding-3-small",
        input=content
    )
    # Store embedding in SQLite
```

Currently, keyword search + tagging is sufficient for most use cases.

## Multi-user access control

With SQLite, access control is enforced at the configuration level:

```python
# In SOUL.md or agent config:
# If message is from partner:
#   - Query only 'household' table
#   - Skip 'work' and 'personal' tables
#   - Return household context only
```

The boundary is enforced by the agent before querying, not by trusting the model to refuse.

## CLI Commands

Users can interact with memory directly:

```bash
# Add/update a contact
python3 lyra_db.py add-contact "vikram_meta" "Vikram Sharma" "Meta" "Recruiter"

# Search contacts
python3 lyra_db.py search-contacts "Meta"

# Add a brain dump
python3 lyra_db.py add-memory "idea_001" "Title" "Content" "idea" "tags"

# Search ideas
python3 lyra_db.py search-memories "n26"

# View all schedules
python3 lyra_db.py search-schedules

# Export everything as JSON
python3 lyra_db.py export > backup.json

# Create a backup
python3 lyra_db.py backup
```

## What to put where

| Content type | Where it lives | Notes |
|---|---|---|
| Who you are, your role, preferences | SQLite `preferences` table | Loaded once per session |
| Contacts, recruiters, companies | SQLite `contacts` table | Query-based, instant retrieval |
| Recurring schedules (daily digest, etc.) | SQLite `schedules` table | Read at cron execution time |
| Ideas, decisions, brain dumps | SQLite `memories` table | Searchable by keyword + tags |
| Notion database IDs | MEMORY.md | Operational, not conversational |
| Tool instructions, API patterns | Skill files | Loaded on-demand only |

## Verifying it works

```bash
# Test database
python3 lyra_db.py search-contacts "your_name"

# View database structure
sqlite3 ~/.openclaw/workspace/lyra.db ".schema"

# Check total memory size
du -h ~/.openclaw/workspace/lyra.db

# Export everything
python3 lyra_db.py export | head -20
```

The SQLite file typically stays under 500KB even with years of data.
