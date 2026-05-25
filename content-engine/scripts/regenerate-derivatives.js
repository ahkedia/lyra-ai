#!/usr/bin/env node
/**
 * Regenerate Derivatives — one-off refresh for existing drafts.
 *
 * For an existing Content Drafts page, regenerates only the derivative
 * outputs (x_thread, linkedin_copy 800ch, pull_quotes, substack
 * title+subtitle, newsletter hook) from the existing blog body, and
 * PATCHes them back onto the same page. Does NOT regenerate the blog
 * itself, does NOT change approval status, does NOT create a new page.
 *
 * Usage:
 *   node scripts/regenerate-derivatives.js <pageId> [<pageId> ...]
 *
 * The blog body is read from the page block tree (under "Full blog ...")
 * with a fallback to the `Content` rich_text property if the page body
 * is empty.
 */

import {
  notionGetPage,
  notionPatch,
  extractTitle,
  extractRichText,
  notionFetchBlockTreeAsPlainText,
  richTextChunks,
} from "./lib/notion.js";
import { sendTelegram } from "./lib/telegram.js";
import { generateDerivativesFromBlog } from "./draft-generator.js";

const MIN_BLOG_CHARS = 400;

function truncate(s, n) {
  if (!s) return "";
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

async function fetchBlogBody(pageId, page) {
  const fromBlocks = await notionFetchBlockTreeAsPlainText(pageId, 20000);
  if (fromBlocks && fromBlocks.length >= MIN_BLOG_CHARS) {
    return fromBlocks;
  }
  const fromContent = extractRichText(page, "Content") || extractRichText(page, "blog_content");
  return fromContent || fromBlocks;
}

async function regenerateOne(pageId) {
  console.log(`\n=== ${pageId} ===`);
  const page = await notionGetPage(pageId);
  const topic = extractTitle(page) || extractTitle(page, "Draft") || "(unknown topic)";
  console.log(`Topic: ${topic}`);

  const blog = await fetchBlogBody(pageId, page);
  if (!blog || blog.length < MIN_BLOG_CHARS) {
    throw new Error(`Blog body too short (${blog?.length ?? 0} chars) — refusing to regenerate`);
  }
  console.log(`Blog body: ${blog.length} chars`);

  const result = await generateDerivativesFromBlog(topic, blog);
  console.log(`  x_thread: ${result.xThread.length} chars`);
  console.log(`  linkedin_copy: ${result.linkedinCopy.length} chars`);
  console.log(`  pull_quotes: ${result.pullQuotes.filter(Boolean).length}/3`);
  console.log(`  substack_title: ${result.substackTitle || "—"}`);
  console.log(`  newsletter_hook: ${result.newsletterHook?.length || 0} chars`);

  const linkedinFirstComment = "wrote up the long version → {{SUBSTACK_URL}}";
  await notionPatch(pageId, {
    x_thread: { rich_text: richTextChunks(result.xThread) },
    linkedin_copy: { rich_text: [{ text: { content: result.linkedinCopy.slice(0, 2000) } }] },
    linkedin_first_comment: { rich_text: [{ text: { content: linkedinFirstComment } }] },
    linkedin_newsletter_hook: { rich_text: [{ text: { content: (result.newsletterHook || "").slice(0, 2000) } }] },
    substack_title: { rich_text: [{ text: { content: (result.substackTitle || "").slice(0, 2000) } }] },
    substack_subtitle: { rich_text: [{ text: { content: (result.substackSubtitle || "").slice(0, 2000) } }] },
    pull_quote_1: { rich_text: [{ text: { content: (result.pullQuotes[0] || "").slice(0, 2000) } }] },
    pull_quote_2: { rich_text: [{ text: { content: (result.pullQuotes[1] || "").slice(0, 2000) } }] },
    pull_quote_3: { rich_text: [{ text: { content: (result.pullQuotes[2] || "").slice(0, 2000) } }] },
    pull_quote_used_count: { number: 0 },
  });
  console.log("  PATCHed Notion");

  const quotesPreview = (result.pullQuotes || [])
    .filter(Boolean)
    .map((q, i) => `${i + 1}. ${q}`)
    .join("\n");
  const msg = `🔁 *Derivatives Regenerated*

*Topic:* ${topic}

*Substack title:* ${result.substackTitle || "—"}
*Subtitle:* ${result.substackSubtitle || "—"}

---
*X Thread (preview):*
${truncate(result.xThread, 400)}

---
*LinkedIn Post (${result.linkedinCopy.length} chars):*
${truncate(result.linkedinCopy, 300)}

---
*Pull-quotes:*
${quotesPreview || "—"}

---
*Newsletter hook:*
${result.newsletterHook || "—"}

(Existing approval status unchanged.)`;

  try {
    await sendTelegram(msg);
  } catch (e) {
    console.warn(`Telegram send failed (non-fatal): ${e.message}`);
  }

  return { topic, ...result };
}

async function main() {
  const ids = process.argv.slice(2);
  if (ids.length === 0) {
    console.error("Usage: regenerate-derivatives.js <pageId> [<pageId> ...]");
    process.exit(1);
  }

  console.log(`=== Regenerating derivatives for ${ids.length} page(s) ===`);
  let ok = 0;
  let fail = 0;

  for (const id of ids) {
    try {
      await regenerateOne(id);
      ok++;
    } catch (err) {
      console.error(`FAILED ${id}: ${err.message}`);
      fail++;
    }
  }

  console.log(`\n=== Done: ${ok} ok, ${fail} failed ===`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
