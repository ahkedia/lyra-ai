# Lyra AI — deferred work

Short-lived scratch list. Prefer Notion for product tasks; use this for repo-local engineering follow-ups.

## Active

| ID | What | Why | Depends on |
|----|------|-----|------------|
| L-1 | Atomic lock acquire (`O_EXCL` or `mkdir`) for content-engine hot paths | Removes rare double-acquire race between cron and manual runs | — |
| L-2 | Optional: `bats` in CI (GitHub Action) calling `tests/bats/` | Catches bash regressions without relying on local brew | Runner image with `bats` |
| L-4 | **Upstream filed** [openclaw#69787](https://github.com/openclaw/openclaw/issues/69787): on `getUpdates` 409, `markDirty()` not called; retry reuses keep-alive → 409 loop. Suggested fix: `if (isConflict \|\| isRecoverable) markDirty()` in `monitor-polling.runtime-*.js` (~line 280). | Track until fixed in npm release; then deploy + verify 409s → ~0. | — |
| L-5 | Heap leak: gateway RSS climbs to 700MB+ within minutes of a restart; 2 OOMs in 7 days | Silent night-time crashes, unbounded memory | Lane A2 investigation |
| L-6 | OOM alarm in 15-min health cron | OOMs are currently silent unless grepping journalctl | — |

## Done (archive when stale)

- 2026-04-21: L-4 initial deliverable — upstream issue filed: https://github.com/openclaw/openclaw/issues/69787 (409 / transport `markDirty` on conflict); row above tracks **follow-up** until shipped.
- 2026-04-15: Stale lockfile recovery in `content-engine/scripts/lib/lockfile.js`
- 2026-04-21: `lyra-gateway-smoke.sh` + bats syntax tests (fixed pgrep false positive on 2026-04-21)
- 2026-04-21: **L-3 root cause identified and resolved — it was NOT a double-fork.** A second systemd unit `openclaw-gateway.service` (2026-03-15) was left enabled alongside `openclaw.service` (2026-03-28); both ran gateways polling the same bot token. Disabled + unit file renamed to `.disabled-2026-04-21`. 409 conflicts dropped 384/24h → ~4/min (remainder is L-4, separate bug inside openclaw itself). The interim `remove_orphan_openclaw_gateways` fix (commit dce4258) was treating the symptom and has been reverted.

## How to run tests

- **lyra-ai:** `npm test` (Node tests + `bash -n` on wrapper and smoke script). Optional: `npm run test:bats` if [bats-core](https://github.com/bats-core/bats-core) is installed.
- **content-engine:** `npm test` (Vitest, includes `tests/lockfile.test.js`).
