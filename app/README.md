# Lyra app boundary

This directory contains the first deployable vertical slice of Lyra's PWA boundary.

Run locally:

```sh
npm run app
```

For a private production process, set `NODE_ENV=production`, `LYRA_APP_TOKEN`, and
`LYRA_DATABASE_URL`. The API accepts a bearer token or exchanges it for an HttpOnly
session cookie at `POST /v1/auth/session`. Passkey/WebAuthn sign-in is also available.
The API deliberately returns an explicit unavailable state
when `LYRA_TODAY_SNAPSHOT` is not configured. It never fills Today with invented data.

`LYRA_TODAY_SNAPSHOT` remains available as a deterministic local source adapter. In
the server, live Notion, calendar, mail, and OpenClaw adapters are selected when their
configuration is present; unavailable providers return explicit warnings.
It is a JSON file with this shape:

```json
{
  "items": [{
    "id": "reminder-1",
    "title": "Call the dentist",
    "kind": "reminder",
    "status": "open",
    "source": "Notion",
    "asOf": "2026-08-12T08:00:00.000Z",
    "confidence": "verified",
    "detail": "Due today",
    "actions": ["complete"]
  }],
  "sources": [],
  "warnings": []
}
```

`app/providers.js` also contains a composite provider that isolates one failed source
from the rest of Today. The API persists conversations, actions, and captures under
`LYRA_APP_DATA_DIR` (default `.lyra-app`) so local restarts do not erase the thread;
when `LYRA_DATABASE_URL` is set, the same state is hydrated from and mirrored to
Postgres alongside the audit ledger. Passkey/WebAuthn registration, sign-in, and
push subscription are implemented; production still requires HTTPS and real VAPID
credentials.

WhatsApp can route messages through `LYRA_APP_URL` into the same conversation API;
`app/channels.js` provides the shared adapter contract for Telegram or other bridges.
The existing native OpenClaw Telegram transport still requires a deployment-side bridge
to call this endpoint before Telegram reaches full parity. Commitment events are written to `push-outbox.jsonl`
and delivered directly through VAPID/Web Push when the VAPID variables are configured.
