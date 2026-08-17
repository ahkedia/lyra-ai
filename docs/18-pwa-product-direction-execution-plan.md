# Lyra PWA product-direction execution plan

## Decision

The current application is **not yet the product described in the three-tab
brief**. It has credible building blocks, but they were shipped as a series of
independent patches. The result is a functional PWA whose Lyra stream, To Do,
News, sharing, settings, and mobile interaction model do not yet behave as one
coherent product.

This plan finishes the intended iPhone-first product. It does not add a
sidebar, conversation history, WhatsApp, or a Telegram Mini App.

## What already exists and will be reused

| Existing implementation | Reuse decision |
|---|---|
| `app/client/main.tsx` three-tab shell, composer, basic To Do, News and settings | Keep behavior, split it into focused screen and shared UI modules before further feature work. |
| `app/client/renderers.tsx` and validated UI fixtures | Keep as the only rich-content rendering boundary. Finish visual and interaction coverage rather than inventing tab-specific renderers. |
| `app/api.js` canonical event, action, question, News and push flows | Keep its API contract, move durable state progressively from the JSON snapshot into repositories backed by Postgres. |
| `app/news.js` free source ingestion and morning-brief bridge | Keep the source pipeline and improve clustering, freshness, and presentation. |
| IndexedDB mutation queue in `app/client/offline.ts` | Keep it, extend it to every safe task edit and inbound share capture. |
| native Web Share wrapper in `app/client/share.ts` | Keep it for outbound sharing, then add a safe inbound share target. |

## Verified implementation gaps

1. The frontend still concentrates the product in `app/client/main.tsx`.
   This makes stream, task, News, sharing, settings, and offline behavior easy
   to regress together.
2. The durable application state is still a whole-state snapshot in
   `app/api.js`, despite the initial Postgres migration. It is not yet the
   canonical repository model promised by the product architecture.
3. Lyra pagination fetches older data but then simply renders the last 120
   items. It does not preserve the reader's position or represent unread state
   accurately across live updates.
4. To Do has basic create/edit/complete/reopen, but lacks source-capability
   driven list and priority fields, version conflicts, offline edit replay, and
   Apple Reminders-like grouping and scanning.
5. News is a live RSS list with save/read state. It does not yet cluster the
   same story across publishers or fully present source time, source count, and
   a dated canonical morning brief when stale.
6. Outbound share exists for messages and stories. There is no inbound iOS/Chrome
   share target that turns a shared URL or text into a Lyra capture, nor a
   durable share receipt in the Lyra stream.
7. Settings shows controls but not truthful device state, last successful sync,
   delivery health, capture history, or recovery instructions.
8. The rich renderer supports the intended blocks in code, but there is no
   browser-level proof that every component is visually usable at iPhone widths.

## Product contract

```text
            Share sheet / cron / typed or voice input
                              |
                              v
                     canonical Lyra API
                              |
        +---------------------+---------------------+
        |                     |                     |
        v                     v                     v
    Lyra stream            To Do read model      News read model
        |                     |                     |
        +---------------------+---------------------+
                              |
                              v
                    installed iPhone PWA
```

Every write receives a stable idempotency key, persists before delivery, and
reports `pending`, `completed`, `failed`, `stale`, or `conflict` explicitly.
No screen may describe a provider mutation as complete until the provider has
confirmed it.

## Execution sequence

### Phase 1: Stabilize product boundaries

1. Split `app/client/main.tsx` into:
   - `client/app-shell.tsx` for tabs, URL/deep-link state, service worker, and
     live feed subscriptions.
   - `client/screens/lyra-stream.tsx`, `todo-screen.tsx`, `news-screen.tsx`,
     and `settings-sheet.tsx`.
   - `client/components/` for composer, sheets, top bar, tab bar, source rows,
     status banners, and share controls.
   - `client/hooks/` for authenticated resources, feed windowing, offline queue,
     and device status.
2. Add a repository layer behind `app/api.js` for events, questions, actions,
   deliveries, push subscriptions, News state, captures, and sessions. Add a
   new, additive migration and a one-time idempotent backfill from the current
   durable snapshot. Keep the snapshot only as a recoverable mirror during the
   transition.
3. Upgrade `app/migrate.js` to ordered migrations with an advisory lock and
   clear migration status. Never edit an already-applied migration.
4. Preserve current endpoint shapes while moving reads and writes to the
   repositories. The PWA must not notice the storage migration.

**Acceptance:** restart, duplicate submission, interrupted write, and a second
browser session all return one consistent event/task/news state.

### Phase 2: Finish Lyra, the default conversation stream

1. Make one chronological stream the default launch destination. Restore a
   valid deep link only when it targets a specific event, News story, or task.
2. Implement a real 40-item page window:
   - prepend older pages without moving the reader's current message;
   - retain an anchor event and scroll offset while loading;
   - retain at most 120 mounted items while keeping older/newer cursor state;
   - show an unread divider and a `New messages` affordance only when the reader
     is away from the newest item.
3. Make message states first-class: sending, queued offline, streaming,
   completed, failed, stale scheduled update, and action progress. A failure
   includes retry only when a retry is actually safe.
4. Make every scheduled delivery an ordinary rich stream event. Consolidate
   duplicate cron updates by run id, keep raw operational stderr out of the UI,
   and use the smallest suitable renderer block.
5. Finish capture:
   - a single compact composer with text, voice, and share-capture affordances;
   - recording, upload, transcription, and failure states;
   - capture receipt and playable audio attachment in the stream when supported.
6. Preserve the current exact question continuation worker, and surface queued,
   expired, conflict, and failed continuation states inline.

**Acceptance:** a reader can scroll through prior content while a cron arrives,
answer a structured prompt exactly once, send offline, relaunch, and recover
without losing where they were reading.

### Phase 3: Make To Do genuinely Reminders-like

1. Extend the normalized task capability response, not the UI alone. Expose
   whether the current Notion adapter supports list, flag, priority, recurrence,
   delete, and conflict versions.
2. Render smart lists `Today`, `Scheduled`, `All`, and `Flagged`, then show
   source lists below only when mapped. Group Today into overdue, today, later,
   and undated, and use a 24px completion circle with clear pending/conflict
   treatment.
3. Detail sheet uses capability-driven fields only. Add list, priority, and
   recurrence only after the adapter can read and write them. Add swipe actions
   only for supported reversible operations.
4. Include `sourceUpdatedAt`/version with all updates. On a conflict, show the
   current source value, the local draft, and explicit keep/reload choices.
5. Queue create, complete/reopen, flag, and edit mutations offline in order.
   Reconcile them with the same idempotency keys and expose a recoverable failure.

**Acceptance:** task completion never lies, an offline edit replays once after
reconnect, unsupported properties never appear, and the screen remains useful
with zero, one, and many reminders.

### Phase 4: Make News a real source-forward feed

1. Persist a dated morning brief and its stories atomically with its Lyra stream
event. If the fresh brief fails, retain and clearly label the last valid brief.
2. Build deterministic source clustering using canonical URL, normalized title,
and publication-time proximity. A cluster stores all source rows and stable
story identity; it never invents a merged fact.
3. Render the feed as flat editorial rows, not dashboard cards: optional image,
topic, headline, concise summary, published time, source count, Why it matters,
read/save state, and external source access.
4. The detail sheet shows each publisher, source title, URL, and timestamp.
`Ask Lyra` passes only the stable story ID to the API. It must not paste page
contents into a prompt.
5. Retain read/save state in Postgres and the offline queue. A failed refresh
never wipes the last usable feed.

**Acceptance:** a real morning run yields one stream briefing and one dated News
brief, a multi-source story is visibly grouped, and offline read/save changes
survive relaunch and replay once.

### Phase 5: Complete sharing and operational settings

1. **Outbound sharing:** keep native share for a stream event, story, and source
link. Clipboard fallback must report `Copied`, not `Shared`.
2. **Inbound sharing:** declare a web share target in the manifest. Receive
shared `title`, `text`, and `url` through a dedicated PWA route, validate/sanitize
them, store a capture with an idempotency key, and append a visible capture
receipt to the Lyra stream. Queue this safely when the device is offline.
3. **Settings:** show one accurate row each for passkey status, session state,
notifications, source health, delivery health, queued changes, app version, and
last successful sync. Include sign-out, retry queued changes, notification test,
and theme. Remove placeholder labels such as `Next`.
4. Make all sheets keyboard-safe, outside-tap dismissible, Escape-dismissible,
and focus-contained. The settings trigger uses a recognizable settings icon with
an accessible label.

**Acceptance:** sharing from Safari/Chrome creates a Lyra capture, sharing out
works with and without native share support, and Settings never reports a state
it has not verified.

### Phase 6: Mobile visual completion and renderer proof

1. Retain the neutral blue, black, white, and gray system. Use one SF system font
stack, one body scale, one metadata scale, and no green legacy tokens. The user
bubble and send control use the documented blue token; Lyra responses remain
open, not large cards.
2. Remove remaining decorative/dashboards patterns. The installed PWA has a
compact header, fixed 3-tab bar, sticky composer, source chips near their
content, and flat News/To Do scanning surfaces.
3. Treat all 17 supported blocks as a release surface: rich text, both list
types, checklist, callout, metric group, chart, table, image, media, file,
source list, action group, briefing, News brief, task snapshot, question form,
and code. Add golden DOM assertions plus screenshot fixtures for every type.
4. Establish reviewed visual baselines at 375px, 393px, and 430px widths in light
and dark modes. Cover Lyra, composer with keyboard, every sheet, To Do states,
News states, offline/stale/error states, and component gallery.

**Acceptance:** all controls meet 44px touch targets, no desktop-only layout
appears, no legacy green/drawer/history UI remains, and screenshots match the
approved mobile visual contract.

### Phase 7: Release evidence

1. Add API, migration, component, browser E2E, and agent-output tests alongside
each phase. Test provider failure and malformed agent output before deploying.
2. Deploy small reversible commits to both canonical Hetzner checkouts. Verify
service health, authenticated feed, News, tasks, schedule ingestion, and static
PWA headers after each release.
3. On the physical iPhone, verify Home Screen launch, passkey/Face ID,
notifications, native share in/out, audio capture/playback, offline queue,
keyboard, sheets, taps, and deep links.
4. Run a 14-day PWA-first period. Telegram remains a fallback until the measured
stream, capture, task, scheduled delivery, and recovery acceptance gates pass.

## Test matrix

| Layer | Required proof |
|---|---|
| Unit/schema | repositories, migration/backfill, capability mapping, clustering, share validation, all golden envelopes |
| API | auth, restart, idempotency, task conflict, queued replay, question continuation, scheduled dedupe, source failure |
| Browser E2E | three exact tabs, no drawer, scroll anchor, composer/voice, share in/out, task lifecycle, News detail, settings, offline recovery |
| Visual | screenshot baselines at 375/393/430px, light/dark, 17 rich blocks, keyboard and every sheet |
| Production/iPhone | authenticated smoke checks, one safe cron, source health, installed-PWA behavior, physical touch/notification/audio recovery |

## Explicitly not in scope

- App Store packaging. Safari/Chrome install remains the distribution path.
- A general desktop layout. Desktop remains a functional fallback only.
- WhatsApp restoration or Telegram Mini App links.
- Household identities or multi-user permissions before the personal flow is
  stable.
- Simulated Notion fields. A field appears only when the source adapter supports
  it end-to-end.

## Delivery order and ownership boundaries

| Order | Workstream | Primary modules | Depends on |
|---:|---|---|---|
| 1 | repository/migration foundation | `app/api.js`, `app/storage.js`, `app/migrations/` | none |
| 2 | client extraction and shared state | `app/client/` | none, but merge before screen work |
| 3 | Lyra stream and capture/share | `app/client/screens/`, API capture/event routes | 1, 2 |
| 4 | To Do capabilities and lifecycle | task adapter, API actions, To Do screen | 1, 2 |
| 5 | News briefing and clusters | `app/news.js`, API News model, News screen | 1, 2 |
| 6 | Settings/device status | API health/push/session, Settings screen | 1, 2 |
| 7 | visual/E2E/release proof | tests, CSS, production checks | 3, 4, 5, 6 |

The repository and client extraction are sequential foundation work. Once merged,
Lyra/share, To Do, News, and Settings can proceed in parallel only if each owns
its screen and API boundary. Visual integration and production acceptance are last.

## Definition of done

The implementation is complete only after all seven phases pass their acceptance
criteria, the production checks are green, and the physical iPhone plus 14-day
PWA-first evidence exists. A polished screenshot or a passing unit suite alone is
not sufficient.
