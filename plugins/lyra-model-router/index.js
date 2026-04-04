/**
 * Lyra Model Router v15 — OpenClaw Plugin
 *
 * This is the server-side routing plugin that runs inside OpenClaw on Hetzner.
 * It intercepts model resolution and routes to the appropriate provider/model.
 *
 * v15: Tier 0 Python bypass. Pure CRUD operations (list reminders, add item,
 * mark done, etc.) are executed via Python scripts directly — zero LLM tokens.
 * Exits before model resolution if matched.
 *
 * v15.1: Normalize prompts (strip trailing "just list briefly") and relax list
 * patterns ("current reminders", text after core phrase) so eval phrasing hits Tier 0.
 *
 * v15.2: Tier 0 health — messages that match crud/cli.py parse() health regexes run
 * `python3 cli.py parse` with zero LLM tokens. Writes go to Lyra Health Coach DBs
 * (Daily / Food / Workout / Snapshots) via crud/notion.py — same as manual cli.
 *
 * v14: Rate-limit aware routing. When Anthropic API is rate-limited,
 * all requests fall back to MiniMax instead of failing.
 * Starts with Anthropic DISABLED (rate limited until April 1).
 * Auto re-checks every 30 minutes.
 *
 * Deployment: SCP to /root/lyra-model-router/index.js on Hetzner, restart openclaw.
 *
 * NOTE: This is different from scripts/model-router.js which is the local
 * CLI-based classifier with rule+LLM routing. This plugin hooks directly
 * into OpenClaw's model resolution pipeline.
 */

import { execFileSync } from "child_process";
import { existsSync } from "fs";

const ABHIGNA_ID = "5003298152";

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

const TIER0_PATTERNS = [
  /^(?:list|show|what(?:'s| is| are)(?: in| on)?)\s+(?:my|the)\s+(?:current\s+)?(?:reminders?|tasks?)\b/i,
  /^(?:show|list)(?:\s+me)?(?:\s+my)?\s+(?:current\s+)?(?:reminders?|tasks?)\b/i,
  /^(?:list|show)\s+(?:my|the)\s+(?:current\s+)?(?:reminders?|tasks?)\b/i,
  /^(?:what'?s?|show|list)(?: in| on)?(?: my)?(?: the)? meal (?:plan|planning)$/i,
  /^(?:show|list) (?:me )?(?:my )?meals?$/i,
  /^(?:what'?s?|show|list)(?: my)?(?: upcoming)? trips?$/i,
  /^remind me (?:to |about )?/i,
  /^set (?:a )?reminder (?:to |for |about )?/i,
  /^add .+? to (?:(?:my |the )?(?:shopping|grocery|groceries|meal|task|todo|reminder|trip|content|idea)s? (?:list|plan|db|database)?|(?:my )?reminders?)$/i,
  /^mark .+? (?:as )?(?:done|complete|finished)$/i,
  /^(?:done|complete|finished)[:\s]+.+$/i,
];

const CRUD_CLI = "/root/lyra-ai/crud/cli.py";

function tryTier0(prompt) {
  const trimmed = normalizeTier0Prompt(prompt);
  const matched =
    TIER0_PATTERNS.some((p) => p.test(trimmed)) ||
    HEALTH_TIER0_PATTERNS.some((p) => p.test(trimmed));
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

const SONNET_PATTERNS = [
  /\b(?:brain brief|weekly brief|digest quality|content suggest|analyze themes?|synthesize|synthesis)\b/i,
  /\bdraft (?:a |an )?(?:blog|article|essay|report|strategy|plan|proposal)\b/i,
  /\b(?:compare and contrast|pros and cons|strategic analysis|deep dive|comprehensive review)\b/i,
  /\b(?:across (?:all |my )?databases|connect the dots|find patterns?|what themes)\b/i,
  /\b(?:write me a|compose a|create a detailed|elaborate on)\b/i,
];
const HAIKU_PATTERNS = [
  /\b(?:exactly \d+ (?:bullet|point|item|sentence|word)|format (?:as|it as)|in (?:a )?table|markdown format)\b/i,
  /\b(?:draft (?:a |an )?email|reply to|respond to .{0,40}email|write back to)\b/i,
  /\b(?:what (?:can|do) (?:i|you) have access|show me .{0,40}database|list .{0,40}databases?|what databases?)\b/i,
  /\b(?:search (?:the web|google|online)|find (?:me )?(?:articles?|news|information) about)\b/i,
  /\b(?:summarize|summary of|brief me|give me (?:a |the )?(?:rundown|overview|highlights?))\b/i,
];

// tier0Result is set when a CRUD bypass executes before model resolution
let _tier0Result = null;

function routeQuery(event, ctx) {
  const prompt = event?.prompt || "";
  const sessionKey = ctx?.sessionKey || "";
  const trigger = ctx?.trigger || "";

  // Crons use their own model config
  if (trigger === "cron" || trigger === "scheduled") return undefined;

  // Tier 0: CRUD Python bypass — check before any model routing
  // If matched, store result and signal "use noop model" (will be intercepted post-hook)
  const tier0 = tryTier0(prompt);
  if (tier0 !== null) {
    _tier0Result = tier0;
    process.stderr.write(`[R] Tier0 hit — bypassing LLM\n`);
    // Return a special marker; the response hook below will short-circuit
    return { __tier0: true, directResponse: tier0 };
  }
  _tier0Result = null;

  // If Anthropic is unavailable, everything stays on MiniMax (default)
  if (!isAnthropicAvailable()) {
    return undefined;
  }

  // Abhigna -> Haiku (ACL-aware responses)
  if (sessionKey.includes(ABHIGNA_ID)) {
    return { providerOverride: "anthropic", modelOverride: "claude-haiku-4-5" };
  }

  // Sonnet patterns
  for (const p of SONNET_PATTERNS) {
    if (p.test(prompt)) return { providerOverride: "anthropic", modelOverride: "claude-sonnet-4-6" };
  }

  // Haiku patterns
  for (const p of HAIKU_PATTERNS) {
    if (p.test(prompt)) return { providerOverride: "anthropic", modelOverride: "claude-haiku-4-5" };
  }

  // Long messages -> Haiku
  if (prompt.trim().length > 500) {
    return { providerOverride: "anthropic", modelOverride: "claude-haiku-4-5" };
  }

  return undefined;
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
const SETUP_KEY = Symbol.for("lyra-model-router.v14");

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
  description: "Tier 0 Python bypass + 3-tier routing: Python (0 tokens) -> MiniMax -> Haiku -> Sonnet",
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
    process.stderr.write("[lyra-model-router] v15.2 registered (Tier 0 CRUD + health)\n");
  },
};

export default plugin;
