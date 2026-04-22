#!/usr/bin/env node
/**
 * Topic Quality Gate (Q2) — promotes at most N Candidate rows to Shortlisted per calendar day.
 *
 * - Only sources in topicPool.queue.autoPromoteSources (Twitter, SecondBrain).
 * - Wiki / Lenny stay Candidate until manually Shortlisted.
 * - Haiku scores 0–10; score >= qualityMinScore (default 7) required.
 * - Respects dailyShortlistCap including slots already used by HOT or manual Shortlisted rows with "Shortlisted on" = today.
 *
 * Cron: after topic-collector (e.g. 07:45 Europe/Berlin). Env CONTENT_TZ defaults to Europe/Berlin.
 *
 * Notion: add date property "Shortlisted on" and optional number "Quality score" to Content Topic Pool.
 */

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { notionQuery, notionPatch, extractTitle, extractSelect, extractNumber } from "./lib/notion.js";
import { sendTelegram } from "./lib/telegram.js";
import { acquireLock, releaseLock } from "./lib/lockfile.js";
import { evaluateTopicGate } from "./lib/anthropic.js";
import { countShortlistedToday, remainingSlots, getTodayYmd } from "./lib/topic-pool-quota.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCKFILE = "/tmp/content-topic-quality-gate.lock";

const sources = JSON.parse(readFileSync(join(__dirname, "../config/sources.json"), "utf8"));
const TOPIC_POOL_DB = sources.topicPool.dbId;
const queue = sources.topicPool.queue || {};
const CAP = queue.dailyShortlistCap ?? 2;
const MIN_SCORE = queue.qualityMinScore ?? 7;
const MAX_EVAL = queue.maxGateEvaluationsPerRun ?? 15;
const AUTO_SOURCES = new Set(queue.autoPromoteSources || ["Twitter", "SecondBrain"]);
const SHORTLISTED_ON = queue.shortlistedOnProperty || "Shortlisted on";
const QUALITY_PROP = queue.qualityScoreProperty || "Quality score";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function run() {
  console.log("=== Topic Quality Gate starting ===");
  console.log(`Day (CONTENT_TZ): ${getTodayYmd()}`);

  let promotedToday = 0;
  try {
    promotedToday = await countShortlistedToday(TOPIC_POOL_DB, SHORTLISTED_ON, notionQuery);
  } catch (e) {
    console.error(`Count Shortlisted today failed: ${e.message}`);
    await sendTelegram(
      `⚠️ *Topic Quality Gate skipped*\n\nAdd Notion date property *${SHORTLISTED_ON}* to Content Topic Pool (used for daily cap).`
    );
    return;
  }

  let slots = remainingSlots(CAP, promotedToday);
  console.log(`Shortlisted today (dated): ${promotedToday}, cap ${CAP}, remaining slots: ${slots}`);

  if (slots <= 0) {
    console.log("No slots left today; exiting.");
    return;
  }

  const res = await notionQuery(
    TOPIC_POOL_DB,
    { property: "Status", select: { equals: "Candidate" } },
    [{ property: "Score", direction: "descending" }],
    100
  );

  const pages = res.results.filter((p) => {
    const src = extractSelect(p, "Source") || "";
    return AUTO_SOURCES.has(src);
  });

  let promoted = 0;
  let evaluated = 0;

  for (const page of pages) {
    if (slots <= 0) break;
    if (evaluated >= MAX_EVAL) break;

    const topic = extractTitle(page);
    const source = extractSelect(page, "Source") || "";
    const domain = extractSelect(page, "Domain") || "General";
    const collectorScore = extractNumber(page, "Score") ?? 0;

    evaluated++;
    console.log(`Evaluating (${evaluated}): "${topic.slice(0, 60)}..." [${source}]`);

    const gate = await evaluateTopicGate(topic, source, domain, collectorScore);
    if (!gate) {
      console.log("  Haiku did not return JSON; skip");
      await sleep(400);
      continue;
    }

    console.log(`  Gate score: ${gate.score} — ${gate.reason}`);

    if (gate.score < MIN_SCORE) {
      await sleep(400);
      continue;
    }

    const props = {
      Status: { select: { name: "Shortlisted" } },
      [SHORTLISTED_ON]: { date: { start: getTodayYmd() } },
    };
    props[QUALITY_PROP] = { number: gate.score };

    try {
      await notionPatch(page.id, props);
    } catch (e) {
      console.warn(`  Patch with ${QUALITY_PROP} failed, retrying without quality: ${e.message}`);
      try {
        await notionPatch(page.id, {
          Status: { select: { name: "Shortlisted" } },
          [SHORTLISTED_ON]: { date: { start: getTodayYmd() } },
        });
      } catch (e2) {
        console.error(`  Failed to promote: ${e2.message}`);
        await sleep(400);
        continue;
      }
    }

    promoted++;
    slots--;
    console.log(`  Promoted to Shortlisted (${promoted} this run)`);
    await sleep(400);
  }

  const msg =
    `🎯 *Topic Quality Gate*\n\n` +
    `Day: ${getTodayYmd()}\n` +
    `Already shortlisted today: ${promotedToday}\n` +
    `Cap: ${CAP}\n` +
    `New promotions: ${promoted}\n` +
    `Candidates evaluated: ${evaluated}`;

  try {
    await sendTelegram(msg);
  } catch (e) {
    console.error("Telegram:", e.message);
  }

  console.log("=== Topic Quality Gate complete ===");
}

if (!acquireLock(LOCKFILE)) {
  process.exit(0);
}

run()
  .then(() => {
    releaseLock(LOCKFILE);
    process.exit(0);
  })
  .catch((err) => {
    console.error("Fatal:", err);
    releaseLock(LOCKFILE);
    process.exit(1);
  });
