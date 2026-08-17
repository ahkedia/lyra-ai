# Lyra

Lyra is a private, mobile-first PWA hosted on Hetzner. The PWA is the primary
experience; Telegram remains an optional recovery channel. WhatsApp is not a
supported channel.

## Production

- PWA: `https://wa.akashkedia.com/app`
- App service: `lyra-app.service`
- Agent service: `openclaw.service`
- Deployment instructions: [`docs/13-pwa-deployment.md`](docs/13-pwa-deployment.md)

Run `npm test` before deploying a code change. Production secrets belong only in
the host environment files; do not add them to this repository.
