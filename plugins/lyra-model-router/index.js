/**
 * Lyra Model Router v16 — OpenClaw Plugin
 *
 * 4-way real-time router for ad-hoc traffic:
 *   Tier0 CRUD -> MiniMax -> Haiku -> Sonnet
 *
 * Includes:
 * - MiniMax-first complexity routing with configurable thresholds
 * - rolling 24h/3d/7d Anthropic share checks
 * - conservative fallback profile
 * - budget-aware route clamping
 */

import { execFileSync } from "child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { dirname, join as pathJoin } from "path";
import { fileURLToPath } from "url";

const ABHIGNA_ID = "5003298152";

const _pluginDir = dirname(fileURLToPath(import.meta.url));
const _repoRoot = pathJoin(_pluginDir, "..", "..");

function resolveLogPath() {
  if (process.env.LYRA_ROUTING_LOG_PATH) return process.env.LYRA_ROUTING_LOG_PATH;
  const serverLogs = "/root/lyra-ai/logs/routing-decisions.jsonl";
  if (existsSync(dirname(serverLogs))) return serverLogs;
  return pathJoin(_repoRoot, "logs", "routing-decisions.jsonl");
}

/** Resolved path used for routing JSONL (CLI/evals and plugin). */
export const ROUTING_DECISIONS_LOG = resolveLogPath();
const LOG_PATH = ROUTING_DECISIONS_LOG;
const LOG_DIR = dirname(LOG_PATH);
const POLICY_VERSION = process.env.LYRA_ROUTING_POLICY_VERSION || "routing_thresholds_v1";
const THRESHOLD_SET = process.env.LYRA_ROUTING_THRESHOLD_SET || "routing_thresholds_v1";

const MODELS = {
  minimax: { providerOverride: undefined, modelOverride: undefined, provider: "minimax", model: "minimax/MiniMax-M2.7" },
  haiku: { providerOverride: "anthropic", modelOverride: "claude-haiku-4-5", provider: "anthropic", model: "anthropic/claude-haiku-4-5" },
  sonnet: { providerOverride: "anthropic", modelOverride: "claude-sonnet-4-6", provider: "anthropic", model: "anthropic/claude-sonnet-4-6" },
};

const V1 = {
  crud: parseFloat(process.env.LYRA_ROUTING_CRUD_THRESHOLD || "0.80"),
  haiku: parseFloat(process.env.LYRA_ROUTING_HAIKU_THRESHOLD || "0.78"),
  sonnet: parseFloat(process.env.LYRA_ROUTING_SONNET_THRESHOLD || "0.92"),
  sonnetVeryHigh: parseFloat(process.env.LYRA_ROUTING_SONNET_VERY_HIGH || "0.96"),
  sonnetMargin: parseFloat(process.env.LYRA_ROUTING_SONNET_MARGIN || "0.08"),
};

const CONSERVATIVE = {
  crud: parseFloat(process.env.LYRA_ROUTING_FALLBACK_CRUD_THRESHOLD || "0.78"),
  haiku: parseFloat(process.env.LYRA_ROUTING_FALLBACK_HAIKU_THRESHOLD || "0.90"),
  sonnet: parseFloat(process.env.LYRA_ROUTING_FALLBACK_SONNET_THRESHOLD || "0.97"),
  sonnetVeryHigh: parseFloat(process.env.LYRA_ROUTING_FALLBACK_SONNET_VERY_HIGH || "0.98"),
  sonnetMargin: parseFloat(process.env.LYRA_ROUTING_FALLBACK_SONNET_MARGIN || "0.12"),
};

const COSTS = { minimax: 0.0001, haiku: 0.001, sonnet: 0.01 };
const BUDGET_EUR = parseFloat(process.env.MONTHLY_BUDGET_EUR || "20");
const USD_PER_EUR = parseFloat(process.env.LYRA_USD_PER_EUR || "1.09");
const BUDGET_USD = BUDGET_EUR * USD_PER_EUR;
const FORCE_CONSERVATIVE = process.env.LYRA_ROUTING_FORCE_FALLBACK === "1";
const CACHE_MS = 60_000;

// --- Tier 0: Python CRUD bypass ---
// These patterns skip the LLM entirely and execute Python scripts directly.
// Must stay in sync with crud/parse.py (normalize + list_reminders patterns).

function normalizeTier0Prompt(raw) {
  let s = raw.trim();
  s = s.replace(
    /[\s?.!]*(?:just\s+)?(?:please\s+)?(?:list|show|tell me)\s+(?:them\s+)?(?:briefly|quickly|shortly|concisely)\s*[\s?.!]*$/i,
    "",
  );
  return s.trim();
}

// Must stay aligned with crud/cli.py cmd_parse() health branch (after CRUD).
const HEALTH_TIER0_PATTERNS = [
  /\bweight[:\s]+\d/i,
  /\bweigh\s+\d/i,
  /\bslept?\s+\d/i,
  /\bsleep[:\s]+\d/i,
  /(?:walked|steps)[:\s]+\d+/i,
  /\d+\s+steps\b/i,
  /(?:active\s+cal(?:ories)?|burned)[:\s]+\d+/i,
  /(?:resting\s+)?h[ea]rt\s+rate[:\s]+\d+/i,
  /\bhr[:\s]+\d+/i,
  /\benergy[:\s]+(?:low|medium|med|high)\b/i,
  /\bworkout[:\s]+/i,
  /(?:^|\s)(?:ran|cycled|walked\s+for|did\s+gym)\s+\d+\s*min/i,
  /(?:ate|had|eaten)\s+.+\s+for\s+(?:breakfast|lunch|dinner|snack)/i,
];

// Tier 1 Haiku patterns — these need an LLM but Haiku is sufficient (short, structured tasks)
// Unlike TIER0 (zero-token Python CRUD), these make a Haiku API call.
// Handled downstream in the router after Tier0 check.
const HAIKU_PATTERNS = [
  /^promote to wiki:/i,
];

// Personal Wiki — crud/wiki_notion.try_tier0_wiki_text (Lenny search, lint, dedup)
const WIKI_TIER0_PATTERNS = [
  /what does lenny say (?:about )?.{2,}/i,
  /what did lenny say (?:about )?.{2,}/i,
  /lenny says (?:about )?.{2,}/i,
  /lenny (?:wiki )?(?:on|about) .{2,}/i,
  /wiki lenny[:\s].{2,}/i,
  /(?:run |monthly )?wiki[- ]?lint/i,
  /lint (?:my )?personal wiki/i,
  /wiki health(?: check)?/i,
  /personal wiki lint/i,
  /wiki[- ]?dedup/i,
  /deduplicate wiki/i,
  /deduplication wiki/i,
  /existing (?:wiki )?pages? (?:for|on|about)/i,
  /any (?:existing )?wiki (?:page )?about/i,
];

const TIER0_PATTERNS = [
  // Telegram slash commands (setMyCommands menu) — zero-token routes.
  // /reminders → list reminders; /last → last-message recall.
  // Trailing "@botname" is what Telegram appends in group chats.
  /^\/reminders(?:@\w+)?\s*$/i,
  /^\/last(?:@\w+)?\s*$/i,
  /^(?:list|show|what(?:'s| is| are)(?: in| on)?)\s+(?:my|the)\s+(?:current\s+)?(?:reminders?|tasks?)\b/i,
  /^(?:show|list)(?:\s+me)?(?:\s+my)?\s+(?:current\s+)?(?:reminders?|tasks?)\b/i,
  /^(?:list|show)\s+(?:my|the)\s+(?:current\s+)?(?:reminders?|tasks?)\b/i,
  /^(?:what'?s?|show|list)(?: in| on)?(?: my)?(?: the)? meal (?:plan|planning)$/i,
  /^(?:show|list) (?:me )?(?:my )?meals?$/i,
  /^(?:what'?s?|show|list)(?: my)?(?: upcoming)? trips?$/i,
  /^remind me (?:to |about )?/i,
  /^set (?:a )?reminder (?:to |for |about )?/i,
  /^add (?:a )?reminder(?:\s*:\s*|\s+to\s+|\s+for\s+|\s+about\s+|\s+)/i,
  /^create (?:a )?reminder(?:\s*:\s*|\s+to\s+|\s+for\s+|\s+about\s+|\s+)/i,
  /^add .+? to (?:(?:my |the )?(?:shopping|grocery|groceries|meal|task|todo|reminder|trip|content|idea)s? (?:list|plan|db|database)?|(?:my )?reminders?)$/i,
  /^mark .+? (?:as )?(?:done|complete|finished)$/i,
  /^(?:done|complete|finished)[:\s]+.+$/i,
  // Job application workflow — Phase A (trigger). Keep aligned with crud/job_application.py _JOB_TRIGGER_RE.
  /^\s*\/job\b/i,
  /(?:apply(?:ing)?\s+to\b|job\s+(?:link|post|opening|at)\b|cover\s+letter\s+(?:for|to)\b|draft\s+.*?outreach\s+(?:to|for)\b|write\s+.*?cover\s+letter\b|message\s+.*?(?:and|plus)\s+cover\s+letter\b|(?:draft|write|creating)\s+(?:an?\s+)?(?:outreach\s+)?message\s+(?:to|for)\b|outreach\s+(?:message\s+)?(?:to|for)\b|gmail\s+draft\b|\bmessage\s+(?:to|for)\s+[A-Za-z]|help\s+(?:me\s+)?(?:with\s+)?(?:a\s+)?(?:outreach\s+)?message\b)/i,
  // URL-based: known ATS/job hosts and LinkedIn profile URLs
  /linkedin\.com\/(?:jobs|in)\//i,
  /(?:jobs|careers|boards)\.[a-z0-9\-]+\.[a-z]{2,}/i,
  /(?:lever|greenhouse|ashbyhq|workable|smartrecruiters|bamboohr|wellfound|hired|grnh\.se|myworkdayjobs|icims)\.[a-z]{2,}/i,
  /kraken\.com\/careers/i,
  // URL + job-intent fallback (URL in same message as role/apply/outreach/cover)
  /https?:\/\/\S+[\s\S]{0,200}\b(?:role|position|opening|opportunity|apply|outreach|cover\s+letter)\b/i,
  /\b(?:role|position|opening|opportunity|apply|outreach|cover\s+letter)\b[\s\S]{0,200}https?:\/\/\S+/i,
  // Job application workflow — Phase B (clarification reply; Python validates state file exists)
  /^(?:[1-3]|both|outreach(?:\s+only)?|cover(?:\s+letter)?(?:\s+only)?|message(?:\s+only)?)(?:\s+.{0,120})?$/i,
  // Content draft / revise — shared wiki + channel rules (cli.py parse → content_draft.py)
  /(?:^|\n)(?:lyra\s+)?content\s+draft\s+(?:x|outreach|generic)\b/i,
  /(?:^|\n)(?:lyra\s+)?content\s+revise\s+(?:x|outreach|generic)\b/i,
];

function resolveCrudCli() {
  if (process.env.LYRA_CRUD_CLI) return process.env.LYRA_CRUD_CLI;
  const serverCrud = "/root/lyra-ai/crud/cli.py";
  if (existsSync(serverCrud)) return serverCrud;
  return pathJoin(_repoRoot, "crud", "cli.py");
}

const CRUD_CLI = resolveCrudCli();
const SONNET_ALLOWLIST = [
  /\b(?:weekly review|brain brief|competitor digest|content strategy)\b/i,
  /\b(?:trade.?off|pros and cons|priorit(?:ize|ise)|what should i)\b/i,
  /\b(?:analy[sz]e).*(?:strategy|market|competitor|themes?|patterns?)\b/i,
  /\b(?:synthes(?:ize|is)|across my|across all|connect the dots)\b/i,
  /\b(?:draft|write|compose).*(?:proposal|strategy|plan|blog|article|essay)\b/i,
];
const ACK_PATTERNS = [/^(?:hi|hello|hey|gm|ok|okay|thanks|thank you|done|yes|no|sure|got it|cool|great|perfect|👍|🙏)\s*$/i];
let _rollingCache = { at: 0, state: null };

function tryTier0(prompt) {
  const trimmed = normalizeTier0Prompt(prompt);
  const matched =
    TIER0_PATTERNS.some((p) => p.test(trimmed)) ||
    HEALTH_TIER0_PATTERNS.some((p) => p.test(trimmed)) ||
    WIKI_TIER0_PATTERNS.some((p) => p.test(trimmed));
  if (!matched) return null;
  if (!existsSync(CRUD_CLI)) return null;

  try {
    const result = execFileSync("python3", [CRUD_CLI, "parse", prompt.trim()], {
      timeout: 8000,
      env: { ...process.env },
    });
    return result.toString().trim();
  } catch (e) {
    // exit code 1 = no match, pass through to LLM
    // exit code other = script error, log and fall through
    if (e.status !== 1) {
      process.stderr.write(`[R] Tier0 script error: ${e.message}\n`);
    }
    return null;
  }
}
// --- End Tier 0 ---

// Track Anthropic availability — START DISABLED (rate limited until April 1)
let anthropicAvailable = false;
let lastAnthropicFailure = Date.now();
const ANTHROPIC_COOLDOWN_MS = 5 * 60 * 1000;

function isAnthropicAvailable() {
  if (!anthropicAvailable) return false;
  if (Date.now() - lastAnthropicFailure < ANTHROPIC_COOLDOWN_MS) return false;
  return true;
}

/** Eval/test harnesses: tier policy without live Anthropic gate. Production uses rate-limit state. */
function isEvalLikeContext(ctx) {
  const s = String(ctx?.sender || "");
  const ch = String(ctx?.channel || "");
  return s === "eval" || ch === "eval" || s === "test" || ch === "test";
}

function anthropicAllowedForPolicy(ctx) {
  if (process.env.LYRA_ROUTING_ASSUME_ANTHROPIC_AVAILABLE === "1") return true;
  if (process.env.LYRA_ROUTING_ASSUME_ANTHROPIC_AVAILABLE === "0") return false;
  if (isEvalLikeContext(ctx)) return true;
  return isAnthropicAvailable();
}

function markAnthropicFailed() {
  anthropicAvailable = false;
  lastAnthropicFailure = Date.now();
  process.stderr.write("[R] Anthropic marked unavailable (rate limit). Will retry in 30min\n");
}

// Re-enable Anthropic check every 30 minutes
setInterval(() => {
  if (!anthropicAvailable && Date.now() - lastAnthropicFailure > 30 * 60 * 1000) {
    anthropicAvailable = true;
    process.stderr.write("[R] Anthropic re-enabled (30min cooldown expired). Will test on next routed request.\n");
  }
}, 60 * 1000);

// tier0Result is set when a CRUD bypass executes before model resolution
let _tier0Result = null;

function clip01(n) {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function matchesAny(patterns, text) {
  return patterns.some((p) => p.test(text));
}

function extractFeatures(prompt) {
  const text = (prompt || "").trim();
  const lower = text.toLowerCase();
  const qCount = (text.match(/\?/g) || []).length;
  const conjunctionCount = (lower.match(/\b(and|then|also|after that|plus)\b/g) || []).length;
  const sentenceCount = text.split(/[.!?]+/).filter((s) => s.trim()).length;
  const length = text.length;
  return {
    text,
    lower,
    qCount,
    conjunctionCount,
    sentenceCount,
    length,
    hasAck: matchesAny(ACK_PATTERNS, text),
    strategyIntent: /\b(strategy|strategic|priorit(?:ize|ise)|trade.?off|pros and cons|recommend)\b/i.test(text),
    crossSourceSynthesis: /\b(across|patterns?|themes?|connect the dots|synthes(?:ize|is)|multi-source|based on my)\b/i.test(text),
    timeHorizon: /\b(week|month|quarter|lately|recently|over time)\b/i.test(text),
    formattingIntent: /\b(table|markdown format|format as|exactly \d+)\b/i.test(text),
    emailIntent: /\b(email|reply|draft)\b/i.test(text),
    webIntent: /\b(search|research|look up|latest news)\b/i.test(text),
  };
}

function computeScores(features) {
  const sonnetHints =
    (/\b(?:weekly review|brain brief|competitor digest|content strategy)\b/i.test(features.text) ? 1 : 0) +
    (/\b(?:analy[sz]e|synthes(?:ize|is)|patterns?|themes?)\b/i.test(features.text) ? 1 : 0);
  const haikuHints =
    (/\b(?:draft (?:a |an )?(?:email|reply)|respond to)\b/i.test(features.text) ? 1 : 0) +
    (/\b(?:format (?:as|it as)|table|markdown format|rewrite concisely|summary)\b/i.test(features.text) ? 1 : 0);

  const sonnet =
    0.08 +
    0.2 * (features.strategyIntent ? 1 : 0) +
    0.22 * (features.crossSourceSynthesis ? 1 : 0) +
    0.12 * (features.timeHorizon ? 1 : 0) +
    0.12 * Math.min(sonnetHints, 2) +
    0.08 * (features.length > 500 ? 1 : 0) +
    0.06 * (features.qCount >= 2 ? 1 : 0);
  const haiku =
    0.12 +
    0.2 * (features.emailIntent ? 1 : 0) +
    0.18 * (features.formattingIntent ? 1 : 0) +
    0.16 * (features.webIntent ? 1 : 0) +
    0.12 * (features.conjunctionCount >= 1 || features.sentenceCount >= 2 ? 1 : 0) +
    0.1 * Math.min(haikuHints, 2) +
    0.06 * (features.length > 200 ? 1 : 0);
  const minimax =
    0.5 +
    0.2 * (features.hasAck ? 1 : 0) +
    0.12 * (features.length < 140 ? 1 : 0) -
    0.15 * (features.strategyIntent ? 1 : 0) -
    0.16 * (features.crossSourceSynthesis ? 1 : 0) -
    0.08 * (features.conjunctionCount >= 1 ? 1 : 0);
  return {
    crud: 0,
    minimax: clip01(minimax),
    haiku: clip01(haiku),
    sonnet: clip01(sonnet),
  };
}

function parseEntries(limit = 6000) {
  if (!existsSync(LOG_PATH)) return [];
  const content = readFileSync(LOG_PATH, "utf8").trim();
  if (!content) return [];
  const lines = content.split("\n");
  const selected = lines.slice(Math.max(0, lines.length - limit));
  return selected.map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

function rollingAnthropic(entries, hours) {
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const recent = entries.filter((e) => {
    const sender = String(e.sender || "");
    const channel = String(e.channel || "");
    if (sender === "test" || sender === "eval" || channel === "test" || channel === "eval") return false;
    const t = Date.parse(e.timestamp || "");
    return Number.isFinite(t) && t >= cutoff;
  });
  let anthropic = 0;
  for (const e of recent) {
    const model = String(e.model || "");
    if (Boolean(e.anthropic_call) || model.includes("anthropic") || model.includes("claude")) anthropic++;
  }
  return { n: recent.length, anthropic, share: recent.length ? anthropic / recent.length : 0 };
}

function monthRunRateUsd(entries) {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  let total = 0;
  for (const e of entries) {
    const sender = String(e.sender || "");
    const channel = String(e.channel || "");
    if (sender === "test" || sender === "eval" || channel === "test" || channel === "eval") continue;
    const d = new Date(e.timestamp || 0);
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month) continue;
    total += COSTS[String(e.tier || "minimax")] || COSTS.minimax;
  }
  return total;
}

function getRoutingMode() {
  if (FORCE_CONSERVATIVE) {
    return { mode: "emergency", reason: "force_fallback", roll24h: null, roll3d: null, roll7d: null, monthUsd: 0 };
  }
  const now = Date.now();
  if (_rollingCache.state && now - _rollingCache.at < CACHE_MS) return _rollingCache.state;

  const entries = parseEntries();
  const roll24h = rollingAnthropic(entries, 24);
  const roll3d = rollingAnthropic(entries, 72);
  const roll7d = rollingAnthropic(entries, 168);
  const monthUsd = monthRunRateUsd(entries);

  let mode = "normal";
  let reason = "within_limits";
  if (monthUsd > BUDGET_USD) {
    mode = "emergency";
    reason = "budget_breach";
  } else if (roll24h.n >= 50 && roll24h.share >= 0.25) {
    mode = "emergency";
    reason = "rolling_24h_extreme";
  } else if (roll7d.n >= 200 && roll7d.share >= 0.20) {
    mode = "emergency";
    reason = "rolling_7d_extreme";
  } else if ((roll24h.n >= 50 && roll24h.share >= 0.15) || (roll3d.n >= 100 && roll3d.share >= 0.14)) {
    mode = "clamp";
    reason = "rolling_share_clamp";
  }
  const state = { mode, reason, roll24h, roll3d, roll7d, monthUsd };
  _rollingCache = { at: now, state };
  return state;
}

function thresholdsForMode(mode) {
  if (mode === "clamp" || mode === "emergency") return CONSERVATIVE;
  return V1;
}

function decideTier(features, scores, sessionKey, mode) {
  const t = thresholdsForMode(mode.mode);
  const sonnetAllowlisted = matchesAny(SONNET_ALLOWLIST, features.text);
  const sonnetStrong =
    (scores.sonnet >= t.sonnet && (features.strategyIntent || features.crossSourceSynthesis)) ||
    scores.sonnet >= t.sonnetVeryHigh;
  const sonnetMarginOk = (scores.sonnet - scores.haiku) >= t.sonnetMargin;
  const haikuStrong = scores.haiku >= t.haiku;

  if (features.hasAck) return { tier: "minimax", reason: "ack_force_minimax", thresholdMode: mode.mode };
  if (mode.mode === "emergency") {
    if (sonnetAllowlisted && sonnetStrong) return { tier: "sonnet", reason: "emergency_allowlisted_sonnet", thresholdMode: mode.mode };
    return { tier: "minimax", reason: "emergency_forced_minimax", thresholdMode: mode.mode };
  }
  if (sessionKey.includes(ABHIGNA_ID) && haikuStrong) {
    return { tier: "haiku", reason: "abhigna_acl_haiku", thresholdMode: mode.mode };
  }
  if (sonnetStrong && sonnetMarginOk) {
    return { tier: "sonnet", reason: "score_sonnet", thresholdMode: mode.mode };
  }
  if (haikuStrong) {
    return { tier: "haiku", reason: "score_haiku", thresholdMode: mode.mode };
  }
  return { tier: "minimax", reason: "default_minimax", thresholdMode: mode.mode };
}

function logDecision(event, ctx, chosen, scores, features, modeState) {
  try {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
    const mapped = MODELS[chosen.tier] || MODELS.minimax;
    const entry = {
      timestamp: new Date().toISOString(),
      policy_version: POLICY_VERSION,
      threshold_set_id: THRESHOLD_SET,
      threshold_mode: chosen.thresholdMode,
      threshold_reason: modeState.reason,
      decision_reason: chosen.reason,
      message_preview: String(event?.prompt || "").slice(0, 120),
      message_length: String(event?.prompt || "").length,
      trigger: ctx?.trigger || "unknown",
      sender: ctx?.sender || "unknown",
      channel: ctx?.channel || "unknown",
      tier: chosen.tier,
      provider: mapped.provider,
      model: mapped.model,
      anthropic_call: chosen.tier === "haiku" || chosen.tier === "sonnet",
      confidence: Number(Math.max(scores.minimax, scores.haiku, scores.sonnet).toFixed(3)),
      classifier: "plugin_scoring_v1",
      scores: {
        minimax: Number(scores.minimax.toFixed(3)),
        haiku: Number(scores.haiku.toFixed(3)),
        sonnet: Number(scores.sonnet.toFixed(3)),
      },
      features: {
        qCount: features.qCount,
        conjunctionCount: features.conjunctionCount,
        sentenceCount: features.sentenceCount,
        strategyIntent: features.strategyIntent,
        crossSourceSynthesis: features.crossSourceSynthesis,
        timeHorizon: features.timeHorizon,
      },
      rolling: {
        h24: modeState.roll24h ? { n: modeState.roll24h.n, share: Number(modeState.roll24h.share.toFixed(4)) } : null,
        d3: modeState.roll3d ? { n: modeState.roll3d.n, share: Number(modeState.roll3d.share.toFixed(4)) } : null,
        d7: modeState.roll7d ? { n: modeState.roll7d.n, share: Number(modeState.roll7d.share.toFixed(4)) } : null,
      },
      estimated_month_usd: Number(modeState.monthUsd.toFixed(4)),
    };
    appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n");
  } catch {
    // do not fail routing because logging fails
  }
}

/**
 * Single decision path shared by OpenClaw hook (routeQuery) and CLI/evals (routeForCli).
 * @returns {{ type: 'skip_cron' } | { type: 'tier0', direct: string } | { type: 'haiku_early' } | { type: 'scored', chosen: object, scores: object, features: object, modeState: object }}
 */
function resolveRoutingCore(event, ctx) {
  const prompt = event?.prompt || "";
  const sessionKey = ctx?.sessionKey || "";
  const trigger = ctx?.trigger || "";

  if (trigger === "cron" || trigger === "scheduled") {
    return { type: "skip_cron" };
  }

  const tier0 = tryTier0(prompt);
  if (tier0 !== null) {
    return { type: "tier0", direct: tier0 };
  }

  if (HAIKU_PATTERNS.some((p) => p.test(prompt)) && anthropicAllowedForPolicy(ctx)) {
    return { type: "haiku_early" };
  }

  const features = extractFeatures(prompt);
  const scores = computeScores(features);
  const modeState = getRoutingMode();
  const chosen = decideTier(features, scores, sessionKey, modeState);
  return { type: "scored", chosen, scores, features, modeState };
}

function routeQuery(event, ctx) {
  const r = resolveRoutingCore(event, ctx);

  if (r.type === "skip_cron") return undefined;

  if (r.type === "tier0") {
    _tier0Result = r.direct;
    process.stderr.write("[R] Tier0 hit — bypassing LLM\n");
    return { __tier0: true, directResponse: r.direct };
  }
  _tier0Result = null;

  if (r.type === "haiku_early") {
    process.stderr.write("[R] Haiku pattern hit — routing to Haiku\n");
    return {
      providerOverride: MODELS.haiku.providerOverride,
      modelOverride: MODELS.haiku.modelOverride,
    };
  }

  const chosen = { ...r.chosen };
  const { scores, features, modeState } = r;

  let route = undefined;
  if (chosen.tier !== "minimax" && !anthropicAllowedForPolicy(ctx)) {
    chosen.tier = "minimax";
    chosen.reason = "anthropic_unavailable_fallback_minimax";
  }
  if (chosen.tier !== "minimax") {
    route = {
      providerOverride: MODELS[chosen.tier].providerOverride,
      modelOverride: MODELS[chosen.tier].modelOverride,
    };
  }

  logDecision(event, ctx, chosen, scores, features, modeState);
  return route;
}

/**
 * Same routing policy as production (plugin), formatted for CLI and eval harnesses.
 * Sync — no duplicate YAML/LLM path (L-9 split-brain fix).
 * @param {string} message
 * @param {{ sessionKey?: string, sender?: string, channel?: string, trigger?: string }} [ctx]
 */
export function routeForCli(message, ctx = {}) {
  const startTime = Date.now();
  const event = { prompt: message };
  const r = resolveRoutingCore(event, ctx);

  if (r.type === "skip_cron") {
    return {
      model: MODELS.minimax.model,
      tier: "minimax",
      category: "cron_skip",
      confidence: 0,
      reason: "cron_uses_gateway_config",
      classifier: "plugin_v16",
      latency_ms: Date.now() - startTime,
      policy_version: POLICY_VERSION,
      threshold_set_id: THRESHOLD_SET,
      anthropic_call: false,
    };
  }

  if (r.type === "tier0") {
    process.stderr.write("[R] Tier0 hit — bypassing LLM\n");
    return {
      model: MODELS.minimax.model,
      tier: "minimax",
      category: "tier0_python",
      confidence: 0.99,
      reason: "tier0_python_bypass",
      classifier: "plugin_v16",
      latency_ms: Date.now() - startTime,
      policy_version: POLICY_VERSION,
      threshold_set_id: THRESHOLD_SET,
      anthropic_call: false,
    };
  }

  if (r.type === "haiku_early") {
    process.stderr.write("[R] Haiku pattern hit — routing to Haiku\n");
    return {
      model: MODELS.haiku.model,
      tier: "haiku",
      category: "haiku_pattern",
      confidence: 0.95,
      reason: "haiku_pattern_fast_path",
      classifier: "plugin_v16",
      latency_ms: Date.now() - startTime,
      policy_version: POLICY_VERSION,
      threshold_set_id: THRESHOLD_SET,
      anthropic_call: true,
    };
  }

  const chosen = { ...r.chosen };
  const { scores, features, modeState } = r;

  if (chosen.tier !== "minimax" && !anthropicAllowedForPolicy(ctx)) {
    chosen.tier = "minimax";
    chosen.reason = "anthropic_unavailable_fallback_minimax";
  }

  logDecision(event, ctx, chosen, scores, features, modeState);

  const mapped = MODELS[chosen.tier] || MODELS.minimax;
  const confidence = Math.max(scores.minimax, scores.haiku, scores.sonnet);

  return {
    model: mapped.model,
    tier: chosen.tier,
    category: chosen.reason,
    confidence: Number(confidence.toFixed(3)),
    reason: chosen.reason,
    classifier: "plugin_v16",
    latency_ms: Date.now() - startTime,
    policy_version: POLICY_VERSION,
    threshold_set_id: THRESHOLD_SET,
    threshold_mode: modeState.mode,
    anthropic_call: chosen.tier === "haiku" || chosen.tier === "sonnet",
    semantic_scores: {
      minimax: Number(scores.minimax.toFixed(3)),
      haiku: Number(scores.haiku.toFixed(3)),
      sonnet: Number(scores.sonnet.toFixed(3)),
    },
    rolling: {
      h24: modeState.roll24h ? { n: modeState.roll24h.n, share: Number(modeState.roll24h.share.toFixed(4)) } : null,
      d3: modeState.roll3d ? { n: modeState.roll3d.n, share: Number(modeState.roll3d.share.toFixed(4)) } : null,
      d7: modeState.roll7d ? { n: modeState.roll7d.n, share: Number(modeState.roll7d.share.toFixed(4)) } : null,
    },
  };
}

let patchCount = 0;
function patchRunner(runner) {
  if (!runner || runner._lyraPatched) return;
  const origRun = runner.runBeforeModelResolve;
  if (typeof origRun !== "function") return;

  patchCount++;
  const myPatchId = patchCount;

  runner.runBeforeModelResolve = async function(event, ctx) {
    let result;
    try { result = await origRun.call(this, event, ctx); } catch(e) {}
    if (result?.modelOverride || result?.providerOverride) return result;
    const route = routeQuery(event, ctx);
    if (route) process.stderr.write("[R] -> " + route.modelOverride + "\n");
    return route || result;
  };

  const origHas = runner.hasHooks;
  if (typeof origHas === "function") {
    runner.hasHooks = function(name) {
      if (name === "before_model_resolve") return true;
      return origHas.call(this, name);
    };
  }
  runner._lyraPatched = true;
  runner._lyraId = myPatchId;
  // process.stderr.write("[R] Patched #" + myPatchId + "!\n");
}

const HR_KEY = Symbol.for("openclaw.plugins.hook-runner-global-state");
const SETUP_KEY = Symbol.for("lyra-model-router.v16");

if (!globalThis[SETUP_KEY]) {
  globalThis[SETUP_KEY] = true;

  let _hrState = globalThis[HR_KEY] || null;

  const watchState = (state) => {
    if (!state || state._lyraWatched) return;
    state._lyraWatched = true;
    let _runner = state.hookRunner;
    if (_runner) patchRunner(_runner);

    const desc = Object.getOwnPropertyDescriptor(state, "hookRunner");
    if (desc && !desc.configurable) return;

    try {
      Object.defineProperty(state, "hookRunner", {
        get() { return _runner; },
        set(v) {
          _runner = v;
          if (v) patchRunner(v);
        },
        configurable: true,
        enumerable: true,
      });
    } catch(e) {}
  };

  if (_hrState) watchState(_hrState);

  try {
    Object.defineProperty(globalThis, HR_KEY, {
      get() { return _hrState; },
      set(v) {
        _hrState = v;
        if (v) watchState(v);
      },
      configurable: true,
      enumerable: true,
    });
  } catch(e) {
    setInterval(() => {
      const state = globalThis[HR_KEY];
      if (state?.hookRunner && !state.hookRunner._lyraPatched) patchRunner(state.hookRunner);
    }, 50);
  }
}

// Intercept stderr to detect rate limit errors and auto-disable Anthropic
const _origStderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = function(chunk, ...args) {
  const str = typeof chunk === "string" ? chunk : (chunk?.toString?.() || "");
  if (str.includes("API usage limits") || str.includes("rate_limit")) {
    markAnthropicFailed();
  }
  return _origStderrWrite(chunk, ...args);
};

const plugin = {
  id: "lyra-model-router",
  name: "Lyra Model Router",
  description: "Tier 0 Python bypass + MiniMax-first 4-way routing with rolling guardrails",
  register(api) {
    api.on("before_model_resolve", (event, ctx) => {
      const result = routeQuery(event, ctx);
      if (result?.__tier0) {
        // Inject direct response — bypass model call entirely
        if (typeof api.respondDirect === "function") {
          api.respondDirect(result.directResponse);
          return { __skip: true };
        }
        // Fallback: if OpenClaw doesn't support respondDirect, let MiniMax handle it
        // but prepend the Python result so the model just echoes/formats it
        event.prompt = `[CRUD result — format nicely for Telegram]\n${result.directResponse}`;
        return undefined;
      }
      return result || {};
    });
    // Registration logged via stderr only to avoid contaminating eval JSON output
    process.stderr.write("[lyra-model-router] v16 registered (4-way thresholds + rolling guardrails)\n");
  },
};

export default plugin;
