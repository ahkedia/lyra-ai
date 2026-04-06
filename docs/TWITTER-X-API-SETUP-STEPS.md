# X (Twitter) API — step-by-step for Lyra bookmarks

This is the **linear** checklist. Technical detail and copy-paste scripts live in [`skills/twitter-bookmarks/oauth-setup.md`](../skills/twitter-bookmarks/oauth-setup.md).

---

## What you are doing (one sentence)

You register a small “app” on X, prove who you are once in the browser, and get a **refresh token** that Lyra keeps on the server so `fetch-twitter-bookmarks.sh` can read your **bookmarks** without storing your X password.

---

## Before you start

- X account that has **bookmarks** you want to sync.
- ~30 minutes.
- You will copy **secrets** into `~/.openclaw/.env` on the gateway — treat them like passwords.

---

## Step 1 — X Developer account and app

1. Go to **[developer.twitter.com](https://developer.twitter.com/)** and sign in with the **same** X account you use for bookmarks (or an org account if you use one for apps).
2. **Create a Project** (if prompted) and then **Create App** inside it.
3. Name it something like **Lyra Twitter Bookmarks** (name is shown to you only in the portal).
4. Note the **App** screen — you will use **Keys** next.

---

## Step 2 — Turn on OAuth 2.0 and permissions

1. In the Developer Portal, open your app → **User authentication settings** → **Set up** (or **Edit**).
2. Enable **OAuth 2.0**.
3. **Type of App:** **Web App** or **Native App** per portal options; use a **confidential** client if offered (Lyra uses Client ID + Client Secret).
4. **Callback URL:** use exactly what the oauth doc uses for the one-time login flow, e.g.  
   `http://localhost:3000/auth/callback`  
   (You are not running a real server forever — the script or browser step only needs this URL to match when X redirects back with a `code`.)
5. **App permissions:** you need at least **Read** for tweets and bookmarks. The scopes in our docs are typically:  
   `tweet.read` · `users.read` · `bookmark.read`
6. **Save** the authentication settings.

---

## Step 3 — Copy Client ID and Client Secret

1. Open **Keys and tokens** (or **Credentials**) for the app.
2. Copy:
   - **OAuth 2.0 Client ID** (sometimes labeled API Key in OAuth2 context — use the **OAuth 2.0** client id, not the old v1 API key unless the UI only shows one).
   - **OAuth 2.0 Client Secret**
3. Store them in a password manager or temp notes — you will paste into `.env` in Step 7.

---

## Step 4 — Get a refresh token (one-time browser flow)

X does not give you a long-lived refresh token until you **authorize the app once**.

1. **Easiest:** from your `lyra-ai` clone, run `./scripts/get-twitter-oauth-refresh-token.sh` after setting `TWITTER_CLIENT_ID` and `TWITTER_CLIENT_SECRET` (see **[`skills/twitter-bookmarks/oauth-setup.md`](../skills/twitter-bookmarks/oauth-setup.md)** Option A).
2. That flow does roughly:
   - Build an **authorize URL** with your Client ID, redirect URI, scopes, and PKCE.
   - Open it in the browser → log in → **Authorize**.
   - X redirects to `http://localhost:3000/auth/callback?code=...` (the page may “error” if nothing listens on 3000 — **that is OK**).
   - Copy the **`code`** from the address bar.
   - Exchange `code` for tokens using `POST` to `https://oauth2.twitter.com/2/oauth2/token` (see oauth-setup for exact body).
3. From the JSON response, save **`refresh_token`** (long string). That is what the server uses from then on.

If anything says **invalid_grant** or **code expired**, run the browser step again and use the new `code` within a few minutes.

---

## Step 5 — Get your numeric X user id

The bookmarks API URL is  
`GET /2/users/{id}/bookmarks`  
so you need **`TWITTER_USER_ID`** (digits only), not `@handle`.

Ways that work:

- Use **[tweeterid.com](https://tweeterid.com/)** with your @handle, or  
- Use any small script/API call that returns `data.id` for your user (oauth-setup has examples once you have a **Bearer** access token from the same OAuth flow).

Put that number aside for `.env`.

---

## Step 6 — Put credentials on the gateway

On your Hetzner (or wherever OpenClaw runs), edit **`~/.openclaw/.env`** and add:

```bash
TWITTER_CLIENT_ID="your_oauth2_client_id"
TWITTER_CLIENT_SECRET="your_oauth2_client_secret"
TWITTER_REFRESH_TOKEN="your_refresh_token_from_step_4"
TWITTER_USER_ID="1234567890123456789"
```

Also set (if not already):

```bash
NOTION_API_KEY="secret_..."
TWITTER_INSIGHTS_DB_ID="33a7800891008166aa55ddec1d2e5dc2"
```

Then restart OpenClaw (e.g. `sudo systemctl restart openclaw`).

---

## Step 7 — Test the fetch script

```bash
/root/lyra-ai/scripts/run-with-openclaw-env.sh /root/lyra-ai/scripts/fetch-twitter-bookmarks.sh
```

- Success: Telegram ping (if configured) and a JSON file under `/tmp/lyra-bookmarks-YYYY-MM-DD.json`.
- **401 / invalid_client:** wrong Client ID/Secret or wrong token endpoint — re-check Step 3 and oauth-setup.
- **403:** app permissions or scopes — re-check Step 2 (bookmark scope).
- **Empty data:** date filter in the script (default: bookmarks after `2026-03-19`) — adjust `DATE_FILTER` in `fetch-twitter-bookmarks.sh` if needed.

---

## Step 8 — After fetch works

Run **twitter-synthesis** via Lyra (scheduled message or Telegram) so rows appear in **Twitter Insights** — fetch alone does not fill Notion. See [`TWITTER-EXECUTION-SUMMARY.md`](../TWITTER-EXECUTION-SUMMARY.md).

---

## Quick mental model

| Piece | Role |
|-------|------|
| Developer app | Lets X issue OAuth tokens to *your* app |
| Refresh token | Long-lived secret stored on server |
| Access token | Short-lived; script refreshes it with refresh token |
| User id | Tells the API whose bookmarks to list |

You are **not** publishing the app to the X app store — this is a private integration for your account (subject to X Developer Policy).
