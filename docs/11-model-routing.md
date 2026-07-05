# Model Routing — Intelligent Task Classification

## The problem

Lyra's previous routing was "always MiniMax, self-assess when to escalate." This relied on the cheap model knowing when it wasn't good enough — unreliable. MiniMax would attempt complex synthesis tasks, produce mediocre output, and the user would have to manually request Sonnet.

## The solution

A **programmatic router** that classifies the task BEFORE any model sees it:

```
User message
    │
    ▼
┌──────────────────────┐
│   RULE-BASED         │ <1ms, free
│   CLASSIFIER         │
│                      │
│ patterns + keywords  │
│ + complexity signals │
└──────────┬───────────┘
           │
     confidence >= 0.7?
    ┌──yes──┴──no──┐
    │              │
    ▼              ▼
 ┌──────┐   ┌───────────────┐
 │ROUTE │   │ LLM CLASSIFIER│ ~500ms, ~$0.001
 │      │   │ (Haiku)       │
 │      │   │               │
 │      │   │ Confirms or   │
 │      │   │ overrides     │
 │      │   └───────┬───────┘
 │      │           │
 │      │           ▼
 │      │        ┌──────┐
 └──┬───┘        │ROUTE │
    │            └──┬───┘
    └───────┬──────┘
            │
            ▼
    ┌───────────────┐
    │ MiniMax M2.7  │  87% — simple tasks
    │ Haiku 4.5     │   9% — moderate tasks
    │ Sonnet 4.6    │   4% — complex tasks
    └───────────────┘
```

## Three tiers

### Tier 1: MiniMax M2.7 (fast, cheap)
- Single Notion reads/writes
- Reminders, calendar adds
- Weather lookups
- Short replies, acknowledgments
- Cron management
- Self-edit operations

### Tier 2: Claude Haiku 4.5 (moderate)
- Email reading and drafting
- Web search
- Multi-step tasks (2-3 actions)
- Cross-user coordination
- Data formatting and export

### Tier 3: Claude Sonnet 4.6 (synthesis)
- Weekly/monthly synthesis
- Strategic analysis
- Competitive intelligence
- Long-form drafting (blog, proposals)
- Planning and prioritization
- Multi-source reasoning

## Classification methods

> **Where the live logic runs:** production routing happens in the OpenClaw plugin
> `plugins/lyra-model-router/index.js` — a synchronous, rule-based scorer with its own
> compiled pattern tables plus the Tier-0 CRUD bypass (`crud/cli.py`) and gbrain
> retrieve-then-synthesize hook. There is **no LLM classifier in the live path** (the
> plugin must return synchronously; the Haiku fallback below exists only in the CLI
> tool `scripts/model-router.js`).

### 0. Tier-0 deterministic bypass

Before any model routing, deterministic CRUD messages (reminders, groceries, meals…)
are regex-matched and executed directly via `crud/cli.py`. Zero tokens, ~100ms.

### 1. Rule-based scoring (the live path)

Pattern + signal scoring in the plugin:
- **Regex patterns** per tier (e.g., `"add .+ to .+ list"` → minimax)
- **Keyword detection** (e.g., "synthesize" → sonnet)
- **Complexity signals** (conjunction count, message length, question marks)
- **Override rules** (greetings always minimax, "weekly review" always sonnet)
- **ACL pinning** (partner traffic pinned to Haiku)
- **Emergency/threshold modes** (cost-pressure mode forces cheaper tiers)

### 2. LLM classifier (CLI tool only)

`scripts/model-router.js` (offline experiments) can escalate <0.7-confidence messages
to a Haiku classification. This never runs in production.

## Configuration

The CLI/documentation rules live in `config/routing-rules.yaml` (see the banner at the top of that file). To add a new category there:

```yaml
tiers:
  haiku:
    categories:
      new_category:
        patterns:
          - "regex pattern here"
        keywords: ["keyword1", "keyword2"]
        examples:
          - "Example message that should match"
```

## Analytics

Every routing decision is logged to `logs/routing-decisions.jsonl`:

```json
{
  "timestamp": "2026-03-18T10:30:00Z",
  "message_preview": "Add milk to shopping list",
  "tier": "minimax",
  "category": "notion_write",
  "confidence": 0.70,
  "classifier": "rules",
  "latency_ms": 0
}
```

View stats:
```bash
node scripts/model-router.js --stats
```

## Testing

Built-in test suite with 23 test cases:
```bash
node scripts/model-router.js --test
```

Batch testing:
```bash
echo "Add milk to list" | node scripts/model-router.js --batch
```

## Cost impact

| Scenario | Monthly cost |
|----------|-------------|
| Before (all MiniMax, manual escalation) | ~€18 but poor quality on complex tasks |
| After (smart routing) | ~€18-20 with correct model per task |
| Net effect | Same cost, dramatically better output on synthesis/strategy tasks |

The router adds ~$0.50-1.00/month in Haiku classification calls (for ~20% of messages that are ambiguous). This is offset by avoiding wasted MiniMax attempts on tasks it can't handle well.

## Files

| File | Purpose |
|------|---------|
| `config/routing-rules.yaml` | Routing rules configuration |
| `scripts/model-router.js` | Main router module + CLI |
| `plugins/lyra-model-router/index.js` | **Live** OpenClaw plugin (own pattern tables + Tier-0 bypass) |
| `skills/model-router/SKILL.md` | Skill definition for Lyra |
| `docs/11-model-routing.md` | This documentation |
| `logs/routing-decisions.jsonl` | Routing decision log |
