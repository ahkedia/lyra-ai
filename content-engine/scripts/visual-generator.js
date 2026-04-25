#!/usr/bin/env node
/**
 * Visual Generator — Step 5 of Content Pipeline
 *
 * Generates doodle visuals for approved text drafts.
 * Primary: MiniMax image API
 * Fallback: DALL-E 3
 *
 * Triggered by approval-bot.js when text is approved.
 * Can also be run standalone for a specific draft ID.
 *
 * Usage: node visual-generator.js [draft-page-id]
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import { notionPatch, notionGetPage, notionAppendBlock, extractTitle, extractSelect, extractRichText, extractNumber } from "./lib/notion.js";
import { sendTelegram, sendPhoto } from "./lib/telegram.js";
import { generateImage, buildDoodlePrompt } from "./lib/image.js";
import { uploadToImgur } from "./lib/imgur.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const doodleConfig = JSON.parse(readFileSync(join(__dirname, "../config/doodle-prompts.json"), "utf8"));

const MAX_REDO_COUNT = 3;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function extractConcept(draftText) {
  const sentences = draftText.split(/[.!?]+/).filter((s) => s.trim().length > 10);
  const firstSentence = sentences[0] || draftText.slice(0, 100);
  
  const conceptWords = firstSentence
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 4)
    .slice(0, 5)
    .join(" ");
  
  return conceptWords || "abstract concept diagram";
}

function getDomainHint(domain) {
  return doodleConfig.domainHints[domain] || doodleConfig.fallbackHint;
}

async function generateVisualForDraft(pageId, redoHint = null) {
  console.log(`Generating visual for draft: ${pageId}`);
  
  const page = await notionGetPage(pageId);
  const title = extractTitle(page);
  const domain = extractSelect(page, "Domain") || "General";
  const draftText = extractRichText(page, "Content");
  const visualCaption = extractRichText(page, "visual_caption");
  const redoCount = extractNumber(page, "redo_count") || 0;
  
  if (redoCount >= MAX_REDO_COUNT) {
    console.log(`Max redo count reached (${redoCount}), skipping visual`);
    await notionPatch(pageId, {
      visual_approval_status: { select: { name: "not_required" } },
    });
    await sendTelegram(`⚠️ Visual generation skipped for "${title}" after ${MAX_REDO_COUNT} failed attempts`);
    return null;
  }
  
  const concept = extractConcept(draftText);
  const domainHint = getDomainHint(domain);

  let promptConcept = `${concept} — ${domainHint}`;
  if (visualCaption) {
    promptConcept = `${visualCaption} — ${domainHint}`;
    console.log(`  Visual caption: ${visualCaption}`);
  }
  if (redoHint) {
    promptConcept = `${redoHint} — ${domainHint}`;
  }

  const prompt = buildDoodlePrompt(promptConcept, domain);
  console.log(`Prompt: ${prompt.slice(0, 100)}...`);
  
  try {
    const imageUrl = await generateImage(prompt);
    if (!imageUrl) {
      throw new Error("No image URL returned from generation API");
    }
    
    const isDataUrl = imageUrl.startsWith("data:");
    console.log(`Image generated: ${isDataUrl ? "[base64 data]" : imageUrl.slice(0, 80)}...`);
    
    // If base64, upload to Imgur for permanent hosting
    let finalUrl = imageUrl;
    if (isDataUrl) {
      console.log("Uploading to Imgur for permanent hosting...");
      const base64Data = imageUrl.replace(/^data:image\/\w+;base64,/, "");
      try {
        const { url } = await uploadToImgur(base64Data);
        finalUrl = url;
        console.log(`Uploaded to Imgur: ${url}`);
      } catch (imgurErr) {
        console.error(`Imgur upload failed: ${imgurErr.message}, continuing with base64`);
      }
    }
    
    // Update Notion properties
    const notionUpdate = {
      redo_count: { number: redoCount + (redoHint ? 1 : 0) },
      visual_approval_status: { select: { name: "pending" } },
    };
    if (!finalUrl.startsWith("data:")) {
      notionUpdate.visual_url = { url: finalUrl };
    }
    await notionPatch(pageId, notionUpdate);
    
    // Add image as block in Notion page body (so it's visible in the page)
    if (!finalUrl.startsWith("data:")) {
      try {
        await notionAppendBlock(pageId, [
          {
            type: "divider",
            divider: {},
          },
          {
            type: "heading_3",
            heading_3: {
              rich_text: [{ type: "text", text: { content: "Generated Visual" } }],
            },
          },
          {
            type: "image",
            image: {
              type: "external",
              external: { url: finalUrl },
            },
          },
        ]);
        console.log("Image added to Notion page body");
      } catch (blockErr) {
        console.error(`Failed to add image block: ${blockErr.message}`);
      }
    }
    
    // Send to Telegram (supports both URLs and base64 data)
    await sendPhoto(imageUrl, `🎨 *Visual for:* ${title}\n\nReply APPROVE or REDO (or SKIP to skip visual)`);
    
    return finalUrl;
  } catch (err) {
    console.error(`Visual generation failed: ${err.message}`);
    await sendTelegram(`⚠️ Visual generation failed for "${title}": ${err.message}\n\nReply SKIP to skip visual, or REDO to retry.`);
    return null;
  }
}

async function main() {
  const draftId = process.argv[2];
  
  if (!draftId) {
    console.log("Usage: visual-generator.js <draft-page-id>");
    console.log("No draft ID provided - this script is triggered by approval-bot on text approval");
    process.exit(0);
  }
  
  console.log(`Running for draft: ${draftId}`);
  await generateVisualForDraft(draftId);
}

export { generateVisualForDraft };

const isMainModule = process.argv[1]?.endsWith("visual-generator.js");
if (isMainModule) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Fatal error:", err);
      process.exit(1);
    });
}
