#!/usr/bin/env node
/**
 * HOT Commentary Generator
 *
 * Immediate-mode commentary pipeline triggered by OpenClaw when Akash sends
 * "HOT <url_or_topic>". Bypasses Topic Pool / quality gate / blog pipeline.
 *
 * Generates:
 *   - tweet_take: single punchy tweet (240-270 chars) with Akash's voice
 *   - linkedin_post: 180-250 word reactive commentary
 *
 * Usage:
 *   node scripts/hot-commentary-generator.js "<url_or_topic>"
 *
 * Exits 0 on success, 1 on failure (Telegram notified on error).
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import {
  notionQuery,
  notionCreatePage,
  extractTitle,
  notionFetchBlockTreeAsPlainText,
} from "./lib/notion.js";
import { sendTelegram } from "./lib/telegram.js";
import { generateWithSonnet, parseJsonLoose } from "./lib/anthropic.js";
import { sanitizeInput, truncate } from "./lib/sanitize.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTENT_DRAFTS_DB = "8135676dd15c4ef4925336cf484567ac";
const VOICE_CANON_MAX_CHARS = 5000;

const sources = JSON.parse(readFileSync(join(__dirname, "../config/sources.json"), "utf8"));
const PERSONAL_WIKI_DB = sources.sources.personalWiki.dbId;

// ─── Voice canon (canonical, from voice-canon.md) ────────────────────────────

const voiceCanonFile = readFileSync(join(__dirname, "../config/voice-canon.md"), "utf8");

// ─── Negative style contract (matches draft-generator) ───────────────────────

// Negative style contract: single source of truth in voice-system/NEGATIVE_STYLE.md
// (shared with crud/content_context.py and the other generators). Edit the file, not this script.
const NEGATIVE_STYLE_FALLBACK = `
# Negative Style (minimal fallback; voice-system/NEGATIVE_STYLE.md missing)
- ABSOLUTE BAN: em dash (U+2014) and en dash (U+2013) as em-dash stand-ins. Use comma, colon, period, or parentheses.
- All-lowercase body; first person as lowercase i; caps only for acronyms and brand spellings (CheQ).
- No 'Not X, but Y' cadence in ANY variant; no anaphoric three-beat negation; no windup openers; no symmetrical closes.
- Kill on sight: delve, crucial, robust, comprehensive, nuanced, pivotal, landscape, game-changer, paradigm shift, ecosystem, synergy, seamless, unlock.
`;
let NEGATIVE_STYLE;
try {
  NEGATIVE_STYLE = readFileSync(join(__dirname, "../../voice-system/NEGATIVE_STYLE.md"), "utf8");
} catch {
  NEGATIVE_STYLE = NEGATIVE_STYLE_FALLBACK;
}

// ─── Twitter/X URL fetching via Twitter API v2 ───────────────────────────────

function isTwitterUrl(url) {
  return /^https?:\/\/(www\.)?(twitter\.com|x\.com)\/\w+\/status\/\d+/.test(url);
}

function extractTweetId(url) {
  const m = url.match(/\/status\/(\d+)/);
  return m ? m[1] : null;
}

async function refreshTwitterToken() {
  const clientId = process.env.TWITTER_CLIENT_ID;
  const clientSecret = process.env.TWITTER_CLIENT_SECRET;
  const refreshToken = process.env.TWITTER_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Missing TWITTER_CLIENT_ID, TWITTER_CLIENT_SECRET, or TWITTER_REFRESH_TOKEN");
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const res = await fetch("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials}`,
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Twitter token refresh failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.access_token;
}

async function fetchTweetContent(url) {
  const tweetId = extractTweetId(url);
  if (!tweetId) throw new Error(`Could not extract tweet ID from URL: ${url}`);

  const accessToken = await refreshTwitterToken();

  const apiUrl = `https://api.twitter.com/2/tweets/${tweetId}?tweet.fields=text,created_at&expansions=author_id&user.fields=name,username`;
  const res = await fetch(apiUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Twitter API v2 fetch failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  const tweet = data.data;
  const user = data.includes?.users?.[0];

  if (!tweet?.text) throw new Error("Twitter API returned no tweet text");

  const author = user ? `@${user.username} (${user.name})` : "unknown author";
  const title = `Tweet by ${author}`;
  const content = `Tweet by ${author}:\n\n${tweet.text}`;
  return { title, content };
}

// ─── URL content fetching via Tavily extract ──────────────────────────────────

async function fetchUrlContent(url) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("TAVILY_API_KEY not set");

  const res = await fetch("https://api.tavily.com/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey, urls: [url] }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Tavily extract failed (${res.status}): ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  const result = data.results?.[0];
  if (!result) throw new Error("Tavily returned no results for URL");

  const title = result.title || "";
  const content = (result.raw_content || result.content || "").slice(0, 2500);
  return { title, content };
}

// ─── Voice Canon loading (same pattern as draft-generator) ───────────────────

async function fetchVoiceCanon() {
  const res = await notionQuery(PERSONAL_WIKI_DB, {
    property: "Type", select: { equals: "Voice Canon" },
  }, undefined, 1);

  if (res.results.length === 0) {
    return "High conviction, all-lowercase body copy. Intelligent but not academic. Concrete details from experience.";
  }

  const pageId = res.results[0].id;
  try {
    const body = await notionFetchBlockTreeAsPlainText(pageId, VOICE_CANON_MAX_CHARS);
    if (body.trim()) return body;
  } catch (e) {
    console.warn(`Voice Canon block fetch failed: ${e.message}`);
  }

  return `${extractTitle(res.results[0])}. (Voice Canon page had no readable blocks — use all-lowercase, high-conviction, concrete-details style.)`;
}

// ─── Commentary prompt ────────────────────────────────────────────────────────

function buildCommentaryPrompt(input, voiceCanon) {
  const isUrl = input.startsWith("http");
  const contextLabel = isUrl ? "SOURCE CONTENT (fetched from URL)" : "TOPIC";

  return `You are writing for Akash Kedia, a technical founder (Flipkart payments, N26 neobanking, CheQ credit, Trade Republic brokerage). Write reactive commentary in his voice.

VOICE CANON (canonical, from voice-canon.md — follow strictly):
${voiceCanonFile}

VOICE CANON (supplementary, from Notion Personal Wiki — may be empty):
${voiceCanon}

${NEGATIVE_STYLE}

${contextLabel}:
${sanitizeInput(input)}

TASK:
Write two pieces of reactive commentary:

1. TWEET TAKE: A single punchy tweet that gives an opinion or insight on this. 240-270 characters (Twitter limit). No hashtags. No rhetorical questions. No "hot take:" framing. Write the actual take.

2. LINKEDIN POST: A reactive LinkedIn post. Around 350 words. Mobile-first. Hook line first (specific claim, not vague). 3-4 short paragraphs with concrete points. End with one real question. No hashtags. No em dash. No "full write-up" line.

OUTPUT: Respond ONLY with valid JSON, no preamble:
{
  "tweet_take": "...",
  "linkedin_post": "...",
  "title": "short label for this take (max 80 chars)"
}`;
}

// ─── Save to Content Drafts ───────────────────────────────────────────────────

async function saveToDrafts(label, sourceUrl, tweetTake, linkedinPost) {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  const properties = {
    Draft: { title: [{ text: { content: label.slice(0, 100) } }] },
    Domain: { select: { name: "Commentary" } },
    tweet_copy: { rich_text: [{ text: { content: tweetTake.slice(0, 2000) } }] },
    linkedin_copy: { rich_text: [{ text: { content: linkedinPost.slice(0, 2000) } }] },
    text_approval_status: { select: { name: "pending" } },
    visual_approval_status: { select: { name: "not_required" } },
    draft_expires_at: { date: { start: expiresAt.toISOString().split("T")[0] } },
    Channel: { multi_select: [{ name: "X" }, { name: "LinkedIn" }] },
    Notes: { rich_text: [{ text: { content: sourceUrl ? `Source: ${sourceUrl}` : "HOT — manual topic" } }] },
  };

  const page = await notionCreatePage(
    { type: "database_id", database_id: CONTENT_DRAFTS_DB },
    properties
  );

  return page.id;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const raw = process.argv[2]?.trim();
  if (!raw) {
    console.error("Usage: node hot-commentary-generator.js \"<url_or_topic>\"");
    process.exit(1);
  }

  console.log(`=== HOT Commentary Generator ===`);
  console.log(`Input: ${raw.slice(0, 120)}`);

  const isUrl = raw.startsWith("http");
  let sourceUrl = isUrl ? raw : "";
  let inputForPrompt = raw;
  let fetchedTitle = "";

  // Fetch URL content if needed
  if (isUrl) {
    const fetchMethod = isTwitterUrl(raw) ? "Twitter API v2" : "Tavily";
    console.log(`Fetching URL content via ${fetchMethod}...`);
    try {
      const { title, content } = isTwitterUrl(raw)
        ? await fetchTweetContent(raw)
        : await fetchUrlContent(raw);
      fetchedTitle = title;
      inputForPrompt = `URL: ${raw}\nTitle: ${title}\n\nContent:\n${content}`;
      console.log(`  Fetched: "${title}" (${content.length} chars)`);
    } catch (e) {
      console.warn(`  URL fetch failed: ${e.message}. Using URL as context.`);
      inputForPrompt = `URL: ${raw}\n\n(Content could not be fetched — generate commentary based on the URL and any context inferable from it.)`;
    }
  }

  // Load Voice Canon
  console.log("Loading Voice Canon...");
  let voiceCanon;
  try {
    voiceCanon = await fetchVoiceCanon();
    console.log(`  Voice Canon: ${voiceCanon.length} chars`);
  } catch (e) {
    console.warn(`  Voice Canon failed: ${e.message}. Using default.`);
    voiceCanon = "High conviction, all-lowercase, concrete details from experience.";
  }

  // Generate commentary
  console.log("Generating commentary via Sonnet...");
  const prompt = buildCommentaryPrompt(inputForPrompt, voiceCanon);
  const raw_response = await generateWithSonnet(
    "You are a social media writer. Respond ONLY with valid JSON, no preamble or explanation.",
    prompt,
    1800
  );

  const parsed = parseJsonLoose(raw_response);
  if (!parsed?.tweet_take || !parsed?.linkedin_post) {
    throw new Error(`Invalid JSON response from Sonnet: ${raw_response.slice(0, 200)}`);
  }

  const { tweet_take, linkedin_post, title: generatedTitle } = parsed;
  const label = generatedTitle || fetchedTitle || truncate(raw, 80);

  console.log(`  Tweet take: ${tweet_take.length} chars`);
  console.log(`  LinkedIn post: ${linkedin_post.length} chars`);

  // Save to Notion
  console.log("Saving to Content Drafts...");
  const pageId = await saveToDrafts(label, sourceUrl, tweet_take, linkedin_post);
  console.log(`  Saved: ${pageId}`);

  // Send Telegram preview
  const twitterPreview = tweet_take.length > 280
    ? tweet_take.slice(0, 277) + "..."
    : tweet_take;

  const linkedinPreview = linkedin_post.length > 300
    ? linkedin_post.slice(0, 297) + "..."
    : linkedin_post;

  const sourceNote = sourceUrl ? `\n\n📎 ${sourceUrl}` : "";

  await sendTelegram(
    `🔥 *HOT commentary ready*: "${label}"${sourceNote}\n\n` +
    `𝕏 TWEET (${tweet_take.length} chars):\n${twitterPreview}\n\n` +
    `LINKEDIN:\n${linkedinPreview}\n\n` +
    `→ APPROVE to mark ready | SKIP to discard | FEEDBACK <text>`
  );

  console.log("=== Done ===");
}

main().catch(async (err) => {
  console.error("Fatal error:", err);
  try {
    await sendTelegram(`❌ HOT commentary failed: ${err.message}`);
  } catch {}
  process.exit(1);
});
