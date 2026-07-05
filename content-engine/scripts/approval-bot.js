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

import {
  notionQuery, notionPatch, extractTitle, extractSelect, extractRichText, extractUrl, notionGetPage,
  notionFetchBlockTreeAsPlainText, blogPlainTextToParagraphBlocks, notionAppendChildrenBatched,
} from "./lib/notion.js";
import { getTelegramUpdates, validateChatId, getMessageText, sendTelegram } from "./lib/telegram.js";
import { generateWithSonnet } from "./lib/anthropic.js";
import { acquireLock, releaseLock } from "./lib/lockfile.js";
import { generateVisualForDraft } from "./visual-generator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCKFILE = "/tmp/content-approval-bot-script.lock";
const OFFSET_FILE = "/tmp/content-approval-bot-offset.txt";
const LEARNINGS_FILE = join(__dirname, "../config/learnings.json");
const CONTENT_DRAFTS_DB = "8135676dd15c4ef4925336cf484567ac";


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
  }, [{ timestamp: "created_time", direction: "ascending" }], 10);

  return res.results;
}

async function getPendingVisualDrafts() {
  const res = await notionQuery(CONTENT_DRAFTS_DB, {
    and: [
      { property: "text_approval_status", select: { equals: "approved" } },
      { property: "visual_approval_status", select: { equals: "pending" } },
      { property: "visual_url", url: { is_not_empty: true } },
    ],
  }, [{ timestamp: "created_time", direction: "ascending" }], 10);
  
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

  // 4. Rewrite the CURRENT draft with the feedback applied and re-queue it for
  // approval. (Previously feedback only affected future drafts and this draft
  // was shelved in "feedback" status — the operator's correction never landed
  // on the piece they were actually reviewing.)
  try {
    const revised = await rewriteDraftWithFeedback(draft, feedback);
    await sendTelegram(`📝 Feedback applied to: "${title}"\n\nDraft rewritten (revision appended to the Notion page) and re-queued as pending. Reply APPROVE / SKIP / FEEDBACK <more>.\n\nPreview:\n${revised.slice(0, 600)}`);
  } catch (err) {
    console.error(`Feedback rewrite failed: ${err.message}`);
    await sendTelegram(`📝 Feedback recorded for: "${title}" (rewrite failed: ${err.message}).\n\nIt will still shape future drafts. Draft left in "feedback" status — edit in Notion or send FEEDBACK again to retry.`);
  }
}

function loadVoiceContract() {
  const parts = [];
  for (const rel of ["../config/voice-canon.md", "../../voice-system/NEGATIVE_STYLE.md"]) {
    try {
      parts.push(readFileSync(join(__dirname, rel), "utf8"));
    } catch {
      /* optional grounding; skip if missing */
    }
  }
  return parts.join("\n\n").slice(0, 12000);
}

async function rewriteDraftWithFeedback(draft, feedback) {
  const title = extractTitle(draft);
  const fullBlog = await notionFetchBlockTreeAsPlainText(draft.id, 12000);
  const currentText = fullBlog && fullBlog.trim().length > 200
    ? fullBlog
    : extractRichText(draft, "blog_content");
  if (!currentText || !currentText.trim()) {
    throw new Error("no draft text found on the page");
  }

  const system = `You revise a blog draft based on the author's direct feedback. Preserve the argument and evidence; change only what the feedback requires plus anything that violates the voice contract below. Output ONLY the revised blog text, no preamble.\n\n${loadVoiceContract()}`;
  const user = `FEEDBACK (non-negotiable, apply throughout):\n${feedback}\n\nCURRENT DRAFT — "${title}":\n${currentText}`;
  const revised = (await generateWithSonnet(system, user, 3000)).trim();
  if (revised.length < 200) {
    throw new Error("rewrite came back suspiciously short");
  }

  // Append the revision to the page body (originals stay above for comparison),
  // refresh the preview property, and put the draft back in the approval queue.
  const marker = `Revised draft — feedback applied ${new Date().toISOString().slice(0, 10)}`;
  await notionAppendChildrenBatched(draft.id, [
    { type: "heading_2", heading_2: { rich_text: [{ type: "text", text: { content: marker } }] } },
    ...blogPlainTextToParagraphBlocks(revised),
  ]);
  const preview = revised.length > 1960 ? `${revised.slice(0, 1960)}\n…(full revision in page body)` : revised;
  await notionPatch(draft.id, {
    blog_content: { rich_text: [{ type: "text", text: { content: preview } }] },
    text_approval_status: { select: { name: "pending" } },
  });
  return revised;
}


async function processUpdates() {
  const offset = getLastOffset();
  console.log(`Polling Telegram updates (offset: ${offset})`);
  
  // timeout=0: short-poll (non-blocking) to avoid conflicting with OpenClaw's long-poll on the same bot token
  const updates = await getTelegramUpdates(offset ? offset + 1 : undefined, 0);
  
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

*Other:*
STATUS - Show queue status
HELP - Show this message

*To create commentary:*
Send HOT <url_or_topic> as a regular message to Lyra`;
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

// Direct command mode: called by Lyra via `node approval-bot.js --cmd APPROVE`.
// Skips Telegram getUpdates entirely — eliminates the dual-poller 409 conflict.
async function runDirectCommand(cmd) {
  console.log(`Direct command: ${cmd}`);

  const expired = await checkExpiredDrafts();
  if (expired > 0) console.log(`Expired ${expired} drafts`);

  const pendingText = await getPendingTextDrafts();
  const pendingVisual = await getPendingVisualDrafts();
  console.log(`Pending: ${pendingText.length} text, ${pendingVisual.length} visual`);

  const upper = cmd.toUpperCase();

  if (upper === "APPROVE") {
    if (pendingText.length > 0) await handleTextApprove(pendingText[0]);
    else if (pendingVisual.length > 0) await handleVisualApprove(pendingVisual[0]);
    else await sendTelegram("No pending drafts to approve.");
  } else if (upper === "SKIP") {
    if (pendingText.length > 0) await handleTextSkip(pendingText[0]);
    else if (pendingVisual.length > 0) await handleVisualSkip(pendingVisual[0]);
    else await sendTelegram("No pending drafts to skip.");
  } else if (upper.startsWith("REDO")) {
    const hint = cmd.slice(4).trim();
    if (pendingVisual.length > 0) await handleVisualRedo(pendingVisual[0], hint);
    else await sendTelegram("No pending visual drafts to redo.");
  } else if (upper.startsWith("FEEDBACK")) {
    const feedback = cmd.slice(8).trim();
    if (pendingText.length > 0 && feedback) await handleFeedback(pendingText[0], feedback);
    else await sendTelegram(feedback ? "No pending text drafts for feedback." : "Usage: FEEDBACK <text>");
  } else if (upper === "STATUS") {
    const statusMsg = `📊 *Status*\n\nPending text: ${pendingText.length}\nPending visual: ${pendingVisual.length}`;
    await sendTelegram(statusMsg);
  } else {
    console.log(`Unknown direct command: ${cmd}`);
  }
}

async function main() {
  console.log("=== Approval Bot starting ===");
  console.log(`Time: ${new Date().toISOString()}`);

  // --cmd mode: Lyra routes APPROVE/SKIP/REDO/FEEDBACK directly here, no Telegram polling.
  const cmdIndex = process.argv.indexOf("--cmd");
  if (cmdIndex > -1) {
    const cmd = process.argv.slice(cmdIndex + 1).join(" ").trim();
    await runDirectCommand(cmd);
    console.log("=== Approval Bot complete (direct) ===");
    return;
  }

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
