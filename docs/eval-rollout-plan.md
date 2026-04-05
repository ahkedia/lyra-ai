# Lyra Eval Rollout Plan (Incremental + Non-Breaking)

This plan upgrades evals to be production-representative while preserving current cron and dashboard compatibility.

## Principles

- Keep legacy fields (`pass_rate`, `by_tier`, `failures`) unchanged.
- Add new fields as optional metadata first.
- Avoid changing existing gate behavior until data quality is proven.

## Phase 1 (Implemented)

### 1) Failure taxonomy (runner + aggregation)

- Added `failure_reason` to each failed test result.
- Added `failure_kind` classification:
  - `timeout`
  - `infra`
  - `heartbeat_leak`
  - `judge`
  - `latency_threshold`
  - `assertion`
  - `auth`
  - `other`
- Added `failure_breakdown` to run summary.

### 2) Eval lane metadata

- Added `eval_lane` and `run_mode` metadata to summary:
  - `EVAL_LANE` (default: `production_representative`)
  - `EVAL_RUN_MODE` (default: `e2e_live_tools`)

### 3) Dashboard compatibility updates

- Dashboard now reads optional `failure_kind` and displays it inline.
- Timeout/judge highlighting now uses case-insensitive matching and/or `failure_kind`.
- If new fields are missing (old JSON), dashboard behavior remains unchanged.

## Phase 2 (Implemented)

### 1) Split lanes in scheduling

- **Production lane (ship gate)**:
  - Runs with `--lane production_representative` when lane split is enabled
  - Continues to power normal aggregation + dashboard publishing
- **Diagnostic lane (non-blocking)**:
  - Runs with `--lane diagnostic`
  - Writes to a separate results directory (`results-diagnostic`) so it does not overwrite published production summaries by default

Feature flags in `evals/run-evals.sh`:

- `EVAL_ENABLE_LANE_SPLIT=1` - enables lane-aware execution
- `EVAL_RUN_DIAGNOSTIC_ON_EVEN_DAYS=1` - runs diagnostic lane on even days
- `EVAL_RUN_DIAGNOSTIC_AFTER_PROD=1` - runs diagnostic lane after production lane on full days
- `EVAL_DIAGNOSTIC_NON_BLOCKING=1` - diagnostic failures do not fail the overall run

### 2) Timeout hardening (Implemented in transport + result schema)

- `ws-client` timeout errors now include watchdog diagnostics:
  - timeout stage (`send_request` / `await_run_final` / `history_fetch`)
  - idle duration since last progress
  - lifecycle event count
  - tool event count
- Runner emits structured timeout context per test:
  - `timed_out_stage`
  - `tool_chain_depth`
  - `expected_tool_chain_depth`
  - `last_progress_ts`
  - `idle_ms`
- Dashboard failure rows show timeout stage metadata when present.

### 3) Multi-turn judge fidelity

- Implemented transcript-aware judging:
  - runner now captures turn-by-turn transcript for multi-turn tests
  - `llm-judge` now receives the conversation transcript (clipped) plus original prompt
- Added lane-aware test assignment in runner:
  - tests can define `eval_lane` in YAML
  - defaults route latency/model-routing/edge tests to `diagnostic`
  - everything else defaults to `production_representative`

## Phase 3 (Implemented with env-tunable gates)

- Added strict, tunable gates over `failure_kind` mix:
  - `EVAL_MAX_TIMEOUT_RATE`
  - `EVAL_MAX_HEARTBEAT_LEAKS`
  - `EVAL_MAX_AUTH_FAILURE_RATE`
  - `EVAL_MAX_RETRIEVAL_JUDGE_FAILURES`
- Strict mode toggle:
  - `EVAL_ENABLE_STRICT_KIND_GATES` (default on in `run-evals.sh`)
- `all_ok` now requires:
  - run validity + stability gate + capability gate + strict kind gates (when enabled)
- Legacy pass rate remains unchanged for trend continuity.

## Production-Representative Migration (Implemented for key dry-run/theoretical cases)

- Reworked remaining dry-run/theoretical tests into write-backed flows where possible:
  - Tier 2 reminder write test now requires real write + cleanup
  - Tier 2 cross-user handoff now requires write-backed reminder + cleanup
  - Tier 4 cross-user showcase now requires write-backed reminder + cleanup
  - Multi-step rubrics now score actual completion over “describe plan”
