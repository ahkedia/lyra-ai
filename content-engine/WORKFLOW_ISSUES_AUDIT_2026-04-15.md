# Content Workflow Issues Audit (2026-04-15)

This document captures all major failures observed while operating the current Lyra + content-engine workflow, with root causes and a concrete fix plan.

---

## Executive Summary

The core workflow is partially functional, but unreliable for hands-off use because:

1. **Telegram update polling is split across multiple consumers** (Lyra/OpenClaw and content approval bot) using the **same bot token**, causing command loss/race conditions.
2. **Feedback/rewrite UX is mismatched** with user expectations (feedback records learnings, but does not rewrite current draft automatically).
3. **Operational lock and deployment drifts** created intermittent stuck behavior and broken runs.
4. **Prompt/output parsing brittleness** caused quality gate and humanization stages to fail silently or degrade.

Net effect: user must repeatedly return to laptop/manual intervention despite intended autonomous flow.

---

## User-Facing Symptoms

### A) "When I give feedback on a draft to Lyra, it loses context."

Observed behavior:
- Feedback sent in Telegram often does **not** route to content approval workflow.
- Lyra replies in generic assistant mode, not in "content-engine draft revision" mode.

Impact:
- Voice canon / Notion workflow context appears "forgotten."
- Draft state in Content Drafts is not consistently updated by feedback commands.

---

### B) "When I ask it to redo an image, it fails."

Observed behavior:
- `REDO` intent is inconsistently applied from chat.
- Sometimes visual generation required manual triggering.

Impact:
- Image regeneration is not trustworthy from user chat alone.

---

### C) "APPROVE sent, but nothing happens."

Observed behavior:
- Draft remained `text_approval_status = pending` after user sent approval.
- Approval-bot logs showed "No new updates" despite user interaction.

Impact:
- Approval and image generation chain stalls.

---

## Root Causes (Confirmed)

## 1) Telegram `getUpdates` conflict (highest severity)

Evidence:
- OpenClaw logs repeatedly show:
  - `409 Conflict: terminated by other getUpdates request; make sure that only one bot instance is running`
- Content approval bot and Lyra/OpenClaw both poll Telegram using shared token/env.

Why this breaks context:
- Messages are consumed by whichever poller wins.
- Approval-bot misses commands (`APPROVE`, `FEEDBACK`, `REDO`) and cannot transition draft state.
- Lyra handles messages outside content-engine state machine.

---

## 2) Feedback command semantics do not match expected "rewrite now"

Current behavior in `approval-bot.js`:
- `FEEDBACK <text>`:
  - writes feedback to draft page
  - sets `text_approval_status = feedback`
  - updates `config/learnings.json`
  - sends "recorded for future drafts" message
- It does **not** regenerate the current draft.

Why this feels like "lost context":
- User expects iterative editing on active draft.
- System records feedback as policy/training input instead.

---

## 3) Lockfile strategy collision (partially fixed)

Prior issue:
- `cron-task-runner` lock and script-level lock used overlapping names.
- Scripts exited with:
  - `Lock exists (PID ), exiting`

Status:
- Adjusted script-level locks to separate filenames (`*-script.lock`) for draft/approval.

Residual risk:
- Need consistent lock naming policy across all scripts/jobs to avoid future regressions.

---

## 4) Deployment drift / missing exports caused runtime failures (fixed ad hoc)

Observed:
- `draft-generator.js` failed on server due to import/export mismatch with `notion.js`.
- Quality gate failed initially due to missing `evaluateTopicGate` export and fragile JSON parsing.

Status:
- Patched and deployed, but process is fragile because multiple repos/scripts are coupled and can drift.

---

## 5) Topic Pool schema assumptions not guaranteed (fixed once, should be automated)

Observed:
- Quality gate failed when Topic Pool lacked:
  - `Shortlisted on`
  - `Quality score`

Status:
- Added manually via Notion API.

Residual risk:
- No startup schema validator; future DB recreation changes can silently break pipeline.

---

## 6) Humanization / gate parsing brittleness

Observed:
- Haiku responses often not strict JSON.
- Pipeline fell back with:
  - `Haiku response not JSON, using raw blog`

Status:
- Improved parsing for gate path (extract fenced JSON / braces).
- Still needs stronger structured-output enforcement across all model calls.

---

## Current Workflow State (as of this audit)

- Topic ingest and candidate creation: working.
- Quality gate: working after patches and schema fix.
- Draft generation: working.
- Approval and redo from Telegram: **unreliable due to poller conflict**.
- Manual operator intervention: still required frequently.

---

## Required Fixes (Priority Order)

## P0 (must-do)

1. **Split Telegram bots (or switch one side to webhook)**
   - Give content-engine its own `TELEGRAM_BOT_TOKEN`.
   - Keep Lyra/OpenClaw bot separate.
   - Ensure only one consumer per bot token for `getUpdates`.

2. **Implement deterministic command routing**
   - Enforce command namespace in content bot (`/approve`, `/feedback`, `/redo`) to prevent ambiguity.
   - Reject unrecognized freeform input with actionable help.

3. **Add "rewrite current draft" path**
   - New command: `REWRITE <brief>`
   - Should regenerate same draft topic with voice canon + author brief + new feedback.
   - Replace or version the current draft row deterministically.

## P1 (high)

4. **Schema guardrail at startup**
   - Script checks required Topic Pool / Drafts properties and exits with clear alert if missing.

5. **Structured output hardening**
   - Add resilient parser utility for all model JSON outputs.
   - Add retry with stricter prompt if parse fails.

6. **Cross-repo deployment integrity check**
   - One command to verify expected versions/commits in:
     - `/root/content-engine`
     - `/root/lyra-ai/scripts/*`
   - Prevent partial upgrades.

## P2 (quality)

7. **Observability dashboard/alerts**
   - Metrics: pending drafts age, command success rate, getUpdates conflicts, image regen failure rate.

8. **UX simplification**
   - Present active draft card with explicit actions and state transitions.
   - Confirm command target draft by ID/title in bot response.

---

## Recommended Refactor for Opus 4.5 Session

Ask model to implement this as a single tracked effort:

1. **Dedicated content Telegram bot integration**
2. **Command router with strict intents**
3. **REWRITE flow for same-draft regeneration**
4. **Schema validator + healthcheck CLI**
5. **End-to-end integration tests (mock Telegram + Notion stubs)**

Suggested acceptance criteria:
- `APPROVE` always transitions latest pending draft to approved and triggers image.
- `REDO` always regenerates image for targeted draft and updates visual URL.
- `FEEDBACK` + `REWRITE` produces revised draft in same workflow without laptop intervention.
- Zero `getUpdates conflict` for content bot over 24h.

---

## Quick Repro Checklist (for next debugging session)

1. Send `APPROVE` to bot while one draft is pending.
2. Verify in logs:
   - approval-bot receives update
   - `Text APPROVED`
   - `Generating visual`
3. Verify Notion transitions:
   - `text_approval_status: approved`
   - `visual_approval_status: pending`
   - `visual_url` populated
4. Send `REDO <specific hint>`
5. Verify new image URL + `redo_count` increment.

---

## Notes

- The user behavior is not the issue.
- Main blocker is architectural contention and unclear command semantics.
- Once bot separation + rewrite path are in place, workflow should become reliably "phone-first" without laptop rescue.

