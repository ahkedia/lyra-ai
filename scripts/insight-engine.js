#!/usr/bin/env node
/**
 * InsightEngine — Content Draft Generator
 *
 * Runs as a detached child_process spawned by OpenClaw at 08:00 daily.
 * Reads ideas from Content Ideas DB (status=backlog, priority=high),
 * fetches wiki evidence, drafts via Sonnet, humanizes via Haiku,
 * runs plagiarism check, writes to Content Drafts DB.
 *
 * PID lockfile: /tmp/insight-engine.lock
 * Timeout: 10 minutes (enforced by spawner)
 * Max ideas per run: 3 (sequential, not parallel)
 */

import { createRequire } from "module";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

// --- Config ---
const NOTION_KEY = process.env.NOTION_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "YOUR_CHAT_ID";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

const CONTENT_IDEAS_DB = "27fc8e00643a4b9390f7ce8b9a345c62";
const CONTENT_DRAFTS_DB = "8135676dd15c4ef4925336cf484567ac";
const CONTENT_JOB_LOG_DB = "33d780089100815 0b18fd9967447d1fb".replace(/\s/g, "");
// Personal Wiki Notion DB (standard database query API)
// Note: data_source_id 33d78008-9100-8197-9f0f-000b205edfe8 is for Notion AI features only
const PERSONAL_WIKI_DB = "33d78008-9100-8183-850d-e7677ac46b63";

const MAX_IDEAS = 3;
const MAX_RUNS_PER_DAY = 1;
const NOTION_DELAY_MS = 350;
const LOCKFILE = "/tmp/insight-engine.lock";

// Stopwords for plagiarism check (5-consecutive-non-stopword threshold)
const STOPWORDS = new Set([
  "a","an","the","and","or","but","in","on","at","to","for","of","with",
  "by","from","is","was","are","were","be","been","being","have","has",
  "had","do","does","did","will","would","could","should","may","might",
  "it","its","this","that","these","those","i","we","you","he","she","they",
  "not","no","nor","so","yet","as","if","then","than","when","while","since",
]);

// --- Utilities ---
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function sanitizeInput(text) {
  if (!text) return "";
  // Strip prompt injection attempts: remove system-like instruction patterns
  return text
    .replace(/\[\s*system\s*\]/gi, "[filtered]")
    .replace(/\bignore\s+(previous|above|all)\s+instructions?\b/gi, "[filtered]")
    .replace(/\byou\s+are\s+now\b/gi, "[filtered]")
    .slice(0, 4000); // hard cap
}

async function notionRequest(method, endpoint, body) {
  await sleep(NOTION_DELAY_MS);
  const res = await fetch(`https://api.notion.com/v1${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${NOTION_KEY}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Notion ${method} ${endpoint}: ${json.message}`);
  return json;
}

async function anthropicRequest(model, systemPrompt, userPrompt, maxTokens = 1500) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Anthropic ${model}: ${json.error?.message}`);
  return json.content?.[0]?.text || "";
}

async function sendTelegram(message) {
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: "Markdown" }),
    });
  } catch (e) {
    console.warn("[insight-engine] Telegram failed (non-blocking):", e.message);
  }
}

// --- Lockfile ---
function acquireLock() {
  if (existsSync(LOCKFILE)) {
    const content = readFileSync(LOCKFILE, "utf8").trim();
    const pid = parseInt(content, 10);
    if (!isNaN(pid)) {
      try {
        process.kill(pid, 0); // Check if process is alive
        console.warn(`[insight-engine] Another instance (PID ${pid}) is running. Skipping.`);
        process.exit(0);
      } catch {
        console.warn(`[insight-engine] Stale lockfile for dead PID ${pid}. Clearing.`);
        unlinkSync(LOCKFILE);
      }
    }
  }
  writeFileSync(LOCKFILE, String(process.pid));
}

function releaseLock() {
  try { unlinkSync(LOCKFILE); } catch {}
}

// --- ContentJobLog ---
async function writeJobLog(fields) {
  const runId = `insight-${new Date().toISOString().slice(0, 10)}-${Date.now()}`;
  const props = {
    run_id: { title: [{ text: { content: fields.run_id || runId } }] },
    status: { select: { name: fields.status } },
    phase: { select: { name: "phase1" } },
  };
  if (fields.started_at) props.started_at = { date: { start: fields.started_at } };
  if (fields.finished_at) props.finished_at = { date: { start: fields.finished_at } };
  if (fields.drafts_generated !== undefined) props.drafts_generated = { number: fields.drafts_generated };
  if (fields.drafts_flagged !== undefined) props.drafts_flagged = { number: fields.drafts_flagged };
  if (fields.ideas_skipped !== undefined) props.ideas_skipped = { number: fields.ideas_skipped };
  if (fields.error_message) props.error_message = { rich_text: [{ text: { content: fields.error_message.slice(0, 2000) } }] };

  return notionRequest("POST", "/pages", {
    parent: { database_id: CONTENT_JOB_LOG_DB },
    properties: props,
  });
}

async function updateJobLog(pageId, fields) {
  const props = {};
  if (fields.status) props.status = { select: { name: fields.status } };
  if (fields.finished_at) props.finished_at = { date: { start: fields.finished_at } };
  if (fields.drafts_generated !== undefined) props.drafts_generated = { number: fields.drafts_generated };
  if (fields.drafts_flagged !== undefined) props.drafts_flagged = { number: fields.drafts_flagged };
  if (fields.ideas_skipped !== undefined) props.ideas_skipped = { number: fields.ideas_skipped };
  if (fields.error_message) props.error_message = { rich_text: [{ text: { content: fields.error_message.slice(0, 2000) } }] };

  return notionRequest("PATCH", `/pages/${pageId}`, { properties: props });
}

// --- Wiki retrieval ---
function extractDomain(topic) {
  const topicLower = (topic || "").toLowerCase();
  let map;
  try {
    const mapPath = join(REPO_ROOT, "config/topic-to-domain.json");
    map = JSON.parse(readFileSync(mapPath, "utf8"));
  } catch {
    return null;
  }
  for (const entry of map.mappings) {
    if (entry.keywords.some((kw) => topicLower.includes(kw))) return entry.domain;
  }
  return null;
}

async function fetchWikiEvidence(domain) {
  if (!domain) return null;
  try {
    // Step 1: Query wiki by domain filter
    const queryRes = await notionRequest("POST", `/databases/${PERSONAL_WIKI_DB}/query`, {
      filter: { property: "Domain", select: { equals: domain } },
      page_size: 2,
    });
    const pages = queryRes.results || [];
    if (!pages.length) return null;

    // Step 2: Fetch page body for top 1-2 matches
    const evidenceParts = [];
    for (const page of pages.slice(0, 2)) {
      const blocksRes = await notionRequest("GET", `/blocks/${page.id}/children?page_size=20`);
      const text = (blocksRes.results || [])
        .filter((b) => b.type === "paragraph" || b.type === "bulleted_list_item")
        .map((b) => (b[b.type]?.rich_text || []).map((rt) => rt.plain_text).join(""))
        .filter(Boolean)
        .join("\n")
        .slice(0, 1500);
      if (text) evidenceParts.push(`[${page.properties?.Name?.title?.[0]?.plain_text || "Wiki page"}]\n${text}`);
    }
    return evidenceParts.join("\n\n") || null;
  } catch (e) {
    console.warn("[insight-engine] Wiki fetch failed:", e.message);
    return null;
  }
}

// --- Voice Canon ---
function loadVoiceCanon(voiceCanonText) {
  if (voiceCanonText) return voiceCanonText;
  // Fallback to local file
  try {
    return readFileSync(join(REPO_ROOT, "voice-system/VOICE.md"), "utf8");
  } catch {
    return "Voice: lowercase, conversational, high-conviction, not corporate. Avoid AI symmetry patterns.";
  }
}

async function fetchVoiceCanon() {
  try {
    const queryRes = await notionRequest("POST", `/databases/${PERSONAL_WIKI_DB}/query`, {
      filter: { property: "Type", select: { equals: "Voice Canon" } },
      page_size: 10,
    });
    const voicePage = (queryRes.results || [])[0];
    if (!voicePage) return null;

    const blocksRes = await notionRequest("GET", `/blocks/${voicePage.id}/children?page_size=30`);
    return (blocksRes.results || [])
      .filter((b) => b.type === "paragraph" || b.type === "bulleted_list_item" || b.type === "heading_2" || b.type === "heading_3")
      .map((b) => (b[b.type]?.rich_text || []).map((rt) => rt.plain_text).join(""))
      .filter(Boolean)
      .join("\n")
      .slice(0, 3000);
  } catch (e) {
    console.warn("[insight-engine] Voice Canon fetch failed:", e.message);
    return null;
  }
}

// --- Plagiarism check ---
async function fetchReferenceCorpus() {
  // Reference Corpus not yet built in Phase 1 — return empty
  return [];
}

function checkPlagiarism(draftText, corpus) {
  if (!corpus.length) return { result: "skipped", match: null };
  const draftWords = draftText.toLowerCase().split(/\s+/).filter((w) => !STOPWORDS.has(w));

  for (const item of corpus) {
    const sourceWords = (item.tweet_text || "").toLowerCase().split(/\s+/).filter((w) => !STOPWORDS.has(w));
    // Sliding window: 5 consecutive non-stopwords
    for (let i = 0; i <= sourceWords.length - 5; i++) {
      const window = sourceWords.slice(i, i + 5).join(" ");
      const draftStr = draftWords.join(" ");
      if (draftStr.includes(window)) {
        return { result: "flagged", match: window, source: item.tweet_url || "unknown" };
      }
    }
  }
  return { result: "clean", match: null };
}

// --- Draft generation ---
async function generateDraft(idea, wikiEvidence, voiceCanon) {
  const negativeStyle = (() => {
    try { return readFileSync(join(REPO_ROOT, "voice-system/NEGATIVE_STYLE.md"), "utf8").slice(0, 1000); }
    catch { return "Avoid AI symmetry patterns, tidy bullets, filler openers, CTA closers."; }
  })();

  const systemPrompt = `You are a ghostwriter for Akash Kedia, a technical product leader and builder.

VOICE:
${loadVoiceCanon(voiceCanon).slice(0, 1000)}

NEGATIVE STYLE (never use these patterns):
${negativeStyle}

RULES:
- Write in Akash's voice: lowercase-leaning, high-conviction, intelligent but not academic
- Always ground the draft in first-hand experience or specific examples
- The draft must have a clear "Akash point of view" — a non-obvious take
- Do not plagiarize or closely paraphrase the source material
- Format: determine whether this idea is best as a micro-post, thread, or essay thread`;

  const userPrompt = `Generate a draft X post for this idea:

IDEA TITLE: ${sanitizeInput(idea.title)}
IDEA NOTES: ${sanitizeInput(idea.notes)}
FORMAT CANDIDATE: ${sanitizeInput(idea.formatCandidate || "determine best format")}

${wikiEvidence ? `WIKI EVIDENCE (use this for first-hand grounding):\n${wikiEvidence}\n` : "NO WIKI EVIDENCE: Proceed but flag evidence_grounded=false"}

Produce:
1. The draft text (ready to post on X, with thread breaks marked as [TWEET N] if multi-tweet)
2. One sentence: why this is original and grounded in first-hand experience
3. Format chosen: micro-post | thread | essay-thread

Return as JSON: {"draft": "...", "originality_check": "...", "format": "..."}`;

  const text = await anthropicRequest(
    "claude-sonnet-4-6",
    systemPrompt,
    userPrompt,
    2000
  );

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch {}
  // If JSON parse fails, return raw text
  return { draft: text, originality_check: "parse failed", format: "micro-post" };
}

async function humanizeDraft(draftText) {
  const checklist = (() => {
    try { return readFileSync(join(REPO_ROOT, "voice-system/HUMANIZATION_CHECKLIST.md"), "utf8").slice(0, 1500); }
    catch { return "Check: lowercase feel, uneven rhythm, no AI symmetry, no filler opener, no CTA closer."; }
  })();

  const systemPrompt = "You are a style editor specializing in making AI-generated text sound like a real human operator.";
  const userPrompt = `Humanize this X post draft. Apply these style rules and score the result 0-10.

HUMANIZATION RULES:
${checklist.slice(0, 800)}

DRAFT:
${draftText}

Return JSON: {"humanized_draft": "...", "score": N, "changes": ["change1", "change2"]}`;

  try {
    const text = await anthropicRequest("claude-haiku-4-5-20251001", systemPrompt, userPrompt, 1500);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        text: parsed.humanized_draft || draftText,
        score: typeof parsed.score === "number" ? parsed.score : null,
      };
    }
  } catch (e) {
    console.warn("[insight-engine] Humanization failed:", e.message);
  }
  return { text: draftText, score: null };
}

// --- Write to Content Drafts ---
async function writeDraftToNotion(idea, draftText, humanizationScore, status, pipelineLog) {
  const title = idea.title || "Untitled Draft";
  return notionRequest("POST", "/pages", {
    parent: { database_id: CONTENT_DRAFTS_DB },
    properties: {
      Draft: { title: [{ text: { content: title.slice(0, 2000) } }] },
      Status: { select: { name: status } },
      Content: { rich_text: [{ text: { content: draftText.slice(0, 2000) } }] },
      Platform: { select: { name: "X" } },
      text_approval_status: { select: { name: "pending" } },
      visual_approval_status: { select: { name: "not_required" } },
      ...(humanizationScore !== null && { humanization_score: { number: humanizationScore } }),
      Notes: { rich_text: [{ text: { content: (pipelineLog || "").slice(0, 2000) } }] },
    },
  });
}

// --- Main ---
async function main() {
  acquireLock();
  const startedAt = new Date().toISOString();
  let jobLogId = null;
  const stats = { draftsGenerated: 0, draftsFlagged: 0, ideasSkipped: 0 };

  try {
    if (!NOTION_KEY) throw new Error("NOTION_API_KEY not set");
    if (!ANTHROPIC_KEY) throw new Error("ANTHROPIC_API_KEY not set");

    // Step 0: Write ContentJobLog running row
    const jobLog = await writeJobLog({ status: "running", started_at: startedAt });
    jobLogId = jobLog.id;
    console.log(`[insight-engine] Started. JobLog: ${jobLogId}`);

    // Step 1: Fetch Voice Canon
    const voiceCanonText = await fetchVoiceCanon();
    console.log(`[insight-engine] Voice Canon: ${voiceCanonText ? "fetched" : "using fallback"}`);

    // Step 2: Fetch content ideas (status=backlog, limit MAX_IDEAS)
    const ideasRes = await notionRequest("POST", `/databases/${CONTENT_IDEAS_DB}/query`, {
      filter: {
        and: [
          { property: "Status", select: { equals: "Idea" } },
        ],
      },
      sorts: [{ timestamp: "created_time", direction: "ascending" }],
      page_size: MAX_IDEAS,
    });

    const ideas = (ideasRes.results || []).map((page) => ({
      id: page.id,
      title: page.properties?.Idea?.title?.[0]?.plain_text || "Untitled",
      notes: page.properties?.["Rough Notes"]?.rich_text?.[0]?.plain_text || "",
      tags: (page.properties?.Tags?.multi_select || []).map((t) => t.name).join(", "),
      formatCandidate: page.properties?.["format_candidate"]?.select?.name || null,
    }));

    if (!ideas.length) {
      console.log("[insight-engine] No backlog ideas found. Exiting.");
      await updateJobLog(jobLogId, { status: "completed", finished_at: new Date().toISOString(), drafts_generated: 0, ideas_skipped: 0 });
      releaseLock();
      return;
    }

    console.log(`[insight-engine] Processing ${ideas.length} idea(s) sequentially.`);

    // Step 3: Process each idea sequentially
    const referenceCorpus = await fetchReferenceCorpus();

    for (const idea of ideas) {
      console.log(`[insight-engine] Processing: "${idea.title}"`);
      const pipelineLog = [];

      try {
        // 3a: Extract domain and fetch wiki evidence
        const domain = extractDomain(`${idea.title} ${idea.tags} ${idea.notes}`);
        const wikiEvidence = domain ? await fetchWikiEvidence(domain) : null;
        const evidenceGrounded = !!wikiEvidence;
        pipelineLog.push(`domain=${domain || "none"}, wiki=${evidenceGrounded ? "yes" : "no"}`);

        // 3d: Generate draft (Sonnet)
        let draftResult;
        try {
          draftResult = await generateDraft(idea, wikiEvidence, voiceCanonText);
          if (!draftResult.draft || draftResult.draft.length < 20) throw new Error("Empty draft");
        } catch (e) {
          // Retry once
          try { draftResult = await generateDraft(idea, wikiEvidence, voiceCanonText); }
          catch (e2) {
            console.warn(`[insight-engine] Draft failed for "${idea.title}":`, e2.message);
            pipelineLog.push(`draft_failed: ${e2.message}`);
            stats.ideasSkipped++;
            continue;
          }
        }

        // 3e: Humanization pass (Haiku)
        const humanized = await humanizeDraft(draftResult.draft);
        pipelineLog.push(`humanization_score=${humanized.score}`);

        // 3g: Plagiarism check
        const plagCheck = checkPlagiarism(humanized.text, referenceCorpus);
        pipelineLog.push(`plagiarism=${plagCheck.result}`);

        // 3h: Write to Content Drafts
        const draftStatus = plagCheck.result === "flagged" ? "flagged" : "draft";
        if (plagCheck.result === "flagged") stats.draftsFlagged++;

        await writeDraftToNotion(
          idea,
          humanized.text,
          humanized.score,
          draftStatus,
          pipelineLog.join(" | ")
        );

        stats.draftsGenerated++;
        console.log(`[insight-engine] Draft written (${draftStatus}): "${idea.title}"`);

      } catch (e) {
        console.error(`[insight-engine] Error processing "${idea.title}":`, e.message);
        pipelineLog.push(`error: ${e.message}`);
        stats.ideasSkipped++;
      }
    }

    // Step 4: Update ContentJobLog to completed
    const finishedAt = new Date().toISOString();
    await updateJobLog(jobLogId, {
      status: "completed",
      finished_at: finishedAt,
      drafts_generated: stats.draftsGenerated,
      drafts_flagged: stats.draftsFlagged,
      ideas_skipped: stats.ideasSkipped,
    });

    // Step 5: Telegram notification
    if (stats.draftsGenerated > 0) {
      await sendTelegram(
        `*InsightEngine complete*\n${stats.draftsGenerated} draft(s) ready for review in [Content Drafts](https://notion.so/${CONTENT_DRAFTS_DB})` +
        (stats.draftsFlagged > 0 ? `\n${stats.draftsFlagged} flagged for plagiarism check` : "")
      );
    }

    console.log(`[insight-engine] Done. Generated=${stats.draftsGenerated}, Flagged=${stats.draftsFlagged}, Skipped=${stats.ideasSkipped}`);

  } catch (e) {
    console.error("[insight-engine] Fatal:", e.message);
    if (jobLogId) {
      await updateJobLog(jobLogId, {
        status: "failed",
        finished_at: new Date().toISOString(),
        error_message: e.message,
        ...stats,
      }).catch(() => {});
    }
    await sendTelegram(`*InsightEngine failed*\n${e.message}`).catch(() => {});
    process.exit(1);
  } finally {
    releaseLock();
  }
}

main();
