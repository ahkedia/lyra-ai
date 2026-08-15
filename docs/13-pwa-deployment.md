# Lyra PWA deployment

The app is designed to run as a separate systemd service beside OpenClaw. Copy
`deploy/lyra-app.service` to `/etc/systemd/system/lyra-app.service`, set the private
variables in `/etc/lyra/lyra-app.env`, and proxy a real HTTPS hostname with the Caddy
snippet. HTTPS is required for passkeys, microphone capture, service workers, and push.

Required variables:

```text
NODE_ENV=production
LYRA_APP_TOKEN=temporary-bootstrap-token
LYRA_DATABASE_URL=postgres://...
LYRA_RP_ID=lyra.example.com
LYRA_ORIGIN=https://lyra.example.com
LYRA_APP_DATA_DIR=/var/lib/lyra-app
```

Start from `deploy/lyra-app.env.example`, copy it to the host-only environment file,
replace every placeholder, and never commit the populated file.

Optional integrations are enabled only when their variables are present:

```text
NOTION_API_KEY=...
NOTION_REMINDERS_DS_ID=...
LYRA_ENABLE_CALENDAR=1
LYRA_ENABLE_EMAIL=1
OPENAI_API_KEY=...
LYRA_VAPID_PUBLIC_KEY=...
LYRA_VAPID_PRIVATE_KEY=...
LYRA_VAPID_SUBJECT=mailto:you@example.com
```

Deployment sequence:

0. Run `npm run app:preflight` with the production environment file loaded; resolve
   every hard blocker before starting the service.
1. Create the `lyra` user and `/var/lib/lyra-app` with mode `0700`.
2. Install dependencies with `npm ci --omit=dev`.
3. Install the systemd unit and Caddy route.
4. Start the service and verify `/health`.
5. Register a passkey from the HTTPS origin.
6. Point the WhatsApp bridge at `LYRA_APP_URL=https://lyra.example.com` and set its API token.
7. For Telegram parity, disable the native OpenClaw Telegram transport and enable
   `deploy/lyra-telegram-bridge.service`; both channels then call `/v1/channels/message`.
   Set `TELEGRAM_BRIDGE_STATE=/var/lib/lyra-app/telegram-offset.json` so the hardened
   systemd unit can persist polling progress.
8. Run `npm test` and the physical iPhone acceptance checklist before changing messaging to fallback-only.

The protected `GET /v1/metrics` endpoint summarizes conversations, messages, captures,
action outcomes, and queued push events for the migration dashboard. It contains counts,
not message content or provider secrets.

Authentication ceremonies are rate-limited per source address, and API JSON bodies are
bounded to protect the passkey and capture endpoints from accidental or hostile floods.
