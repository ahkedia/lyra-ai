# Contributing to Lyra

Lyra is a personal AI agent that runs 24/7 on a cloud VPS, coordinates a household, and integrates with Notion, Telegram, email, and calendar. It's built on [OpenClaw](https://openclaw.ai) and uses a 3-tier model router (MiniMax M2.5 → Claude Haiku → Claude Sonnet) to keep costs low while maintaining quality.

This guide helps you contribute — whether that's a new skill, better routing rules, more eval cases, or infrastructure improvements.

---

## Quick Setup

```bash
# Clone
git clone https://github.com/ahkedia/lyra-ai.git
cd lyra-ai

# Install dependencies
npm install

# Copy env template
cp .env.example .env
# Fill in your API keys (MiniMax, Anthropic, Notion, Telegram)

# Run router tests to verify setup
node scripts/model-router.js --test
```

---

## Adding a New Skill

Skills are how Lyra learns new capabilities. Each skill lives in `skills/<name>/SKILL.md`.

### 1. Create the skill file

```bash
cp skills/_template/SKILL.md skills/your-skill/SKILL.md
```

### 2. Write the frontmatter

```yaml
---
name: your-skill
description: One-line description under 30 words explaining what this skill does.
---
```

### 3. Document operations

Include: what the skill does, how to invoke it, example commands, decision logic, and error handling. The agent reads this file to learn the skill — be explicit.

### 4. Add routing patterns (if needed)

If your skill handles a new type of message, add patterns to `config/routing-rules.yaml` under the appropriate tier:
- **minimax**: Simple, single-action commands
- **haiku**: Multi-step or nuanced tasks
- **sonnet**: Synthesis, strategic analysis, complex reasoning

### 5. Add eval test cases

Add at least 3 test cases to `evals/routing-eval.js` to verify your skill's messages route to the correct tier.

### Chief of Staff (`skills/chief-of-staff/`)

Operational workflows (morning prep, inbox/calendar discipline, `tasks/current.md`) live in **`skills/chief-of-staff/SKILL.md`**. Shared workspace assets: **`workspace/TOOLS.md`**, **`workspace/tasks/current.md`** — synced to `~/.openclaw/workspace/` by `scripts/deploy-lyra.sh` and backed up from the server by `scripts/memory-backup.sh`. Keep router/CRUD changes separate: CoS is orchestration only, not new Tier 0 patterns.

---

## Adding Eval Test Cases

Evals are ground-truth labeled messages that verify the router works correctly.

### In `evals/routing-eval.js`

Add entries to the `GROUND_TRUTH` array:

```javascript
{ message: "Your test message here", expected_tier: "minimax" },
```

### In `evals/cases/` (YAML)

For judgment-quality evals, add to the appropriate tier file:

```yaml
- id: your-test-id
  prompt: "The message to test"
  criteria:
    - "What good looks like"
    - "Another quality criterion"
```

---

## Running Tests

```bash
# Router built-in tests (23 cases, rule-based, free)
node scripts/model-router.js --test

# Router ground-truth eval (46 cases, free)
node evals/routing-eval.js

# Full eval suite (requires API keys, costs ~$0.36)
bash evals/run-evals.sh --force

# Router stats (distribution analysis)
node scripts/model-router.js --stats
```

---

## PR Process

### Branch naming

```
feature/add-calendar-skill
fix/routing-email-pattern
chore/update-dependencies
```

### Required checks

All PRs run the CI pipeline (`.github/workflows/ci.yml`) which checks:
- YAML config validation
- SOUL.md token count < 700 words
- Skill frontmatter descriptions < 30 words
- No hardcoded secrets
- Router tests pass (23 cases)

### Commit messages

Imperative mood, concise:
- "Add Google Calendar skill with OAuth2 auth"
- "Fix routing pattern for email drafts"
- "Update eval cases with calendar patterns"

---

## Code Conventions

- **ESM modules**: Project uses `"type": "module"`. Use `import`, never `require()`.
- **Files**: kebab-case (`gcal-helper.js`, `cost-tracker.sh`)
- **Functions**: camelCase
- **Constants**: UPPER_SNAKE_CASE
- **Scripts**: `set -euo pipefail` at the top, source `lyra-logger.sh` for structured logging
- **Security**: Never commit secrets. Validate all input. Parameterize queries.

---

## Architecture Overview

```
Message → Model Router → MiniMax (87%) / Haiku (9%) / Sonnet (4%)
                ↓
         OpenClaw Gateway
                ↓
    Skills (Notion, Email, Calendar, ...)
                ↓
        Response → Telegram
```

The router (`scripts/model-router.js`) classifies messages using:
1. **Rule-based patterns** from `config/routing-rules.yaml` (free, <1ms)
2. **LLM fallback** via Haiku for ambiguous cases (~$0.001, ~500ms)

---

## Questions?

Open an issue or reach out to [Akash Kedia](https://github.com/ahkedia).
