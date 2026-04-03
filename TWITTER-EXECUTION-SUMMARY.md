# Twitter Bookmarks Integration - Execution Summary

**What's Done:** All code, scripts, and documentation created
**What's Left:** You execute the steps (2 hours total)
**Date Filter:** Only bookmarks after 2026-03-19

---

## Files Created (All in `/Users/akashkedia/AI/lyra-ai/`)

### Executables (Copy to Hetzner)
- `scripts/fetch-twitter-bookmarks.sh` — Fetches bookmarks daily
- `scripts/analyze-claude-setup.js` — Analyzes patterns
- `scripts/aggregate-morning-digest.js` — Creates morning digest

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

   # Add these 4 lines:
   TWITTER_CLIENT_ID="paste_here"
   TWITTER_CLIENT_SECRET="paste_here"
   TWITTER_REFRESH_TOKEN="paste_here"
   TWITTER_USER_ID="your_numeric_id"

   # Save and restart
   ssh hetzner "sudo systemctl restart openclaw"
   ```

4. **Verify**
   ```bash
   ssh hetzner "/root/fetch-twitter-bookmarks.sh"
   # Should say: ✅ Lyra Twitter: Fetched X new bookmarks
   ```

---

### ⏱️ Step 2: Create Notion Database (10 min)

1. **In Notion (GUI)**
   - Open Lyra Hub workspace
   - New Database → Name it "Twitter Insights"
   - Add these 11 properties:

   ```
   1. Content Byte (Title)
   2. Source Tweet (URL)
   3. Type (Select: Problem-Solving/Thought Leadership/Journey-Based/Mixed)
   4. Themes (Multi-select: ai, fintech, product, recruiting, etc.)
   5. Original Tweet Summary (Text)
   6. My Take (Text)
   7. Full Byte (Text)
   8. For Recruiter (Checkbox)
   9. Recruiter Notes (Text)
   10. Status (Select: Draft/Ready/Published/Archived)
   11. Generated At (Date)
   ```

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
   scp scripts/fetch-twitter-bookmarks.sh hetzner:/root/
   scp scripts/analyze-claude-setup.js hetzner:/root/
   scp scripts/aggregate-morning-digest.js hetzner:/root/

   ssh hetzner "chmod +x /root/fetch-twitter-bookmarks.sh"
   ```

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
   ssh hetzner "ls /root/*.sh /root/*.js"
   # Should show 3 files
   ```

---

### ⏱️ Step 4: Test Everything (10 min)

1. **Test fetch**
   ```bash
   ssh hetzner "/root/fetch-twitter-bookmarks.sh"
   # ✅ Should show bookmark count
   ```

2. **Test analysis**
   ```bash
   ssh hetzner "cd /root && node analyze-claude-setup.js"
   # ✅ Should show theme distribution and suggestions
   ```

3. **Test digest**
   ```bash
   ssh hetzner "cd /root && node aggregate-morning-digest.js"
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
   openclaw cron add --at "0 7 * * *" --name "twitter-fetch" --command "/root/fetch-twitter-bookmarks.sh"
   openclaw cron add --at "5 7 * * *" --name "twitter-synthesis" --command "node /root/analyze-claude-setup.js"
   openclaw cron add --at "15 7 * * *" --name "morning-digest" --command "node /root/aggregate-morning-digest.js"
   ```

   OR add to system crontab:
   ```bash
   crontab -e

   # Add these lines:
   0 7 * * * /root/fetch-twitter-bookmarks.sh >> /var/log/twitter-fetch.log 2>&1
   5 7 * * * cd /root && node analyze-claude-setup.js >> /var/log/twitter-analysis.log 2>&1
   15 7 * * * cd /root && node aggregate-morning-digest.js >> /var/log/twitter-digest.log 2>&1
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
- [ ] Notion Twitter Insights DB created with 11 properties
- [ ] Database ID added to .env
- [ ] Scripts copied to /root/
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
