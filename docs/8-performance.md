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
| SuperMemory recall (5 relevant memories) | ~250 |
| System overhead | ~500 |
| **Total** | **~2,879** |

**74% reduction. ~4x more capacity.**

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

### 5. Switch default model to Haiku

OpenClaw defaults to Sonnet. For 90% of Lyra's tasks — reminders, Notion writes, weather, quick replies — Haiku is identical in practice and has 5× the TPM headroom.

```json
{
  "agents": {
    "defaults": {
      "model": "anthropic/claude-haiku-3-5"
    }
  }
}
```

---

## Model routing architecture

Not all tasks are equal. Haiku handles most things; Sonnet is reserved for tasks that genuinely need deep reasoning.

### Haiku (default, live Telegram chat)
- Single-action commands: add reminder, write to Notion, check weather
- Lookups: query database, check calendar
- Short drafts: quick replies, one-paragraph summaries
- Routing: "what should I do next", "add X to Y"

### Sonnet (scheduled synthesis crons)
The 4 synthesis cron jobs always run on Sonnet:
- Morning news digest (aggregates RSS + Notion + search)
- Weekly job review (reasons about recruiter priorities)
- Weekly competitor digest (synthesises multiple sources)
- Weekly brain brief (finds patterns across all domains)
- Content reminder (drafts from Content Ideas, needs tone judgment)

### On-demand Sonnet escalation
Lyra self-routes. If a live message requires synthesis, strategic analysis, or complex planning, she escalates automatically:

```bash
openclaw cron add --at +0m \
  --model anthropic/claude-sonnet-4-6 \
  --session isolated \
  --announce \
  --delete-after-run \
  --name "sonnet-task" \
  --message "<full task here>"
```

The result arrives in Telegram in ~15 seconds. Lyra never attempts complex tasks in Haiku first.

---

## SuperMemory: solving static context

**The problem with MEMORY.md:** It's a flat file loaded on every message. "Add milk to the shopping list" loads Akash's full professional history, recruiter contacts, and content strategy. None of that is relevant. It's pure waste.

**What SuperMemory does differently:**
- Stores all facts as semantic embeddings in the cloud
- Before each turn, retrieves only the 5 most relevant memories to that specific message
- "Add milk" → recalls household context, not job search data
- "Help me prep for the Stripe interview" → recalls professional context automatically

**Token impact:** Instead of 555 tokens of static context every turn, you get ~250 tokens of *relevant* context. And those 250 tokens actually help.

**Setup:**
```bash
openclaw plugins install @supermemory/openclaw-supermemory
```

Set `plugins.slots.memory = "openclaw-supermemory"` in `openclaw.json`. Add `SUPERMEMORY_API_KEY` to your LaunchAgent plist.

**Containers:** Route different memory types to isolated namespaces:
- `work` — professional context (only accessible in primary user sessions)
- `household` — shared context (accessible to both users)
- `second-brain` — ideas, decisions, patterns

This also enforces the multi-user access control at the infrastructure level: your partner's sessions only touch the `household` container.

---

## Performance rule for all future changes

Written into `AGENTS.md` so Lyra enforces it herself during self-edits:

- SOUL.md + MEMORY.md combined must stay under 600 tokens
- MEMORY.md is for operational IDs only (Notion databases, schedules)
- Never add prose about people or preferences to MEMORY.md — use SuperMemory
- Never add a new always-loaded file to workspace — use skills (on-demand)
- New skill frontmatter descriptions must stay under 30 words
- New crons must check if they can batch with existing ones first
