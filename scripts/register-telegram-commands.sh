#!/usr/bin/env bash
# register-telegram-commands.sh — Register Lyra's slash-command menu with Telegram.
#
# One-shot (idempotent): calls Telegram Bot API setMyCommands so the chat UI
# shows the command list in autocomplete. Re-run after editing COMMANDS below.
#
# Usage:
#   bash scripts/register-telegram-commands.sh           # reads token from /root/.openclaw/.env
#   TELEGRAM_BOT_TOKEN=xxx bash register-telegram-commands.sh
#
# Commands are handled downstream:
#   /reminders, /last  → tier-0 Python CRUD (crud/cli.py)
#   /brief, /weekly    → existing skills via router (chief-of-staff)
#   /health            → health-coach skill
#   /new               → new chat / reset context (handled by openclaw session)
#
# Telegram treats a /command just like a text message starting with "/" — the
# router's TIER0_PATTERNS / skill matchers decide what actually runs.

set -euo pipefail

if [ -z "${TELEGRAM_BOT_TOKEN:-}" ] && [ -f /root/.openclaw/.env ]; then
    # shellcheck disable=SC1091
    source /root/.openclaw/.env
fi

if [ -z "${TELEGRAM_BOT_TOKEN:-}" ]; then
    echo "register-telegram-commands: TELEGRAM_BOT_TOKEN not set and /root/.openclaw/.env unavailable" >&2
    exit 1
fi

read -r -d '' COMMANDS <<'JSON' || true
{
  "commands": [
    {"command": "reminders", "description": "List my open reminders"},
    {"command": "brief",     "description": "Morning brief (today's focus + priorities)"},
    {"command": "weekly",    "description": "Weekly review / summary"},
    {"command": "health",    "description": "Log or review health data (weight, sleep, steps)"},
    {"command": "new",       "description": "Start a fresh conversation (reset context)"},
    {"command": "last",      "description": "What did I ask you last?"}
  ]
}
JSON

response="$(curl -sS -X POST \
    "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setMyCommands" \
    -H 'Content-Type: application/json' \
    -d "${COMMANDS}")"

if printf '%s' "$response" | grep -q '"ok":true'; then
    echo "register-telegram-commands: ok — 6 commands registered with Telegram"
else
    echo "register-telegram-commands: FAILED" >&2
    printf '%s\n' "$response" >&2
    exit 1
fi
