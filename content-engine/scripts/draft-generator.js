#!/usr/bin/env node
/**
 * Draft Generator: Step 3 of Content Pipeline
 *
 * For each Shortlisted topic in Topic Pool:
 * 1. Fetch wiki evidence (top 5 pages for domain)
 * 2. Fetch Voice Canon from wiki
 * 3. Generate draft via Sonnet (wiki + voice + negative style)
 * 4. Humanize via Haiku (10-point checklist)
 * 5. Write to Content Drafts DB
 * 6. Send Telegram preview for text approval
 *
 * Cron: Hourly 09:00-22:00 (Akash shortlists any time)
 * Lockfile: /tmp/content-draft-generator-script.lock
 * Max per run: 3 topics
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import {
  notionQueryAll,
  notionQuery,
  notionPatch,
  notionCreatePage,
  extractTitle,
  extractSelect,
  extractRichText,
  extractNumber,
  blogPlainTextToParagraphBlocks,
  notionAppendChildrenBatched,
  notionFetchBlockTreeAsPlainText,
} from "./lib/notion.js";
import { sendTelegram } from "./lib/telegram.js";
import { generateWithSonnet, humanizeWithHaiku } from "./lib/anthropic.js";
import { sanitizeInput, truncate } from "./lib/sanitize.js";
import { acquireLock, releaseLock } from "./lib/lockfile.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCKFILE = "/tmp/content-draft-generator-script.lock";
const LEARNINGS_FILE = join(__dirname, "../config/learnings.json");
const MAX_TOPICS_PER_RUN = 3;

const sources = JSON.parse(readFileSync(join(__dirname, "../config/sources.json"), "utf8"));
const topicToDomain = JSON.parse(readFileSync(join(__dirname, "../config/topic-to-domain.json"), "utf8"));

function getLearnings() {
  if (existsSync(LEARNINGS_FILE)) {
    try {
      return JSON.parse(readFileSync(LEARNINGS_FILE, "utf8"));
    } catch {
      return { feedbackHistory: [], cumulativeLearnings: "" };
    }
  }
  return { feedbackHistory: [], cumulativeLearnings: "" };
}

const TOPIC_POOL_DB = sources.topicPool.dbId;
const PERSONAL_WIKI_DB = sources.sources.personalWiki.dbId;
const CONTENT_DRAFTS_DB = "8135676dd15c4ef4925336cf484567ac";

const commandCenter = readFileSync(join(__dirname, "../config/command-center.md"), "utf8");
const openingPrinciples = readFileSync(join(__dirname, "../config/opening-principles.md"), "utf8");
const xPlatform = readFileSync(join(__dirname, "../config/x-platform.md"), "utf8");
const contentTypes = readFileSync(join(__dirname, "../config/content-types.md"), "utf8");
const repurpose = readFileSync(join(__dirname, "../config/repurpose.md"), "utf8");

const VOICE_CANON_MAX_CHARS = 7000;
const SONNET_REWRITE_SCORE_THRESHOLD = 8;

const NEGATIVE_STYLE = `
# Negative Style: What Not To Sound Like

## Punctuation (hard ban)
- Never use the em dash character (Unicode U+2014). Readers associate it with generic AI prose. Use commas, periods, colons, or parentheses instead.
- Do not use an en dash (Unicode U+2013) as a stand-in for an em dash. Hyphens in compound words are fine.

## Casing (hard default)
- All-lowercase body: blog, tweet, and LinkedIn output. No title case headings, no ALL CAPS emphasis, no LinkedIn-style Title Case sentences.
- First person as lowercase i. Allow minimal caps only where required for clarity: acronyms (API, PR, YoY), and non-negotiable brand spellings (CheQ, Trade Republic as two words still lowercase except proper brand cap in CheQ).

## AI Symmetry Patterns (highest priority)
- Tidy 3x3 bullets. Three points, each two words long, all parallel.
- Too-perfect transitions: "Furthermore", "Moreover", "Additionally", "It's worth noting that"
- The windup opener: "In today's fast-paced world...", "In an era where..."
- The rhetorical pair: "Not just X, but Y."
- The symmetrical close: "The future belongs to those who..."

## Words to Kill on Sight
delve, crucial, robust, comprehensive, nuanced, multifaceted, pivotal, landscape, tapestry, underscore, foster, showcase, intricate, vibrant, interplay, game-changer, paradigm shift, ecosystem, synergy, seamless, unlock, mind-blowing, "let that sink in"

## Voice Anti-Patterns
- Over-qualifying ("I think", "in my experience", "IMHO")
- Hedging both sides without committing
- False humility ("I'm no expert but...")
- Motivational poster tone
- Faux-casual that's corporate

## Core Test
Would a sharp operator who's been in the trenches actually say this? Or does it sound like someone performing competence?
`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function mapTopicToDomain(topic) {
  const lower = topic.toLowerCase();
  for (const mapping of topicToDomain.mappings) {
    for (const kw of mapping.keywords) {
      if (lower.includes(kw)) return mapping.domain;
    }
  }
  return "General";
}

async function getShortlistedTopics() {
  const res = await notionQuery(TOPIC_POOL_DB, {
    property: "Status",
    select: { equals: "Shortlisted" },
  }, [{ property: "Score", direction: "descending" }], MAX_TOPICS_PER_RUN);
  
  return res.results;
}

async function markTopicInProgress(pageId) {
  await notionPatch(pageId, {
    Status: { select: { name: "InProgress" } },
  });
}

async function markTopicDone(pageId) {
  await notionPatch(pageId, {
    Status: { select: { name: "Done" } },
  });
}

async function markTopicShortlisted(pageId) {
  await notionPatch(pageId, {
    Status: { select: { name: "Shortlisted" } },
  });
}

async function fetchSecondBrainEvidence(limit = 3) {
  const cfg = sources.sources.secondBrain;
  if (!cfg?.dbId) return [];
  const sort = cfg.sortBy
    ? [{ timestamp: cfg.sortBy.timestamp, direction: cfg.sortBy.direction }]
    : [{ timestamp: "created_time", direction: "descending" }];
  const res = await notionQuery(cfg.dbId, cfg.filter ?? undefined, sort, limit);
  return res.results.map((page) => ({
    title: extractTitle(page, cfg.titleProp || "Name"),
    domain: "General",
    url: page.url,
  }));
}

async function fetchWikiEvidence(domain, limit = 5) {
  const filter = domain && domain !== "General"
    ? { property: "Domain", select: { equals: domain } }
    : undefined;

  const res = await notionQuery(PERSONAL_WIKI_DB, filter, [{ timestamp: "last_edited_time", direction: "descending" }], limit);

  let mapped = res.results.map((page) => ({
    title: extractTitle(page),
    domain: extractSelect(page, "Domain"),
    url: page.url,
  }));

  if (mapped.length === 0) {
    mapped = await fetchSecondBrainEvidence(4);
  }

  if (mapped.length === 0) {
    mapped = [{
      title: "No Personal Wiki or Second Brain rows matched this run (ground in AUTHOR BRIEF and career context)",
      domain: domain || "General",
      url: "",
    }];
  }

  return mapped;
}

async function fetchVoiceCanon() {
  const res = await notionQuery(PERSONAL_WIKI_DB, {
    property: "Type", select: { equals: "Voice Canon" },
  }, undefined, 1);

  if (res.results.length === 0) {
    return "High conviction, all-lowercase body copy by default (see command-center Global style), intelligent but not academic, concrete details from experience.";
  }

  const pageId = res.results[0].id;
  try {
    const body = await notionFetchBlockTreeAsPlainText(pageId, VOICE_CANON_MAX_CHARS);
    if (body.trim()) {
      return body;
    }
  } catch (e) {
    console.warn(`Voice Canon block fetch failed: ${e.message}`);
  }

  return `${extractTitle(res.results[0])}. (Voice Canon page had no readable blocks; use opening principles + command center + NEGATIVE_STYLE.)`;
}

function buildBlogPrompt(topic, domain, evidence, voiceCanon, learnings = "", authorBrief = "") {
  const evidenceText = evidence.map((e) => `- ${e.title} (${e.domain})`).join("\n");

  let learningsSection = "";
  if (learnings && learnings.trim()) {
    learningsSection = `
IMPORTANT: FEEDBACK FROM PREVIOUS DRAFTS:
${learnings}

Apply this feedback to this draft. These are specific corrections I've requested.
`;
  }

  const authorSection = authorBrief.trim()
    ? `AUTHOR BRIEF (from Topic Pool; binding context for angle, stats, bans, links, and emphasis):\n${sanitizeInput(authorBrief)}\n\n`
    : "";

  return `You are a content writer for Akash Kedia, a technical founder who built products at CheQ (credit), Flipkart Pay (payments), and Trade Republic (brokerage).

${commandCenter}

${openingPrinciples}

${contentTypes}

VOICE CANON (full text from Notion):
${voiceCanon}
${authorSection}${learningsSection}
NEGATIVE STYLE (DO NOT USE):
${NEGATIVE_STYLE}

WIKI EVIDENCE FOR GROUNDING:
${evidenceText}

TASK:
Write a blog article (800-1500 words) about: "${sanitizeInput(topic)}"
Domain: ${domain}

This blog will be published on X/Twitter Articles and shared on LinkedIn.

Requirements:
1. Ground in specific experience from CheQ/Flipkart Pay/Trade Republic when relevant
2. Follow opening principles (start with the true thing, not the smart-sounding thing)
3. Use clear section headers where appropriate (lowercase phrases, not title case)
4. Include concrete examples and specific details
5. No hashtags, no CTAs, no engagement bait
6. High conviction voice: make a claim and stick to it
7. End with a clear takeaway, not a rhetorical question
8. Never use the em dash character (U+2014). No en dash as a fake em dash. Use commas, periods, colons, or parentheses.
9. All-lowercase body: no title case headings, no ALL CAPS, first person as i. Minimal caps only for acronyms or fixed brand spellings (e.g. CheQ).
10. If AUTHOR BRIEF is present above, obey it over generic filler. It represents the human intent for this piece.

Output ONLY the blog text. No preamble, no explanation.`;
}

function buildTweetCopyPrompt(topic, blogContent) {
  return `Write a single tweet (max 280 characters) to share this blog post.

BLOG TOPIC: "${sanitizeInput(topic)}"

BLOG EXCERPT (first 500 chars):
${blogContent.slice(0, 500)}...

Requirements:
1. Hook the reader with the key insight
2. Don't summarize the whole post; tease it
3. No hashtags, no "check out my blog" CTAs
4. High conviction, not clickbait
5. Should work standalone but make them want to read more
6. Never use the em dash character (U+2014). Use commas, periods, or colons.
7. All-lowercase except unavoidable acronyms (e.g. PR, YoY). First person as i.

Output ONLY the tweet text. No preamble.`;
}

function buildLinkedInCopyPrompt(topic, blogContent) {
  const repurposeExcerpt = repurpose.slice(0, 2200);
  return `Write a LinkedIn post to accompany this blog (same thesis, different packaging than X).

BLOG TOPIC: "${sanitizeInput(topic)}"

BLOG EXCERPT (first 1200 chars):
${blogContent.slice(0, 1200)}...

REPURPOSING RULES (obey the LinkedIn section and litmus test):
${repurposeExcerpt}

Requirements:
1. Start with a strong opening line (not "I wrote a blog about...")
2. Give real context and 2-4 insights; first-person narrative layer is OK
3. Professional but not corporate; match Akash's voice and Voice Canon habits
4. No hashtag spam (max 3 if any). No "link in comments" CTAs
5. End with a concrete thought (not engagement bait; a real observation is enough)
6. Never use the em dash character (U+2014). Use commas, periods, colons, or parentheses.
7. All-lowercase: no LinkedIn title case, no shouty caps, first person as i. Minimal caps for acronyms or brand spellings only.
8. Length target: 1000-2000 characters. This must feel like a standalone LinkedIn post, not a reformatted tweet.
9. Litmus: if someone read your X version of this topic, this post must still feel non-redundant (different scene, angle, or implication).

Output ONLY the LinkedIn post text. No preamble.`;
}

function buildVisualCaptionPrompt(topic, blogContent) {
  return `You are a visual concept writer. Create a short, punchy caption for an editorial cartoon illustration that accompanies this piece.

BLOG TOPIC: "${sanitizeInput(topic)}"

BLOG SUMMARY:
${blogContent.slice(0, 800)}...

GUIDELINES:
- Caption should be 8-15 words max
- Must be relatable and specific to the content (not generic)
- Should complement the blog's core thesis or hook
- No hashtags, no jargon, no explanation
- Output ONLY the caption text. No quotes around it, no preamble.
`;
}

async function sonnetVoiceRewrite(draftText, topic, domain, voiceCanon, authorBrief = "") {
  const briefSection = authorBrief.trim()
    ? `\nAUTHOR BRIEF (do not contradict; keep claims aligned):\n${sanitizeInput(authorBrief)}\n`
    : "";
  const voiceSlice = voiceCanon.slice(0, 4500);
  const systemPrompt =
    "You are a senior editor. Output only the revised full blog body text. No preamble or markdown fences.";
  const userPrompt = `Rewrite this blog draft for voice and polish only. Same thesis and approximate length (800-1500 words). Do not add new factual claims.

TOPIC: "${sanitizeInput(topic)}"
DOMAIN: ${domain}

VOICE CANON (follow strictly):
${voiceSlice}
${briefSection}
NEGATIVE STYLE (hard constraints):
${NEGATIVE_STYLE}

RULES:
- Preserve structure, examples, and factual claims unless a sentence is clearly broken. Tighten wording, rhythm, and conviction.
- All-lowercase body default; no em dash (U+2014); no en dash as fake em dash.
- Output ONLY the full revised blog. No title line like "here is the draft".

DRAFT:
${draftText}`;
  return generateWithSonnet(systemPrompt, userPrompt, 8000);
}

function buildHaikuPrompt(draft) {
  return `You are a style editor. Humanize this draft and score it 0-10 on the checklist.

DRAFT:
${draft}

CHECKLIST:
1. Lowercase feels natural (1 pt)
2. Sentence rhythm is uneven (1 pt)
3. No AI symmetry patterns (1 pt)
4. At least one informal/incomplete structure (1 pt)
5. No filler opener (1 pt)
6. No CTA or engagement-bait closer (1 pt)
7. At least one concrete specific detail (1 pt)
8. High-conviction voice, not hedgy (1 pt)
9. No em dash (U+2014) and no en dash used as a stand-in; commas, periods, colons, or parentheses instead (1 pt)
10. All-lowercase default respected; no title case headings or ALL CAPS emphasis (1 pt)

OUTPUT FORMAT (JSON only):
{"score": N, "fails": ["item1", "item2"], "humanized": "the improved draft text"}`;
}

async function generateDraft(topic, domain, authorBrief = "") {
  const evidence = await fetchWikiEvidence(domain);
  if (evidence.length === 0) {
    throw new Error(`No wiki evidence found for domain: ${domain}`);
  }

  const voiceCanon = await fetchVoiceCanon();

  // Load learnings from previous feedback
  const learnings = getLearnings();
  const learningsText = learnings.cumulativeLearnings || "";
  if (learningsText) {
    console.log(`  Incorporating ${learnings.feedbackHistory.length} learnings`);
  }

  // Step 1: Generate blog content
  const blogPrompt = buildBlogPrompt(topic, domain, evidence, voiceCanon, learningsText, authorBrief);
  const systemPrompt = "You are a content writer. Output only the draft text, no explanation.";
  const rawBlog = await generateWithSonnet(systemPrompt, blogPrompt, 4000);
  console.log(`  Blog generated: ${rawBlog.length} chars`);

  // Step 2: Humanize the blog
  const haikuSystem = "You are a style editor. Return only valid JSON.";
  const haikuResponse = await humanizeWithHaiku(haikuSystem, buildHaikuPrompt(rawBlog), 4500);

  let score = null;
  let humanizedBlog = rawBlog;
  let fails = [];

  try {
    const parsed = JSON.parse(haikuResponse);
    score = parsed.score;
    humanizedBlog = parsed.humanized || rawBlog;
    fails = parsed.fails || [];
  } catch {
    console.log("  Haiku response not JSON, using raw blog");
  }

  if (score !== null && score < SONNET_REWRITE_SCORE_THRESHOLD) {
    console.log(`  Haiku score ${score} < ${SONNET_REWRITE_SCORE_THRESHOLD}: Sonnet voice rewrite`);
    try {
      humanizedBlog = await sonnetVoiceRewrite(humanizedBlog, topic, domain, voiceCanon, authorBrief);
      console.log(`  After Sonnet rewrite: ${humanizedBlog.length} chars`);
    } catch (e) {
      console.warn(`  Sonnet rewrite failed: ${e.message}`);
    }
  }

  // Step 3: Tweet + LinkedIn from final blog body
  const tweetPrompt = buildTweetCopyPrompt(topic, humanizedBlog);
  const tweetCopy = await generateWithSonnet(
    "You are a social media writer. Output only the tweet text.",
    tweetPrompt,
    300
  );
  console.log(`  Tweet copy generated: ${tweetCopy.length} chars`);

  const linkedinPrompt = buildLinkedInCopyPrompt(topic, humanizedBlog);
  const linkedinCopy = await generateWithSonnet(
    "You are a social media writer. Output only the LinkedIn post text.",
    linkedinPrompt,
    2800
  );
  console.log(`  LinkedIn copy generated: ${linkedinCopy.length} chars`);

  // Step 4: Visual caption for image generation pipeline
  const visualCaptionPrompt = buildVisualCaptionPrompt(topic, humanizedBlog);
  const visualCaption = await generateWithSonnet(
    "You are a visual concept writer. Output only the caption, no explanation.",
    visualCaptionPrompt,
    200
  );
  console.log(`  Visual caption generated: ${visualCaption.length} chars`);

  return {
    blog: humanizedBlog,
    tweetCopy,
    linkedinCopy,
    visualCaption,
    score,
    fails,
    evidence: evidence.map((e) => e.title).join(", "),
  };
}

const BLOG_PROP_PREVIEW = 2000;
const BLOG_TRUNC_SUFFIX = "\n…(full blog in page body)";

function notionBlogPreviewProperty(fullBlog) {
  if (fullBlog.length <= BLOG_PROP_PREVIEW) return fullBlog;
  const headLen = BLOG_PROP_PREVIEW - BLOG_TRUNC_SUFFIX.length;
  return fullBlog.slice(0, Math.max(0, headLen)) + BLOG_TRUNC_SUFFIX;
}

async function writeToDraftsDB(topic, domain, result, authorBrief = "") {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  const blogPropText = notionBlogPreviewProperty(result.blog);

  const noteParts = [`Evidence: ${result.evidence.slice(0, 400)}`];
  if (authorBrief.trim()) {
    noteParts.push(`Author brief: ${authorBrief.slice(0, 700)}`);
  }
  const notesText = noteParts.join("\n\n").slice(0, 2000);

  const page = await notionCreatePage(
    { type: "database_id", database_id: CONTENT_DRAFTS_DB },
    {
      Draft: { title: [{ text: { content: topic.slice(0, 100) } }] },
      Domain: { select: { name: domain } },
      blog_content: { rich_text: [{ text: { content: blogPropText } }] },
      tweet_copy: { rich_text: [{ text: { content: result.tweetCopy.slice(0, 2000) } }] },
      linkedin_copy: { rich_text: [{ text: { content: result.linkedinCopy.slice(0, 2000) } }] },
      visual_caption: { rich_text: [{ text: { content: result.visualCaption.slice(0, 500) } }] },
      Content: { rich_text: [{ text: { content: blogPropText } }] },
      humanization_score: { number: result.score },
      text_approval_status: { select: { name: "pending" } },
      visual_approval_status: { select: { name: "pending" } },
      Notes: { rich_text: [{ text: { content: notesText } }] },
      draft_expires_at: { date: { start: expiresAt.toISOString().split("T")[0] } },
      Channel: { multi_select: [{ name: "X" }, { name: "LinkedIn" }] },
    }
  );
  
  const bodyBlocks = blogPlainTextToParagraphBlocks(result.blog);
  if (bodyBlocks.length > 0) {
    const header = [
      { type: "divider", divider: {} },
      {
        type: "heading_2",
        heading_2: {
          rich_text: [
            {
              type: "text",
              text: { content: "Full blog (for X Articles / copy edit)" },
            },
          ],
        },
      },
    ];
    await notionAppendChildrenBatched(page.id, [...header, ...bodyBlocks]);
  }
  
  return page.id;
}

async function main() {
  console.log("=== Draft Generator starting ===");
  console.log(`Time: ${new Date().toISOString()}`);
  
  const topics = await getShortlistedTopics();
  console.log(`Found ${topics.length} shortlisted topics`);
  
  if (topics.length === 0) {
    console.log("No shortlisted topics, exiting");
    return;
  }
  
  let processed = 0;
  
  for (const topicPage of topics.slice(0, MAX_TOPICS_PER_RUN)) {
    const topic = extractTitle(topicPage);
    const domain = extractSelect(topicPage, "Domain") || mapTopicToDomain(topic);
    const authorBrief = extractRichText(topicPage, "Author brief");

    console.log(`\nProcessing: "${topic}" (${domain})`);

    try {
      await markTopicInProgress(topicPage.id);

      const result = await generateDraft(topic, domain, authorBrief);
      console.log(`Generated blog (score: ${result.score})`);

      if (result.score !== null && result.score < 5) {
        console.log(`Score too low (${result.score}), marking back to Shortlisted for retry`);
        await markTopicShortlisted(topicPage.id);
        continue;
      }

      const draftId = await writeToDraftsDB(topic, domain, result, authorBrief);
      console.log(`Written to Content Drafts: ${draftId}`);
      
      await markTopicDone(topicPage.id);
      
      const blogPreview = truncate(result.blog, 400);
      const msg = `📝 *New Blog Draft*

*Topic:* ${topic}
*Score:* ${result.score || "N/A"}/10

*Blog Preview:*
${blogPreview}

---
*Tweet Copy:*
${result.tweetCopy}

---
*LinkedIn Copy:*
${truncate(result.linkedinCopy, 300)}

Reply APPROVE or SKIP`;
      
      await sendTelegram(msg);
      processed++;
      
      await sleep(1000);
    } catch (err) {
      console.error(`Failed to process "${topic}": ${err.message}`);
      
      try {
        await markTopicShortlisted(topicPage.id);
        await sendTelegram(`⚠️ Draft generation failed for "${topic}": ${err.message}`);
      } catch {}
    }
  }
  
  console.log(`\n=== Draft Generator complete: ${processed} drafts created ===`);
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
