# Build Your Own Personal AI Agent in 30 Minutes

This is a minimal fork template from [Lyra](https://github.com/ahkedia/lyra-ai) — a production personal AI agent. Use this as a starting point to build your own.

## What you get

- 2-tier model routing (cheap model for simple tasks, smart model for complex ones)
- Telegram interface
- One example skill (reminders)
- 5 starter eval cases
- Structured logging

## Quick Start

```bash
# 1. Install OpenClaw
curl -fsSL https://get.openclaw.ai | bash
openclaw onboard

# 2. Copy this template
cp -r templates/minimal-agent/ ~/my-agent/
cd ~/my-agent/

# 3. Configure
cp .env.example .env
# Edit .env with your API keys

# 4. Deploy
openclaw gateway
```

## Customise

1. **`config/SOUL.md`** — Your agent's personality, rules, and boundaries
2. **`config/routing-rules.yaml`** — What goes to the cheap vs smart model
3. **`skills/`** — Add new capabilities (copy from `skills/reminders/` as template)
4. **`.env`** — Your API keys

## Add a Skill

```bash
mkdir skills/my-skill
cat > skills/my-skill/SKILL.md << 'EOF'
---
name: my-skill
description: What this skill does in under 30 words.
---
# My Skill
...
EOF
```

## Add Eval Cases

Add test messages to `evals/test-cases.yaml` with expected routing tier.

## Full Documentation

See the [main Lyra repo](https://github.com/ahkedia/lyra-ai) for:
- Full 3-tier routing with 18 categories
- Notion integration (13 databases)
- Household coordination (multi-user access control)
- Email, calendar, voice capture, self-edit skills
- Production monitoring, backups, auto-recovery
