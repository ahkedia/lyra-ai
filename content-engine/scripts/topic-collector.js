#!/usr/bin/env node
/**
 * Topic Collector — Step 1 of Content Pipeline
 *
 * Aggregates topic candidates from 4 sources (Content Ideas merged into Topic Pool; bookmarks route there via classify-and-route):
 * 1. Personal Wiki — career/domain pages
 * 2. Lenny KB — synthesis pages
 * 3. Twitter Insights — content_create marked bookmarks
 * 4. Second Brain — insights/ideas
 *
 * Scores, deduplicates, writes to Content Topic Pool DB (Status: Candidate).
 * topic-quality-gate.js promotes to Shortlisted (Q2 Haiku + daily cap 2).
 * Cron: 07:30 daily (after Twitter bookmarks sync at 07:00)
 * Lockfile: /tmp/content-topic-collector.lock
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import { notionQueryAll, notionCreatePage, extractTitle, extractText, extractSelect, extractDate, extractUrl } from "./lib/notion.js";
import { sendTelegram } from "./lib/telegram.js";
import { acquireLock, releaseLock } from "./lib/lockfile.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCKFILE = "/tmp/content-topic-collector.lock";

const sources = JSON.parse(readFileSync(join(__dirname, "../config/sources.json"), "utf8"));
const TOPIC_POOL_DB = sources.topicPool.dbId;
const INGEST_CAP = sources.topicPool?.queue?.ingestCap ?? 5;

const RECENCY_TIERS = sources.scoring.recencyTiers;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function getRecencyTier(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const now = new Date();
  const diffHours = (now - d) / (1000 * 60 * 60);
  
  for (const tier of RECENCY_TIERS) {
    if (diffHours <= tier.maxHours) {
      return tier;
    }
  }
  return null;
}

function scoreCandidate(candidate, sourceWeight) {
  let score = sourceWeight;
  const tier = getRecencyTier(candidate.date);
  if (tier) {
    score += tier.bonus;
  }
  return {
    score: Math.round(score * 10) / 10,
    recencyLabel: tier?.label || null,
  };
}

async function fetchPersonalWikiTopics() {
  const cfg = sources.sources.personalWiki;
  const sort = cfg.sortBy 
    ? [{ timestamp: cfg.sortBy.timestamp, direction: cfg.sortBy.direction }]
    : [{ timestamp: "last_edited_time", direction: "descending" }];
  const pages = await notionQueryAll(cfg.dbId, cfg.filter, sort);
  
  return pages.slice(0, 50).map((page) => ({
    topic: extractTitle(page, cfg.titleProp),
    source: "Wiki",
    domain: extractSelect(page, "Domain") || extractSelect(page, "Type") || "General",
    date: page.last_edited_time,
    sourceRef: page.url,
    weight: cfg.weight,
  }));
}

async function fetchLennyTopics() {
  const cfg = sources.sources.lennyKB;
  const sort = cfg.sortBy 
    ? [{ timestamp: cfg.sortBy.timestamp, direction: cfg.sortBy.direction }]
    : [{ timestamp: "last_edited_time", direction: "descending" }];
  const pages = await notionQueryAll(cfg.dbId, cfg.filter, sort);
  
  return pages.slice(0, 20).map((page) => ({
    topic: extractTitle(page, cfg.titleProp),
    source: "Lenny",
    domain: extractSelect(page, "Domain") || "Strategy & GTM",
    date: page.last_edited_time,
    sourceRef: page.url,
    weight: cfg.weight,
  }));
}

async function fetchTwitterTopics() {
  const cfg = sources.sources.twitterInsights;
  const sort = cfg.sortBy 
    ? [{ timestamp: cfg.sortBy.timestamp, direction: cfg.sortBy.direction }]
    : [{ timestamp: "created_time", direction: "descending" }];
  
  const pages = await notionQueryAll(cfg.dbId, cfg.filter, sort);
  
  return pages.slice(0, 30).map((page) => ({
    topic: extractTitle(page, cfg.titleProp) || extractText(page, "Original Tweet Summary"),
    source: "Twitter",
    domain: extractSelect(page, "Tags") || "General",
    date: extractDate(page, "Bookmarked Date") || page.created_time,
    sourceRef: extractUrl(page, "Original Tweet URL") || page.url,
    weight: cfg.weight,
  }));
}

async function fetchSecondBrainTopics() {
  const cfg = sources.sources.secondBrain;
  const sort = cfg.sortBy 
    ? [{ timestamp: cfg.sortBy.timestamp, direction: cfg.sortBy.direction }]
    : [{ timestamp: "created_time", direction: "descending" }];
  
  const pages = await notionQueryAll(cfg.dbId, cfg.filter, sort);
  
  return pages.slice(0, 30).map((page) => ({
    topic: extractTitle(page, cfg.titleProp),
    source: "SecondBrain",
    domain: "General",
    date: page.created_time,
    sourceRef: page.url,
    weight: cfg.weight,
  }));
}

async function getExistingTopics() {
  const pages = await notionQueryAll(TOPIC_POOL_DB, undefined, undefined);
  return new Set(pages.map((p) => extractTitle(p).toLowerCase().trim()));
}

function normalizeTitle(title) {
  return title.toLowerCase().trim().replace(/[^\w\s]/g, "");
}

function deduplicate(candidates, existingTitles) {
  const seen = new Set();
  const result = [];
  
  for (const c of candidates) {
    const norm = normalizeTitle(c.topic);
    if (!norm || seen.has(norm) || existingTitles.has(norm)) continue;
    seen.add(norm);
    result.push(c);
  }
  
  return result;
}

async function writeToTopicPool(candidates) {
  const week = new Date().toISOString().split("T")[0];
  let written = 0;

  for (const c of candidates) {
    // All ingested rows stay Candidate until topic-quality-gate.js (Q2 + daily cap) or manual Shortlist.
    // Wiki / Lenny remain Candidate unless you Shortlist in Notion.
    try {
      await notionCreatePage(
        { type: "database_id", database_id: TOPIC_POOL_DB },
        {
          Topic: { title: [{ text: { content: c.topic.slice(0, 100) } }] },
          Source: { select: { name: c.source } },
          Domain: { select: { name: c.domain.slice(0, 50) } },
          Score: { number: c.score },
          Status: { select: { name: "Candidate" } },
          Week: { date: { start: week } },
          "Source Reference": { url: c.sourceRef || null },
        }
      );
      written++;
      await sleep(350);
    } catch (err) {
      console.error(`Failed to write topic "${c.topic}": ${err.message}`);
    }
  }

  return { written };
}

async function main() {
  console.log("=== Topic Collector starting ===");
  console.log(`Time: ${new Date().toISOString()}`);
  
  const existingTitles = await getExistingTopics();
  console.log(`Existing topics in pool: ${existingTitles.size}`);
  
  console.log("Fetching from 4 sources...");
  const [wiki, lenny, twitter, secondBrain] = await Promise.all([
    fetchPersonalWikiTopics().catch((e) => { console.error("Wiki fetch failed:", e.message); return []; }),
    fetchLennyTopics().catch((e) => { console.error("Lenny fetch failed:", e.message); return []; }),
    fetchTwitterTopics().catch((e) => { console.error("Twitter fetch failed:", e.message); return []; }),
    fetchSecondBrainTopics().catch((e) => { console.error("SecondBrain fetch failed:", e.message); return []; }),
  ]);
  
  console.log(`Wiki: ${wiki.length}, Lenny: ${lenny.length}, Twitter: ${twitter.length}, SecondBrain: ${secondBrain.length}`);
  
  const allCandidates = [...wiki, ...lenny, ...twitter, ...secondBrain];
  const scoredCandidates = allCandidates.map((c) => {
    const { score, recencyLabel } = scoreCandidate(c, c.weight);
    return { ...c, score, recencyLabel };
  });
  
  scoredCandidates.sort((a, b) => b.score - a.score);
  
  const deduped = deduplicate(scoredCandidates, existingTitles);
  console.log(`After dedup: ${deduped.length} new candidates`);
  
  const toWrite = deduped.slice(0, INGEST_CAP);
  const { written } = await writeToTopicPool(toWrite);

  console.log(`Written to Topic Pool: ${written} (all Candidate until quality gate or manual Shortlist)`);

  const summary =
    `📝 *Topic Collector*\n\n` +
    `Sources: Wiki ${wiki.length}, Lenny ${lenny.length}, Twitter ${twitter.length}, SecondBrain ${secondBrain.length}\n` +
    `New candidates: ${written}\n\n` +
    `Rows are *Candidate*. Run *topic-quality-gate* (cron after this) for Q2 Shortlist up to 2/day, or Shortlist in Notion.`;
  
  try {
    await sendTelegram(summary);
  } catch (err) {
    console.error("Telegram send failed:", err.message);
  }
  
  console.log("=== Topic Collector complete ===");
}

if (!acquireLock(LOCKFILE)) {
  process.exit(0);
}

main()
  .then(() => {
    releaseLock(LOCKFILE);
    process.exit(0);
  })
  .catch((err) => {
    console.error("Fatal error:", err);
    releaseLock(LOCKFILE);
    process.exit(1);
  });
