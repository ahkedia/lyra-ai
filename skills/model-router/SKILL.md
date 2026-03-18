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

## Escalation

To escalate to Sonnet: `openclaw cron add --at +0m --model anthropic/claude-sonnet-4-6 --session isolated --announce --delete-after-run --name "sonnet-task" --message "<full task>"`. Do NOT attempt in MiniMax first.

To use Haiku: process using `anthropic/claude-haiku-4-5`.

## Fallback behavior

If MiniMax API returns error (HTTP 400/429/500/timeout):
1. Retry once after 3 seconds
2. If still failing, auto-escalate to Haiku
3. If Haiku also fails: "Both models are down. Try again in a few minutes."

If Notion API fails (5xx/timeout/rate limit):
1. Tell user: "Notion is temporarily unreachable. Here's what I would have done: [action]. I'll retry."
2. NEVER hallucinate success. Never say "Done" if the API call failed.
3. For task creation: save intent, retry on next message.

## Key rules

1. **Never attempt Sonnet tasks in MiniMax** — route correctly from the start
2. **When in doubt, escalate** — haiku is cheap, Sonnet is worth it for quality
3. **Override rules are absolute** — "weekly review" always goes to Sonnet
4. **Log every decision** — routing logs enable tuning over time

## Routing command

```bash
node ~/lyra-ai/scripts/model-router.js "message here"
node ~/lyra-ai/scripts/model-router.js --json "message here"
node ~/lyra-ai/scripts/model-router.js --stats
```
