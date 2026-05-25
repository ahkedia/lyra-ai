# TODO

## Auto-posting (next major lift)

**Goal:** After Telegram APPROVE, the pipeline auto-posts to X and LinkedIn at scheduled times. Substack and LinkedIn newsletter stay manual (no clean APIs).

### Scope (the realistic 80%)

| Surface | API | Effort | Notes |
|---|---|---|---|
| X thread auto-post | X API v2, OAuth 1.0a user context | ~1 day | Free tier = 1,500 posts/mo, plenty for 2 blogs/wk |
| LinkedIn native post | LinkedIn `w_member_social` scope | ~1-2 days | OAuth dance + token refresh |
| LinkedIn first comment | Same scope, posted ~30s after main post | included in above | |
| Pull-quote auto-post (Wed/Fri) | Reuses both above | included | |
| Substack publish | No clean API | **stays manual** | 90 sec paste, not worth fighting |
| LinkedIn article + newsletter | No public API | **stays manual** | Click publish in browser |

### Architecture sketch

1. **`scheduler.js`** (new cron, runs every 15 min) — reads Content Drafts where `text_approval_status = approved` AND `Scheduled Date` is in the past AND `posted_to_x = false` (or LinkedIn). Fires the relevant poster. Updates Notion when done.

2. **`lib/x-poster.js`** — wraps X API v2 thread creation. Handles rate limits, splits the thread, links the substack URL into the final tweet.

3. **`lib/linkedin-poster.js`** — wraps LinkedIn UGC Post API. Posts main post, waits ~30s, posts the first comment with the Substack URL.

4. **OAuth dance** — one-time setup. Tokens stored in `/root/.openclaw/.env` (need `chattr -i` first per immutable config rule). Refresh logic in poster.

5. **`SUBSTACK_LIVE <url>` Telegram command** — when Akash publishes manually on Substack, replies in Telegram with the URL. Bot back-fills the URL into all draft fields, swaps `{{SUBSTACK_URL}}` placeholders, marks draft as ready-to-schedule.

6. **Notion schema additions** — `posted_to_x` (checkbox), `posted_to_linkedin` (checkbox), `x_post_url` (URL), `linkedin_post_url` (URL), `Scheduled Date` already exists.

### Open questions for the eng-review

- Where to store OAuth tokens? `/root/.openclaw/.env` works for now but rotation matters.
- Failure mode: post fails after substack URL is set — retry once, then alert via Telegram. Need idempotency.
- Rate limit handling: X v2 free tier = 1,500/mo posts. Each thread = N tweets. At 9 tweets/thread × 8 blogs/mo = 72 tweets. Comfortable headroom.
- Test plan: dry-run mode that prints what would be posted instead of posting.

### Trigger

Run `/plan-eng-review` on this section before writing any code. OAuth + production posting + token storage = real engineering, deserves the rigor.

---

## Smaller items

- [ ] Delete `tweet_copy` Notion property once 2 weeks of new drafts confirm `x_thread` works
- [ ] Add a daily digest Telegram message (09:00 Berlin) — counts of pending drafts, approved drafts, pull-quotes remaining
- [ ] Pull-quote scheduler should skip days when no eligible draft exists (today: silent exit; should it Telegram-notify?)
- [ ] Substack Recommendations setup — manually recommend 5-10 newsletters in the wedge once first 3 posts are live
