# Lyra AI — deferred work

Consolidated list for all Lyra work — repo engineering, cron fixes, evals, content engine. Updated after each session.

---

## Active

| ID | What | Why | Status | Depends on |
|----|------|-----|--------|------------|
| L-8a | ~~Fix `morning-weight-nudge` stalling~~ | MiniMax M2.7 reasoning mode stalled daily at 9am Berlin | ✅ DONE 2026-06-07 | — |
| L-8b | ~~Fix `wiki-candidate-review-merged` stalling~~ | No model set → MiniMax default stalled daily at 9pm Berlin | ✅ DONE 2026-06-07 | — |
| L-14 | ~~Delete old shell scripts~~ | Deleted in 2026-07 architecture cleanup (`fetch-twitter-bookmarks.sh`, `bookmarks-to-notion.sh`; kept `get-twitter-oauth-refresh-token.sh`). | ✅ DONE 2026-07-05 | — |
| L-5 | Close heap observation window | Window ended 2026-04-28. No OOM observed. A3 alarm (L-6) guards recurrence. Just close. | Open (stale) | — |
| L-15 | ~~Content engine quality gate + approval fix~~ | Options A+B implemented 2026-06-07. See Done section. | ✅ DONE 2026-06-07 | — |
| L-1 | Atomic lock for content-engine hot paths | Removes rare double-acquire race between cron and manual runs | Low priority | — |
| L-2 | bats in CI (GitHub Action) | Catches bash regressions without local brew | Low priority | Runner image with `bats` |
| L-4 | Upstream OpenClaw #69787: 409 retry loop | Track until fixed in npm release, deploy, verify 409s → ~0 | Passive watch | — |
| E-1 | Health logging evals (P0) | 14 Tier-0 patterns, highest daily frequency, zero eval coverage | Open | — |
| E-2 | ~~Fix mislabeled `tier0-mark-done` eval~~ | Renamed to `tier0-list-reminders`; added `tier0-mark-done-actual` (real write path). | ✅ DONE 2026-07-05 | — |
| E-3 | Email read eval (P1) | `tool-email-draft` tests drafting only; read path is a different code path | Open | — |
| E-4 | ~~Job application pipeline eval (P0)~~ | Added `job-apply-phase-a` + `job-apply-phase-b-cover-letter` (tier5); tracker upsert case still open. | ✅ DONE 2026-07-05 (partial: recruiter-tracker case open) | — |
| E-5 | Content draft quality eval (P1) | Voice canon adherence untested despite voice system investment | Open | — |
| E-6 | Wiki ops eval (P1) | 14 Tier-0 patterns across lenny-search, wiki-lint, wiki-dedup — all uneval'd | Open | — |
| E-7 | HOT commentary eval (P1) | Bypasses LLM entirely; no eval for whether it returns content or fails silently | Open | — |
| E-8 | Calendar graceful degradation eval (P1) | Calendar unavailable from Hetzner; no eval for graceful failure message | Open | — |
| E-9 | Web search quality eval (P1) | Tavily used for job research; no quality eval | Open | — |
| E-10 | Self-edit safety eval (P1) | `self_edit` can modify SOUL.md; no confirmation gate or destructive-edit refusal eval | Open | — |
| E-11 | Sonnet escalation verification | No eval checks `model` field in routing log to confirm Sonnet was invoked | Deferrable | — |
| E-12 | Cron add/remove eval | `tool-cron-list` tests listing only; create/remove is untested | Deferrable | — |
| E-13 | Write→read consistency (Shopping, Second Brain) | Only reminders tested for write+read consistency | Deferrable | — |
| E-14 | Competitor digest quality eval | Zero eval despite being in `always_sonnet` | Deferrable | — |
| E-15 | Akash-specific ambiguity patterns | "Update that", "Check the status" — not covered | Deferrable | — |
| PHASE-4 | ~~Flip eval gate to blocking~~ | Flipped 2026-07-05: `--enforce` + no `continue-on-error` in eval-gate.yml. (Telegram authoring approval still open.) | ✅ DONE 2026-07-05 (gate) | — |

---

## L-15 Detail

**Current state (2026-06-07):** Content pipeline is operational but producing zero output. Quality gate rejects all auto-sourced topics (scoring 1–5, threshold ≥7). 116 topics in pool, nothing Shortlisted. Draft generator idles. Approval bot has nothing to poll.

**Known P0 bugs still unresolved (from 2026-04-15 audit):**
- Dual Telegram bot conflict (content-engine bot + Lyra share same token → `getUpdates` 409 → APPROVE silently lost)
- FEEDBACK records for future but doesn't rewrite current draft
- APPROVE can fail if Lyra wins the poller race

**Targeted fix options (prefer over full rewrite):**
- (a) Lower quality gate threshold: `config/sources.json` → `topicPool.queue.qualityMinScore` 7→5. Immediate output.
- (b) Fix dual-bot conflict: route `APPROVE`/`SKIP`/`REDO` through Lyra directly instead of a separate poller.
- (c) Full L-15 rewrite: 1 cron, inline keyboard, no separate approval bot. Higher effort, same outcome.

**Decision needed from Akash:** which approach + whether auto-posting to X/LinkedIn is still the end goal (affects architecture choice).

---

## Done (archive when stale)

- 2026-06-07: **L-8a — `morning-weight-nudge` stall fixed.** Root cause: `minimax-direct/MiniMax-M2.7` is a reasoning model; triggers `<think>` mode for a trivial 1-sentence nudge, then stalls at 140s with no timeout set. Fix: model → `anthropic/claude-haiku-4-5`, added `timeoutSeconds: 30`. Deployed to `/root/.openclaw/cron/jobs.json`, service restarted, confirmed healthy. Config committed to `config/cron-jobs.json` in repo.
- 2026-06-07: **L-15 — Content pipeline unblocked (Options A + B).** Option A: `qualityMinScore` 7→5 in `content-engine/config/sources.json`. Pipeline had 116 topics in pool but zero drafts for weeks — all scored 1-5, gate threshold was 7. Immediate result: 10 pending text drafts + 3 pending visual drafts after the fix. Option B: eliminated dual-bot Telegram 409 conflict. Root cause: `approval-bot.js` polled `getUpdates` on the same token as OpenClaw; APPROVE/SKIP/REDO messages were consumed by Lyra before the approval bot ran. Fix: added `runDirectCommand()` + `--cmd` mode to `approval-bot.js` (no Telegram polling); added tier-0 dispatch in `crud/cli.py` + 5 `TIER0_PATTERNS` in router. Disabled `content-approval-bot` system cron. Now: send `APPROVE`/`SKIP`/`REDO <hint>`/`FEEDBACK <text>`/`STATUS` directly to Lyra — it handles them without polling conflict.
- 2026-06-07: **L-8b — `wiki-candidate-review-merged` stall fixed.** Root cause: no model specified, fell to MiniMax default, same reasoning stall pattern at 9pm Berlin. Fix: added `model: anthropic/claude-haiku-4-5`, reduced `timeoutSeconds: 600→300`. Haiku is sufficient for 2 Notion queries + short digest. Same deploy.
- 2026-05-31: **Phase 2 — Classifier + shadow gate deployed** (commit 061c725). `evals/gate/classify-diff.js` + `check-eval-coverage.js`. Shadow-only (exit 0). 2 weeks of data accumulating before flip to enforce.
- 2026-06-04: **Phase 3 — Eval dashboard built + verified** (commit 41a4907). Dark-theme page at `evals/dashboard/`. Mirror to `docs/dashboard/` on GitHub via run-evals.sh Step 4.
- 2026-05-31: **Phase 1 — Eval harness resurrected.** `ws-client.js` `maxProtocol: 3→4`. Preflight now does real ws handshake + Telegram alert. Baseline 65%→71% after validity triage. Rate-limit pacing, latency de-gated, dry-run prefix opt-out on 11 read-only tests.
- 2026-04-21: **Personal Wiki Tier 0 + News Inbox RSS.** See previous entry.
- 2026-04-22: **Twitter bookmark pipeline unified.** See previous entry.
- 2026-04-21: **WhatsApp stripped at runtime.** See previous entry.
- 2026-04-21: **L-10 — tier-0 eval reminder regression test.** See previous entry.
- 2026-04-21: **L-11 — eval-pollution audit clean.** See previous entry.
- 2026-04-21: **L-12 — branch protection drift (ops playbook).** See previous entry.
- 2026-04-21: **L-13 — WhatsApp removed.** See previous entry.
- 2026-04-21: **L-9 — router split-brain removed.** See previous entry.
- 2026-04-21: **Streams 3/4 — Group A shipped.** See previous entry.
- 2026-04-21: **Eval pollution root-cause fixed** (commit 20a66a1). See previous entry.
- 2026-04-21: **Cron timeouts bumped** on wiki-health-check + second-brain-wiki-review-daily (240s→480s). See previous entry.
- 2026-04-21: **Self-audit `\n` rendering bug fixed** (commit 0353d77). See previous entry.
- 2026-04-21: **Lane B1 — Telegram slash-command menu.** See previous entry.

---

## How to run tests

- **lyra-ai:** `npm test`. Optional: `npm run test:bats` if bats-core is installed.
- **content-engine:** `npm test` (Vitest, includes `tests/lockfile.test.js`).

---

## Maintenance notes

- `lyra-private/config/cron-jobs.json` (PRIVATE repo, `/root/lyra-private` on Hetzner) mirrors `/root/.openclaw/cron/jobs.json`. Sync after any cron change. It moved out of this public repo — see `docs/12-public-private-split.md`.
- `/root/.openclaw/openclaw.json` is immutable (`chattr +i`). Unlock before editing: `ssh hetzner "chattr -i /root/.openclaw/openclaw.json"`, re-lock after.
- Eval gate is in shadow mode until PHASE-4 is started. Check `evals/gate/logs/shadow-decisions.jsonl` on Hetzner for false-positive rate.
