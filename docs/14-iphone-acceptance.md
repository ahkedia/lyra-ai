# Lyra iPhone acceptance checklist

Run this against the deployed HTTPS origin from Safari on the target iPhone. Record
the date, iOS version, device model, and app URL with the result.

## Install and launch

- [ ] Safari Add to Home Screen creates a Lyra icon.
- [ ] Home Screen launch opens the shell without a network connection.
- [ ] Cached Today renders immediately, then refreshes when connectivity returns.
- [ ] Safe-area spacing, keyboard resize, scrolling, and touch targets are usable in portrait.

## Identity and trust

- [ ] First-time setup registers Face ID and creates a session.
- [ ] Closing and reopening the PWA can sign in with Face ID.
- [ ] An unauthenticated request to protected API routes returns `401`.
- [ ] Adding a second passkey requires an authenticated session or bootstrap token.

## Capture, actions, and recovery

- [ ] Text capture creates a source-marked record.
- [ ] Microphone permission, recording, stop, and upload work.
- [ ] A capture made offline is queued and syncs once online.
- [ ] Action preview shows the intended target; commit is auditable and idempotent.
- [ ] Provider failure is visible as unavailable/stale, never fabricated as current.

## Notifications and channels

- [ ] Push permission can be granted; “Send test alert” reports delivery and a notification arrives.
- [ ] Tapping a notification opens Lyra.
- [ ] Telegram messages produce the same conversation/action result as PWA requests.
- [ ] Scheduled delivery and recovery paths are tested before messaging becomes fallback-only.

Migration advances only when every critical checkbox passes on the physical device.
