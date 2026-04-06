# Twitter Bookmarks Integration - Execution Summary

**What's Done:** All code, scripts, and documentation created
**What's Left:** You execute the steps (2 hours total)
**Date Filter:** Only bookmarks after 2026-03-19

---

## Files Created (All in `/Users/akashkedia/AI/lyra-ai/`)

### Executables (Copy to Hetzner)
- `scripts/fetch-twitter-bookmarks.sh` — Fetches bookmarks daily (X OAuth2 refresh, Notion dedupe by tweet id; **requires `jq`**)
- `scripts/run-with-openclaw-env.sh` — Sources `/root/.openclaw/.env` then runs a command (**use this from cron**)
- `scripts/analyze-claude-setup.js` — Analyzes patterns
- `scripts/aggregate-morning-digest.js` — Creates morning digest (includes **Workflow mix** when `Primary workflow` is set)

### Skills (Copy to Hetzner)
- `skills/twitter-synthesis/SKILL.md` — Synthesis engine
- `skills/twitter-bookmarks/oauth-setup.md` — OAuth2 guide

### Docs (Reference)
- `NOTION-TWITTER-INSIGHTS-SETUP.md` — Create Notion DB
- `TWITTER-IMPLEMENTATION-GUIDE.md` — Full step-by-step guide
- This file (quick reference)

---

## Do This Now (In Order)

### ⏱️ Step 1: X API OAuth2 Setup (30 min)

**Readable walkthrough:** [`docs/TWITTER-X-API-SETUP-STEPS.md`](docs/TWITTER-X-API-SETUP-STEPS.md) (then use `skills/twitter-bookmarks/oauth-setup.md` for token commands).

1. **Register X Developer App**
   - Go to https://developer.twitter.com/
   - Create app: "Lyra Twitter Bookmarks"
   - Copy: Client ID, Client Secret
   - Save them securely

2. **Get Refresh Token**
   - Follow: `skills/twitter-bookmarks/oauth-setup.md`
   - Run authorization flow
   - Save refresh token (long string)

3. **Add to .env**
   ```bash
   ssh hetzner "nano ~/.openclaw/.env"

   # Add these lines (client secret required for refresh_token grant):
   TWITTER_CLIENT_ID="paste_here"
   TWITTER_CLIENT_SECRET="paste_here"
   TWITTER_REFRESH_TOKEN="paste_here"
   TWITTER_USER_ID="your_numeric_id"
   NOTION_API_KEY="..."           # for dedupe against Twitter Insights
   TWITTER_INSIGHTS_DB_ID="..." # optional at first; needed for dedupe

   # Save and restart
   ssh hetzner "sudo systemctl restart openclaw"
   ```

4. **Verify**
   ```bash
   ssh hetzner "/root/lyra-ai/scripts/run-with-openclaw-env.sh /root/lyra-ai/scripts/fetch-twitter-bookmarks.sh"
   # Should say: ✅ Lyra Twitter: Fetched X new bookmark(s)
   ```

---

### ⏱️ Step 2: Create Notion Database (10 min)

1. **In Notion (GUI)**
   - Open Lyra Hub workspace
   - New Database → Name it "Twitter Insights"
   - Add properties from [`docs/NOTION-TWITTER-INSIGHTS-SETUP.md`](docs/NOTION-TWITTER-INSIGHTS-SETUP.md) — **base 11 + workflow 6** (Workflow multi-select, Primary workflow, Workflow confidence, Content mode, Workflow rationale, Needs review). Exact workflow option names must match the synthesis skill (e.g. `lyra_capability`, `content_create`).

2. **Get Database ID**
   - Open Twitter Insights DB
   - URL: `https://notion.so/.../[DATABASE_ID]?...`
   - Copy 32-char ID

3. **Add to .env**
   ```bash
   ssh hetzner "nano ~/.openclaw/.env"

   # Add:
   TWITTER_INSIGHTS_DB_ID="your_32_char_id"

   # Restart
   sudo systemctl restart openclaw
   ```

---

### ⏱️ Step 3: Deploy Scripts (15 min)

1. **Copy scripts to server**
   ```bash
   # From your Mac, in lyra-ai directory:
   ssh hetzner "mkdir -p /root/lyra-ai/scripts"
   scp scripts/fetch-twitter-bookmarks.sh hetzner:/root/lyra-ai/scripts/
   scp scripts/run-with-openclaw-env.sh hetzner:/root/lyra-ai/scripts/
   scp scripts/analyze-claude-setup.js hetzner:/root/lyra-ai/scripts/
   scp scripts/aggregate-morning-digest.js hetzner:/root/lyra-ai/scripts/

   ssh hetzner "chmod +x /root/lyra-ai/scripts/fetch-twitter-bookmarks.sh /root/lyra-ai/scripts/run-with-openclaw-env.sh"
   ```
   Install **`jq`** on the server if missing: `apt-get install -y jq` (Debian/Ubuntu).

2. **Create skill directories and copy**
   ```bash
   ssh hetzner "mkdir -p /root/.openclaw/workspace/skills/twitter-{bookmarks,synthesis}"

   scp skills/twitter-bookmarks/oauth-setup.md \
     hetzner:/root/.openclaw/workspace/skills/twitter-bookmarks/

   scp skills/twitter-synthesis/SKILL.md \
     hetzner:/root/.openclaw/workspace/skills/twitter-synthesis/
   ```

3. **Verify**
   ```bash
   ssh hetzner "ls /root/lyra-ai/scripts/*.sh /root/lyra-ai/scripts/*.js"
   # Should show fetch + run-with-openclaw-env + two node scripts
   ```

---

### ⏱️ Step 4: Test Everything (10 min)

1. **Test fetch**
   ```bash
   ssh hetzner "/root/lyra-ai/scripts/run-with-openclaw-env.sh /root/lyra-ai/scripts/fetch-twitter-bookmarks.sh"
   # ✅ Should show bookmark count
   ```

2. **Test analysis**
   ```bash
   ssh hetzner "/root/lyra-ai/scripts/run-with-openclaw-env.sh node /root/lyra-ai/scripts/analyze-claude-setup.js"
   # ✅ Should show theme distribution and suggestions
   ```

3. **Test digest**
   ```bash
   ssh hetzner "/root/lyra-ai/scripts/run-with-openclaw-env.sh node /root/lyra-ai/scripts/aggregate-morning-digest.js"
   # ✅ Should show digest preview
   # ✅ Should send to Telegram
   ```

4. **Verify Notion**
   - Open Twitter Insights DB
   - Should have new entries
   - All properties filled

---

### ⏱️ Step 5: Add Crons (10 min)

1. **Edit MEMORY.md** (document what crons do)
   ```bash
   ssh hetzner "nano /root/.openclaw/workspace/MEMORY.md"

   # Add to 7am section:
   - 7:00am - Twitter Bookmarks Fetch
   - 7:05am - Twitter Synthesis
   - 7:10am - Claude Setup Analysis
   - 7:15am - Morning Digest Aggregation
   ```

2. **Add OpenClaw crons** (or verify they exist)
   ```bash
   ssh hetzner

   # If using OpenClaw CLI:
   openclaw cron add --at "0 7 * * *" --name "twitter-fetch" --command "/root/lyra-ai/scripts/run-with-openclaw-env.sh /root/lyra-ai/scripts/fetch-twitter-bookmarks.sh"
   openclaw cron add --at "5 7 * * *" --name "twitter-synthesis" --command "/root/lyra-ai/scripts/run-with-openclaw-env.sh node /root/lyra-ai/scripts/analyze-claude-setup.js"
   openclaw cron add --at "15 7 * * *" --name "morning-digest" --command "/root/lyra-ai/scripts/run-with-openclaw-env.sh node /root/lyra-ai/scripts/aggregate-morning-digest.js"
   ```

   OR add to system crontab (**always load `.env` via wrapper**):
   ```bash
   crontab -e

   # Add these lines (adjust paths to match where you copied scripts):
   0 7 * * * /root/lyra-ai/scripts/run-with-openclaw-env.sh /root/lyra-ai/scripts/fetch-twitter-bookmarks.sh >> /var/log/twitter-fetch.log 2>&1
   5 7 * * * /root/lyra-ai/scripts/run-with-openclaw-env.sh node /root/lyra-ai/scripts/analyze-claude-setup.js >> /var/log/twitter-analysis.log 2>&1
   15 7 * * * /root/lyra-ai/scripts/run-with-openclaw-env.sh node /root/lyra-ai/scripts/aggregate-morning-digest.js >> /var/log/twitter-digest.log 2>&1
   ```

---

## Done!

Tomorrow at 7am:
1. ✅ Your bookmarks are fetched (from March 19 onwards)
2. ✅ Content bytes are generated (3 styles)
3. ✅ Saved to Twitter Insights DB
4. ✅ Digest sent to Telegram
5. ✅ Ready to use for recruiter outreach

---

## What Happens Daily (at 7am)

```
TIMELINE:
7:00am - Fetch bookmarks since March 19
         → 10-20 new bookmarks expected
         → Saves to /tmp/lyra-bookmarks-YYYY-MM-DD.json

7:05am - Synthesize bookmarks
         → Analyze each for themes & type
         → Generate 3 content bytes per theme
         → Save to Twitter Insights DB

7:10am - Analyze Claude setup
         → Find theme patterns
         → Suggest workflow improvements

7:15am - Generate morning digest
         → Combine all sections
         → Send to Telegram
         → You see in morning notification

YOUR ACTION:
Review entries in Twitter Insights DB
→ Mark good ones as "Ready"
→ Add Recruiter Notes
→ Use for recruiter outreach
→ Mark as "Published" when sent
```

---

## Quick Checklist

- [ ] X API app created + credentials saved
- [ ] Refresh token obtained and added to .env
- [ ] Notion Twitter Insights DB created with all properties (11 + workflow fields)
- [ ] Database ID added to .env
- [ ] Scripts copied to `/root/lyra-ai/scripts/` (or consistent path used in cron)
- [ ] Skills copied to /root/.openclaw/workspace/skills/
- [ ] All 3 scripts tested manually
- [ ] Notion DB has entries
- [ ] Crons added (7am execution)
- [ ] Telegram receipt verified

---

## Need Help?

See: `/TWITTER-IMPLEMENTATION-GUIDE.md` for detailed step-by-step instructions and troubleshooting

---

## Summary

**Time to complete:** ~2 hours (mostly copy-paste)
**Technical difficulty:** Low (no coding needed, just config + copy files)
**Breaking changes:** None (all new, doesn't touch existing Lyra systems)
**Rollback:** If needed, delete scripts and remove .env keys - reverts to pre-integration state

Ready to start? Begin with Step 1! 🚀
