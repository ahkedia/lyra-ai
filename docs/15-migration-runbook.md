# Lyra PWA-first migration runbook

This runbook is the gate for moving daily use from Telegram to Lyra PWA.
Messaging remains available as recovery until every gate passes.

## 0. Deploy and establish a baseline

1. Populate `deploy/lyra-app.env.example` on the host and run `npm run app:preflight`.
2. Deploy `lyra-app.service`, Caddy, and (when desired) the Telegram bridge.
3. Verify `/health`, passkey sign-in, Today refresh, capture, action preview/commit/undo,
   `/v1/metrics`, and the push test from a physical iPhone.
4. Record a seven-day baseline for messaging usage, missed commitments, capture success,
   action failures, refresh latency, and notification delivery.

## 1. PWA-first shadow period

- Use the PWA for Today, planning, capture, and all reversible actions.
- Keep Telegram active and route it through the shared API.
- Review `/v1/metrics` daily; investigate every failed action and unavailable source.
- Do not advance while any critical action is fabricated, silently fails, or lacks provenance.

## 2. Fallback-only period

Move messaging to emergency use only after seven consecutive days with:

- no unexplained missed commitments;
- successful PWA capture and action completion;
- cached launch and critical refresh within the targets;
- push test and at least one real scheduled notification verified;
- household/channel workflows explicitly tested;
- recovery from offline launch, provider outage, and expired session.

## 3. Retirement decision and rollback

Retire routine messaging only after the fallback-only period is stable and a recovery
owner is identified. Keep the bridge deployment artifacts for rollback. To roll back,
re-enable the native Telegram transport or bridge, keep the PWA API running, and use
the audit ledger plus `/v1/metrics` to reconcile any actions made during the transition.
