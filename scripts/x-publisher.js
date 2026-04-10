#!/usr/bin/env node
/**
 * x-publisher.js — Automated X (Twitter) publisher for the content machine.
 *
 * Runs as a Lyra heartbeat (every 3 hours via OpenClaw cron).
 * Polls Content Drafts for approved posts, sends Telegram confirmation,
 * then publishes single posts or threaded series to X.
 *
 * Prerequisites:
 *   - X_BEARER_TOKEN, X_API_KEY, X_API_KEY_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET
 *   - NOTION_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 *   All in /root/.openclaw/.env
 *
 * Approval model:
 *   text_approval_status = approved
 *   AND (visual_approval_status = approved OR visual_approval_status = not_required)
 */

"use strict";

const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ── Constants ──────────────────────────────────────────────────────────────────

const CONTENT_DRAFTS_DB = "8135676dd15c4ef4925336cf484567ac";
const CONTENT_JOB_LOG_DB = "33d780089100815" + "0b18fd9967447d1fb"; // split to avoid lint line-len
const NOTION_VERSION = "2022-06-28";
const NOTION_DELAY_MS = 350;
const TELEGRAM_CONFIRM_TIMEOUT_MS = 10 * 60 * 1000; // 10 min to respond YES/NO
const BETWEEN_TWEETS_MS = 500;
const X_RATE_LIMIT_BACKOFFS = [1000, 2000, 4000]; // ms, then partial_failure

// ── Environment ────────────────────────────────────────────────────────────────

function loadEnv() {
  const envFile = "/root/.openclaw/.env";
  if (!fs.existsSync(envFile)) return;
  const lines = fs.readFileSync(envFile, "utf8").split("\n");
  for (const line of lines) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

loadEnv();

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const X_BEARER_TOKEN = process.env.X_BEARER_TOKEN;
const X_API_KEY = process.env.X_API_KEY;
const X_API_KEY_SECRET = process.env.X_API_KEY_SECRET;
const X_ACCESS_TOKEN = process.env.X_ACCESS_TOKEN;
const X_ACCESS_TOKEN_SECRET = process.env.X_ACCESS_TOKEN_SECRET;

// ── HTTP helpers ───────────────────────────────────────────────────────────────

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = data; }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ status: res.statusCode, body: parsed, headers: res.headers });
        } else {
          reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { status: res.statusCode, body: parsed }));
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Notion helpers ─────────────────────────────────────────────────────────────

function notionRequest(method, path, body) {
  return request(
    {
      hostname: "api.notion.com",
      path,
      method,
      headers: {
        Authorization: `Bearer ${NOTION_API_KEY}`,
        "Content-Type": "application/json",
        "Notion-Version": NOTION_VERSION,
      },
    },
    body
  );
}

async function notionQuery(dbId, filter, sorts) {
  await sleep(NOTION_DELAY_MS);
  const payload = {};
  if (filter) payload.filter = filter;
  if (sorts) payload.sorts = sorts;
  const res = await notionRequest("POST", `/v1/databases/${dbId}/query`, payload);
  return res.body.results || [];
}

async function notionPatch(pageId, properties) {
  await sleep(NOTION_DELAY_MS);
  await notionRequest("PATCH", `/v1/pages/${pageId}`, { properties });
}

function notionRichText(text) {
  return [{ type: "text", text: { content: String(text).slice(0, 2000) } }];
}

function getPlainText(prop) {
  if (!prop) return "";
  if (prop.type === "title") return prop.title.map((t) => t.plain_text).join("");
  if (prop.type === "rich_text") return prop.rich_text.map((t) => t.plain_text).join("");
  if (prop.type === "select") return prop.select?.name || "";
  if (prop.type === "number") return prop.number ?? "";
  if (prop.type === "url") return prop.url || "";
  return "";
}

// ── Telegram helpers ───────────────────────────────────────────────────────────

async function sendTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return null;
  try {
    const res = await request(
      {
        hostname: "api.telegram.org",
        path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      { chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "Markdown" }
    );
    return res.body.result?.message_id;
  } catch (e) {
    console.error("[telegram] send failed:", e.message);
    return null;
  }
}

async function getTelegramUpdates(offset) {
  if (!TELEGRAM_BOT_TOKEN) return [];
  try {
    const res = await request({
      hostname: "api.telegram.org",
      path: `/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=${offset}&timeout=5`,
      method: "GET",
    });
    return res.body.result || [];
  } catch {
    return [];
  }
}

/**
 * Wait up to TELEGRAM_CONFIRM_TIMEOUT_MS for a YES or NO reply from the chat.
 * Returns "yes", "no", or "timeout".
 */
async function waitForTelegramConfirmation(promptMsgId) {
  const deadline = Date.now() + TELEGRAM_CONFIRM_TIMEOUT_MS;
  let offset = 0;

  // Seed offset so we only read updates AFTER our prompt was sent
  try {
    const seed = await request({
      hostname: "api.telegram.org",
      path: `/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=-1`,
      method: "GET",
    });
    const latest = seed.body.result;
    if (latest && latest.length > 0) {
      offset = latest[latest.length - 1].update_id + 1;
    }
  } catch { /* ignore */ }

  while (Date.now() < deadline) {
    await sleep(5000);
    const updates = await getTelegramUpdates(offset);
    for (const upd of updates) {
      offset = upd.update_id + 1;
      const text = upd.message?.text?.trim().toLowerCase();
      if (!text) continue;
      if (upd.message.chat.id.toString() !== TELEGRAM_CHAT_ID.toString()) continue;
      if (text === "yes") return "yes";
      if (text === "no" || text === "hold") return "no";
    }
  }
  return "timeout";
}

// ── X (Twitter) OAuth 1.0a ─────────────────────────────────────────────────────

function oauthSign(method, url, params) {
  const nonce = crypto.randomBytes(16).toString("hex");
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const oauthParams = {
    oauth_consumer_key: X_API_KEY,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_token: X_ACCESS_TOKEN,
    oauth_version: "1.0",
  };

  const allParams = Object.assign({}, params, oauthParams);
  const sortedKeys = Object.keys(allParams).sort();
  const paramStr = sortedKeys
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(allParams[k])}`)
    .join("&");

  const base = [method.toUpperCase(), encodeURIComponent(url), encodeURIComponent(paramStr)].join("&");
  const signingKey = `${encodeURIComponent(X_API_KEY_SECRET)}&${encodeURIComponent(X_ACCESS_TOKEN_SECRET)}`;
  const signature = crypto.createHmac("sha1", signingKey).update(base).digest("base64");

  oauthParams.oauth_signature = signature;
  const authHeader = "OAuth " + Object.keys(oauthParams)
    .sort()
    .map((k) => `${encodeURIComponent(k)}="${encodeURIComponent(oauthParams[k])}"`)
    .join(", ");

  return authHeader;
}

async function postTweet(text, replyToId) {
  const url = "https://api.twitter.com/2/tweets";
  const hostname = "api.twitter.com";
  const urlPath = "/2/tweets";
  const body = { text };
  if (replyToId) body.reply = { in_reply_to_tweet_id: replyToId };

  const authHeader = oauthSign("POST", url, {});

  return request(
    {
      hostname,
      path: urlPath,
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
    },
    body
  );
}

/**
 * Post a single tweet with 429 backoff.
 * Returns tweet ID or throws with { partial: true } if all retries exhausted.
 */
async function postTweetWithBackoff(text, replyToId) {
  for (let i = 0; i <= X_RATE_LIMIT_BACKOFFS.length; i++) {
    try {
      const res = await postTweet(text, replyToId);
      return res.body.data.id;
    } catch (err) {
      if (err.status === 429 && i < X_RATE_LIMIT_BACKOFFS.length) {
        console.log(`[x] 429 rate limit — backing off ${X_RATE_LIMIT_BACKOFFS[i]}ms`);
        await sleep(X_RATE_LIMIT_BACKOFFS[i]);
        continue;
      }
      const enhanced = new Error(`Tweet failed: ${err.message}`);
      enhanced.partial = true;
      throw enhanced;
    }
  }
}

// ── Draft parsing ──────────────────────────────────────────────────────────────

/**
 * Parse thread posts from draft text.
 * Supports markers like:  [TWEET 1], [TWEET 2], or plain paragraphs for single posts.
 * Returns array of strings.
 */
function parseDraftIntoTweets(draftText) {
  // Try [TWEET N] markers
  const markerRe = /\[TWEET\s+\d+\][:\s]*/gi;
  if (markerRe.test(draftText)) {
    const parts = draftText.split(/\[TWEET\s+\d+\][:\s]*/i).filter((s) => s.trim());
    return parts.map((s) => s.trim());
  }

  // Try numbered lines: "1. " "2. "
  const numbered = draftText.split(/\n\d+\.\s+/).filter((s) => s.trim());
  if (numbered.length > 1) return numbered.map((s) => s.trim());

  // Single post
  return [draftText.trim()];
}

// ── ContentJobLog helpers ──────────────────────────────────────────────────────

async function writePublishLog(draftPageId, status, note) {
  try {
    await notionRequest("POST", "/v1/pages", {
      parent: { database_id: CONTENT_JOB_LOG_DB },
      properties: {
        run_id: { title: notionRichText(`publish-${draftPageId.slice(0, 8)}-${Date.now()}`) },
        status: { select: { name: status } },
        started_at: { date: { start: new Date().toISOString() } },
        phase: { select: { name: "Phase1" } },
        error_message: note ? { rich_text: notionRichText(note) } : undefined,
      },
    });
  } catch (e) {
    console.error("[job-log] write failed:", e.message);
  }
}

// ── Main publish flow ──────────────────────────────────────────────────────────

async function publishDraft(draft) {
  const pageId = draft.id;
  const title = getPlainText(draft.properties["Content Title"] || draft.properties.Name);
  const draftText = getPlainText(draft.properties["Draft Text"] || draft.properties.draft_text);
  const format = getPlainText(draft.properties.Format || draft.properties.format);

  console.log(`\n[publish] Starting: "${title}" (${pageId})`);

  // ── Step 1: Telegram confirmation ──────────────────────────────────────────

  const previewSnippet = draftText.slice(0, 280);
  await sendTelegram(
    `📣 *Content Machine — Publish Ready*\n\n*Title:* ${title}\n*Format:* ${format || "unknown"}\n\n_Preview:_\n${previewSnippet}${draftText.length > 280 ? "..." : ""}\n\n` +
    `Reply *YES* to publish now, or *NO* to hold (10 min window).`
  );

  console.log("[publish] Waiting for Telegram confirmation...");
  const answer = await waitForTelegramConfirmation();

  if (answer === "no") {
    console.log("[publish] Held by user — marking held");
    await notionPatch(pageId, {
      text_approval_status: { select: { name: "pending" } }, // reset to pending so it re-appears next cycle
    });
    await sendTelegram(`⏸ "${title}" held. Status reset to pending for next cycle.`);
    return { result: "held", pageId };
  }

  if (answer === "timeout") {
    console.log("[publish] Confirmation timed out — skipping this cycle");
    await sendTelegram(`⏰ Publish confirmation timed out for "${title}". Will retry next poll.`);
    return { result: "timeout", pageId };
  }

  // ── Step 2: Parse tweets ───────────────────────────────────────────────────

  const tweets = parseDraftIntoTweets(draftText);
  console.log(`[publish] ${tweets.length} tweet(s) to post`);

  const publishedIds = [];
  let rootTweetId = null;

  // ── Step 3: Post tweets with 500ms delay ───────────────────────────────────

  for (let i = 0; i < tweets.length; i++) {
    const text = tweets[i];
    const replyTo = i === 0 ? null : publishedIds[i - 1];

    console.log(`[publish] Posting tweet ${i + 1}/${tweets.length}: ${text.slice(0, 60)}...`);

    try {
      const tweetId = await postTweetWithBackoff(text, replyTo);
      publishedIds.push(tweetId);
      if (i === 0) rootTweetId = tweetId;

      if (i < tweets.length - 1) {
        await sleep(BETWEEN_TWEETS_MS);
      }
    } catch (err) {
      // Mid-thread failure
      if (publishedIds.length >= 3) {
        // Partial publish — 3+ tweets already live
        const liveUrl = `https://twitter.com/i/web/status/${rootTweetId}`;
        console.error(`[publish] partial_failure after ${publishedIds.length} tweets. Live: ${liveUrl}`);

        await notionPatch(pageId, {
          text_approval_status: { select: { name: "partial_failure" } },
          canonical_url: { url: liveUrl },
        });

        await writePublishLog(pageId, "partial_failure", `Failed on tweet ${i + 1}/${tweets.length}. ${publishedIds.length} tweets live.`);
        await sendTelegram(
          `⚠️ *Partial publish* for "${title}"\n\n${publishedIds.length} of ${tweets.length} tweets posted.\n` +
          `Live thread: ${liveUrl}\n\n_Remaining tweets not posted — manual action needed._`
        );

        return { result: "partial_failure", pageId, liveUrl };
      }

      // Too few tweets live to call partial — mark failed and alert
      console.error(`[publish] failed on tweet ${i + 1} with ${publishedIds.length} live:`, err.message);
      await notionPatch(pageId, {
        text_approval_status: { select: { name: "publish_failed" } },
      });
      await writePublishLog(pageId, "failed", err.message);
      await sendTelegram(`❌ Publish failed for "${title}" at tweet ${i + 1}/${tweets.length}.\n\nError: ${err.message}`);

      return { result: "failed", pageId };
    }
  }

  // ── Step 4: Update Notion with canonical URL ───────────────────────────────

  const canonicalUrl = `https://twitter.com/i/web/status/${rootTweetId}`;
  console.log(`[publish] Published! Root tweet: ${canonicalUrl}`);

  await notionPatch(pageId, {
    text_approval_status: { select: { name: "published" } },
    canonical_url: { url: canonicalUrl },
    published_at: { date: { start: new Date().toISOString() } },
  });

  await writePublishLog(pageId, "completed", `${tweets.length} tweet(s) published.`);

  await sendTelegram(
    `✅ *Published!* "${title}"\n\n${tweets.length} tweet(s) live.\n${canonicalUrl}`
  );

  return { result: "published", pageId, canonicalUrl, tweetCount: tweets.length };
}

// ── Approval poller ────────────────────────────────────────────────────────────

async function fetchApprovedDrafts() {
  console.log("[poller] Querying approved drafts...");
  const rows = await notionQuery(
    CONTENT_DRAFTS_DB,
    {
      and: [
        {
          property: "text_approval_status",
          select: { equals: "approved" },
        },
        {
          or: [
            { property: "visual_approval_status", select: { equals: "approved" } },
            { property: "visual_approval_status", select: { equals: "not_required" } },
          ],
        },
        // Exclude already published/in-flight
        {
          property: "text_approval_status",
          select: { does_not_equal: "published" },
        },
      ],
    },
    [{ property: "Created time", direction: "ascending" }]
  );

  console.log(`[poller] Found ${rows.length} approved draft(s)`);
  return rows;
}

// ── Entry point ────────────────────────────────────────────────────────────────

async function main() {
  console.log("[x-publisher] Starting poll —", new Date().toISOString());

  if (!NOTION_API_KEY) {
    console.error("[x-publisher] NOTION_API_KEY not set — aborting");
    process.exit(1);
  }

  if (!X_API_KEY || !X_ACCESS_TOKEN) {
    console.error("[x-publisher] X credentials not set — aborting");
    process.exit(1);
  }

  const drafts = await fetchApprovedDrafts();

  if (drafts.length === 0) {
    console.log("[x-publisher] No approved drafts — done");
    process.exit(0);
  }

  // Process one draft per poll to keep the confirmation window manageable
  const draft = drafts[0];
  const result = await publishDraft(draft);
  console.log("[x-publisher] Result:", result);

  process.exit(0);
}

main().catch((err) => {
  console.error("[x-publisher] Fatal:", err);
  process.exit(1);
});
