# Lyra AI — deferred work

Short-lived scratch list. Prefer Notion for product tasks; use this for repo-local engineering follow-ups.

## Active

| ID | What | Why | Depends on |
|----|------|-----|------------|
| L-1 | Atomic lock acquire (`O_EXCL` or `mkdir`) for content-engine hot paths | Removes rare double-acquire race between cron and manual runs | — |
| L-2 | Optional: `bats` in CI (GitHub Action) calling `tests/bats/` | Catches bash regressions without relying on local brew | Runner image with `bats` |
| L-4 | **Upstream filed** [openclaw#69787](https://github.com/openclaw/openclaw/issues/69787): on `getUpdates` 409, `markDirty()` not called; retry reuses keep-alive → 409 loop. Suggested fix: `if (isConflict \|\| isRecoverable) markDirty()` in `monitor-polling.runtime-*.js` (~line 280). | Track until fixed in npm release; then deploy + verify 409s → ~0. | — |
| L-5 | **Likely resolved by L-3 fix — observe for 7 days.** Post-fix RSS stable at ~600MB steady-state (sampled 2026-04-21 post-restart). Previous "700MB+ in minutes" readings were taken while the duplicate `openclaw-gateway.service` was active, contributing ~250MB concurrent. Both OOMs (Apr 17 04:21, Apr 21 04:32) happened during 4am eval runs with duplicate unit in play. A3 OOM alarm (L-6, shipped) will catch any recurrence. If alarm fires in next 7 days, re-open with fresh heap snapshot via `--heapsnapshot-signal=SIGUSR2`. | Band-aid option if recurrence: bump `--max-old-space-size` from 896 to 1024 in `openclaw-wrapper.sh` (systemd MemoryMax=1536 gives room). | 7-day observation window |

## Done (archive when stale)

- 2026-04-21: **L-7** — synced `scripts/lyra-health-check.sh` with live server copy (commit `e11073f`). A3 OOM block now tracked in repo; no longer at risk of being lost on redeploy.
- 2026-04-21: L-6 OOM alarm shipped — appended to `/root/lyra-health-check.sh` on server. Scans last 20 min of `journalctl -u openclaw` for `FATAL ERROR.*heap`, alerts once per event to Telegram (de-duped via `/tmp/lyra-oom-state`). Dry-run confirmed it would have caught the 2026-04-21 04:32:18Z OOM. Backup of pre-edit script at `/root/lyra-health-check.sh.bak-2026-04-21`. See L-7 re: repo drift.
- 2026-04-21: L-4 initial deliverable — upstream issue filed: https://github.com/openclaw/openclaw/issues/69787 (409 / transport `markDirty` on conflict); row above tracks **follow-up** until shipped.
- 2026-04-15: Stale lockfile recovery in `content-engine/scripts/lib/lockfile.js`
- 2026-04-21: `lyra-gateway-smoke.sh` + bats syntax tests (fixed pgrep false positive on 2026-04-21)
- 2026-04-21: **L-3 root cause identified and resolved — it was NOT a double-fork.** A second systemd unit `openclaw-gateway.service` (2026-03-15) was left enabled alongside `openclaw.service` (2026-03-28); both ran gateways polling the same bot token. Disabled + unit file renamed to `.disabled-2026-04-21`. 409 conflicts dropped 384/24h → ~4/min (remainder is L-4, separate bug inside openclaw itself). The interim `remove_orphan_openclaw_gateways` fix (commit dce4258) was treating the symptom and has been reverted.

## How to run tests

- **lyra-ai:** `npm test` (Node tests + `bash -n` on wrapper and smoke script). Optional: `npm run test:bats` if [bats-core](https://github.com/bats-core/bats-core) is installed.
- **content-engine:** `npm test` (Vitest, includes `tests/lockfile.test.js`).
