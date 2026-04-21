---
name: google-calendar
description: Manage Google Calendar events via API. List, create, update, delete events and check availability across personal, work, and shared calendars.
---

# Google Calendar via API

Direct Google Calendar API v3 integration. Replaces the old Apple Calendar/osascript approach (Mac-only).

## Available Calendars

| Calendar | Calendar ID | Use for |
|----------|-------------|---------|
| **Primary** | `primary` | Akash's default personal events |
| **Work** | `work` (or the actual calendar ID) | Work meetings, blocks, focus time |
| **Akash & Abhigna** | (shared calendar ID from env) | Joint events: trips, date nights, shared appointments |

> Set `GCAL_WORK_ID` and `GCAL_SHARED_ID` in `.env` for non-primary calendars.

## Routing Rules

- Joint event (both Akash and Abhigna) → **Akash & Abhigna** (shared calendar)
- Work meeting / focus block → **Work**
- Akash personal → **Primary**
- If unsure and involves Abhigna → **Akash & Abhigna**

## Time Zone

All times are in **Europe/Berlin** (CET/CEST) unless the user specifies otherwise. The helper script defaults to this timezone.

## Operations

All operations use the helper script at `scripts/gcal-helper.js`.

### List Events

```bash
node scripts/gcal-helper.js list --from "2026-03-18" --to "2026-03-25"
```

Optional: `--calendar primary|work|shared` (defaults to all calendars).

### Create Event

```bash
node scripts/gcal-helper.js create \
  --title "Dinner with team" \
  --date "2026-03-20" \
  --time "19:00" \
  --duration 90 \
  --calendar primary
```

Optional flags:
- `--location "Restaurant Name, Berlin"`
- `--description "Notes about the event"`
- `--all-day` (omit --time and --duration for all-day events)

### Create All-Day Event

```bash
node scripts/gcal-helper.js create \
  --title "Trip to Munich" \
  --date "2026-03-22" \
  --all-day \
  --calendar shared
```

### Check Free/Busy

```bash
node scripts/gcal-helper.js free --date "2026-03-20"
```

Shows busy slots and available windows for the given day across all calendars.

### Update Event

```bash
node scripts/gcal-helper.js update \
  --event-id "abc123" \
  --title "Updated Title" \
  --time "15:00" \
  --duration 60
```

Any field can be updated: `--title`, `--date`, `--time`, `--duration`, `--location`, `--description`.

### Delete Event

```bash
node scripts/gcal-helper.js delete --event-id "abc123" --calendar primary
```

## Setup (One-Time)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project (or use existing)
3. Enable **Google Calendar API**
4. Create OAuth 2.0 credentials (Desktop app type)
5. Download the client ID and secret
6. Add to OpenClaw env (`~/.openclaw/.env` on local installs, `/root/.openclaw/.env` on VPS):
   ```
   GOOGLE_CLIENT_ID=your_client_id
   GOOGLE_CLIENT_SECRET=your_client_secret
   # Optional override if needed:
   # GOOGLE_REDIRECT_URI=http://127.0.0.1:53682/oauth2callback
   ```
7. Run the auth script to get a refresh token:
   ```bash
   node scripts/gcal-auth.js
   ```
8. Follow the URL, authorize, and paste either the code or the full redirected URL.  
   The script saves `GOOGLE_REFRESH_TOKEN` to the detected env file.

## After Adding/Updating an Event

Always confirm: "Added to [calendar name]: [title] on [date] at [time]" or "Updated [title] on [calendar name]".

## Error Handling

- **401 Unauthorized**: Token expired — the helper auto-refreshes. If persistent, re-run `node scripts/gcal-auth.js`.
- **404 Not Found**: Event ID is wrong or event was deleted.
- **403 Forbidden**: Calendar ID is wrong or not shared with the service account.
