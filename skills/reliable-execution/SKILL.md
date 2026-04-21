---
name: reliable-execution
description: Complete multi-step tasks after approval; avoid empty "Let me…" messages; never leak raw JSON parse errors to Telegram. Use when Akash says "do it" after you proposed steps, or when execution feels stuck.
---

# Reliable execution

Canonical rules live in **`config/SOUL.md`** — sections **Task execution & follow-through** and **User-facing errors (Telegram)**.

## Checklist
1. Akash approved → run tools **in the same turn** (read → write/edit or one allowed command) before saying "Done."
2. Multi-step → finish automatable steps or explicitly say done vs remaining.
3. Any `JSON.parse` / `SyntaxError` / position-N text → **do not** paste to Telegram; paraphrase and suggest retry/shorter message/fresh thread.
