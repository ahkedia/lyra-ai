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
  richTextChunks,
} from "./lib/notion.js";
import { sendTelegram, sendWhatsApp } from "./lib/telegram.js";
import { generateWithSonnet, humanizeWithHaiku, parseJsonLoose } from "./lib/anthropic.js";
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
const voiceCanonFile = readFileSync(join(__dirname, "../config/voice-canon.md"), "utf8");
const xPlatform = readFileSync(join(__dirname, "../config/x-platform.md"), "utf8");
const linkedinPlatform = readFileSync(join(__dirname, "../config/linkedin-platform.md"), "utf8");
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

## AI Symmetry Patterns (highest priority — AI detector load-bearing)
- Tidy 3x3 bullets. Three points, each two words long, all parallel.
- Too-perfect transitions: "Furthermore", "Moreover", "Additionally", "It's worth noting that"
- The windup opener: "In today's fast-paced world...", "In an era where..."
- The "Not X, but Y" cadence (ANY variant): "not X, but Y", "not X, it's Y", "not X, actually Y", "X isn't Y, it's Z", "X wasn't Y, it was Z", "it's not about X, it's about Y", dash-bound "X — not Y" or "Y, not X". This is the single most overused pattern in AI-generated content. Rewrite as two separate sentences, concession-then-pivot, or the sharper claim delivered directly. See voice-canon.md Rule 7.
- Anaphoric three-beat negation: "Not a recap. Not a question. Not a flourish." or "It's not the X. It's not the Y. It's the Z." Three-beat negation reads as template. Three-beat lists of nouns are fine ("faster, cheaper, better"). The slop is specifically negation in repeated form. Rewrite as one sentence stating the move plus one banning the alternatives, or two-beat negation.
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

  // If Topic Pool has a Domain that the Personal Wiki schema does not, the
  // filtered query throws "select option not found". Fall through to an
  // unfiltered query (any wiki page) rather than failing the whole draft.
  let res;
  try {
    res = await notionQuery(PERSONAL_WIKI_DB, filter, [{ timestamp: "last_edited_time", direction: "descending" }], limit);
  } catch (err) {
    if (filter && /select option .* not found/i.test(err.message)) {
      console.warn(`  Wiki has no "${domain}" domain option; falling back to unfiltered wiki query`);
      res = await notionQuery(PERSONAL_WIKI_DB, undefined, [{ timestamp: "last_edited_time", direction: "descending" }], limit);
    } else {
      throw err;
    }
  }

  const toEntry = (page) => ({
    title: extractTitle(page),
    domain: extractSelect(page, "Domain"),
    type: extractSelect(page, "Type"),
    pageId: page.id,
    url: page.url,
    body: "",
  });

  let mapped = res.results.map(toEntry);

  // Always include all Career pages so drafts can ground in full work history
  const seenIds = new Set(mapped.map((e) => e.pageId));
  try {
    const careerRes = await notionQuery(PERSONAL_WIKI_DB, {
      property: "Type", select: { equals: "Career" },
    }, [{ timestamp: "last_edited_time", direction: "descending" }], 10);
    for (const page of careerRes.results) {
      if (!seenIds.has(page.id)) {
        mapped.push(toEntry(page));
        seenIds.add(page.id);
      }
    }
  } catch (e) {
    console.warn(`  Failed to fetch Career pages: ${e.message}`);
  }

  if (mapped.length === 0) {
    mapped = await fetchSecondBrainEvidence(4);
  }

  if (mapped.length === 0) {
    mapped = [{
      title: "No Personal Wiki or Second Brain rows matched this run (ground in AUTHOR BRIEF and career context)",
      domain: domain || "General",
      type: "",
      pageId: "",
      url: "",
      body: "",
    }];
  }

  const CAREER_BODY_MAX_CHARS = 3000;
  for (const entry of mapped) {
    if (entry.type === "Career" && entry.pageId) {
      try {
        entry.body = await notionFetchBlockTreeAsPlainText(entry.pageId, CAREER_BODY_MAX_CHARS);
      } catch (e) {
        console.warn(`  Failed to fetch body for "${entry.title}": ${e.message}`);
      }
    }
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

  return `${extractTitle(res.results[0])}. (Voice Canon Notion page had no readable blocks; voice-canon.md from file + command center + NEGATIVE_STYLE are the active canon.)`;
}

function buildBlogPrompt(topic, domain, evidence, voiceCanon, learnings = "", authorBrief = "") {
  const evidenceText = evidence.map((e) => {
    const line = `- ${e.title} (${e.domain})`;
    if (e.body && e.body.trim()) {
      return `${line}\n  CONTENT:\n  ${e.body.trim().split("\n").join("\n  ")}`;
    }
    return line;
  }).join("\n\n");

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

  return `You are a content writer for Akash Kedia, a technical founder who built products at Flipkart (e-commerce, payments), N26 (neobanking), CheQ (credit), and Trade Republic (brokerage).

${commandCenter}

VOICE CANON (canonical, from voice-canon.md — applies to all surfaces; platform files override where noted):
${voiceCanonFile}

${contentTypes}

VOICE CANON (supplementary, from Notion Personal Wiki — may be empty if not fetched):
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
1. Ground in specific experience from Flipkart/N26/CheQ/Trade Republic when relevant.
2. Follow the voice canon above (Rules 1-11). Start with the true thing. Coin one named phrase that carries the argument. Vary sentence length aggressively.
3. Use clear section headers where appropriate (lowercase phrases, no title case).
4. Include concrete examples and specific details: company names, numbers, dates, decisions.
5. No hashtags. No CTAs. No engagement bait.
6. High conviction voice: make a claim and stick to it.
7. Close on a 4-7 word instruction (voice-canon.md Rule 8). Skip the recap. Skip the question to the reader.
8. Em-dashes: maximum 2 per blog post (voice-canon.md Rule 10). The U+2014 character and U+2013 as a fake em dash are banned.
9. All-lowercase body. First person as lowercase i. Caps only for acronyms (API, PR, YoY) and brand spellings (CheQ, Trade Republic).
10. NO "Not X, but Y" cadence in any variant (see NEGATIVE STYLE above and voice-canon.md Rule 7). NO anaphoric three-beat negation.
11. Length: 800-1,150 words. Hard cap 1,150. If you cross 1,150, the piece has two ideas in it; cut.
12. If AUTHOR BRIEF is present above, obey it over generic filler. It represents the human intent for this piece.

Output ONLY the blog text. No preamble, no explanation.`;
}

export function buildXThreadPrompt(topic, blogContent) {
  const xPlatformExcerpt = xPlatform.slice(0, 1800);
  return `Write a 5-9 tweet thread to tease this blog. Substack URL goes in the FINAL tweet only.

BLOG TOPIC: "${sanitizeInput(topic)}"

BLOG EXCERPT (first 1500 chars):
${blogContent.slice(0, 1500)}...

X PLATFORM RULES:
${xPlatformExcerpt}

THREAD STRUCTURE:
- Tweet 1 (HOOK, 200-260 chars): a counterintuitive claim, specific number, or tight story opener. NO link, NO "thread:" announcement, NO emojis. Make a smart operator stop scrolling.
- Tweets 2 to N-1 (BODY, 250-280 chars each): one idea per tweet. Specific names, numbers, scenes. Whitespace between thoughts (line breaks inside tweets are fine). No transitions like "next," "also," "furthermore."
- Final tweet (CLOSE): one-line restatement of the insight + the literal token {{SUBSTACK_URL}} where the link will be inserted at post time. Example: "wrote up the long version: {{SUBSTACK_URL}}"

HARD CONSTRAINTS:
- 5 to 9 tweets total. Pick what fits the topic; don't pad.
- The named phrase from the blog appears verbatim in at least one tweet (typically the hook or the close). This is the through-line across blog, LinkedIn, X.
- Em-dashes: ZERO. The U+2014 character and U+2013 as a substitute are banned. Commas, periods, colons, parentheses only.
- All-lowercase body. First person as i. Acronyms and brand caps (CheQ) excepted.
- No hashtags anywhere. No "🧵". No "let me break this down" or "here's the kicker."
- NO "Not X, but Y" cadence in ANY variant. NO anaphoric three-beat negation. See voice-canon.md Rule 7 and NEGATIVE_STYLE.
- Banned vocabulary: delve, crucial, robust, comprehensive, nuanced, multifaceted, pivotal, landscape, tapestry, underscore, foster, showcase, intricate, vibrant, interplay, game-changer, paradigm shift, ecosystem, synergy, seamless, unlock, mind-blowing.

OUTPUT FORMAT (strict):
Number each tweet on its own line as "TWEET N:" then a blank line, then the tweet body. Separate tweets with a blank line. No preamble, no commentary.

Example shape:
TWEET 1:
[hook tweet]

TWEET 2:
[body tweet]

...

TWEET N:
[close tweet with {{SUBSTACK_URL}}]`;
}

export function buildLinkedInCopyPrompt(topic, blogContent) {
  const repurposeExcerpt = repurpose.slice(0, 2200);
  const blogExcerpt = blogContent.slice(0, 12000);
  return `Write a LinkedIn post derived from this blog. The LinkedIn post is ONE CUT from the blog, not a compressed version of it. Pick one of three formats below, then write.

BLOG TOPIC: "${sanitizeInput(topic)}"

BLOG (full text):
${blogExcerpt}

---

VOICE CANON (universal rules; LinkedIn platform overrides where noted):
${voiceCanonFile}

---

LINKEDIN PLATFORM RULES (authoritative; overrides voice-canon.md where they conflict; read in full):
${linkedinPlatform}

---

REPURPOSE RULES (governs how the named phrase travels across surfaces):
${repurposeExcerpt}

---

FORMAT SELECTION (do this first, before writing)

Choose ONE format based on the blog's strongest beat. Do not output the label, just pick and write accordingly:

- ARGUMENT POST (150-280 words): blog stacks analytical points with evidence. Take the named claim plus 2-3 evidence beats. Numbered structure OK when the substance is genuinely list-shaped.
- APHORISM POST (40-80 words): blog's named claim is sharp enough to stand alone. One pattern statement, one supporting line, one punchy close.
- SCENE POST (120-220 words): blog opens with a personal scene that proves the point. Scene plus personal coda, skip the analytical layer.

Default to argument post if uncertain.

---

ENFORCED CONSTRAINTS (override anything ambiguous above)

1. The named phrase from the blog (the coined thing the title is about) appears verbatim in the LinkedIn post. This is the through-line that connects the blog, LinkedIn, and X versions.
2. Em-dashes: ZERO. Use commas, periods, colons, parentheses. The U+2014 character is banned.
3. Closing: personal beat, soft echo of the named phrase, practical observation, or footnoted nuance. NOT a 4-7 word imperative (that is the blog close, see voice-canon.md Rule 8). NOT a question to the reader. NOT a "full write-up in the comments" CTA — the Substack link lives in a separate first-comment field and is not the post's responsibility.
4. NO "Not X, but Y" cadence in ANY variant: "not X it's Y", "not X actually Y", "X isn't Y, it's Z", "it's not about X, it's about Y", or em-dash bound versions. Use two separate sentences, concession-then-pivot, or the sharper claim delivered directly.
5. No anaphoric three-beat negation ("Not a recap. Not a question. Not a flourish."). Two-beat negation is fine.
6. Casing: all-lowercase body. First person as lowercase "i". Caps only for acronyms (API, PR, YoY) and brand spellings (CheQ, Trade Republic).
7. Banned vocabulary: delve, crucial, robust, comprehensive, nuanced, multifaceted, pivotal, landscape, tapestry, underscore, foster, showcase, intricate, vibrant, interplay, game-changer, paradigm shift, ecosystem, synergy, seamless, unlock, mind-blowing, "let that sink in".
8. Hard cap: 280 words. Three or fewer hashtags. No URL in the post body.
9. Preserve idiosyncrasy: sentences that start with "And" or "But", parenthetical asides, a colon doing emphasis work. Do not smooth these out.

---

LITMUS TEST (must pass)

If someone follows Akash on both X and LinkedIn, would seeing both feel redundant? If yes, you reformatted instead of rethought. Pick a different beat of the blog and try again.

---

Output ONLY the LinkedIn post text. No preamble. No format label. No explanation.`;
}

export function buildPullQuotesPrompt(topic, blogContent) {
  return `Extract 3 standalone pull-quotes from this blog. Each quote will later be posted as its own native LinkedIn or X post (no link, no context), so each must land on its own.

BLOG TOPIC: "${sanitizeInput(topic)}"

BLOG (full text):
${blogContent}

CRITERIA FOR EACH QUOTE:
- Self-contained: a stranger who has not read the blog must still get value from it.
- Specific: includes a number, name, scene, or claim. No generic "always start with the user" lines.
- Punchy: 180-260 characters each. Short enough to be a tweet, long enough to be substantive.
- Distinct from each other: cover three different angles of the blog, not three rephrasings of the same idea.
- Voice-aligned: all-lowercase, no em dash, no hashtags, no "thread:" or "🧵".
- ABSOLUTELY NO "Not X, but Y" cadence in any variant ("not X it's Y", "not X actually Y", "X isn't Y, it's Z", "is not X. it's Y", em-dash bound versions). If a sharp pull-quote naturally wants this cadence, rewrite as two separate sentences or a concession-then-pivot. The cadence is the single biggest AI tell in pull quotes.
- NO anaphoric three-beat negation ("Not a recap. Not a question. Not a flourish.").
- Each pull quote should preserve idiosyncrasy: a parenthetical aside, a sentence that starts with "And" or "But", a colon doing emphasis work. Pull quotes that read perfectly smooth read as AI.

OUTPUT FORMAT (strict JSON, no preamble):
{"quotes": ["quote one", "quote two", "quote three"]}`;
}

export function buildSubstackHeadlinePrompt(topic, blogContent) {
  return `Write a Substack title and subtitle for this blog. Substack uses two fields and the subtitle drives ~30% of click-through.

BLOG TOPIC: "${sanitizeInput(topic)}"

BLOG EXCERPT (first 800 chars):
${blogContent.slice(0, 800)}...

REQUIREMENTS:
- Title: 40-70 characters. The hook. Specific noun or counterintuitive claim. NOT a question. NOT clickbait.
- Subtitle: 80-140 characters. The specific promise of what the reader will get. Concrete.
- Lowercase. No em dash. No "how to" / "X things" listicle openers.

OUTPUT FORMAT (strict JSON, no preamble):
{"title": "...", "subtitle": "..."}`;
}

export function buildNewsletterHookPrompt(topic, blogContent) {
  return `Write a single-sentence preamble that goes at the top of the LinkedIn newsletter version of this blog (subscribers see this in their notification + email).

BLOG TOPIC: "${sanitizeInput(topic)}"

BLOG EXCERPT (first 600 chars):
${blogContent.slice(0, 600)}...

REQUIREMENTS:
- One sentence. 80-160 characters.
- Sets up why this post exists right now (a specific moment, decision, or trigger), not a generic teaser.
- Lowercase. No em dash. No "in this article we'll cover."

Output ONLY the sentence. No preamble, no quotation marks.`;
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

  const parsed = parseJsonLoose(haikuResponse);
  if (parsed) {
    score = parsed.score;
    humanizedBlog = parsed.humanized || rawBlog;
    fails = parsed.fails || [];
  } else {
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

  // Step 3: X thread + LinkedIn post from final blog body
  const xThreadPrompt = buildXThreadPrompt(topic, humanizedBlog);
  const xThread = await generateWithSonnet(
    "You are Akash, writing an X thread that teases a blog you just published. You follow voice-canon.md (no 'Not X, but Y' cadence in any variant, no anaphoric triple negation, em-dashes banned). Output only the numbered tweet thread, no preamble.",
    xThreadPrompt,
    1800
  );
  console.log(`  X thread generated: ${xThread.length} chars`);

  const linkedinPrompt = buildLinkedInCopyPrompt(topic, humanizedBlog);
  const linkedinCopy = await generateWithSonnet(
    "You are Akash, writing a LinkedIn post adapted from a blog you just published. You follow voice-canon.md (no 'Not X, but Y' cadence, no anaphoric triple negation, em-dashes banned). Output only the LinkedIn post text, nothing else.",
    linkedinPrompt,
    1200
  );
  console.log(`  LinkedIn copy generated: ${linkedinCopy.length} chars`);

  // Step 4: Pull-quotes (3 standalone quotes for Wed/Fri amplification)
  let pullQuotes = ["", "", ""];
  try {
    const quotesRaw = await generateWithSonnet(
      "You are a content editor. Return only valid JSON.",
      buildPullQuotesPrompt(topic, humanizedBlog),
      900
    );
    const parsed = parseJsonLoose(quotesRaw) || {};
    if (Array.isArray(parsed.quotes)) {
      pullQuotes = [
        parsed.quotes[0] || "",
        parsed.quotes[1] || "",
        parsed.quotes[2] || "",
      ];
    }
    console.log(`  Pull-quotes generated: ${pullQuotes.filter(Boolean).length}/3`);
  } catch (e) {
    console.warn(`  Pull-quote generation failed: ${e.message}`);
  }

  // Step 5: Substack title + subtitle
  let substackTitle = topic;
  let substackSubtitle = "";
  try {
    const headlineRaw = await generateWithSonnet(
      "You are a headline editor. Return only valid JSON.",
      buildSubstackHeadlinePrompt(topic, humanizedBlog),
      400
    );
    const parsed = parseJsonLoose(headlineRaw) || {};
    if (parsed.title) substackTitle = parsed.title;
    if (parsed.subtitle) substackSubtitle = parsed.subtitle;
    console.log(`  Substack headline generated`);
  } catch (e) {
    console.warn(`  Substack headline generation failed: ${e.message}`);
  }

  // Step 6: LinkedIn newsletter hook (1-line preamble)
  let newsletterHook = "";
  try {
    newsletterHook = await generateWithSonnet(
      "You are a newsletter editor. Output only the single sentence.",
      buildNewsletterHookPrompt(topic, humanizedBlog),
      200
    );
    newsletterHook = newsletterHook.trim().replace(/^["']|["']$/g, "");
    console.log(`  Newsletter hook generated: ${newsletterHook.length} chars`);
  } catch (e) {
    console.warn(`  Newsletter hook generation failed: ${e.message}`);
  }

  return {
    blog: humanizedBlog,
    xThread,
    linkedinCopy,
    pullQuotes,
    substackTitle,
    substackSubtitle,
    newsletterHook,
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

  const linkedinFirstComment = "wrote up the long version → {{SUBSTACK_URL}}";
  const properties = {
    Draft: { title: [{ text: { content: topic.slice(0, 100) } }] },
    Domain: { select: { name: domain } },
    blog_content: { rich_text: [{ text: { content: blogPropText } }] },
    x_thread: { rich_text: richTextChunks(result.xThread) },
    linkedin_copy: { rich_text: [{ text: { content: result.linkedinCopy.slice(0, 2000) } }] },
    linkedin_first_comment: { rich_text: [{ text: { content: linkedinFirstComment } }] },
    linkedin_newsletter_hook: { rich_text: [{ text: { content: (result.newsletterHook || "").slice(0, 2000) } }] },
    substack_title: { rich_text: [{ text: { content: (result.substackTitle || "").slice(0, 2000) } }] },
    substack_subtitle: { rich_text: [{ text: { content: (result.substackSubtitle || "").slice(0, 2000) } }] },
    pull_quote_1: { rich_text: [{ text: { content: (result.pullQuotes?.[0] || "").slice(0, 2000) } }] },
    pull_quote_2: { rich_text: [{ text: { content: (result.pullQuotes?.[1] || "").slice(0, 2000) } }] },
    pull_quote_3: { rich_text: [{ text: { content: (result.pullQuotes?.[2] || "").slice(0, 2000) } }] },
    pull_quote_used_count: { number: 0 },
    Content: { rich_text: [{ text: { content: blogPropText } }] },
    humanization_score: { number: result.score },
    text_approval_status: { select: { name: "pending" } },
    visual_approval_status: { select: { name: "pending" } },
    Notes: { rich_text: [{ text: { content: notesText } }] },
    draft_expires_at: { date: { start: expiresAt.toISOString().split("T")[0] } },
    Channel: { multi_select: [{ name: "X" }, { name: "LinkedIn" }, { name: "Substack" }] },
  };

  const page = await notionCreatePage(
    { type: "database_id", database_id: CONTENT_DRAFTS_DB },
    properties
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
      
      const blogPreview = truncate(result.blog, 350);
      const xThreadPreview = truncate(result.xThread, 400);
      const linkedinPreview = truncate(result.linkedinCopy, 300);
      const quotesPreview = (result.pullQuotes || [])
        .filter(Boolean)
        .map((q, i) => `${i + 1}. ${q}`)
        .join("\n");
      const msg = `📝 *New Blog Draft*

*Topic:* ${topic}
*Score:* ${result.score || "N/A"}/10

*Substack title:* ${result.substackTitle || "—"}
*Subtitle:* ${result.substackSubtitle || "—"}

*Blog Preview:*
${blogPreview}

---
*X Thread (preview):*
${xThreadPreview}

---
*LinkedIn Post (${result.linkedinCopy.length} chars):*
${linkedinPreview}

---
*Pull-quotes (Wed/Fri amplification):*
${quotesPreview || "—"}

Reply APPROVE or SKIP`;
      
      await Promise.all([sendTelegram(msg), sendWhatsApp(msg)]);
      processed++;
      
      await sleep(1000);
    } catch (err) {
      console.error(`Failed to process "${topic}": ${err.message}`);
      
      try {
        await markTopicShortlisted(topicPage.id);
        await Promise.all([sendTelegram(`⚠️ Draft generation failed for "${topic}": ${err.message}`), sendWhatsApp(`⚠️ Draft generation failed for "${topic}": ${err.message}`)]);
      } catch {}
    }
  }
  
  console.log(`\n=== Draft Generator complete: ${processed} drafts created ===`);
}

/**
 * Generate the 5 derivative outputs (x_thread, linkedin_copy, pull_quotes,
 * substack title/subtitle, newsletter hook) from an already-written blog.
 *
 * Reused by regenerate-derivatives.js for one-off refreshes.
 */
export async function generateDerivativesFromBlog(topic, blog) {
  const xThread = await generateWithSonnet(
    "You are Akash, writing an X thread that teases a blog you just published. You follow voice-canon.md (no 'Not X, but Y' cadence in any variant, no anaphoric triple negation, em-dashes banned). Output only the numbered tweet thread, no preamble.",
    buildXThreadPrompt(topic, blog),
    1800
  );

  const linkedinCopy = await generateWithSonnet(
    "You are Akash, writing a LinkedIn post adapted from a blog you just published. You follow voice-canon.md (no 'Not X, but Y' cadence, no anaphoric triple negation, em-dashes banned). Output only the LinkedIn post text, nothing else.",
    buildLinkedInCopyPrompt(topic, blog),
    1200
  );

  let pullQuotes = ["", "", ""];
  try {
    const quotesRaw = await generateWithSonnet(
      "You are a content editor. Return only valid JSON.",
      buildPullQuotesPrompt(topic, blog),
      900
    );
    const parsed = parseJsonLoose(quotesRaw) || {};
    if (Array.isArray(parsed.quotes)) {
      pullQuotes = [
        parsed.quotes[0] || "",
        parsed.quotes[1] || "",
        parsed.quotes[2] || "",
      ];
    }
  } catch (e) {
    console.warn(`Pull-quote generation failed: ${e.message}`);
  }

  let substackTitle = topic;
  let substackSubtitle = "";
  try {
    const headlineRaw = await generateWithSonnet(
      "You are a headline editor. Return only valid JSON.",
      buildSubstackHeadlinePrompt(topic, blog),
      400
    );
    const parsed = parseJsonLoose(headlineRaw) || {};
    if (parsed.title) substackTitle = parsed.title;
    if (parsed.subtitle) substackSubtitle = parsed.subtitle;
  } catch (e) {
    console.warn(`Substack headline generation failed: ${e.message}`);
  }

  let newsletterHook = "";
  try {
    newsletterHook = await generateWithSonnet(
      "You are a newsletter editor. Output only the single sentence.",
      buildNewsletterHookPrompt(topic, blog),
      200
    );
    newsletterHook = newsletterHook.trim().replace(/^["']|["']$/g, "");
  } catch (e) {
    console.warn(`Newsletter hook generation failed: ${e.message}`);
  }

  return {
    xThread,
    linkedinCopy,
    pullQuotes,
    substackTitle,
    substackSubtitle,
    newsletterHook,
  };
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
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
}
