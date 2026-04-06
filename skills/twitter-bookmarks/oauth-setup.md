# X API v2 OAuth2 Setup for Lyra

This guide walks through setting up OAuth2 authentication for Lyra to access your Twitter bookmarks via the X API.

**New to the flow?** Read the linear checklist first: [`docs/TWITTER-X-API-SETUP-STEPS.md`](../../docs/TWITTER-X-API-SETUP-STEPS.md).

## Overview

**What we're building:**
- A "Lyra Twitter Bookmarks" app registered on X Developer Portal
- OAuth2 credentials (Client ID, Client Secret)
- Refresh token for long-lived access to bookmarks
- Environment variables for Lyra to use

**Why OAuth2:**
- Official X API method (most reliable)
- Supports bookmark access
- Secure token refresh mechanism
- No password stored

---

## Step 1: Register X Developer Account

1. Go to https://developer.twitter.com/
2. Sign in with your X/Twitter account (or create one)
3. Click "Create new app"
4. Choose **Free** tier
5. Fill in app details:
   - **App name:** `Lyra Twitter Bookmarks`
   - **Description:** `Lyra AI assistant accessing user bookmarks for content synthesis`
   - **Use case:** `Building a tool to analyze and synthesize bookmarked content`
   - **Will your app use the Twitter API to display Tweets or aggregate data about Tweets?** Yes
   - **Will your app read, create, edit, or delete Tweets?** No
   - **Will your app require the ability to Tweet, Retweet, or Like content?** No
   - **Are you planning to analyze Tweets, Twitter users, or their content?** Yes
   - **Will your app be used in a way that shares information or insights derived from Twitter data outside of Twitter?** Yes

6. Accept the terms and click **Create**

---

## Step 2: Configure App Permissions

1. In your app settings, find **Authentication settings**
2. Set **App Permissions** to **Read and write** (or Read only if you prefer less access)
3. Set **Type of App** to **Confidential client**
4. Under **Callback URL**, enter:
   ```
   http://localhost:3000/auth/callback
   ```
   (This is used for the one-time OAuth2 flow)

5. Save settings

---

## Step 3: Generate OAuth2 Credentials

1. Go to **Keys and tokens** tab
2. Copy and save:
   - **API Key** (Client ID)
   - **API Secret Key** (Client Secret)

3. Store these safely (we'll use them in the next step)

---

## Step 4: Get Refresh Token (One-Time)

Lyra needs a refresh token to access your bookmarks indefinitely.

**Scopes used:** `tweet.read` `bookmark.read` `users.read` `offline.access` (the last one is what allows a **refresh token** to be returned).

### Option A: Helper script (recommended — correct PKCE)

From your `lyra-ai` clone on **Mac** (or any machine with `bash`, `openssl`, `curl`, `python3`):

```bash
cd /path/to/lyra-ai
export TWITTER_CLIENT_ID='paste_your_client_id'
export TWITTER_CLIENT_SECRET='paste_your_client_secret'
chmod +x scripts/get-twitter-oauth-refresh-token.sh
./scripts/get-twitter-oauth-refresh-token.sh
```

1. The script opens a browser tab to X. Log in if asked, then click **Authorize**.
2. The browser will try to open `http://localhost:3000/auth/callback?...` — **“connection refused” is normal** (nothing is listening on port 3000).
3. **Copy the entire URL** from the address bar (or copy only the `code=...` value after `code=`).
4. Paste into the terminal when prompted. The script prints JSON and then a line you can copy as `TWITTER_REFRESH_TOKEN=...`.

If you see an error about `invalid_grant` or PKCE, the `code` expires in a few minutes — run the script again and paste the new URL immediately.

### Option B: Using Postman (Visual)

1. Install [Postman](https://www.postman.com/)
2. Create new request:
   - **Method:** POST
   - **URL:** `https://oauth2.twitter.com/2/oauth2/token`
3. **Body** → form-data:
   - `grant_type`: `authorization_code`
   - `client_id`: Your Client ID
   - `client_secret`: Your Client Secret
   - `redirect_uri`: `http://localhost:3000/auth/callback`
   - `code`: [Authorization code you'll get from browser]
4. First, authorize manually by visiting (include `offline.access` for refresh tokens):
   ```
   https://twitter.com/i/oauth2/authorize?client_id=YOUR_CLIENT_ID&redirect_uri=http://localhost:3000/auth/callback&response_type=code&scope=tweet.read%20bookmark.read%20users.read%20offline.access
   ```
   (PKCE is still required for production; use Option A unless you know how to add `code_challenge` manually.)
5. Copy the auth code from redirect
6. Send Postman request → get refresh token

---

## Step 5: Store Credentials in Environment

1. Open `/root/.openclaw/.env` on your Hetzner server

2. Add these lines:
   ```bash
   TWITTER_CLIENT_ID="your_client_id_here"
   TWITTER_CLIENT_SECRET="your_client_secret_here"
   TWITTER_REFRESH_TOKEN="your_refresh_token_here"
   TWITTER_USER_ID="your_numeric_user_id_here"
   ```

3. To get your `TWITTER_USER_ID`:
   - Visit https://x.com/your-username
   - In the browser DevTools (F12), run:
     ```javascript
     fetch('https://api.twitter.com/2/users/by/username/your-username', {
       headers: { 'Authorization': 'Bearer ACCESS_TOKEN' }
     }).then(r => r.json()).then(d => console.log(d.data.id))
     ```
   - Or use a free API like https://tweeterid.com/

4. Save the file and restart OpenClaw:
   ```bash
   ssh hetzner "sudo systemctl restart openclaw"
   ```

---

## Step 6: Test the Setup

Run the fetch script manually:

```bash
ssh hetzner "/root/fetch-twitter-bookmarks.sh"
```

Expected output:
```
[2026-03-22 10:00:00] Starting Twitter bookmarks fetch...
[2026-03-22 10:00:00] Checking OAuth2 token...
[2026-03-22 10:00:01] Fetching bookmarks created after 2026-03-19T00:00:00Z...
[2026-03-22 10:00:02] Found 15 new bookmarks
[2026-03-22 10:00:02] Saved 15 bookmarks to /tmp/lyra-bookmarks-2026-03-22.json
[2026-03-22 10:00:02] Twitter bookmarks fetch completed successfully
✅ Lyra Twitter: Fetched 15 new bookmarks
```

---

## Troubleshooting

### "Authorization code expired"
- Codes are valid for 5 minutes
- Re-run the authorization flow and use the code immediately

### "Invalid refresh token"
- Make sure you copied the full token (including any quotes)
- Refresh tokens expire after 6 months of non-use
- Get a new one using the authorization flow again

### "Invalid client_id / client_secret"
- Copy-paste directly from X Developer Portal (avoid typos)
- Make sure they're quoted in `.env`

### "User not found"
- Verify `TWITTER_USER_ID` is correct (must be numeric)
- Check that the account owns the bookmarks

### "Rate limited"
- X API limits 180 bookmark requests per 15 minutes
- Lyra fetches once per day, so this shouldn't be an issue

---

## Token Refresh Mechanism

Your refresh token is long-lived (6 months of inactivity), but the access token expires every 2 hours.

`fetch-twitter-bookmarks.sh` handles this automatically:
1. Caches access token in `/tmp/twitter-access-token`
2. Reuses token for 1 hour
3. Refreshes automatically when expired
4. Never expires the refresh token

You don't need to do anything - it's automatic.

---

## Scopes Requested

The `tweet.read`, `bookmark.read`, `users.read`, and `offline.access` scopes allow:
- ✅ Read your bookmarked tweets
- ✅ Read tweet content and metadata
- ✅ Read user information (authors)
- ❌ Create/edit/delete tweets (not requested)
- ❌ Like, retweet, or quote (not requested)

This is minimal and read-only.

---

## Next Steps

1. Complete this setup
2. Save credentials to `/root/.openclaw/.env`
3. Test with `./fetch-twitter-bookmarks.sh`
4. Create Twitter Insights Notion database (see `notion-setup.md`)
5. Deploy synthesis skill (see `skills/twitter-synthesis/SKILL.md`)
6. Add 7am cron to OpenClaw (see `MEMORY.md`)

---

## Reference

- X API docs: https://developer.twitter.com/en/docs/twitter-api/tweets/api-reference/get-users-id-bookmarks
- OAuth2 flow: https://developer.twitter.com/en/docs/authentication-and-authorization/oauth-2-0/oauth-2-0-authorization-code-flow
