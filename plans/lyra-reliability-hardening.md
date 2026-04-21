# Lyra reliability hardening (targeted refactor)

**Status:** Draft plan, eng-reviewed in-session  
**Owner:** Akash  
**Repo:** `lyra-ai` (+ `content-engine` on server under `/root/content-engine`)  
**Last updated:** 2026-04-15

## Problem statement

Production has shown: duplicate `openclaw-gateway` processes (including orphans with PPID 1), Telegram `getUpdates` 409 conflicts, Node heap OOM under load, and content pipeline jobs exiting early (`Lock exists (PID ), exiting` in approval-bot). Cron fires, but work is skipped or the bot fights itself. Goal is **trust**: one gateway, predictable jobs, clearer failure signals, without rewriting “Lyra” as a product.

## Goals (acceptance criteria)

1. **Single gateway invariant:** At steady state, exactly one long-lived `openclaw-gateway` serves port `18789` and Telegram long-poll. Restarts do not leave orphans.
2. **Stale lock recovery:** Content approval-bot lock at `/tmp/content-approval-bot-script.lock` must not block forever if holder is dead or file is empty; log must show actionable PID or “stale lock removed”.
3. **Observability:** One place to answer “is gateway duplicated?” (script or health check) and alert or log when count ≠ 1.
4. **Load shaping (minimum):** Document which crons overlap; adjust timeouts or stagger so 4 GB VPS is not routinely in swap + heap pressure during eval + content-engine + gateway.

## Non-goals (explicit)

- Rewriting OpenClaw or replacing the gateway with a different stack.
- Full content-engine redesign.
- WhatsApp channel work (missing env is already a known config warning).

## Workstreams

### A. Gateway process model

- **Audit:** Every entry point that can run `openclaw gateway` or hold `18789` (systemd unit, `openclaw-wrapper.sh`, eval cron `openclaw agent`, manual runs).
- **Hypothesis to validate:** `openclaw gateway` may spawn/reparent such that `$!` in the wrapper is not the only live server PID; `cleanup_port` + restart may race with a child still bound to the port or reparented to init.
- **Changes (minimal):** Prefer `exec` or documented single-child model if upstream supports it; else post-start verification loop in `openclaw-wrapper.sh` that lists PIDs listening on `18789` and kills **only** non-tracked duplicates after TERM window; or PID file written by gateway if supported.
- **Tests / verification:** `systemctl restart openclaw` then `sleep 5` and assert `ss -ltnp | grep 18789` shows one listener; `ps` shows one main gateway tree under wrapper.

### B. Lockfile hardening (`content-engine`)

- **File:** `scripts/lib/lockfile.js` (and callers).
- **Behavior:** If lock exists, read PID; if empty/non-numeric, treat as stale and remove. If numeric, `kill -0` (or `/proc/$pid` on Linux); if dead, remove and acquire. If alive and not ours, exit 0 with clear log (current behavior, but correct message).
- **Tests:** Unit tests for acquire with stale empty file, stale dead PID, live PID (mock fs + process check).

### C. Cron and capacity

- **Inventory:** `crontab -l` on server: `cron-task-runner.sh` timeouts vs job duration (e.g. approval-bot 180s, eval window).
- **Action:** Stagger `content-draft-generator` vs heavy eval window, or increase `cron-task-runner` budget where safe; document in `CLAUDE.md` or `lyra-ai` ops doc.

### D. Telegram readability (optional follow-up, same PR only if tiny)

- Prompt or `SOUL.md` tweak: default reply shape for Telegram (short summary first). Defer if it expands scope.

## Risks

- Killing “wrong” PID if heuristics are sloppy: blast radius is outage. Prefer narrow checks (port owner, cgroup, or explicit PID file from OpenClaw if available).
- Changing wrapper behavior without staging: do on-server backup of script, restart, watch journal 15 min.

## Rollout

1. Land B (lockfile) in `content-engine` repo, deploy to server path, verify logs for one hour.
2. Land A in `lyra-ai` wrapper + docs, deploy, monitor 24h for 409 and duplicate PIDs.
3. C as config-only after A/B stable.

---

## GSTACK REVIEW REPORT


| Review     | Trigger            | Why                    | Runs | Status      | Findings                                         |
| ---------- | ------------------ | ---------------------- | ---- | ----------- | ------------------------------------------------ |
| Eng Review | `/plan-eng-review` | Architecture and tests | 1    | ISSUES_OPEN | 9 issues, 1 critical gap, 2 unresolved decisions |


**VERDICT:** Eng review logged 2026-04-15 (commit `e18e11c`). Ship after resolving critical gap (stale lock) and gateway duplicate verification story.

---

## Plan eng review (consolidated)

*Skill note:* Full `/plan-eng-review` is designed for interactive section-by-section questions. You asked for one pass with the plan ready; below is the complete review in one block. Re-run the skill in Cursor for strict per-issue AskUserQuestion if you want gating on each decision.

### Step 0: Scope challenge

1. **Existing code:** `openclaw-wrapper.sh` already supervises restarts and cleans the port; `lockfile.js` already serializes approval-bot; `cron-task-runner.sh` already limits overlap. The plan **extends** these, it does not replace them. Good reuse.
2. **Minimum change set:** (B) lockfile stale detection is the smallest diff with highest user-visible payoff. (A) wrapper/gateway invariant is next. (C) cron stagger is doc + small crontab edits, defer if A+B fix 80% of pain.
3. **Complexity:** Under 8 files if scoped: `lockfile.js`, `approval-bot.js` (maybe), `openclaw-wrapper.sh`, one new `scripts/lyra-gateway-smoke.sh` or similar, docs. No new services. **No smell.**
4. **Search:** Optional WebSearch for “Node systemd duplicate process daemonize” if OpenClaw forks; otherwise validate empirically on server with `pstree` and `ss` after restart. Noted as open question in Architecture issue 1.
5. **TODOS.md:** Repo has no `TODOS.md`; optional create with 2–3 items from “Unresolved decisions” or track in Notion. Not blocking.

**Step 0 outcome:** Scope accepted as written; optional reduction is “skip D (Telegram copy) entirely in first PR.”

### Architecture (issues)

1. **Gateway PID ownership:** Wrapper uses `$!` after `openclaw gateway &` (`openclaw-wrapper.sh` lines 71–75). If the Node process daemonizes or spawns a second long-lived PID under init, the supervisor tracks the wrong process and `cleanup_port` can strand a listener. **Recommendation:** After start, resolve listeners on `18789` (parse `ss -ltnp` or `lsof`) and compare to `GATEWAY_PID`; log and reconcile. **Preference:** explicit over clever, minimal new helper script called from wrapper.
2. **Blast radius of orphan kill:** Any “kill everything on 18789” must exclude unrelated processes (none expected, but document). Prefer TERM on tracked PID, then `fuser -k` as today, then assert single listener.
3. **Lockfile semantics:** Current `acquireLock` exits false for any existing file with no staleness check (`lockfile.js` lines 7–14). That matches production “Lock exists (PID ), exiting” when file is empty or PID dead. **Recommendation:** Implement staleness as in plan; keep lock path stable for cron.
4. **Cross-repo deploy:** `content-engine` lives under `projects/content-engine` locally and `/root/content-engine` on server. Plan must name **both** paths so deploy does not drift.
5. **Eval cron vs gateway memory:** Daily eval + `NODE_OPTIONS` heap 896MB + native overhead still risks OOM under peak. **Recommendation:** After A+B, if OOM recurs, move eval to lower concurrency or different clock, not in first PR unless one-line change.
6. **D-Bus env in wrapper:** Already set for systemd (`openclaw-wrapper.sh` lines 62–65). Keep; do not strip during edits.

### Code quality (issues)

1. `**acquireLock` API:** Consider returning reason enum (`held_live`, `held_stale_cleared`, `acquired`) instead of boolean only, so logs are searchable in `journalctl` / file logs. Small readability win, optional.
2. `**withLock` + `process.exit(0)`:** Silent exit on lock contention is correct for cron noise, but combine with clearer stderr line so `content-engine.log` does not look like “mysterious failure.”

### Tests (issues)

1. **Lockfile:** Add tests in `content-engine` (co-locate under `scripts/` or `test/` per project convention) for empty lockfile, dead PID, live PID. Mock `fs` and `process.kill(pid, 0)` or inject a `isProcessAlive(pid)` for testability.
2. **Gateway:** No unit test for bash wrapper in-repo unless you add `bats` or similar. **Acceptance:** Document manual smoke `scripts/lyra-gateway-smoke.sh` run from CI or post-deploy SSH checklist. Gap is acceptable if script is mandatory in deploy doc.

**Test diagram (ASCII):**

```
cron starts approval-bot
        |
        v
  acquireLock(path)
        |
   +----+----+
   |         |
  ok      stale / empty
   |         |
   v         v
 run()   unlink + acquire
           |
           v
        run()
```

### Performance (issues)

1. **Memory:** Single gateway after fix should stay under cgroup `MemoryMax`; watch `RSS` after plugin load. If duplicate gateways return, RSS doubles first symptom.
2. **Lock contention:** Short critical section in approval-bot; staleness check reduces false “held” from 5-minute cron pile-up.

### NOT in scope

- OpenClaw upstream behavior changes (file upstream issues only).
- Migrating Telegram to webhooks in this plan (different security and ops model).
- Rewriting tier0 Python CRUD or model router.
- New VPS purchase (optional future CEO scope); only “document stagger” here.

### What already exists

- `scripts/openclaw-wrapper.sh`: supervisor loop, port cleanup, `NODE_OPTIONS`, D-Bus.
- `projects/content-engine/scripts/lib/lockfile.js`: mutual exclusion (needs staleness).
- Server `cron-task-runner.sh`: overlap protection (not read in-repo this session; treat as given).

### Failure modes


| Path                    | Failure              | Test?     | Handling?       | User-visible?     |
| ----------------------- | -------------------- | --------- | --------------- | ----------------- |
| Stale empty lockfile    | Bot never runs       | After fix | After fix       | Silent (critical) |
| Two gateways            | 409, dropped updates | Smoke     | Partial today   | Telegram “laggy”  |
| Wrapper kills wrong PID | Outage               | Manual    | Must be careful | Total bot down    |
| `kill -0` race on reuse | Rare false stale     | Optional  | Log + metric    | One missed run    |


**Critical gap:** Stale lock with empty or dead PID has **no test and no recovery today** → silent pipeline stall. Plan B closes it.

### Worktree parallelization

**Lane A:** `content-engine` lockfile + tests (JS).  
**Lane B:** `lyra-ai` wrapper + smoke script (bash).  
No shared files between lanes until merge. **Merge order:** A first (lower risk), then B.  
**Conflict flag:** None if `content-engine` is separate repo on disk; if monorepo subtree only, still low overlap.

### Unresolved decisions (for you to confirm)

- **U1 (resolved):** `bash -n` in `npm test` plus `tests/bats/lyra-gateway.bats` (syntax + optional live smoke with `RUN_LYRA_GATEWAY_SMOKE=1`).
- **U2 (resolved):** `lyra-ai/TODOS.md` created with L-1..L-3 follow-ups.

### Completion summary

- Step 0: Scope challenge — **scope accepted as-is** (optional: drop stream D from first PR).
- Architecture Review: **6** issues listed (5 substantive + D-Bus note).
- Code Quality Review: **2** issues.
- Test Review: diagram above, **2** gaps (wrapper automation optional).
- Performance Review: **2** issues.
- NOT in scope: written.
- What already exists: written.
- TODOS.md updates: **done** (`lyra-ai/TODOS.md`).
- Failure modes: **1** critical gap flagged (stale lock).
- Outside voice: **skipped** (not run).
- Parallelization: **2** lanes, **parallel** then sequential merge.
- Lake score: recommend **complete** stale-lock behavior, not “log and exit.”

## Implementation shipped (local repos, 2026-04-15)

- **Lane A:** `projects/content-engine/scripts/lib/lockfile.js` — stale lock recovery, `parseLockPid` / `isPidAlive`, PID 1 always treated as alive. Tests: `tests/lockfile.test.js` (Vitest).
- **Lane B:** `lyra-ai/scripts/openclaw-wrapper.sh` — `remove_orphan_openclaw_gateways` before each gateway start and 2s after start. `lyra-ai/scripts/lyra-gateway-smoke.sh` — curl health + exactly one `openclaw-gateway` process.
- **U1:** `lyra-ai/tests/bats/lyra-gateway.bats`; `npm test` includes `bash -n` on wrapper and smoke; `npm run test:bats` when [bats-core](https://github.com/bats-core/bats-core) is installed.
- **U2:** `lyra-ai/TODOS.md` with follow-ups and test commands.

**Deploy:** `git pull` on Hetzner for `lyra-ai`; sync `content-engine` to `/root/content-engine` for lockfile; `sudo systemctl restart openclaw`; run `RUN_LYRA_GATEWAY_SMOKE=1 bash scripts/lyra-gateway-smoke.sh` once from `/root/lyra-ai`.

