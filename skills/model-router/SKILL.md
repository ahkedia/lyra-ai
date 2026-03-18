# Model Router Skill

Route incoming messages to the optimal model tier based on task complexity.

## When to invoke

Before processing any user message, classify it using the routing rules.

## Tiers

| Tier | Model | When |
|------|-------|------|
| **minimax** | MiniMax M2.5 | Single-action: Notion CRUD, reminders, weather, lookups, greetings |
| **haiku** | Claude Haiku 4.5 | Moderate: email, web search, multi-step, data formatting |
| **sonnet** | Claude Sonnet 4.6 | Complex: synthesis, strategy, analysis, long-form drafting, planning |

## Quick decision tree

```
Is it a greeting or acknowledgment? → minimax
Is it a single Notion read/write? → minimax
Is it a reminder or lookup? → minimax
Does it need email, search, or 2-3 steps? → haiku
Does it need reasoning across sources? → sonnet
Does it need strategic analysis? → sonnet
Does it need pattern-finding or synthesis? → sonnet
Unsure? → haiku (safe middle ground)
```

## Routing command

```bash
node ~/lyra-ai/scripts/model-router.js "message here"
node ~/lyra-ai/scripts/model-router.js --json "message here"
node ~/lyra-ai/scripts/model-router.js --stats
node ~/lyra-ai/scripts/model-router.js --test
```

## Key rules

1. **Never attempt Sonnet tasks in MiniMax** — route correctly from the start
2. **When in doubt, escalate** — haiku is cheap, Sonnet is worth it for quality
3. **Override rules are absolute** — "weekly review" always goes to Sonnet
4. **Log every decision** — routing logs enable tuning over time
