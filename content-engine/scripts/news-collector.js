#!/usr/bin/env node
/**
 * News Collector — Step 1 of Signal Synthesizer Pipeline
 *
 * Fetches articles from NewsAPI across 3 domains (AI, Fintech, Stablecoins),
 * deduplicates against the existing News Inbox Notion DB,
 * summarizes each article with Claude Haiku,
 * and writes new articles to the News Inbox DB.
 *
 * Cron: 06:30 UTC daily (before signal-synthesizer at 07:00 UTC)
 * Lockfile: /tmp/news-collector.lock
 * Dry-run: pass --dry-run to skip Notion writes and Haiku calls
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import { notionQueryAll, notionCreatePage } from "./lib/notion.js";
import { humanizeWithHaiku } from "./lib/anthropic.js";
import { acquireLock, releaseLock } from "./lib/lockfile.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCKFILE = "/tmp/news-collector.lock";
const DRY_RUN = process.argv.includes("--dry-run");

const config = JSON.parse(readFileSync(join(__dirname, "../config/news-sources.json"), "utf8"));
const NEWSAPI_KEY = process.env.NEWSAPI_KEY;
const NEWS_INBOX_DB = config.notionInboxDb;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchArticles(domainKey) {
  const { query, label } = config.domains[domainKey];
  const { baseUrl, language, sortBy, pageSize, excludeDomains } = config.newsapi;

  // Free plan delays articles ~24h, so omit `from` — sort by publishedAt gives most recent available.
  const params = new URLSearchParams({
    q: query,
    language,
    sortBy,
    pageSize: String(pageSize),
    excludeDomains,
    apiKey: NEWSAPI_KEY,
  });

  const res = await fetch(`${baseUrl}?${params}`);
  const json = await res.json();

  if (json.status !== "ok") {
    throw new Error(`NewsAPI error for ${domainKey}: ${json.message}`);
  }

  return (json.articles || []).map((a) => ({
    domain: label,
    title: a.title || "",
    source: a.source?.name || "",
    url: a.url || "",
    publishedAt: a.publishedAt || new Date().toISOString(),
    description: a.description || "",
  }));
}

async function fetchExistingUrls() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 7);

  const results = await notionQueryAll(
    NEWS_INBOX_DB,
    {
      property: "Date",
      date: { on_or_after: yesterday.toISOString().split("T")[0] },
    },
    [{ timestamp: "created_time", direction: "descending" }]
  );

  return new Set(
    results
      .map((p) => p.properties?.Link?.url || "")
      .filter(Boolean)
  );
}

async function summarizeArticle(title, description) {
  if (DRY_RUN) return `[dry-run] ${description?.slice(0, 120) || title}`;

  const system = "You are a concise analyst. Write exactly 2 sentences summarizing the article. No em dashes. All lowercase except proper nouns.";
  const user = `Title: ${title}\n\nDescription: ${description || "no description provided"}\n\nWrite 2 sentences summarizing what happened and why it matters.`;

  try {
    return await humanizeWithHaiku(system, user, 200);
  } catch (e) {
    console.warn(`[news-collector] Haiku summarize failed: ${e.message}`);
    return description?.slice(0, 300) || title;
  }
}

async function writeToNotion(article, summary) {
  if (DRY_RUN) {
    console.log(`  [dry-run] Would write: "${article.title.slice(0, 60)}" (${article.domain})`);
    return;
  }

  await notionCreatePage(
    { database_id: NEWS_INBOX_DB },
    {
      Title: { title: [{ text: { content: article.title.slice(0, 2000) } }] },
      Summary: { rich_text: [{ text: { content: summary.slice(0, 2000) } }] },
      Category: { select: { name: article.domain } },
      Source: { rich_text: [{ text: { content: article.source.slice(0, 100) } }] },
      Date: { date: { start: article.publishedAt.split("T")[0] } },
      Link: { url: article.url },
      Action: { select: { name: "Inbox" } },
    }
  );
}

async function run() {
  if (!DRY_RUN && !acquireLock(LOCKFILE)) process.exit(0);

  try {
    if (!NEWSAPI_KEY) throw new Error("NEWSAPI_KEY is not set");

    console.log(`[news-collector] Starting${DRY_RUN ? " (dry-run)" : ""}`);

    // Fetch existing URLs for deduplication
    let existingUrls = new Set();
    if (!DRY_RUN) {
      existingUrls = await fetchExistingUrls();
      console.log(`[news-collector] ${existingUrls.size} existing URLs loaded for dedup`);
    }

    // Fetch articles for all domains in parallel
    const domainKeys = Object.keys(config.domains);
    const allResults = await Promise.allSettled(domainKeys.map(fetchArticles));

    let written = 0;
    let skipped = 0;

    for (let i = 0; i < domainKeys.length; i++) {
      const domainKey = domainKeys[i];
      const result = allResults[i];

      if (result.status === "rejected") {
        console.warn(`[news-collector] ${domainKey} fetch failed: ${result.reason.message}`);
        continue;
      }

      const articles = result.value;
      console.log(`[news-collector] ${domainKey}: ${articles.length} articles fetched`);

      for (const article of articles) {
        if (!article.url || existingUrls.has(article.url)) {
          skipped++;
          continue;
        }

        existingUrls.add(article.url); // prevent same-run duplicates across domains

        const summary = await summarizeArticle(article.title, article.description);
        await writeToNotion(article, summary);
        await sleep(400); // Notion rate limit
        written++;
      }
    }

    console.log(`[news-collector] Done. Written: ${written}, skipped (dup): ${skipped}`);
  } finally {
    if (!DRY_RUN) releaseLock(LOCKFILE);
  }
}

run().catch((e) => {
  console.error(`[news-collector] Fatal: ${e.message}`);
  if (!DRY_RUN) releaseLock(LOCKFILE);
  process.exit(1);
});
