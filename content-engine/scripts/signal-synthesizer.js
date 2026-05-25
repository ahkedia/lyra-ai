#!/usr/bin/env node
/**
 * Signal Synthesizer — Step 2 of Signal Synthesizer Pipeline
 *
 * Reads today's News Inbox articles (Action=Inbox),
 * groups by domain, finds cross-domain thematic connections via Claude Sonnet,
 * writes the best insight as a pending draft to Content Drafts DB,
 * and sends a Telegram notification for approval.
 *
 * Approval flow: reply APPROVE (content pipeline approval-bot picks it up every 5 min)
 *                reply SKIP to discard
 *
 * Cron: 07:00 UTC daily (after news-collector at 06:30 UTC)
 * Lockfile: /tmp/signal-synthesizer.lock
 * Dry-run: pass --dry-run to skip writes and Telegram
 *
 * Exits silently (no error) when:
 *  - Fewer than 2 domains have articles
 *  - Claude returns no valid insight
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import {
  notionQueryAll,
  notionQuery,
  notionCreatePage,
  notionPatch,
  notionFetchBlockTreeAsPlainText,
  extractTitle,
  extractSelect,
  extractText,
  extractUrl,
  extractDate,
} from "./lib/notion.js";
import { generateWithSonnet } from "./lib/anthropic.js";
import { sendTelegram } from "./lib/telegram.js";
import { acquireLock, releaseLock } from "./lib/lockfile.js";
import { parseJsonLoose } from "./lib/anthropic.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCKFILE = "/tmp/signal-synthesizer.lock";
const DRY_RUN = process.argv.includes("--dry-run");

const config = JSON.parse(readFileSync(join(__dirname, "../config/news-sources.json"), "utf8"));
const sources = JSON.parse(readFileSync(join(__dirname, "../config/sources.json"), "utf8"));
const voiceCanonFile = readFileSync(join(__dirname, "../config/voice-canon.md"), "utf8");

const NEWS_INBOX_DB = config.notionInboxDb;
const CONTENT_DRAFTS_DB = config.contentDraftsDb;
const PERSONAL_WIKI_DB = sources.sources.personalWiki.dbId;
const VOICE_CANON_MAX_CHARS = 4000;

// ─── Negative style contract ──────────────────────────────────────────────────

const NEGATIVE_STYLE = `
# Negative Style: What Not To Sound Like

## Punctuation (hard ban)
- ABSOLUTE BAN: Never use the em dash character (—, Unicode U+2014). Use a comma, colon, period, or parentheses instead.
- ABSOLUTE BAN: Never use an en dash (–) as a stand-in for an em dash.

## Casing
- All-lowercase body. Allow caps only for acronyms (API, IPO) and brand names.
- First person as lowercase i.

## Judgments (most important rule)
- Maximum ONE evaluative statement across the entire insight. Zero is fine.
- The first sentence describes what's happening structurally. That's it. No verdict there.
- If there's a second sentence, it can offer one quiet implication. Not a verdict. Not a declaration. Phrased like "when this pattern shows up, it usually means X" — not "this proves Y" or "this is a sign that Z."
- NEVER two judgments in the same piece. If sentence 1 already names the pattern, sentence 2 cannot restate it as a different verdict.
- Ban: "this proves", "this shows us that", "this confirms", "most X companies are not doing Y", "the new moat is", "watch for", "operators should", "this is the moment when"

## AI Symmetry Patterns (ban — AI detector load-bearing)
- Tidy 3x3 bullets. Three points, each two words long, all parallel.
- Too-perfect transitions: "Furthermore", "Moreover", "Additionally", "It's worth noting that"
- The windup opener: "In today's fast-paced world...", "In an era where..."
- The "Not X, but Y" cadence (ANY variant): "not X, but Y", "not X, it's Y", "not X, actually Y", "X isn't Y, it's Z", "it's not about X, it's about Y", "X — not Y", "Y, not X". The single most overused pattern in AI-generated content. Rewrite as two separate sentences or a concession-then-pivot. See voice-canon.md Rule 7.
- Anaphoric three-beat negation: "Not a recap. Not a question. Not a flourish." Three-beat noun lists are fine; three-beat negation is template.
- The symmetrical close: "The future belongs to those who..."

## Words to Kill on Sight
delve, crucial, robust, comprehensive, nuanced, multifaceted, pivotal, landscape, tapestry, underscore, foster, showcase, intricate, vibrant, interplay, game-changer, paradigm shift, ecosystem, synergy, seamless, unlock, mind-blowing

## Core Test
Would a sharp person who has been in the trenches say this out loud, or does it read like a newsletter summary?
`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Fetch articles from News Inbox ──────────────────────────────────────────

async function fetchInboxArticles() {
  const cutoff = new Date();
  cutoff.setHours(cutoff.getHours() - 48);

  const results = await notionQueryAll(
    NEWS_INBOX_DB,
    {
      and: [
        { property: "Action", select: { equals: "Inbox" } },
        { property: "Date", date: { on_or_after: cutoff.toISOString().split("T")[0] } },
      ],
    },
    [{ timestamp: "created_time", direction: "descending" }]
  );

  return results.map((p) => ({
    id: p.id,
    title: extractTitle(p),
    domain: extractSelect(p, "Category") || "Unknown",
    summary: extractText(p, "Summary"),
    source: extractText(p, "Source"),
    url: extractUrl(p, "Link"),
  }));
}

// ─── Voice Canon ──────────────────────────────────────────────────────────────

async function fetchVoiceCanon() {
  try {
    const res = await notionQuery(
      PERSONAL_WIKI_DB,
      { property: "Type", select: { equals: "Voice Canon" } },
      undefined,
      1
    );
    if (res.results.length === 0) throw new Error("no voice canon page");
    const body = await notionFetchBlockTreeAsPlainText(res.results[0].id, VOICE_CANON_MAX_CHARS);
    if (body.trim()) return body;
    return extractTitle(res.results[0]);
  } catch {
    return "High conviction, all-lowercase body copy. Intelligent but not academic. Concrete details, no buzzwords.";
  }
}

// ─── Synthesis prompt ─────────────────────────────────────────────────────────

function buildSynthesisPrompt(articlesByDomain, voiceCanon) {
  const domainList = Object.keys(articlesByDomain).join(", ");
  const sections = Object.entries(articlesByDomain)
    .map(([domain, articles]) => {
      const lines = articles
        .slice(0, 5)
        .map((a, i) => `  ${i + 1}. [${domain}][${a.source}] ${a.title}\n     ${a.summary}`)
        .join("\n");
      return `### ${domain}\n${lines}`;
    })
    .join("\n\n");

  return {
    system: `You are a sharp market observer writing brief, human-sounding notes for a fintech/AI audience. Write in this voice:

VOICE CANON (canonical, from voice-canon.md — follow strictly):
${voiceCanonFile}

VOICE CANON (supplementary, from Notion Personal Wiki — may be empty):
${voiceCanon}

${NEGATIVE_STYLE}

Return only valid JSON. No markdown fences. No prose outside the JSON.`,
    user: `Today's signals, grouped by domain (${domainList}):

${sections}

TASK: Find 1 pair of articles from TWO DIFFERENT DOMAINS that, when read together, reveal something non-obvious — a structural pattern, a quiet convergence, a tension that most people haven't named yet.

HARD RULES:
- domain_a and domain_b MUST be different (AI + AI is invalid, AI + Fintech is valid, Fintech + Stablecoins is valid)
- If the only interesting pairs are within the same domain, return empty insights
- Connection must be thematic, not superficial ("both are about technology" is not a connection)

FORMAT for the insight (2 sentences MAX, follow the Negative Style rules above):
- Sentence 1: "[Event A label] + [Event B label]: [what's structurally happening when you see these two things at the same time]. Factual, observational. Describe the pattern, not the verdict."
- Sentence 2 (OPTIONAL, skip if not needed): One quiet implication. Phrased as an observation, not advice or a verdict. "when this happens alongside that, it usually means X" style. If you can't write one that adds something genuinely new, leave it out.
- Use a COLON or COMMA to join the label to the observation. NEVER use an em dash (Unicode U+2014) or en dash (U+2013). Not ever.

For the tweet: same compressed under 260 chars. natural, not a summary. no hashtags.

Example of good insight tone (observe, don't editorialize every sentence):
"AmexGBT goes private ($6.3B) + Kraken acquires stablecoin rails: two incumbents spending on infrastructure at the same time, in different parts of the stack. consolidation before the next wave, not after it."

Example of bad insight tone (too many judgments):
"both companies are signaling the commodity phase has arrived, which proves the new moat is trust infrastructure, and most companies aren't building it." this has 3 verdicts. ban this pattern.

Return JSON:
{"insights": [{"pair": "3-5 word label, e.g. 'Meta layoffs + Bitcoin collateral'", "domain_a": "AI|Fintech|Stablecoins", "domain_b": "AI|Fintech|Stablecoins", "insight": "...", "tweet": "...", "confidence": N}]}

If no cross-domain pair scores above 5: {"insights": [], "reason": "no strong cross-domain signal today"}`,
  };
}

// ─── Write to Content Drafts DB ───────────────────────────────────────────────

function stripDashes(text) {
  return text
    .replace(/—/g, ",") // em dash → comma
    .replace(/–/g, ",") // en dash → comma
    .replace(/ ,/g, ",");    // clean up space before comma
}

async function writeDraft(insight, tweet, pair) {
  const label = pair.length > 60 ? pair.slice(0, 57) + "..." : pair;
  const title = `[Signal] ${stripDashes(label)}`;

  return notionCreatePage(
    { database_id: CONTENT_DRAFTS_DB },
    {
      Draft: { title: [{ text: { content: title } }] },
      blog_content: { rich_text: [{ text: { content: stripDashes(insight).slice(0, 2000) } }] },
      tweet_copy: { rich_text: [{ text: { content: stripDashes(tweet).slice(0, 500) } }] },
      text_approval_status: { select: { name: "pending" } },
      visual_approval_status: { select: { name: "not_required" } },
    }
  );
}

// ─── Mark articles as Synthesized ────────────────────────────────────────────

async function markSynthesized(articleIds) {
  for (const id of articleIds) {
    await notionPatch(id, { Action: { select: { name: "Synthesized" } } });
    await sleep(350);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  if (!DRY_RUN && !acquireLock(LOCKFILE)) process.exit(0);

  try {
    console.log(`[signal-synthesizer] Starting${DRY_RUN ? " (dry-run)" : ""}`);

    const articles = await fetchInboxArticles();
    console.log(`[signal-synthesizer] ${articles.length} inbox articles`);

    if (articles.length === 0) {
      console.log("[signal-synthesizer] No inbox articles. Exiting.");
      return;
    }

    // Group by domain
    const byDomain = {};
    for (const a of articles) {
      if (!byDomain[a.domain]) byDomain[a.domain] = [];
      byDomain[a.domain].push(a);
    }

    const domainCount = Object.keys(byDomain).length;
    console.log(`[signal-synthesizer] Domains: ${Object.keys(byDomain).join(", ")}`);

    if (domainCount < 2) {
      console.log(`[signal-synthesizer] Only ${domainCount} domain(s) — need 2+ for cross-domain insight. Exiting.`);
      return;
    }

    const voiceCanon = await fetchVoiceCanon();
    console.log(`[signal-synthesizer] Voice Canon: ${voiceCanon.length} chars`);

    const { system, user } = buildSynthesisPrompt(byDomain, voiceCanon);

    console.log("[signal-synthesizer] Calling Claude Sonnet for synthesis...");
    let raw;
    if (DRY_RUN) {
      raw = JSON.stringify({
        insights: [{
          pair: "DRY RUN Pair",
          insight: "dry run event A + dry run event B — this is a test insight. no real signal was synthesized.",
          tweet: "dry run: testing signal synthesizer pipeline. no real insight here.",
          confidence: 8,
        }],
      });
    } else {
      raw = await generateWithSonnet(system, user, 1000);
    }

    console.log(`[signal-synthesizer] Raw response length: ${raw.length}`);

    const parsed = parseJsonLoose(raw);
    if (!parsed || !Array.isArray(parsed.insights)) {
      console.log("[signal-synthesizer] Could not parse response. Exiting.");
      return;
    }

    if (parsed.insights.length === 0) {
      console.log(`[signal-synthesizer] No strong signal today. Reason: ${parsed.reason || "none"}. Exiting.`);
      return;
    }

    // Filter to cross-domain pairs only, then take highest confidence
    const crossDomain = parsed.insights.filter((ins) => {
      if (!ins.domain_a || !ins.domain_b) return true; // allow if fields missing (graceful)
      return ins.domain_a.toLowerCase() !== ins.domain_b.toLowerCase();
    });

    if (crossDomain.length === 0) {
      console.log("[signal-synthesizer] All generated insights are same-domain. Exiting.");
      return;
    }

    const best = crossDomain.sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0];

    if ((best.confidence || 0) < 6) {
      console.log(`[signal-synthesizer] Best insight confidence ${best.confidence} < 6. Exiting.`);
      return;
    }

    console.log(`[signal-synthesizer] Domains: ${best.domain_a} + ${best.domain_b}`);

    console.log(`[signal-synthesizer] Best insight: "${best.pair}" (confidence: ${best.confidence})`);

    // Write to Content Drafts DB
    if (!DRY_RUN) {
      await writeDraft(best.insight, best.tweet, best.pair);
      await markSynthesized(articles.map((a) => a.id));
    } else {
      console.log(`[signal-synthesizer] [dry-run] Would write draft: "${best.pair}"`);
      console.log(`[signal-synthesizer] [dry-run] Insight: ${best.insight}`);
      console.log(`[signal-synthesizer] [dry-run] Tweet: ${best.tweet}`);
    }

    // Send Telegram notification
    const cleanInsight = stripDashes(best.insight);
    const cleanTweet = stripDashes(best.tweet);
    const tgMessage = `🔗 *SIGNAL INSIGHT*\n\n${cleanInsight}\n\n---\n📣 *Tweet draft:*\n${cleanTweet}\n\n_(${cleanTweet.length} chars)_\n\nReply \`APPROVE\` to queue for posting or \`SKIP\` to discard.`;

    if (!DRY_RUN) {
      await sendTelegram(tgMessage);
    } else {
      console.log(`[signal-synthesizer] [dry-run] Would send Telegram:\n${tgMessage}`);
    }

    console.log("[signal-synthesizer] Done.");
  } finally {
    if (!DRY_RUN) releaseLock(LOCKFILE);
  }
}

run().catch((e) => {
  console.error(`[signal-synthesizer] Fatal: ${e.message}`);
  if (!DRY_RUN) releaseLock(LOCKFILE);
  process.exit(1);
});
