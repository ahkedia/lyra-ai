# Twitter Bookmarks Integration - Implementation Guide

**Status:** All files created, ready for deployment
**Timeline:** ~2 hours to full deployment
**Date Filter:** Only bookmarks after 2026-03-19

**Current deploy paths / `jq` / env wrapper:** Prefer [`TWITTER-EXECUTION-SUMMARY.md`](TWITTER-EXECUTION-SUMMARY.md) as the quick reference; it matches `run-with-openclaw-env.sh` and `/root/lyra-ai/scripts/` layout.

---

## What's Been Created

### Scripts (Ready to Deploy)
- ✅ `/scripts/fetch-twitter-bookmarks.sh` — Daily fetch script (March 19 filter)
- ✅ `/scripts/analyze-claude-setup.js` — Setup pattern analysis
- ✅ `/scripts/aggregate-morning-digest.js` — Digest aggregation

### Skills (Ready to Deploy)
- ✅ `/skills/twitter-synthesis/SKILL.md` — Content synthesis engine
- ✅ `/skills/twitter-bookmarks/oauth-setup.md` — OAuth2 setup guide

### Documentation (Ready to Reference)
- ✅ `/docs/NOTION-TWITTER-INSIGHTS-SETUP.md` — Database creation guide
- ✅ Plan updated with March 19 date filter

---

## Deployment Checklist

### Phase 1: X API OAuth2 Setup (30 min)

**What you need to do:**

1. **Register X Developer Account**
   - Go to https://developer.twitter.com/
   - Create app: "Lyra Twitter Bookmarks"
   - Set permissions to Read (or Read-Write)
   - Save Client ID & Client Secret

2. **Get Refresh Token**
   - Follow guide in `/skills/twitter-bookmarks/oauth-setup.md`
   - Run the `get-twitter-token.sh` script (or use Postman)
   - Save the refresh token

3. **Add to Environment**
   ```bash
   # SSH to Hetzner and edit ~/.openclaw/.env
   ssh hetzner
   nano ~/.openclaw/.env

   # Add these 4 lines:
   TWITTER_CLIENT_ID="your_client_id"
   TWITTER_CLIENT_SECRET="your_client_secret"
   TWITTER_REFRESH_TOKEN="your_refresh_token"
   TWITTER_USER_ID="your_numeric_user_id"

   # Then restart
   sudo systemctl restart openclaw
   ```

4. **Verify Setup**
   ```bash
   ssh hetzner "/root/fetch-twitter-bookmarks.sh"
   # Should output: "✅ Lyra Twitter: Fetched X new bookmarks"
   ```

---

### Phase 2: Create Notion Database (10 min)

**What you need to do:**

1. **Manual Setup** (Fastest)
   - Open Notion → Lyra Hub
   - Create new database: "Twitter Insights"
   - Add all properties including workflow fields (see `/docs/NOTION-TWITTER-INSIGHTS-SETUP.md`)
   - Copy database ID from URL

2. **Add to Environment**
   ```bash
   ssh hetzner
   nano ~/.openclaw/.env

   # Add:
   TWITTER_INSIGHTS_DB_ID="your_32_char_database_id"

   sudo systemctl restart openclaw
   ```

3. **Verify Setup**
   - Open Twitter Insights database
   - Check all 11 properties exist
   - No errors in console

---

### Phase 3: Deploy Scripts (15 min)

**What you need to do:**

1. **Copy scripts to server**
   ```bash
   # From your Mac:
   scp ./scripts/fetch-twitter-bookmarks.sh hetzner:/root/
   scp ./scripts/analyze-claude-setup.js hetzner:/root/
   scp ./scripts/aggregate-morning-digest.js hetzner:/root/

   # Make executable
   ssh hetzner "chmod +x /root/fetch-twitter-bookmarks.sh"
   ```

2. **Test fetch script**
   ```bash
   ssh hetzner "/root/fetch-twitter-bookmarks.sh"
   # Expected output:
   # [2026-03-22 10:00:00] Starting Twitter bookmarks fetch...
   # [2026-03-22 10:00:02] Found 15 new bookmarks
   # ✅ Lyra Twitter: Fetched 15 new bookmarks
   ```

3. **Test analysis script**
   ```bash
   ssh hetzner "cd /root && node analyze-claude-setup.js"
   # Expected output:
   # === Claude Setup Analysis ===
   # { tweet_count: 15, theme_distribution: {...}, suggestions: [...] }
   ```

4. **Test digest script**
   ```bash
   ssh hetzner "cd /root && node aggregate-morning-digest.js"
   # Expected output:
   # 🌅 MORNING DIGEST
   # 📱 TWITTER INSIGHTS
   # ...
   ```

---

### Phase 4: Add to OpenClaw Skills (10 min)

**What you need to do:**

1. **Copy skill files**
   ```bash
   ssh hetzner "mkdir -p /root/.openclaw/workspace/skills/twitter-bookmarks"
   ssh hetzner "mkdir -p /root/.openclaw/workspace/skills/twitter-synthesis"

   scp ./skills/twitter-bookmarks/oauth-setup.md \
     hetzner:/root/.openclaw/workspace/skills/twitter-bookmarks/

   scp ./skills/twitter-synthesis/SKILL.md \
     hetzner:/root/.openclaw/workspace/skills/twitter-synthesis/
   ```

2. **Verify skills are loaded**
   ```bash
   ssh hetzner "ls /root/.openclaw/workspace/skills/twitter-*/"
   # Should show SKILL.md files
   ```

---

### Phase 5: Add 7am Cron (10 min)

**What you need to do:**

1. **Update MEMORY.md with new cron**
   ```bash
   # Edit /root/.openclaw/workspace/MEMORY.md
   # Add to 7am cron section:

   - **7:00am** - Twitter Bookmarks Fetch
     - Script: `/root/fetch-twitter-bookmarks.sh`
     - Output: Saves to `/tmp/lyra-bookmarks-$(date +%Y-%m-%d).json`
     - Logs: `/var/log/lyra-twitter-bookmarks.log`
     - Telegram alert: Bookmark count + duplicates filtered

   - **7:05am** - Twitter Synthesis
     - Skill: `twitter-synthesis`
     - Input: Bookmarks from fetch script
     - Output: Content bytes → Twitter Insights DB
     - Digest section: Top 3 bytes (marked For Recruiter)

   - **7:10am** - Claude Setup Analysis
     - Script: `/root/analyze-claude-setup.js`
     - Output: 1-2 workflow improvement suggestions
     - Digest section: "Claude Setup Opportunity"

   - **7:15am** - Morning Digest Aggregation
     - Script: `/root/aggregate-morning-digest.js`
     - Output: Complete digest to Telegram
     - Format: Markdown with sections
   ```

2. **Add cron tasks to OpenClaw**
   ```bash
   ssh hetzner

   # Fetch cron (7:00am)
   openclaw cron add \
     --at "0 7 * * *" \
     --name "twitter-bookmarks-fetch" \
     --command "/root/fetch-twitter-bookmarks.sh"

   # Analysis cron (7:10am)
   openclaw cron add \
     --at "10 7 * * *" \
     --name "twitter-insights-analysis" \
     --command "node /root/analyze-claude-setup.js"

   # Digest cron (7:15am)
   openclaw cron add \
     --at "15 7 * * *" \
     --name "morning-digest-twitter" \
     --command "node /root/aggregate-morning-digest.js"
   ```

3. **Verify crons are set**
   ```bash
   ssh hetzner "openclaw cron list"
   # Should see: twitter-bookmarks-fetch, twitter-insights-analysis, morning-digest-twitter
   ```

---

### Phase 6: Test End-to-End (15 min)

**What you need to do:**

1. **Manual test flow**
   ```bash
   ssh hetzner

   # Step 1: Fetch bookmarks
   /root/fetch-twitter-bookmarks.sh
   # Check output file
   cat /tmp/lyra-bookmarks-$(date +%Y-%m-%d).json | head -20

   # Step 2: Analyze setup
   node /root/analyze-claude-setup.js
   # Check theme distribution and suggestions

   # Step 3: Generate digest
   node /root/aggregate-morning-digest.js
   # Check Telegram for receipt
   ```

2. **Verify Notion entries**
   - Open Twitter Insights database
   - Should see X new entries from today
   - Check properties are filled correctly

3. **Check logs**
   ```bash
   tail -20 /var/log/lyra-twitter-bookmarks.log
   # Should show successful fetch
   ```

---

### Phase 7: Monitor & Iterate (Ongoing)

**What to watch:**

1. **After first 7am cron run tomorrow:**
   - Check Telegram receipt of morning digest
   - Open Twitter Insights DB → verify content bytes saved
   - Check status of entries (should be "Draft" or "Ready")

2. **First week (March 22-28):**
   - Monitor bookmark fetch count (expect 10-20/day)
   - Check content byte quality (3 styles balanced?)
   - Watch Claude setup suggestions (should be 1-2/day)
   - Note any API errors in logs

3. **After first week:**
   - You should have 50-100 entries in Twitter Insights
   - Start using "For Recruiter" entries for outreach
   - Update Recruiter Notes as you use bytes
   - Mark used bytes as "Published"
   - Iterate on synthesis if needed

---

## File Organization

All files are in `/Users/akashkedia/AI/lyra-ai/`:

```
lyra-ai/
├── TWITTER-IMPLEMENTATION-GUIDE.md (this file)
├── scripts/
│   ├── fetch-twitter-bookmarks.sh ← Deploy to /root/
│   ├── analyze-claude-setup.js ← Deploy to /root/
│   └── aggregate-morning-digest.js ← Deploy to /root/
├── skills/
│   ├── twitter-bookmarks/
│   │   └── oauth-setup.md ← Reference for setup
│   └── twitter-synthesis/
│       └── SKILL.md ← Deploy to /root/.openclaw/workspace/skills/
├── docs/
│   └── NOTION-TWITTER-INSIGHTS-SETUP.md ← Reference for DB setup
└── [other Lyra files...]
```

---

## Quick Reference: Environment Variables Needed

Add to `/root/.openclaw/.env`:

```bash
# X API OAuth2
TWITTER_CLIENT_ID="..."
TWITTER_CLIENT_SECRET="..."
TWITTER_REFRESH_TOKEN="..."
TWITTER_USER_ID="123456789"

# Notion API
TWITTER_INSIGHTS_DB_ID="..."

# Telegram (already set, verify)
TELEGRAM_BOT_TOKEN="..."
TELEGRAM_CHAT_ID="..."

# Claude API (already set, verify)
CLAUDE_API_KEY="..."
```

---

## Troubleshooting

### "Bookmarks fetch returns 0 results"
- Check `TWITTER_USER_ID` is correct (should be numeric)
- Verify bookmarks exist after 2026-03-19
- Check OAuth2 token is valid (see oauth-setup.md)

### "Cannot save to Twitter Insights DB"
- Verify `TWITTER_INSIGHTS_DB_ID` is correct (32 chars)
- Check `NOTION_API_KEY` has write access
- Ensure database exists in Notion

### "Synthesis skill not found"
- Verify skill files are in `/root/.openclaw/workspace/skills/`
- Restart OpenClaw: `sudo systemctl restart openclaw`
- Check: `openclaw agent list`

### "Digest not sent to Telegram"
- Check `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set
- Verify Telegram bot is running: `curl https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getMe`

### "Scripts taking too long"
- Fetch should be <30s
- Synthesis should be <2min
- Digest should be <10s
- If slower, check API rate limits or network connectivity

---

## Success Criteria

After completing all phases, you should have:

✅ Daily at 7am: Bookmarks fetched from X
✅ 3-5 content bytes generated per day
✅ Entries saved to Twitter Insights DB with proper properties
✅ Morning digest includes Twitter section
✅ Claude setup suggestions included in digest
✅ Telegram notification sent
✅ Logs show no errors

---

## Next Steps

1. **Complete Phase 1-3 today** (X API + Notion DB + Script deployment)
2. **Run Phase 6 manually tonight** (test the full flow)
3. **Check 7am cron tomorrow** (verify automatic execution)
4. **Iterate based on results** (adjust synthesis, themes, etc.)

Let me know when you're done with each phase!
