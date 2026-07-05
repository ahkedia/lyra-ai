#!/usr/bin/env node
/**
 * Pull-Quote Scheduler — Wed/Fri amplification cycle
 *
 * Picks an unused pull-quote from a recently published blog and sends it to
 * Telegram for one-tap copy-paste (or future auto-post).
 *
 * Usage:
 *   node scripts/pull-quote-scheduler.js linkedin   # Wed 09:00 Berlin
 *   node scripts/pull-quote-scheduler.js x          # Fri 14:00 Berlin
 *
 * Selection logic:
 * 1. Find Content Drafts where text_approval_status = approved AND
 *    pull_quote_used_count < 3 AND created_time within last 14 days.
 * 2. Pick the most recent such draft.
 * 3. Pick the lowest-numbered unused quote (1 → 2 → 3).
 * 4. Send to Telegram, increment pull_quote_used_count.
 *
 * Lockfile: /tmp/content-pull-quote-scheduler.lock
 */

import {
  notionQuery,
  notionPatch,
  extractTitle,
  extractRichText,
  extractNumber,
} from "./lib/notion.js";
import { sendTelegram, sendWhatsApp } from "./lib/telegram.js";
import { acquireLock, releaseLock } from "./lib/lockfile.js";

const LOCKFILE = "/tmp/content-pull-quote-scheduler.lock";
const CONTENT_DRAFTS_DB = "8135676dd15c4ef4925336cf484567ac";
const LOOKBACK_DAYS = 14;

function platformLabel(p) {
  if (p === "linkedin") return "LinkedIn";
  if (p === "x") return "X";
  throw new Error(`Unknown platform: ${p} (expected "linkedin" or "x")`);
}

async function findCandidateDraft() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - LOOKBACK_DAYS);
  const cutoffIso = cutoff.toISOString();

  const res = await notionQuery(
    CONTENT_DRAFTS_DB,
    {
      and: [
        { property: "text_approval_status", select: { equals: "approved" } },
        { property: "pull_quote_used_count", number: { less_than: 3 } },
        { timestamp: "created_time", created_time: { on_or_after: cutoffIso } },
      ],
    },
    [{ timestamp: "created_time", direction: "descending" }],
    20
  );

  for (const page of res.results) {
    const used = extractNumber(page, "pull_quote_used_count") ?? 0;
    const quotes = [
      extractRichText(page, "pull_quote_1"),
      extractRichText(page, "pull_quote_2"),
      extractRichText(page, "pull_quote_3"),
    ];
    const nextIdx = quotes.findIndex((q, i) => i >= used && q && q.trim());
    if (nextIdx >= 0) {
      return { page, quote: quotes[nextIdx], slot: nextIdx + 1, used };
    }
  }
  return null;
}

async function markQuoteUsed(pageId, newUsedCount) {
  await notionPatch(pageId, {
    pull_quote_used_count: { number: newUsedCount },
  });
}

async function main() {
  const platform = (process.argv[2] || "").toLowerCase();
  if (!platform || !["linkedin", "x"].includes(platform)) {
    console.error("Usage: pull-quote-scheduler.js <linkedin|x>");
    process.exit(1);
  }

  console.log(`=== Pull-Quote Scheduler (${platform}) starting ===`);
  console.log(`Time: ${new Date().toISOString()}`);

  const candidate = await findCandidateDraft();
  if (!candidate) {
    console.log("No eligible drafts with unused pull-quotes. Exiting.");
    return;
  }

  const { page, quote, slot, used } = candidate;
  const topic = extractTitle(page);
  const label = platformLabel(platform);

  const msg = `📣 *Pull-Quote: ${label}*

*From:* ${topic}
*Quote ${slot}/3:*

${quote}

---
Copy-paste to ${label}. No link. No context.
(Slot ${slot} of 3 used; ${3 - (used + 1)} remain on this blog.)`;

  await Promise.all([sendTelegram(msg), sendWhatsApp(msg)]);
  await markQuoteUsed(page.id, used + 1);

  console.log(`Sent quote ${slot} from "${topic}" for ${label}`);
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
