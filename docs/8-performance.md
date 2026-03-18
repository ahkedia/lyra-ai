# Performance — Token Optimisation and Model Routing

## Why this matters

Claude API billing is per token, and Anthropic rate limits are per token per minute (TPM). On Tier 1:
- Claude Sonnet: 40,000 TPM
- Claude Haiku: 200,000 TPM

Every message Lyra responds to costs tokens in *both* directions — input (context loaded) + output (response). Without optimisation, this setup loaded ~11,000 tokens per turn, meaning Lyra could only handle **3 messages per minute** before hitting rate limits. Completely unusable for daily life.

After the optimisations documented here: **~2,900 tokens per turn. 69+ turns/minute headroom on Haiku.**

---

## What loads on every turn

Before optimisation, every single Lyra response — including "add milk to the shopping list" — loaded all of this:

| File | Tokens |
|------|--------|
| AGENTS.md (unedited OpenClaw default) | ~1,967 |
| SOUL.md (verbose) | ~1,523 |
| MEMORY.md (verbose + recruiter contact list) | ~1,394 |
| NOTION-CONTEXT.md (in workspace, loaded every turn) | ~2,362 |
| BOOTSTRAP.md (one-time setup file, never deleted) | ~367 |
| IDENTITY.md, TOOLS.md, USER.md (empty templates) | ~493 |
| Skill frontmatter | ~482 |
| **Total** | **~10,882** |

After optimisation:

| File | Tokens |
|------|--------|
| SOUL.md (condensed) | ~699 |
| MEMORY.md (operational IDs only) | ~357 |
| AGENTS.md (trimmed) | ~381 |
| IDENTITY.md, TOOLS.md, USER.md | ~106 |
| HEARTBEAT.md | ~42 |
| Skill frontmatter (8 skills) | ~544 |
| SQLite memory recall (keyword + tags) | ~100 |
| System overhead | ~500 |
| **Total** | **~2,729** |

**75% reduction. ~4x more capacity.**

---

## The five optimisation moves

### 1. Delete BOOTSTRAP.md

OpenClaw's setup wizard creates this file and explicitly says "delete it after first run." It never gets deleted. 367 tokens wasted on every message describing how to introduce yourself to your user.

```bash
rm ~/.openclaw/workspace/BOOTSTRAP.md
```

### 2. Move NOTION-CONTEXT.md out of workspace

Any `.md` file in `~/.openclaw/workspace/` is loaded on every turn. The Notion reference file (2,362 tokens) only needs to exist when Lyra is making an API call. Move it out:

```bash
mkdir -p ~/.openclaw/references
mv ~/.openclaw/workspace/NOTION-CONTEXT.md ~/.openclaw/references/notion.md
```

Update SOUL.md to reference `~/.openclaw/references/notion.md` instead.

### 3. Trim SOUL.md and MEMORY.md

**SOUL.md** should contain: identity, hard rules, access levels, tool quick-reference, model routing. It should NOT contain verbose "assistance modes" prose or full recruiter contact lists.

**MEMORY.md** after SuperMemory: only operational IDs (Notion database IDs) and schedules. Every conversational fact about who you are goes into SuperMemory — not a static file loaded on every turn.

### 4. Replace verbose OpenClaw defaults

`AGENTS.md`, `IDENTITY.md`, `TOOLS.md`, `USER.md` are OpenClaw system templates with generic instructions. Replace with tight, purpose-specific versions. The default AGENTS.md alone has full sections on Discord formatting, group chat emoji reactions, and TTS voice storytelling — none of which apply.

### 5. Switch default model to MiniMax M2.5

OpenClaw defaults to Sonnet. For ~87% of Lyra's tasks — reminders, Notion writes, weather, quick replies — MiniMax M2.5 is sufficient and dramatically cheaper.

```json
{
  "agents": {
    "defaults": {
      "model": "minimax/minimax-m2-5"
    }
  }
}
```

---

## Model routing architecture (3-tier)

Not all tasks are equal. A rule-based classifier + LLM fallback routes each message to the cheapest capable model. See `config/routing-rules.yaml` and `scripts/model-router.js`.

### MiniMax M2.5 (default, ~87% of tasks)
- Single-action commands: add reminder, write to Notion, check weather
- Lookups: query database, check calendar
- Quick replies, status confirmations, simple Q&A

### Claude Haiku 4.5 (moderate, ~9% of tasks)
- Short drafts: email replies, one-paragraph summaries
- Multi-step but single-domain tasks
- Data formatting, comparisons within one source

### Claude Sonnet 4.6 (complex, ~4% of tasks)
The 4 synthesis cron jobs always run on Sonnet:
- Morning news digest (aggregates RSS + Notion + search)
- Weekly job review (reasons about recruiter priorities)
- Weekly competitor digest (synthesises multiple sources)
- Weekly brain brief (finds patterns across all domains)
- Content reminder (drafts from Content Ideas, needs tone judgment)

### On-demand Sonnet escalation
Lyra self-routes via `scripts/model-router.js`. If a live message requires synthesis, strategic analysis, or multi-domain reasoning, she escalates automatically:

```bash
openclaw cron add --at +0m \
  --model anthropic/claude-sonnet-4-6 \
  --session isolated \
  --announce \
  --delete-after-run \
  --name "sonnet-task" \
  --message "<full task here>"
```

The result arrives in Telegram in ~15 seconds. Lyra never attempts complex tasks in MiniMax first. Fallback chain: MiniMax error → retry → Haiku → if both fail, tell user.

---

## Memory: from SuperMemory to SQLite hybrid

**The problem with MEMORY.md:** It's a flat file loaded on every message. "Add milk to the shopping list" loads Akash's full professional history, recruiter contacts, and content strategy. None of that is relevant. It's pure waste.

**Original approach (SuperMemory Pro, $19/month):** Semantic embeddings in the cloud, dynamic recall per-turn. Worked well but cost-prohibitive and cloud-locked at scale. See `docs/9-supermemory.md` for the full migration story.

**Current approach (SQLite hybrid, $0/month):**
- Layer 1: SQLite local DB — contacts, schedules, preferences (keyword + tag search, instant)
- Layer 2: Skill files — detailed instructions loaded on-demand only
- Layer 3: MEMORY.md — operational IDs only (Notion DBs, schedules), kept under 357 tokens

**Token impact:** Instead of 555 tokens of static context every turn, you get ~100 tokens of operational IDs. Relevant context is retrieved on-demand via skill files and SQLite queries.

**Access control:** SQLite tables are namespaced per user — Abhigna's sessions only query `household` and her personal tables.

---

## Performance rule for all future changes

Written into `AGENTS.md` so Lyra enforces it herself during self-edits:

- SOUL.md + MEMORY.md combined must stay under 600 tokens
- MEMORY.md is for operational IDs only (Notion databases, schedules)
- Never add prose about people or preferences to MEMORY.md — use SQLite or skill files
- Never add a new always-loaded file to workspace — use skills (on-demand)
- New skill frontmatter descriptions must stay under 30 words
- New crons must check if they can batch with existing ones first
