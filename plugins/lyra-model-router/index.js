/**
 * Lyra Model Router v14 — OpenClaw Plugin
 *
 * This is the server-side routing plugin that runs inside OpenClaw on Hetzner.
 * It intercepts model resolution and routes to the appropriate provider/model.
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

const ABHIGNA_ID = "5003298152";

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
  /\b(brain brief|weekly brief|digest quality|content suggest|analyze themes?|synthesize|synthesis)\b/i,
  /\b(draft (a |an )?(blog|article|essay|report|strategy|plan|proposal))\b/i,
  /\b(compare and contrast|pros and cons|strategic analysis|deep dive|comprehensive review)\b/i,
  /\b(across (all |my )?databases|connect the dots|find patterns?|what themes)\b/i,
  /\b(write me a|compose a|create a detailed|elaborate on)\b/i,
];
const HAIKU_PATTERNS = [
  /\b(exactly \d+ (bullet|point|item|sentence|word)|format (as|it as)|in (a )?table|markdown format)\b/i,
  /\b(draft (a |an )?email|reply to|respond to .* email|write back to)\b/i,
  /\b(what (can|do) (i|you) have access|show me .* database|list .* databases?|what databases?)\b/i,
  /\b(search (the web|google|online)|find (me |)(articles?|news|information) about)\b/i,
  /\b(summarize|summary of|brief me|give me (a |the )?(rundown|overview|highlights?))\b/i,
];

function routeQuery(event, ctx) {
  const prompt = event?.prompt || "";
  const sessionKey = ctx?.sessionKey || "";
  const trigger = ctx?.trigger || "";

  // Crons use their own model config
  if (trigger === "cron" || trigger === "scheduled") return undefined;

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
  process.stderr.write("[R] Patched #" + myPatchId + "!\n");
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
  description: "3-tier routing with rate-limit fallback: MiniMax (default) -> Haiku -> Sonnet",
  register(api) {
    api.on("before_model_resolve", (event, ctx) => routeQuery(event, ctx) || {});
    api.logger.info("[lyra-model-router] v14 registered (Anthropic disabled - rate limited until April 1)");
  },
};

export default plugin;
