#!/usr/bin/env node
/**
 * Approval Bot — Central Coordinator for Content Pipeline
 *
 * Polls Telegram for APPROVE/SKIP/REDO commands.
 * Routes to appropriate handlers based on draft state.
 *
 * Flow:
 * 1. Text approval (APPROVE → trigger visual generation, SKIP → skip)
 * 2. Visual approval (APPROVE → mark ready, REDO → regenerate)
 *
 * Cron: Every 5 minutes
 * Lockfile: /tmp/content-approval-bot-script.lock
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { notionQuery, notionPatch, notionCreatePage, extractTitle, extractSelect, extractRichText, extractUrl, notionGetPage } from "./lib/notion.js";
import { getTelegramUpdates, validateChatId, getMessageText, sendTelegram } from "./lib/telegram.js";
import { acquireLock, releaseLock } from "./lib/lockfile.js";
import { generateVisualForDraft } from "./visual-generator.js";
import { countShortlistedToday, remainingSlots, getTodayYmd } from "./lib/topic-pool-quota.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCKFILE = "/tmp/content-approval-bot-script.lock";
const OFFSET_FILE = "/tmp/content-approval-bot-offset.txt";
const LEARNINGS_FILE = join(__dirname, "../config/learnings.json");
const CONTENT_DRAFTS_DB = "8135676dd15c4ef4925336cf484567ac";

const sources = JSON.parse(readFileSync(join(__dirname, "../config/sources.json"), "utf8"));
const TOPIC_POOL_DB = sources.topicPool.dbId;
const queueCfg = sources.topicPool.queue || {};
const DAILY_SHORTLIST_CAP = queueCfg.dailyShortlistCap ?? 2;
const SHORTLISTED_ON = queueCfg.shortlistedOnProperty || "Shortlisted on";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function getLastOffset() {
  if (existsSync(OFFSET_FILE)) {
    return parseInt(readFileSync(OFFSET_FILE, "utf8").trim(), 10);
  }
  return 0;
}

function saveLastOffset(offset) {
  writeFileSync(OFFSET_FILE, offset.toString());
}

async function getPendingTextDrafts() {
  const res = await notionQuery(CONTENT_DRAFTS_DB, {
    property: "text_approval_status",
    select: { equals: "pending" },
  }, [{ property: "created_time", direction: "ascending" }], 10);
  
  return res.results;
}

async function getPendingVisualDrafts() {
  const res = await notionQuery(CONTENT_DRAFTS_DB, {
    and: [
      { property: "text_approval_status", select: { equals: "approved" } },
      { property: "visual_approval_status", select: { equals: "pending" } },
      { property: "visual_url", url: { is_not_empty: true } },
    ],
  }, [{ property: "created_time", direction: "ascending" }], 10);
  
  return res.results;
}

async function handleTextApprove(draft) {
  const title = extractTitle(draft);
  console.log(`Text APPROVED: "${title}"`);
  
  await notionPatch(draft.id, {
    text_approval_status: { select: { name: "approved" } },
  });
  
  await sendTelegram(`✅ Text approved: "${title}"\n\nGenerating visual...`);
  await generateVisualForDraft(draft.id);
}

async function handleTextSkip(draft) {
  const title = extractTitle(draft);
  console.log(`Text SKIPPED: "${title}"`);
  
  await notionPatch(draft.id, {
    text_approval_status: { select: { name: "rejected" } },
    visual_approval_status: { select: { name: "not_required" } },
  });
  
  await sendTelegram(`⏭️ Skipped: "${title}"`);
}

async function handleVisualApprove(draft) {
  const title = extractTitle(draft);
  console.log(`Visual APPROVED: "${title}"`);
  
  await notionPatch(draft.id, {
    visual_approval_status: { select: { name: "approved" } },
  });
  
  await sendTelegram(`✅ Visual approved: "${title}"\n\nReady for publishing!`);
}

async function handleVisualSkip(draft) {
  const title = extractTitle(draft);
  console.log(`Visual SKIPPED: "${title}"`);
  
  await notionPatch(draft.id, {
    visual_approval_status: { select: { name: "not_required" } },
  });
  
  await sendTelegram(`⏭️ Visual skipped: "${title}"\n\nReady for publishing (text only)!`);
}

async function handleVisualRedo(draft, hint = null) {
  const title = extractTitle(draft);
  console.log(`Visual REDO: "${title}"`);
  
  await sendTelegram(`🔄 Regenerating visual for: "${title}"...`);
  await generateVisualForDraft(draft.id, hint);
}

function getLearnings() {
  if (existsSync(LEARNINGS_FILE)) {
    return JSON.parse(readFileSync(LEARNINGS_FILE, "utf8"));
  }
  return { feedbackHistory: [], cumulativeLearnings: "" };
}

function saveLearnings(learnings) {
  writeFileSync(LEARNINGS_FILE, JSON.stringify(learnings, null, 2));
}

async function handleFeedback(draft, feedback) {
  const title = extractTitle(draft);
  const domain = extractSelect(draft, "Domain") || "General";
  console.log(`FEEDBACK for "${title}": ${feedback.slice(0, 50)}...`);
  
  // 1. Store feedback in Notion
  await notionPatch(draft.id, {
    feedback: { rich_text: [{ type: "text", text: { content: feedback.slice(0, 2000) } }] },
    text_approval_status: { select: { name: "feedback" } },
  });
  
  // 2. Add to learnings file
  const learnings = getLearnings();
  learnings.feedbackHistory.push({
    date: new Date().toISOString(),
    topic: title,
    domain,
    feedback,
  });
  
  // Keep only last 20 feedbacks
  if (learnings.feedbackHistory.length > 20) {
    learnings.feedbackHistory = learnings.feedbackHistory.slice(-20);
  }
  
  // 3. Update cumulative learnings (imperative bullets; cap length for prompt injection)
  const MAX_CUMULATIVE = 3500;
  const bullets = learnings.feedbackHistory.slice(-10).map((f) => {
    const oneLine = f.feedback.replace(/\s+/g, " ").trim();
    return `- **${f.domain} (${f.date.slice(0, 10)}):** You MUST honor this in all future drafts until superseded: ${oneLine}`;
  });
  let cumulative = `Cumulative human corrections (apply every time you write for this voice):\n${bullets.join("\n")}`;
  if (cumulative.length > MAX_CUMULATIVE) {
    cumulative = `${cumulative.slice(0, MAX_CUMULATIVE)}\n\n[truncated at ${MAX_CUMULATIVE} chars; oldest items may be dropped next feedback]`;
  }
  learnings.cumulativeLearnings = cumulative;
  saveLearnings(learnings);
  
  await sendTelegram(`📝 Feedback recorded for: "${title}"\n\nThis feedback will be incorporated into future drafts.\n\n*Current queue:* Draft moved to "feedback" status. Send a new topic to generate an improved version, or manually edit in Notion.`);
}

async function handleHotTopic(topicText) {
  console.log(`HOT topic: "${topicText.slice(0, 50)}..."`);
  const week = new Date().toISOString().split("T")[0];

  let promotedToday = 0;
  try {
    promotedToday = await countShortlistedToday(TOPIC_POOL_DB, SHORTLISTED_ON, notionQuery);
  } catch (e) {
    console.error("Shortlist count failed:", e.message);
    try {
      await notionCreatePage(
        { type: "database_id", database_id: TOPIC_POOL_DB },
        {
          Topic: { title: [{ text: { content: topicText.slice(0, 100) } }] },
          Source: { select: { name: "Manual" } },
          Domain: { select: { name: "General" } },
          Score: { number: 5.0 },
          Status: { select: { name: "Candidate" } },
          Week: { date: { start: week } },
        }
      );
    } catch (err) {
      await sendTelegram(`❌ Failed to create hot topic: ${err.message}`);
      return;
    }
    await sendTelegram(
      `⚠️ Add Notion date property *${SHORTLISTED_ON}* to Content Topic Pool for daily cap tracking.\n\nHOT saved as *Candidate*. Shortlist in Notion when ready.`
    );
    return;
  }

  const slots = remainingSlots(DAILY_SHORTLIST_CAP, promotedToday);

  if (slots <= 0) {
    try {
      await notionCreatePage(
        { type: "database_id", database_id: TOPIC_POOL_DB },
        {
          Topic: { title: [{ text: { content: topicText.slice(0, 100) } }] },
          Source: { select: { name: "Manual" } },
          Domain: { select: { name: "General" } },
          Score: { number: 5.0 },
          Status: { select: { name: "Candidate" } },
          Week: { date: { start: week } },
        }
      );
    } catch (err) {
      await sendTelegram(`❌ Failed to create hot topic: ${err.message}`);
      return;
    }
    await sendTelegram(
      `🔥 Daily Shortlist cap (${DAILY_SHORTLIST_CAP}) already reached for *${getTodayYmd()}* (includes auto + prior HOT).\n\nTopic saved as *Candidate*. Shortlist in Notion or try tomorrow.`
    );
    return;
  }

  await sendTelegram(
    `🔥 Creating hot topic: "${topicText.slice(0, 80)}${topicText.length > 80 ? "…" : ""}"\n\nStarting draft generation in the background…`
  );

  try {
    const day = getTodayYmd();
    await notionCreatePage(
      { type: "database_id", database_id: TOPIC_POOL_DB },
      {
        Topic: { title: [{ text: { content: topicText.slice(0, 100) } }] },
        Source: { select: { name: "Manual" } },
        Domain: { select: { name: "General" } },
        Score: { number: 5.0 },
        Status: { select: { name: "Shortlisted" } },
        Week: { date: { start: week } },
        [SHORTLISTED_ON]: { date: { start: day } },
      }
    );

    const { spawn } = await import("child_process");
    const child = spawn("node", [join(__dirname, "draft-generator.js")], {
      env: process.env,
      detached: true,
      stdio: "ignore",
    });
    child.unref();

    await sendTelegram(
      `✅ Hot topic *Shortlisted* (${getTodayYmd()}). Draft generator started.\n\nYou should get the usual draft preview in Telegram once the run finishes.`
    );
  } catch (err) {
    console.error(`Failed to create hot topic: ${err.message}`);
    await sendTelegram(`❌ Failed to create hot topic: ${err.message}`);
  }
}

async function processUpdates() {
  const offset = getLastOffset();
  console.log(`Polling Telegram updates (offset: ${offset})`);
  
  const updates = await getTelegramUpdates(offset ? offset + 1 : undefined, 5);
  
  if (updates.length === 0) {
    console.log("No new updates");
    return;
  }
  
  console.log(`Got ${updates.length} updates`);
  
  const pendingText = await getPendingTextDrafts();
  const pendingVisual = await getPendingVisualDrafts();
  
  console.log(`Pending: ${pendingText.length} text, ${pendingVisual.length} visual`);

  for (const update of updates) {
    saveLastOffset(update.update_id);

    if (!validateChatId(update)) {
      console.log(`Ignoring update from unauthorized chat`);
      continue;
    }

    const text = getMessageText(update);
    console.log(`Processing command: ${text}`);

    if (text.startsWith("HOT ")) {
      const topicText = text.slice(4).trim();
      if (topicText) await handleHotTopic(topicText);
      await sleep(500);
      continue;
    }

    if (text === "HELP") {
      const helpMsg = `📖 *Commands*

*Text approval:*
APPROVE - Approve draft, generate visual
SKIP - Skip this draft
FEEDBACK <text> - Record feedback and skip

*Visual approval:*
APPROVE - Approve visual
SKIP - Skip visual (text only)
REDO - Regenerate visual
REDO <hint> - Regenerate with specific hint

*Hot topics:*
HOT <topic> - Shortlist if daily cap allows, else save as Candidate (cap = auto + HOT)

*Other:*
STATUS - Show queue status
HELP - Show this message`;
      await sendTelegram(helpMsg);
      await sleep(500);
      continue;
    }

    if (text === "STATUS") {
      const statusMsg = `📊 *Status*\n\nPending text: ${pendingText.length}\nPending visual: ${pendingVisual.length}`;
      await sendTelegram(statusMsg);
      await sleep(500);
      continue;
    }

    if (pendingText.length === 0 && pendingVisual.length === 0) {
      console.log("No pending drafts for approval commands");
      await sleep(500);
      continue;
    }

    if (text === "APPROVE") {
      if (pendingText.length > 0) {
        await handleTextApprove(pendingText[0]);
        pendingText.shift();
      } else if (pendingVisual.length > 0) {
        await handleVisualApprove(pendingVisual[0]);
        pendingVisual.shift();
      }
    } else if (text === "SKIP") {
      if (pendingText.length > 0) {
        await handleTextSkip(pendingText[0]);
        pendingText.shift();
      } else if (pendingVisual.length > 0) {
        await handleVisualSkip(pendingVisual[0]);
        pendingVisual.shift();
      }
    } else if (text === "REDO") {
      if (pendingVisual.length > 0) {
        await handleVisualRedo(pendingVisual[0]);
        pendingVisual.shift();
      }
    } else if (text.startsWith("REDO ")) {
      const hint = text.slice(5).trim();
      if (pendingVisual.length > 0 && hint) {
        await handleVisualRedo(pendingVisual[0], hint);
        pendingVisual.shift();
      }
    } else if (text.startsWith("FEEDBACK ")) {
      const feedback = text.slice(9).trim();
      if (pendingText.length > 0 && feedback) {
        await handleFeedback(pendingText[0], feedback);
        pendingText.shift();
      }
    }

    await sleep(500);
  }
}

async function checkExpiredDrafts() {
  const today = new Date().toISOString().split("T")[0];
  
  const res = await notionQuery(CONTENT_DRAFTS_DB, {
    and: [
      { property: "text_approval_status", select: { equals: "pending" } },
      { property: "draft_expires_at", date: { on_or_before: today } },
    ],
  }, undefined, 10);
  
  for (const draft of res.results) {
    const title = extractTitle(draft);
    console.log(`Expiring draft: "${title}"`);
    
    await notionPatch(draft.id, {
      text_approval_status: { select: { name: "rejected" } },
    });
    
    await sendTelegram(`⏰ Draft expired (7 days): "${title}"`);
  }
  
  return res.results.length;
}

async function main() {
  console.log("=== Approval Bot starting ===");
  console.log(`Time: ${new Date().toISOString()}`);
  
  const expired = await checkExpiredDrafts();
  if (expired > 0) {
    console.log(`Expired ${expired} drafts`);
  }
  
  await processUpdates();
  
  console.log("=== Approval Bot complete ===");
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
