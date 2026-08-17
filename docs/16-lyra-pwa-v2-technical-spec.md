# Lyra PWA v2: product and technical specification

**Status:** Build-ready  
**Version:** 1.0  
**Date:** 2026-08-17  
**Primary user:** Akash  
**Implementation target:** `https://wa.akashkedia.com/app/`  
**Source of truth:** This document for product and application decisions; Hetzner for live private configuration and cron definitions.

## 1. Executive decision

Lyra PWA v2 is a private, installable iPhone application with exactly three primary tabs:

1. **Lyra**: the default tab. One continuous conversational stream containing user messages, Lyra replies, scheduled briefs, reminders, system notices, and action results.
2. **To Do**: an Apple Reminders-inspired task experience backed initially by Lyra's existing Notion reminders source.
3. **News**: a Perplexity-inspired news feed populated first by the morning brief and later by other explicitly configured sources.

The interface should use the interaction quality and visual restraint of ChatGPT/Codex, not its chat-history information architecture. There is no permanent conversation sidebar, no Spaces tab, no generic Today dashboard, and no empty-state prompt that makes Lyra feel like a blank chatbot.

OpenClaw remains the agent and scheduler. Notion remains the primary domain data source. The PWA becomes the durable presentation and delivery layer. Scheduled output is persisted to the PWA before any notification or messaging fallback is attempted.

This is an incremental replacement of the current app shell. It is not a rewrite of OpenClaw, the source integrations, or the deployment platform.

## 2. Product outcomes

### 2.1 Goals

- Make the PWA the fastest and most pleasant way to use Lyra every day.
- Preserve the conversational feel of Telegram while rendering content with purpose-built UI components.
- Deliver every scheduled Lyra message to the PWA stream and, when eligible, as a web push notification.
- Give reminders a dedicated, fast, list-first interface.
- Turn the morning brief into a readable news product rather than a pasted text blob.
- Preserve provenance, freshness, confidence, and action state whenever Lyra presents external information.
- Keep Telegram and WhatsApp available as temporary fallback channels during migration.
- Never present fabricated, silently failed, or stale data as current.

### 2.2 Non-goals

- No native App Store application in this release.
- No React, Next.js, GraphQL, Redis, Kafka, or new hosted platform.
- No rewrite of OpenClaw or its cron scheduler.
- No migration of existing Notion data unless a missing field blocks a required To Do behavior.
- No household identity or multi-user access in the first release.
- No chat-history sidebar, Spaces, or multiple user-managed conversation threads.
- No direct Apple Reminders synchronization from Hetzner. The To Do interface copies the useful interaction model, while Notion remains the initial source. Native Apple Reminders sync would require a separately secured Mac relay.
- No automatic retirement of Telegram or WhatsApp. Retirement is a later acceptance decision.
- No copying of OpenAI, Apple, or Perplexity trademarks, logos, proprietary icons, or assets. The app may use familiar interaction patterns and comparable polish.

## 3. Personas and success

| Persona / actor | Goal | Current pain | Success measure |
|---|---|---|---|
| Akash, primary user | Converse, capture, act, review tasks, and read briefs from one installed app | Telegram is unstructured; the current PWA feels like a generic chatbot and misses scheduled messages | PWA is the first interface used on at least 6 of 7 days; capture and action success exceed 98% |
| Lyra interactive agent | Return grounded answers and useful structured output | Agent text is flattened into one message format | Every answer renders safely; all external claims can expose source and freshness |
| Lyra scheduled automation | Deliver proactive information without requiring a prompt | Cron output currently goes to a messaging channel and may never appear in the PWA | Every completed cron run creates exactly one durable PWA event; push attempt begins within 10 seconds |
| Telegram/WhatsApp fallback | Preserve access during migration and outages | Channel-specific formatting and logic can diverge | The same canonical event/action is reused; fallback does not create a second source of truth |

### 3.1 Release metrics

- Cached PWA shell visible in under 500 ms on a previously used iPhone.
- Primary feed interactive in under 1 second from cache.
- Critical online refresh completes in under 2 seconds at p95 when providers are healthy.
- Feed API p95 below 500 ms excluding agent generation.
- Task mutation API p95 below 1.5 seconds excluding a clearly surfaced provider delay.
- At least 98% of accepted text or voice captures reach a terminal state.
- At least 98% of committed actions reach completed or explicitly failed state.
- 100% of scheduled runs have a recorded success, skipped, or failed state.
- Zero fabricated success states and zero silent provider failures.

## 4. User flows

### 4.1 Markdown flow map

| Flow | Happy path | Decision points | Failure behavior |
|---|---|---|---|
| Launch | Tap Home Screen icon → cached shell opens on Lyra → cached feed renders → current feed refreshes | Signed-in session valid? Network available? | Show Face ID sheet if expired; retain cached read-only content offline; never open in browser chrome when launched from Home Screen |
| Converse | Type or record → send → user event appears → Lyra progress appears → structured response streams in → sources/actions render | Response contains valid structured blocks? Action requires confirmation? | Invalid blocks fall back to escaped rich text; agent failure creates retryable error event |
| Receive cron | OpenClaw completes job → authenticated webhook reaches app → event is persisted → push/fallback delivery is queued → event appears in Lyra → deep link opens it | Is output `SKIP`? Does it contain a news brief? Is push permitted? | Failure is persisted; malformed output is shown as safe text; delivery retries without duplicating the event |
| Manage task | Open To Do → select smart list → add/edit/complete → optimistic local update → server validates → provider commits → state reconciles | Online? Provider available? Conflict with newer source version? | Queue safe offline changes; roll back and explain rejected changes; never mark complete if provider commit failed |
| Read news | Open News → latest brief appears → open story → inspect sources → Ask Lyra or save/read | No current brief? Image unavailable? Source stale? | Show last successful brief with age; replace broken image with text layout; state why refresh failed |
| Recover | Launch after session expiry/outage → cached app stays useful → authenticate or retry → queued work syncs | Is mutation safe to retry? | Use idempotency keys; show pending/failed state until server confirms |

### 4.2 ASCII flow

```text
                         ┌──────────────────────────┐
                         │ OpenClaw agent + crons   │
                         └────────────┬─────────────┘
                                      │ authenticated result
                                      ▼
┌──────────────┐    message     ┌──────────────────────────┐
│ Installed PWA├───────────────►│ Lyra API                 │
│              │◄───────────────┤ validate → persist → act │
│ Lyra         │  feed / stream └────────────┬─────────────┘
│ To Do        │                              │
│ News         │                 ┌────────────┴─────────────┐
└──────┬───────┘                 ▼                          ▼
       │                    ┌──────────┐              ┌───────────┐
       │ cached read model  │ Notion, │              │ Delivery  │
       ▼                    │ Calendar│              │ outbox    │
┌──────────────┐            │ Gmail   │              └─────┬─────┘
│ IndexedDB +  │            └──────────┘                    │
│ Cache API    │                                  ┌─────────┼─────────┐
└──────────────┘                                  ▼         ▼         ▼
                                               Push    Telegram  WhatsApp
                                                        fallback  fallback
```

### 4.3 YAML flow definition

```yaml
application:
  entry_route: /app/
  default_tab: lyra
  tabs: [lyra, todo, news]
actors:
  - primary_user
  - interactive_agent
  - scheduled_automation
  - fallback_channel
flows:
  interactive_message:
    steps: [capture_input, persist_user_event, run_agent, normalize_blocks, persist_reply, stream_reply]
    terminal_states: [completed, failed]
  scheduled_message:
    steps: [receive_webhook, authenticate, deduplicate, normalize_blocks, persist_event, enqueue_deliveries]
    deliveries: [pwa_feed, web_push, telegram_optional, whatsapp_optional]
    terminal_states: [completed, skipped, failed]
  task_mutation:
    steps: [optimistic_client_state, validate, preview_if_destructive, provider_commit, persist_audit, reconcile]
    terminal_states: [completed, pending_retry, failed, undone]
invariants:
  - persistence_precedes_notification
  - one_canonical_event_across_channels
  - malformed_rich_content_falls_back_to_safe_text
  - provider_failure_is_never_rendered_as_success
  - every_retryable_write_has_an_idempotency_key
```

## 5. Information architecture

### 5.1 Global shell

- Full-height single-column application surface.
- A compact top bar contains the current tab title and a right-aligned settings/profile button.
- A fixed bottom tab bar contains **Lyra**, **To Do**, and **News**, in that order.
- Lyra is the default tab after every cold launch unless a valid push deep link targets another tab or event.
- The bottom bar is at least 64 px high plus `env(safe-area-inset-bottom)`.
- Each tab target is at least 44 by 44 px and uses icon plus label.
- The application has no hamburger menu and no left navigation drawer.
- Settings open as a bottom sheet on iPhone and a centered dialog on wider screens.
- Tab state is reflected in the URL so refresh and push deep links restore context:
  - `/app/` or `/app/?tab=lyra`
  - `/app/?tab=todo`
  - `/app/?tab=news`
  - `/app/?tab=lyra&event=<uuid>`
  - `/app/?tab=news&brief=<yyyy-mm-dd>&item=<stable-id>`

### 5.2 Settings sheet

Settings contains only operational controls:

- Face ID/passkey status and sign-in/sign-out.
- Notification permission and test notification.
- Connection/source health.
- Offline queue status and manual retry.
- Theme: system, light, dark.
- Application version and last successful sync.

It must not contain primary navigation or conversation history.

## 6. Screen specification

### 6.1 Lyra tab

The Lyra tab is one durable personal stream, not a list of chats.

#### Layout

- Top bar: `Lyra`, connection state only when degraded, settings button.
- Feed: reverse chronological loading with chronological reading order; newest content at the bottom.
- Sticky composer above the tab bar and keyboard.
- On first load, scroll to the newest unread event. Do not force-scroll if the user is reading older content.
- A floating “new messages” control appears when content arrives below the current viewport.
- Pagination loads 40 events at a time. Keep no more than roughly 120 fully rendered events in the DOM.

#### Event presentation

- User messages use a compact right-aligned neutral bubble.
- Lyra replies use an open layout without a large enclosing bubble, matching ChatGPT/Codex reading density.
- Consecutive Lyra text blocks may group under one small Lyra mark and timestamp.
- Scheduled events have a subtle label such as `Morning brief · 07:00`, not a separate chat room.
- System failures use a status banner with a retry or details action.
- Action progress updates in place: `pending → completed`, `pending → failed`, or `completed → undone`.
- Sources appear after the relevant block, not as an unrelated footer when block-level provenance exists.

#### Composer

- Multiline text input, send button, voice/capture button, attachment affordance reserved for later use.
- Input grows from one to six lines.
- Enter inserts a newline on touch devices; the send button submits.
- Voice capture shows permission, recording, upload, transcription, and failure states.
- Offline sends are queued with a visible pending badge and an idempotency key.
- The composer never clears until the local event has been durably queued.

#### Empty state

The normal product should almost never be empty because scheduled events are part of the stream. On a genuinely new account, show a short explanation of what Lyra can receive and do, plus notification and Face ID setup. Do not show “What’s on your mind?” or suggested prompt cards.

### 6.2 To Do tab

The To Do tab follows Apple Reminders' interaction model while using Lyra's own visual identity and Notion as the initial backing source.

#### Navigation and lists

- Header: `To Do`, count of incomplete tasks, optional search.
- Smart-list controls: `Today`, `Scheduled`, `All`, `Flagged`.
- `Today` is selected by default.
- Tasks group by overdue, today, later today, and undated when relevant.
- Custom Notion list/category values appear below smart lists only when the source exposes them.

#### Task row

- Minimum row height: 52 px.
- Leading 24 px circular completion control.
- Title, optional note preview, due time/date, flag, and pending/offline indicator.
- Tapping the completion control changes the local appearance immediately but does not report success until the provider confirms.
- Tapping the body opens a task detail sheet.
- Swipe left: delete/dismiss only when the provider supports it, with confirmation for irreversible deletion.
- Swipe right: flag/unflag when the mapped source property exists.

#### Quick add

- Persistent `New Reminder` row/button above the bottom tab bar.
- First submit needs only a title.
- Detail sheet supports notes, due date/time, list, flag, priority, and recurrence when supported.
- Unsupported provider fields are hidden, not simulated.

#### Source mapping

The normalized task fields are:

| Field | Required | Initial source behavior |
|---|---:|---|
| `id` | Yes | Lyra UUID |
| `source` | Yes | `notion` initially |
| `sourceId` | Yes after sync | Notion page ID, never exposed as a visual label |
| `title` | Yes | Mapped title property |
| `notes` | No | Mapped rich text property if configured |
| `list` | No | Mapped select property; defaults to `Inbox` |
| `dueAt` | No | Mapped date property |
| `completed` | Yes | Mapped checkbox/status property |
| `flagged` | No | Mapped checkbox property if configured |
| `priority` | No | `none`, `low`, `medium`, `high` when configured |
| `recurrence` | No | Read-only until a source adapter implements writes |
| `sourceUpdatedAt` | Yes | Used for conflict detection |
| `syncStatus` | Yes | `current`, `pending`, `failed`, `conflict`, `stale` |

Property names must be configurable through environment variables. No live Notion IDs or private property names belong in this public repository.

### 6.3 News tab

The News tab uses the reading density and source transparency of Perplexity's news feed.

#### Feed

- Header: `News`, brief date, last refresh, and refresh action.
- Lead briefing card: short editorial summary and top themes.
- Story cards: optional 16:9 image, topic label, headline, two-to-four sentence summary, published time, source count, and `Why it matters` when present.
- Cards remain mostly flat; avoid a dashboard grid of equally weighted rounded rectangles.
- Story groups may cluster several sources covering the same event.
- Read state reduces emphasis without hiding the story.
- Saved state is local/user state and does not change the source story.

#### Story detail

- Full summary and `Why it matters`.
- Source list with publisher, title, URL, and publication timestamp.
- `Ask Lyra` starts a message in the Lyra tab with the story context attached by stable ID, not by copying untrusted page text into the prompt.
- `Open source` launches an external browser view.
- Broken or absent images collapse cleanly without a blank placeholder.

#### Morning brief integration

- The morning cron creates one `scheduled.brief` event in the Lyra stream.
- If it contains a valid `news_brief` block, the same transaction upserts the dated News read model.
- Email, health, ideas, and non-news sections stay in the Lyra briefing event and do not become fake news stories.
- A malformed news block does not discard the cron result. The original safe text remains visible in Lyra and the News tab shows the last valid brief as stale.

## 7. Design system

### 7.1 Direction

The product should feel native to an iPhone, calm, information-dense, and conversational. Use ChatGPT/Codex conventions for typography, open assistant messages, composer quality, sheets, code/media rendering, and restrained chrome. Use Apple Reminders conventions for task scanning and completion. Use Perplexity conventions for source-forward news presentation.

The design must not stop halfway between a beige dashboard and a chat clone. One neutral design system governs all three tabs.

### 7.2 Tokens

Use CSS custom properties. Values below are acceptance defaults, not suggestions.

```css
:root {
  --font-sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;
  --font-mono: ui-monospace, "SFMono-Regular", Menlo, monospace;
  --canvas: #ffffff;
  --surface-subtle: #f7f7f8;
  --surface-raised: #ffffff;
  --text-primary: #202123;
  --text-secondary: #6b6c70;
  --text-tertiary: #92949a;
  --divider: #e5e5e7;
  --accent: #10a37f;
  --accent-subtle: #e7f5ef;
  --danger: #d92d20;
  --warning: #a15c00;
  --success: #087f5b;
  --focus: #0a84ff;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --radius-sm: 10px;
  --radius-md: 14px;
  --radius-lg: 18px;
  --radius-sheet: 24px;
  --tap-min: 44px;
  --content-max: 768px;
}
```

Dark mode uses `#212121` canvas, `#2f2f2f` subtle surface, `#ececec` primary text, `#b4b4b4` secondary text, and `#424242` dividers. It must meet WCAG AA contrast for text and controls.

The iOS system font stack is deliberate. It produces SF Pro in the installed PWA without downloading or imitating a proprietary web font.

### 7.3 Type scale

| Role | Size / line-height | Weight |
|---|---|---:|
| Large title | 28 / 34 px | 700 |
| Screen title | 20 / 26 px | 650 |
| Section title | 17 / 22 px | 650 |
| Body | 16 / 24 px | 400 |
| Task body | 17 / 22 px | 400 |
| Metadata | 13 / 18 px | 500 |
| Caption | 11 / 15 px | 500 |
| Code | 13 / 20 px | 400 |

### 7.4 Interaction rules

- All interactive targets are at least 44 by 44 px.
- Use a maximum of two elevation levels. Borders and spacing do more work than shadows.
- Animation duration is 160–220 ms and respects `prefers-reduced-motion`.
- Sheets use drag affordance, Escape support, focus trap, and outside-tap dismissal.
- Loading uses skeletons only where cached content does not exist. Existing content remains visible during refresh.
- Never replace a whole screen with a spinner.
- Keyboard appearance must not cover the composer or bottom navigation.
- Use `aria-live="polite"` for streamed progress and `aria-live="assertive"` only for blocking failures.

## 8. Rich content component contract

All Lyra output is represented as validated content blocks. The PWA renders the full component. Telegram and WhatsApp format the same block into their supported subset. Every block requires the common fields `id` and `type`; the table lists the remaining required fields.

### 8.1 Block types

| Block | Required fields | Rendering | Fallback-channel behavior |
|---|---|---|---|
| `rich_text` | `markdown` | Safe headings, paragraphs, emphasis, links | Markdown/plain text |
| `bullet_list` | `items[]` | Bulleted list | Bullets |
| `numbered_list` | `items[]` | Numbered list | Numbered text |
| `checklist` | `items[{id,label,checked,actionId?}]` | Interactive check rows when action exists | Unicode checkbox list |
| `callout` | `tone,title?,body` | Info/warning/success/error banner | Label plus text |
| `metric_group` | `metrics[{label,value,delta?,unit?}]` | Compact metrics row; horizontally scrollable | Labeled lines |
| `chart` | `chartType,title,summary,series,sourceRefs[]` | Accessible SVG bar/line/donut chart | Compact data table |
| `table` | `columns,rows` | Scrollable table with sticky header when useful | Monospace/plain rows, truncated safely |
| `image` | `url,alt,caption?,sourceRef?` | Responsive image with caption | Link plus caption |
| `media` | `mediaType,url,title,caption?` | Audio/video/file control | Link |
| `source_list` | `sourceRefs[]` | Source chips or expanded list | Numbered links |
| `action_group` | `actionRefs[]` | Buttons with preview/commit/status | Numbered action labels or omitted when unsafe |
| `briefing` | `title,sections[]` | Scheduled briefing container | Sectioned text |
| `news_brief` | `date,title,summary,themes[],items[]` | Lyra summary plus News read-model input | Headline digest |
| `task_snapshot` | `title,tasks[]` | Read-only embedded task list | Checklist text |
| `code` | `language,code` | Escaped code with copy button | Fenced code |

### 8.2 Validation limits

- Maximum 40 blocks per event.
- Maximum 20,000 characters of normalized text per event.
- Maximum 100 checklist or table rows per block.
- Maximum 50 points per chart series and six series per chart.
- `http` and `https` URLs only. `data:` URLs are not accepted from server content.
- No raw HTML.
- Unknown block types are retained in audit metadata but rendered as a safe unsupported-content callout.
- If structured parsing fails, render the original output as escaped `rich_text` and record `normalizationStatus: fallback`.

### 8.3 Chart accessibility

- Render charts with native SVG, not a remote CDN dependency.
- Include a text summary and an expandable data table.
- Do not communicate meaning by color alone.
- Values derived from external data require source references and an `asOf` timestamp.

### 8.4 Normative schema artifacts

The component contract is executable and versioned in two files:

- [`docs/fixtures/lyra-ui-v1.schema.json`](fixtures/lyra-ui-v1.schema.json) is the normative JSON Schema for the complete response envelope and all 16 block types.
- [`docs/fixtures/lyra-ui-v1.golden.json`](fixtures/lyra-ui-v1.golden.json) contains one validated golden case per component, including component variants, exact DOM assertions, required text, interaction sizing, error states, network mocks, screenshot names, and exact Telegram/WhatsApp fallback text.

Every block has a stable `id` and `type`. Every reference is by stable ID:

- `sourceRefs` and `sourceRef` resolve against envelope `provenance`.
- `actionRefs` and item-level `actionId` resolve against envelope `actions`.
- Missing or duplicate references invalidate structured rendering and trigger safe-text fallback.
- Nested briefing blocks may be at most two levels deep at runtime, even though the recursive schema permits composition.

The implementation's Zod schemas must be behaviorally identical to the JSON Schema. A contract test loads every golden envelope and requires both validators to agree. Any schema change requires:

1. Incrementing `schemaVersion` for a breaking change.
2. Adding or updating a golden case.
3. Updating both PWA and fallback-channel tests.
4. Maintaining safe rendering for stored v1 events.

### 8.5 Exact response envelope example

Lyra may emit the following object directly or inside one fenced `lyra-ui` block. This is the smallest complete interactive example:

```json
{
  "schemaVersion": 1,
  "blocks": [
    {
      "id": "focus-summary",
      "type": "rich_text",
      "markdown": "Your **highest-leverage** task is to finish the launch brief.",
      "sourceRefs": ["source-launch-plan"]
    },
    {
      "id": "focus-actions",
      "type": "action_group",
      "title": "Actions",
      "actionRefs": ["action-complete-brief"]
    }
  ],
  "actions": [
    {
      "id": "action-complete-brief",
      "label": "Complete reminder",
      "actionType": "complete",
      "targetId": "task-launch-brief",
      "status": "available",
      "requiresConfirmation": false
    }
  ],
  "provenance": [
    {
      "id": "source-launch-plan",
      "source": "Launch plan",
      "sourceType": "notion",
      "title": "PWA launch",
      "url": "https://example.com/launch-plan",
      "asOf": "2026-08-17T07:00:00.000Z",
      "freshness": "current",
      "confidence": "verified"
    }
  ]
}
```

The renderer receives the validated envelope plus an event context. It does not receive raw model output:

```ts
type RenderContext = {
  eventId: string;
  locale: "en-GB";
  timeZone: "Europe/Berlin";
  actionsById: Map<string, LyraActionReference>;
  provenanceById: Map<string, Provenance>;
  onAction: (actionId: string) => Promise<void>;
};

renderBlocks(envelope.blocks, context): DocumentFragment;
formatBlocksForFallback(envelope, { channel: "telegram" | "whatsapp" }): string;
```

No component may fetch source or action data independently. This keeps the rendered PWA and fallback text tied to the same canonical event.

### 8.6 Golden rendering rules

The golden fixture fixes the following test contract:

- Component gallery route: `/app/dev/components`, available only outside production.
- Viewports: 390×844 light, 390×844 dark, and 768×1024 light.
- Stable block root attributes: `data-block-id` and `data-block-type`.
- Screenshot path: `tests/golden/lyra-ui-v1/<case-id>--<viewport-id>.png`.
- Required checks before screenshot comparison: schema validation, reference integrity, DOM selector counts, text assertions, accessible names/roles, and 44 px interactive targets.
- Exact fallback text in each case is a channel-formatter golden, not illustrative copy.
- Broken image state, disabled action state, stale task state, chart data table, nested briefing blocks, and escaped hostile HTML are mandatory fixture assertions.
- A screenshot baseline may be created only after design review approves the component gallery. Future differences require intentional review; the test command must never overwrite baselines automatically.

Fixture fields are evaluated as follows:

- Each `case` renders in an isolated host. No selectors may match navigation, another case, or test-runner chrome.
- `expected.root` must match at least one element and every matched root must carry the declared block ID/type attributes.
- `expected.selectors[].count` is the exact count inside the isolated case host.
- `expected.textIncludes[]` uses visible text, not `innerHTML`.
- `expected.accessible[]` maps directly to Playwright role queries. `name` is exact, `nameIncludes` is a substring, and `checked`/`disabled` are required state filters.
- `expected.minimumInteractiveSize` applies to every enabled button, link, checkbox, or media control in that case.
- `networkMocks[].response.body` is returned as UTF-8; `bodyBase64` is decoded before response. No golden depends on the public network.
- `expected.errorState.action: abort-image-request` rerenders the same case with the image request aborted, then evaluates the error-state assertions.
- `expected.fallbackText` must match byte-for-byte after normalizing line endings to `\n` and trimming one trailing newline.
- Screenshot comparison uses reduced motion, loaded fonts, completed mocked media requests, and a zero-animation settling frame.

The fixture contains the following cases:

| Golden case | Coverage |
|---|---|
| `rich-text` | Heading, emphasis, external link, inline code, hostile HTML escaping, source reference |
| `bullet-list` | Semantic unordered list and exact fallback bullets |
| `numbered-list` | Semantic ordered list and deterministic numbering |
| `checklist` | Checked/unchecked state, actionable item, source, 44 px target |
| `callout-tones` | Info, warning, success, and error roles/tones |
| `metric-group` | Values, units, deltas, and trends |
| `chart-variants` | Bar, line, donut, SVG accessibility, data-table fallback |
| `table` | Column alignment, null cell, scrolling table semantics |
| `image` | Alt text, caption, lazy loading, source, failed-image state |
| `media-variants` | Audio, video, and file link |
| `source-list` | Two linked sources, timestamps, confidence/freshness data |
| `action-group` | Available, completed, and disabled actions |
| `briefing` | Nested rich text and list sections |
| `news-brief` | Lead summary, themes, image, multi-source story, why-it-matters |
| `task-snapshot` | Open, completed, stale, due time, actionable task |
| `code` | Escaped code, language metadata, caption, copy target |

## 9. Canonical domain model

### 9.1 `LyraEvent`

```ts
type LyraEvent = {
  id: string;
  streamId: "primary";
  schemaVersion: 1;
  type:
    | "conversation.user"
    | "conversation.assistant"
    | "scheduled.brief"
    | "scheduled.reminder"
    | "scheduled.failure"
    | "action.status"
    | "capture.status"
    | "system.status";
  actor: "user" | "lyra" | "automation" | "system";
  occurredAt: string;
  createdAt: string;
  status: "pending" | "completed" | "failed" | "skipped" | "stale";
  title?: string;
  blocks: ContentBlock[];
  actions: LyraActionReference[];
  provenance: Provenance[];
  parentEventId?: string;
  idempotencyKey: string;
  metadata: Record<string, unknown>;
};
```

`idempotencyKey` means the same accepted operation can be retried without creating a duplicate. Interactive sends use the client-generated UUID. Cron events use `cron:<jobId>:<runId>`.

### 9.2 Provenance

```ts
type Provenance = {
  id: string;
  source: string;
  sourceType: "notion" | "calendar" | "gmail" | "web" | "openclaw" | "user" | "system";
  title?: string;
  url?: string;
  asOf: string;
  freshness: "current" | "stale" | "unknown" | "unavailable";
  confidence: "verified" | "inferred" | "unverified";
};
```

### 9.3 Task

Use the normalized fields in section 6.2 plus `createdAt`, `updatedAt`, `version`, and `lastSyncedAt`. The provider version or timestamp is required on mutation to detect overwriting a newer source edit.

### 9.4 News brief

```ts
type NewsBrief = {
  date: string;
  generatedAt: string;
  eventId: string;
  status: "current" | "stale" | "failed";
  title: string;
  summary: string;
  themes: string[];
  items: Array<{
    id: string;
    topic: string;
    headline: string;
    summary: string;
    whyItMatters?: string;
    image?: { url: string; alt: string };
    publishedAt?: string;
    sources: Provenance[];
  }>;
};
```

### 9.5 Delivery record

```ts
type DeliveryRecord = {
  id: string;
  eventId: string;
  channel: "push" | "telegram" | "whatsapp";
  targetKey: string;
  status: "pending" | "delivering" | "delivered" | "failed" | "suppressed";
  attempts: number;
  nextAttemptAt?: string;
  lastAttemptAt?: string;
  deliveredAt?: string;
  lastErrorCode?: string;
};
```

## 10. Database design

Postgres is the production source for PWA state. Files under `LYRA_APP_DATA_DIR` remain a local emergency mirror during migration, not the primary database.

Create an idempotent migration runner at `app/migrate.js` and SQL under `app/migrations/`. Migrations run under a Postgres advisory lock and record applied versions in `lyra_schema_migrations`.

### 10.1 Tables

```sql
CREATE TABLE lyra_events (
  id UUID PRIMARY KEY,
  stream_id TEXT NOT NULL DEFAULT 'primary',
  schema_version INTEGER NOT NULL DEFAULT 1,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL,
  title TEXT,
  blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
  actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  provenance JSONB NOT NULL DEFAULT '[]'::jsonb,
  parent_event_id UUID REFERENCES lyra_events(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX lyra_events_stream_time_idx
  ON lyra_events (stream_id, occurred_at DESC, id DESC);
CREATE INDEX lyra_events_type_time_idx
  ON lyra_events (event_type, occurred_at DESC);

CREATE TABLE lyra_actions (
  id UUID PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  action_type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  status TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  committed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  undone_at TIMESTAMPTZ
);

CREATE TABLE lyra_tasks (
  id UUID PRIMARY KEY,
  source TEXT NOT NULL,
  source_id TEXT,
  title TEXT NOT NULL,
  task_data JSONB NOT NULL,
  source_updated_at TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ,
  sync_status TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (source, source_id)
);

CREATE INDEX lyra_tasks_active_due_idx
  ON lyra_tasks (((task_data->>'completed')::boolean), (task_data->>'dueAt'));

CREATE TABLE lyra_news_briefs (
  brief_date DATE PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES lyra_events(id),
  generated_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL,
  brief JSONB NOT NULL,
  source_run_id TEXT NOT NULL UNIQUE
);

CREATE TABLE lyra_item_state (
  item_type TEXT NOT NULL,
  item_id TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  saved_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (item_type, item_id)
);

CREATE TABLE lyra_deliveries (
  id UUID PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES lyra_events(id),
  channel TEXT NOT NULL,
  target_key TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, channel, target_key)
);

CREATE INDEX lyra_deliveries_pending_idx
  ON lyra_deliveries (status, next_attempt_at);

CREATE TABLE lyra_sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE lyra_push_subscriptions (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL,
  endpoint_hash TEXT NOT NULL UNIQUE,
  subscription JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_success_at TIMESTAMPTZ,
  disabled_at TIMESTAMPTZ
);
```

Do not delete `lyra_app_audit` or `lyra_app_state` during the first migration. Import existing conversations into `lyra_events` once, mark the import version, and retain the old tables for rollback until v2 has run successfully for 30 days.

## 11. Backend architecture

Keep the existing Node HTTP service and ES module runtime. Do not introduce a frontend build system in this release. Add `zod` for request, response, and block validation. The current JavaScript codebase remains JavaScript for this migration; a TypeScript conversion is a separate project and must not delay the user-facing fix.

### 11.1 Target file map

```text
app/
├── server.js                  # HTTP boundary and route dispatch
├── api.js                     # compatibility facade during migration
├── auth.js                    # passkeys; delegates sessions to repository
├── channels.js                # inbound and fallback channel adapters
├── integrations.js            # Notion/calendar/Gmail provider adapters
├── schemas.js                 # Zod schemas and enums
├── normalize-content.js       # structured output + safe text fallback
├── repository.js              # Postgres repositories and transactions
├── feed-service.js            # canonical event stream
├── task-service.js            # task read model and provider writes
├── news-service.js            # dated news read model
├── delivery-service.js        # durable delivery queue and retry worker
├── cron-ingest.js             # OpenClaw webhook normalization
├── migrate.js                 # migration runner
└── migrations/
    └── 001-pwa-v2.sql

app/public/
├── index.html
├── styles.css                 # tokens, shell, shared components
├── manifest.webmanifest
├── sw.js
└── js/
    ├── app.js                 # bootstrap
    ├── api-client.js          # fetch, SSE, auth retry
    ├── state.js               # small observable app state
    ├── offline-db.js          # IndexedDB feed/cache/queue
    ├── router.js              # three-tab URL state + deep links
    ├── render-blocks.js       # content-block renderer
    ├── components.js          # shared DOM component factories
    ├── settings.js
    └── views/
        ├── lyra-view.js
        ├── todo-view.js
        └── news-view.js
```

Native browser ES modules are sufficient. Keep functions small, named, testable, and free of inline event-handler strings.

### 11.2 Service boundaries

- `server.js` parses routes, validates input, applies authentication/rate limits, and maps known errors to HTTP status codes. It contains no domain logic.
- `feed-service.js` creates, lists, and updates canonical events.
- `normalize-content.js` validates structured agent output and falls back to safe text.
- `task-service.js` owns task grouping, cache refresh, provider mutations, and conflict behavior.
- `news-service.js` validates and stores daily briefs and read/saved state.
- `delivery-service.js` owns push and messaging attempts. A notification can never be the only copy of an event.
- `repository.js` uses parameterized queries and exposes transaction helpers.

## 12. API contract

All `/v1` responses use JSON except the message stream. Every error uses:

```json
{
  "error": {
    "code": "stable_machine_code",
    "message": "Human-readable explanation",
    "retryable": false,
    "details": {}
  }
}
```

### 12.1 Feed and conversation

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/v1/feed?cursor=&limit=40` | Load canonical stream, newest page first |
| `GET` | `/v1/feed/events/:id` | Resolve a push/deep-linked event |
| `GET` | `/v1/feed/stream?after=<event-id>` | Receive newly persisted feed events over SSE |
| `POST` | `/v1/messages` | Accept a user message and open an SSE response |
| `POST` | `/v1/captures` | Accept text or audio capture; retained from v1 |

`POST /v1/messages` request:

```json
{
  "idempotencyKey": "client-uuid",
  "text": "What should I focus on today?",
  "contextRefs": [{ "type": "news", "id": "stable-story-id" }]
}
```

SSE event names are `user.accepted`, `agent.started`, `tool.started`, `tool.completed`, `content.delta`, `event.completed`, and `event.failed`. The final event contains the persisted `LyraEvent`. Reconnect with the same idempotency key returns/replays the accepted event instead of running the agent twice.

`GET /v1/feed/stream` emits only completed database events, sends a heartbeat every 20 seconds, and supports `Last-Event-ID`. On reconnect, the server queries Postgres after the last event before subscribing to the in-process notifier. This makes a scheduled event appear in an already-open PWA without relying on a page reload or foreground push delivery.

The old `/v1/conversations*` routes remain behind a compatibility layer for channel bridges during the migration, then are removed after 30 stable days.

### 12.2 Tasks

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/v1/tasks?view=today|scheduled|all|flagged&cursor=` | Return normalized tasks and source state |
| `POST` | `/v1/tasks` | Create task |
| `PATCH` | `/v1/tasks/:id` | Update supported fields |
| `POST` | `/v1/tasks/:id/complete` | Complete with expected version |
| `POST` | `/v1/tasks/:id/reopen` | Reopen with expected version |
| `POST` | `/v1/tasks/refresh` | Refresh from source without blocking cached reads |

Mutation requests include `idempotencyKey` and `expectedVersion`. A source conflict returns `409 task_conflict` with the current task. Provider unavailability returns `503 provider_unavailable`; the client preserves its queued intent and does not show completion.

### 12.3 News

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/v1/news?date=&cursor=` | Latest or requested brief |
| `POST` | `/v1/news/items/:id/read` | Set read state |
| `POST` | `/v1/news/items/:id/save` | Set saved state |
| `DELETE` | `/v1/news/items/:id/save` | Clear saved state |

### 12.4 Scheduled ingestion

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/v1/internal/cron-deliver` | Receive OpenClaw cron completion webhook |
| `POST` | `/v1/internal/cron-status` | Reconcile failed/missed OpenClaw run states |
| `GET` | `/v1/health/scheduled-delivery` | Show last received run and queued/failed deliveries |

The cron endpoint accepts the current OpenClaw webhook envelope, including `jobId`, `action`, `summary`, and compatible `output`, `text`, or `message` fields. Authentication uses a high-entropy secret supplied through the production environment. Because OpenClaw's webhook configuration may only support a URL, query-secret compatibility is allowed initially, but the secret must be redacted from logs and replaced with a signed header when the runtime supports it.

Request deduplication uses `cron:<jobId>:<runId>`. If no run ID is present, derive a stable hash from job ID, scheduled time, and payload hash.

OpenClaw may fail before invoking a completion webhook. A root-side reconciliation script therefore reads recent OpenClaw run status and posts only sanitized job/run/status/error metadata to `/v1/internal/cron-status`. It must run through the existing cron/health mechanism at least every two minutes. It must not grant the restricted `lyra-app` service user access to root's OpenClaw workspace. The status endpoint creates a visible `scheduled.failure` event only when a failed run has no event with the same cron idempotency key.

### 12.5 Actions and operations

Retain `/v1/actions`, `/commit`, and `/undo`, but persist actions in `lyra_actions`. `GET /v1/metrics` adds scheduled event counts, delivery success, feed latency, task sync failures, and push delivery outcomes without storing message content in metrics.

## 13. Agent-output normalization

### 13.1 Accepted formats

The normalizer accepts, in priority order:

1. A validated object containing `schemaVersion`, `blocks`, `actions`, and `provenance`.
2. A fenced `lyra-ui` JSON object embedded in otherwise readable text.
3. Plain Markdown converted to safe basic blocks.

Never make successful rendering depend on the model producing valid JSON.

### 13.2 Interactive prompt contract

The PWA-specific OpenClaw session instruction asks Lyra to:

- Answer normally and concisely.
- Use structured blocks only when they improve comprehension.
- Attach sources to the smallest relevant block.
- Use charts only for actual numeric data.
- Never invent a source, action result, image, or current state.
- Return ordinary text if uncertain about a widget schema.

The server validates everything. Model output is untrusted input.

### 13.3 Scheduled prompt contract

Scheduled prompts keep their human-readable final answer but may include one fenced `lyra-ui` object. The morning brief should emit a `briefing` block and a `news_brief` block. Other crons use `briefing`, `callout`, `checklist`, or `task_snapshot` when appropriate.

If a cron returns exactly `SKIP`, persist a lightweight `skipped` run status for operations but do not add a visible feed event or send notifications.

## 14. Scheduled delivery architecture

### 14.1 Required order

```text
OpenClaw run completes
→ POST /v1/internal/cron-deliver
→ authenticate and validate
→ deduplicate
→ normalize output
→ transaction: persist event + News read model + delivery rows
→ return 200
→ delivery worker attempts push and configured fallback channels
```

Persistence must precede notification. This prevents “Telegram got it but the app did not” and makes retries safe.

### 14.2 OpenClaw configuration change

Update the live private cron definitions so user-facing jobs deliver their webhook to the Lyra app endpoint instead of directly to WhatsApp or Telegram. `scripts/restore-crons.py` must restore webhook delivery modes rather than converting every non-announce delivery to `--no-deliver`.

The public `config/cron-jobs.example.json` may show placeholder URLs only. Live recipients and secrets remain in `lyra-private` and host environment files.

### 14.3 Delivery worker

- Run in the existing `lyra-app` process on a five-second interval; do not add another service initially.
- Claim up to 20 eligible rows using `FOR UPDATE SKIP LOCKED`.
- Mark rows `delivering`, attempt once, then mark `delivered` or schedule retry.
- Retry after approximately 10 seconds, 1 minute, 5 minutes, 30 minutes, and 2 hours.
- Stop automatic attempts after five failures and expose `failed` in health/metrics.
- A startup sweep returns stranded `delivering` rows older than five minutes to `pending`.
- Disable an expired Web Push subscription on HTTP 404 or 410.
- Fallback formatting is generated from canonical blocks at send time.

### 14.4 Notification policy

- Do not push for the user's own interactive message or an assistant reply while the PWA is visibly active.
- Push for scheduled briefs, reminders, failed critical actions, and explicit test alerts.
- Push title is short; body is a safe text summary under 180 characters.
- Notification data includes only `eventId`, `tab`, and safe routing metadata.
- Notification click focuses an existing PWA window when possible and opens the exact event.

### 14.5 Missed-run reconciliation

- Add `scripts/lyra-cron-reconcile.mjs` or extend `scripts/cron-heartbeat.sh` to inspect recent OpenClaw runs from the privileged runtime context.
- Post job ID, run ID, scheduled/finished time, terminal status, and a redacted error category to `/v1/internal/cron-status`.
- Never post the full prompt, output, recipient, token, or private configuration.
- Reconciliation is repeatable and uses the same `cron:<jobId>:<runId>` key as normal delivery.
- A run that is still active is not treated as failed until its configured timeout plus a two-minute grace period has passed.
- A late successful delivery may update the existing failure event to completed and attach the valid output, but it must not create a second visible feed item.

## 15. Frontend state and offline behavior

### 15.1 Storage

- Cache the static application shell with the service worker.
- Store feed pages, latest tasks, latest News brief, read state, and pending mutations in IndexedDB.
- Keep only non-sensitive preferences in `localStorage`.
- Never store the bootstrap token after it has been exchanged for an HttpOnly session.

### 15.2 Launch strategy

1. Render the cached shell and last selected/deep-linked tab.
2. Read cached tab data from IndexedDB.
3. Check session and refresh current tab in parallel.
4. Merge server events by ID; never replace the whole feed.
5. Show freshness and offline state only when it affects trust.

### 15.3 Offline mutations

- Queue user messages, captures, task creates, and supported task updates with a client UUID.
- Keep visible pending state.
- Use Background Sync when available and `online`/launch retry as the universal fallback.
- Preserve ordering per entity. Do not send a task edit before its offline create succeeds.
- A rejected mutation remains visible with `Retry` and `Discard` choices.

## 16. Authentication and security

- Keep WebAuthn/passkeys and Face ID as the normal sign-in experience.
- Persist sessions in Postgres using a SHA-256 hash of the opaque session token. Never store the raw token.
- Sessions expire after 30 days and can be revoked.
- Use `Secure`, `HttpOnly`, and `SameSite=Strict` cookies in production.
- Require the bootstrap token only for first passkey registration or controlled recovery.
- Persist push subscriptions in Postgres, encrypted at rest if the database volume is not already encrypted.
- Validate every endpoint and normalized block with Zod.
- Escape all rendered content; never assign model text to `innerHTML` except through the audited renderer.
- Sanitize URLs and set `rel="noopener noreferrer"` on external links.
- Use parameterized SQL only.
- Apply body-size limits per route: 256 KB for JSON, 15 MB encoded audio, and smaller limits for cron webhooks.
- Rate-limit authentication, messages, captures, actions, and internal webhook failures independently.
- Redact secrets, authorization headers, query-secret values, phone numbers, private source IDs, and message bodies from operational logs.
- Keep all provider keys and recipient identifiers in Hetzner environment/private files. Never copy them into this repository or browser JavaScript.

## 17. State behavior matrix

| State | Lyra | To Do | News |
|---|---|---|---|
| Loading with cache | Keep cached feed; subtle top progress | Keep cached tasks; refresh indicator | Keep last brief; refresh indicator |
| First loading | Conversation skeleton, then setup state | Row skeletons | Lead/story skeletons |
| Empty | Setup explanation, not prompt suggestions | `No reminders here` plus quick add | `No brief has arrived yet` plus last run health |
| Offline | Persistent small offline badge; queue composer | Allow safe queued edits | Read cached brief; disable refresh |
| Stale | Mark affected source/event age | Source banner and per-row sync state | Show last valid brief date and failure reason |
| Partial source failure | Render successful blocks and warning | Render cached tasks, no false confirmation | Render valid stories, omit failed source group |
| Mutation pending | Inline status | Pending glyph and optimistic style | Immediate local read/save state |
| Mutation failed | Error event with Retry | Roll back provider-dependent success; show Retry | Restore prior state if server rejects |
| Session expired | Keep cache read-only; Face ID sheet | Same | Same |
| Fatal app error | Recovery panel with reload and diagnostics ID | Same | Same |

## 18. Failure-mode contract

| Failure | Detection | User experience | Required test |
|---|---|---|---|
| Anthropic/OpenClaw credit or model failure | Agent/cron non-success exit | Persist `scheduled.failure` or `event.failed`; push one concise failure alert when actionable | Simulated non-zero run creates one failure event, no fabricated brief |
| Cron fails before delivery webhook | Reconciliation detects terminal run without event | Create one deduplicated failure event and alert | Repeated reconciliation creates no duplicate; late success updates same event |
| Malformed structured output | Zod parse failure | Safe text fallback; diagnostics records schema errors | Invalid chart/news JSON renders escaped text |
| Duplicate cron webhook | Unique idempotency key | Existing event returned; no duplicate push | Same request twice yields one event and delivery set |
| Database unavailable | Connection/transaction error | API returns retryable 503; no notification is sent | Transaction rollback leaves no partial delivery |
| Notion unavailable | Timeout/non-2xx | Cached tasks marked stale; mutation remains pending/failed | Completion never appears confirmed |
| Task source conflict | Expected version mismatch | Show current task and `Review changes` | Stale edit returns 409 and preserves both states |
| Push denied | Browser permission | App continues; settings explains alerts are off | Denied state does not retry permission prompt |
| Push endpoint expired | 404/410 from push service | Subscription disabled; in-app feed remains authoritative | Endpoint disabled after one terminal response |
| Telegram/WhatsApp rejection | Adapter error | PWA unaffected; fallback delivery marked failed | Retry does not duplicate PWA event |
| Offline send | Fetch failure before acknowledgement | Local pending event remains and retries | Relaunch preserves pending queue |
| Session expired during queued sync | 401 | Pause queue; Face ID; resume same idempotency keys | Login resumes without duplicate action |
| Broken image | Image error | Remove image area; retain headline/caption | Card reflows without empty box |
| Service worker upgrade | New version waiting | Activate on next safe launch or explicit refresh | Existing pending queue survives upgrade |

## 19. Test plan

### 19.1 Unit tests

- Compile `docs/fixtures/lyra-ui-v1.schema.json` in strict JSON Schema 2020-12 mode.
- Validate all 16 envelopes in `docs/fixtures/lyra-ui-v1.golden.json` against JSON Schema and Zod; both validators must agree.
- Every Zod schema: valid case, missing required field, extra field, duplicate ID, broken source/action reference, unknown block, nesting overflow, and size-limit overflow.
- Markdown-to-block normalization and structured-output fallback.
- Safe URL handling and HTML escaping.
- Chart scale, zero/negative data, series limits, and accessible table output.
- Task smart-list grouping, due-date boundaries in `Europe/Berlin`, ordering, and counts.
- Task source mapping with missing optional properties.
- News brief normalization, source clustering, and stable item IDs.
- Cron envelope extraction for `summary`, `output`, `text`, `message`, and existing OpenClaw formats.
- Idempotency-key derivation and duplicate detection.
- Delivery eligibility, push suppression, retry schedule, and terminal subscription errors.
- Telegram and WhatsApp block formatters must equal every fixture's exact `fallbackText`.
- Session hashing and expiry.

### 19.2 API integration tests

- Authenticated and unauthenticated feed access.
- Persistent session survives service restart; logout revokes it.
- Cursor pagination has no duplicates or missing events across equal timestamps.
- User message creates one user event and one terminal assistant/failure event.
- SSE reconnect does not rerun the same message.
- Cron ingest persists before delivery and is transactional.
- Cron reconciliation records a pre-webhook failure and safely handles late success.
- Valid morning brief writes both feed event and News brief.
- Malformed morning brief preserves safe feed output but not invalid News data.
- Task create/update/complete/reopen with provider success, timeout, conflict, and retry.
- Preview/commit/undo remains auditable and retry-safe.
- Push subscription persists across restart.
- Delivery worker recovers stranded claims.
- Compatibility channel input reaches the same primary stream/action handlers.
- Body limits, rate limits, invalid JSON, and stable error shapes.

### 19.3 Browser E2E tests

- First run, token exchange, passkey registration, sign-out, Face ID sign-in.
- Exactly three bottom tabs and no hamburger/sidebar/Spaces/Today UI.
- Default launch opens Lyra.
- Cached launch works offline.
- Send text, observe progress, receive rich response, inspect sources.
- Render the fixture gallery at every `viewportMatrix` entry and assert each case's exact DOM selectors and text before visual comparison.
- Compare all 48 component screenshots: 16 cases × three viewports. Baselines cannot update in the ordinary test command.
- Verify every fixture's accessible role/name, keyboard focus behavior, and declared 44 px minimum target.
- Run fixture-declared error states and network mocks, including failed image layout.
- Voice permission, record, stop, upload, transcription failure, and retry.
- Scheduled event appears without page reload; push deep link scrolls to it.
- To Do add, edit, complete, reopen, offline queue, provider failure, and conflict.
- News latest brief, stale brief, story detail, read/save, broken image, Ask Lyra.
- Keyboard, safe areas, scroll retention, outside-tap sheet close, Escape/focus behavior.
- Dark mode, reduced motion, screen-reader labels, and 200% text zoom.

### 19.4 Agent evaluations

- Evidence-backed answer retains source and freshness.
- Unsupported claims are labeled inferred/unverified or omitted.
- Morning briefing separates news from email/health/tasks.
- Numeric charts match the supplied source data.
- Model never claims an action completed before the provider result.
- Access-control regression suite passes for private and shared sources.
- Malicious source text cannot inject a new system instruction or executable HTML.
- At least 30 representative interactive and scheduled responses either validate as `lyra-ui` v1 or produce the specified safe-text fallback; no response may disappear because structured parsing failed.
- The morning brief, task summary, metric/chart response, source-heavy research answer, media response, and action response each select the intended block type rather than flattening everything into `rich_text`.

### 19.5 Physical iPhone acceptance

Test on the actual target iPhone using Safari Add to Home Screen:

- Standalone launch without browser chrome.
- Face ID sign-in and session persistence after device/app restart.
- Safe-area layout in portrait and landscape.
- Keyboard never hides send, quick add, or bottom navigation.
- Audio recording and playback.
- Push permission, real scheduled push, deep link, and notification while app is closed.
- Offline cold launch, queued capture/task, and recovery.
- Home Screen icon, splash, dark mode, and touch behavior.

No migration gate advances on simulator/browser-only evidence.

## 20. Implementation sequence

The implementation should be sequential in one goal. The backend contracts must stabilize before visual polish begins, but each phase ends in a working application.

### Phase 0: Baseline and safety

1. Pull the canonical production/GitHub line according to `CLAUDE.md` and `docs/GIT-WORKFLOW.md`; stop on divergence.
2. Record current tests, production `/health`, cron status, PWA screenshot, and current source availability.
3. Preserve unrelated local files and private configuration.
4. Add feature switches defaulting off:
   - `LYRA_PWA_V2`
   - `LYRA_CRON_INGEST_V2`
   - `LYRA_DELIVERY_WORKER`
   - `LYRA_FALLBACK_TELEGRAM`
   - `LYRA_FALLBACK_WHATSAPP`

**Gate:** Existing tests pass and rollback commit/version is recorded.

### Phase 1: Persistence and schemas

1. Implement Zod schemas behaviorally identical to `docs/fixtures/lyra-ui-v1.schema.json`.
2. Add schema-parity and golden-envelope contract tests before building renderers.
3. Add migration runner and v2 tables.
4. Add repository, event feed, persistent sessions, and persistent push subscriptions.
5. Import legacy conversations once into the primary stream.
6. Add feed APIs and compatibility wrappers.

**Gate:** All 16 golden envelopes pass JSON Schema, Zod, ID uniqueness, reference integrity, and nesting-limit tests. Integration tests prove restart persistence, pagination, idempotency, and rollback-safe migration.

### Phase 2: Scheduled-event ingestion and delivery

1. Add OpenClaw cron webhook parser.
2. Persist scheduled events before enqueueing deliveries.
3. Add delivery worker, push deep links, and fallback formatters.
4. Add root-side failed/missed-run reconciliation without exposing the OpenClaw workspace to the app service.
5. Fix `scripts/restore-crons.py` webhook restoration.
6. Update sanitized cron example and deployment environment template.
7. Update live private cron URLs only during deployment, never in the public repo.

**Gate:** A forced test cron appears once in the PWA, produces one push, and records fallback status. A forced provider/credit failure creates an explicit failure event.

### Phase 3: Three-tab shell and rich renderer

1. Replace index/sidebar shell with Lyra, To Do, News tabs.
2. Add native-module frontend structure and IndexedDB cache.
3. Build `/app/dev/components` from `docs/fixtures/lyra-ui-v1.golden.json`; return 404 in production.
4. Add all 16 rich block renderers and exact Telegram/WhatsApp formatters.
5. Pass fixture DOM, accessibility, error-state, target-size, and fallback-text assertions.
6. Run design review on the complete gallery, then create the 48 approved screenshot baselines.
7. Add settings sheet and operational controls.
8. Remove current Today and Spaces UI while keeping compatibility APIs temporarily.

**Gate:** E2E proves exact tab set, no drawer, cached launch, safe renderer, responsive layout, and accessible sheets. Every golden component passes at all three viewports with no unreviewed screenshot difference.

### Phase 4: Lyra stream

1. Connect canonical feed and SSE message endpoint.
2. Add pagination, unread marker, scroll retention, message grouping, progress, and inline action state.
3. Add offline send/capture queue.
4. Add streaming-safe block finalization.

**Gate:** Interactive and scheduled events coexist in one ordered stream; refresh/relaunch creates no duplicates.

### Phase 5: To Do

1. Build normalized Notion task adapter and cached read model.
2. Build smart lists, task rows, quick add, detail sheet, completion/reopen, and supported flag/list fields.
3. Add optimistic UI with versioned reconciliation.
4. Add offline mutation ordering and failure recovery.

**Gate:** Physical iPhone test completes the full task lifecycle, including source outage and conflict.

### Phase 6: News

1. Add morning-brief structured prompt contract and normalizer.
2. Populate News brief read model during cron ingestion.
3. Build feed, story detail, source list, read/save, broken-image fallback, and Ask Lyra.
4. Keep last valid brief visible when refresh fails.

**Gate:** A real morning run creates the Lyra briefing and News feed from one canonical event with working sources.

### Phase 7: Quality, deployment, and migration

1. Run full unit, integration, browser E2E, agent eval, security, and visual review.
2. Deploy with v2 feature switch off, run migrations, then enable for the primary user.
3. Verify service health, logs, source status, scheduled ingest, push, and fallback delivery.
4. Run the physical iPhone checklist.
5. Begin 14-day PWA-first shadow period.

**Gate:** No critical fabricated/silent failures; release metrics are met for 14 consecutive days before messaging becomes emergency-only.

## 21. Deployment and rollback

### 21.1 Deployment

1. Commit and push only scoped public code/docs. Private cron changes go to `lyra-private`.
2. Update the canonical Hetzner checkout, then update the PWA service checkout at `/opt/lyra-ai` to the same commit.
3. Run `npm ci --omit=dev` if dependencies changed.
4. Load `/etc/lyra/lyra-app.env` and run `node app/migrate.js`.
5. Run `npm run app:preflight` and targeted production smoke tests.
6. Restart `lyra-app` and verify `/health`, authenticated feed, database, and service-worker assets.
7. Enable v2 switches one at a time.
8. Update the private OpenClaw cron delivery URLs last, then force one non-destructive test run.

The Caddy `/app*` routing remains. Static route tests must prevent the previous zero-byte/download regression.

### 21.2 Rollback

- Disable `LYRA_PWA_V2` to restore the v1 shell without rolling back data.
- Disable cron ingest v2 and restore the previous private webhook target if scheduled delivery is unhealthy.
- Revert the service checkout to the recorded prior commit through a normal deploy, never destructive reset.
- Do not drop v2 tables during rollback.
- Reconcile any events/actions through idempotency keys and the audit ledger.

## 22. Definition of done

The implementation goal is complete only when all statements are true:

- The installed PWA has exactly Lyra, To Do, and News tabs, with Lyra default.
- There is no sidebar, hamburger, Spaces view, Today dashboard, or prompt-card empty state.
- Interactive conversation behaves like the Telegram experience but uses validated rich components.
- Every Lyra UI v1 component and variant in the golden fixture passes schema, reference, DOM, accessibility, error-state, screenshot, and exact fallback-channel tests.
- Scheduled messages appear automatically in the same Lyra stream and trigger eligible push notifications.
- Every scheduled run has a durable completed, skipped, or failed record.
- To Do completes the supported Notion reminder lifecycle and never fakes provider success.
- News is populated from a real morning brief with sources and a stale-data fallback.
- Passkeys, sessions, push subscriptions, feed, actions, tasks, news, and deliveries survive a service restart.
- Offline launch and queued safe mutations work on a physical iPhone.
- Telegram/WhatsApp use canonical events/actions when enabled and remain fallback only.
- Unit, integration, browser E2E, agent eval, security, visual review, and physical iPhone acceptance pass.
- Deployment documentation and migration runbook reflect the v2 behavior.
- No secrets or personal identifiers are committed.

## 23. Implementation-model contract

### Recommended model

Run the end-to-end implementation goal with **`gpt-5.6-terra` at medium reasoning**. Terra is the right single-model compromise for a multi-file, production-connected build: materially cheaper than Sol, but capable enough to follow this locked architecture, handle database migration and auth boundaries, and finish the test/deploy loop.

Use **`gpt-5.6-luna` at medium reasoning** only for isolated mechanical follow-ups such as CSS token replacement, fixture generation, or adding repetitive unit cases. Luna should not own this entire goal because the work crosses database, authentication, cron delivery, offline state, UI, and production rollback.

Do not use Sol for implementation. The critical product and architecture decisions are already made in this specification. The implementation model must not reopen them unless it finds a concrete contradiction with production state or a safety issue.

### Goal prompt

```text
Implement Lyra PWA v2 end to end using:
/Users/akashkedia/AI/lyra-ai/docs/16-lyra-pwa-v2-technical-spec.md

The response/rendering contracts are normative:
/Users/akashkedia/AI/lyra-ai/docs/fixtures/lyra-ui-v1.schema.json
/Users/akashkedia/AI/lyra-ai/docs/fixtures/lyra-ui-v1.golden.json

Treat the specification as the source of truth. Do not redesign the product or add
frameworks/services that the spec excludes. Keep OpenClaw, the Node service, Notion,
Postgres, passkeys, service worker, and current Hetzner deployment. Implement phases
0 through 7 in order, completing and testing each gate before moving on.

Work autonomously and token-efficiently:
- inspect only files relevant to the current phase;
- reuse existing API, action, provider, auth, push, channel, cron, and deployment code;
- make small coherent patches;
- use Zod validation and parameterized SQL;
- make Zod, JSON Schema, the PWA renderer, and fallback formatters pass every golden fixture;
- do not change fixture expectations or screenshot baselines merely to make a failing implementation pass;
- preserve unrelated user changes and all private configuration;
- never print or commit secrets, recipients, phone numbers, or live source IDs;
- never fabricate success when a provider or model fails;
- do not force-push or use destructive git/database commands;
- stop only for a real architectural contradiction, destructive migration ambiguity,
  missing production authority, or a secret that cannot be discovered safely.

Required finish:
- all automated tests and evals pass;
- visual/design review and browser QA are completed and fixes applied;
- production is deployed through the documented Hetzner workflow;
- a forced test cron is visible in Lyra and delivered by push;
- the physical-iPhone-only checklist is prepared with every automatable check done;
- report exact remaining manual iPhone checks, if any, rather than claiming they passed.

Model: gpt-5.6-terra
Reasoning: medium
```

## 24. Decision log

| Decision | Reason |
|---|---|
| One primary stream, not conversation history | Matches the proven Telegram behavior and makes proactive events first-class |
| Three tabs only | Each tab maps to a recurring user job; Today and Spaces dilute the product |
| OpenClaw remains runtime | Existing agent, context, cron, skills, and channel behavior are valuable and expensive to replace |
| Node + native ES modules | Lowest migration risk and no new build/deploy system |
| Postgres event store | Scheduled delivery, restart persistence, idempotency, and audit cannot depend on process memory/files |
| Validated blocks with text fallback | Rich UI without trusting model-generated structure |
| Persist before fan-out | PWA becomes authoritative and cannot miss a message received by fallback channels |
| Notion-backed To Do first | Fits the current server and data boundary; direct Apple Reminders needs a separate Mac relay |
| Morning brief seeds News | Fastest path to a useful feed with existing content generation |
| Terra medium for implementation | Enough agentic reliability for the whole dependency chain without Sol cost |
