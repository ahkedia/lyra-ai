#!/usr/bin/env node

/**
 * Lyra Model Router — Classifies incoming messages and routes to the right model.
 *
 * Three-tier routing:
 *   1. Rule-based classifier (free, <1ms) — catches ~80% of tasks
 *   2. LLM classifier via Haiku (~$0.001, ~500ms) — for ambiguous cases
 *   3. Returns: { model, tier, category, confidence, reason }
 *
 * Usage:
 *   node model-router.js "Add milk to the shopping list"
 *   node model-router.js --json "Synthesize my week"
 *   node model-router.js --stats  (show routing stats from log)
 *
 * As module:
 *   import { routeMessage } from './model-router.js';
 *   const result = await routeMessage("Add milk to the list");
 */

import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import YAML from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = process.env.ROUTING_CONFIG || join(__dirname, '..', 'config', 'routing-rules.yaml');
const LOG_DIR = process.env.ROUTING_LOG_DIR || join(__dirname, '..', 'logs');
const LOG_PATH = join(LOG_DIR, 'routing-decisions.jsonl');
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';

// --- Load routing rules ---
let config;
try {
  const raw = readFileSync(CONFIG_PATH, 'utf8');
  config = YAML.parse(raw);
} catch (err) {
  console.error(`[router] Failed to load routing config: ${err.message}`);
  config = { default_model: 'minimax', confidence_threshold: 0.7, tiers: {}, overrides: {} };
}

// Models map
const MODELS = {
  minimax: 'minimax/minimax-m2-5',
  haiku: 'anthropic/claude-haiku-4-5',
  sonnet: 'anthropic/claude-sonnet-4-6',
};

// --- Rule-based classifier ---

/**
 * Classify a message using pattern matching and keyword detection.
 * Returns { tier, category, confidence, reason } or null if no match.
 */
function classifyByRules(message) {
  const msgLower = message.toLowerCase().trim();
  const msgLen = message.length;

  // 1. Check overrides first
  if (config.overrides) {
    // Always MiniMax
    for (const pattern of config.overrides.always_minimax || []) {
      if (new RegExp(pattern, 'i').test(msgLower)) {
        return { tier: 'minimax', category: 'override_simple', confidence: 0.99, reason: 'Override: simple greeting/acknowledgment' };
      }
    }

    // Always Sonnet
    for (const pattern of config.overrides.always_sonnet || []) {
      if (new RegExp(pattern, 'i').test(msgLower)) {
        return { tier: 'sonnet', category: 'override_synthesis', confidence: 0.95, reason: `Override: matches synthesis trigger "${pattern}"` };
      }
    }

    // Never MiniMax
    for (const pattern of config.overrides.never_minimax || []) {
      if (new RegExp(pattern, 'i').test(msgLower)) {
        return { tier: 'sonnet', category: 'override_complex', confidence: 0.90, reason: `Override: task too complex for MiniMax "${pattern}"` };
      }
    }
  }

  // 2. Score each tier's categories
  const scores = [];

  for (const [tierName, tierConfig] of Object.entries(config.tiers || {})) {
    for (const [catName, catConfig] of Object.entries(tierConfig.categories || {})) {
      let score = 0;
      let matchReason = '';

      // Pattern matching
      for (const pattern of catConfig.patterns || []) {
        try {
          if (new RegExp(pattern, 'i').test(msgLower)) {
            score += 0.4;
            matchReason = `Pattern match: /${pattern}/`;
            break;
          }
        } catch {
          // Skip invalid regex
        }
      }

      // Keyword matching
      for (const keyword of catConfig.keywords || []) {
        if (msgLower.includes(keyword.toLowerCase())) {
          score += 0.3;
          if (!matchReason) matchReason = `Keyword: "${keyword}"`;
          break;
        }
      }

      // Complexity signals
      if (catConfig.signals) {
        const conjunctions = (msgLower.match(/\b(and|then|also|plus|after that)\b/g) || []).length;
        const sentences = message.split(/[.!?]+/).filter(s => s.trim()).length;

        if (catConfig.signals.conjunction_count && conjunctions >= parseInt(catConfig.signals.conjunction_count.replace('>= ', ''))) {
          score += 0.2;
        }
        if (catConfig.signals.sentence_count && sentences >= parseInt(catConfig.signals.sentence_count.replace('>= ', ''))) {
          score += 0.1;
        }
      }

      if (score > 0) {
        scores.push({
          tier: tierName,
          category: catName,
          confidence: Math.min(score, 0.95),
          reason: matchReason,
        });
      }
    }
  }

  // 3. Apply ambiguity signals as tiebreakers
  if (config.ambiguity_signals) {
    const hasConditional = /\b(if|unless|depending|it depends)\b/i.test(msgLower);
    const questionMarks = (message.match(/\?/g) || []).length;
    const hasMetaReasoning = /\b(what do you think|help me decide|what should I|should I)\b/i.test(msgLower);
    const hasTemporalScope = /\b(this week|this month|this quarter|over time|lately|recently)\b/i.test(msgLower);
    const mentionsMultipleDomains = countDomains(msgLower) >= 2;

    // Boost Sonnet signals
    if (hasMetaReasoning || mentionsMultipleDomains) {
      scores.push({
        tier: 'sonnet',
        category: 'ambiguity_escalation',
        confidence: 0.65,
        reason: `Ambiguity signal: ${hasMetaReasoning ? 'meta-reasoning' : 'multi-domain'}`,
      });
    }

    // Boost Haiku signals
    if (msgLen > 200 || questionMarks >= 2 || hasConditional) {
      scores.push({
        tier: 'haiku',
        category: 'ambiguity_moderate',
        confidence: 0.55,
        reason: `Ambiguity signal: ${msgLen > 200 ? 'long message' : questionMarks >= 2 ? 'multiple questions' : 'conditional'}`,
      });
    }

    // Boost Sonnet for long + temporal
    if (msgLen > 500 || hasTemporalScope) {
      scores.push({
        tier: 'sonnet',
        category: 'ambiguity_synthesis',
        confidence: 0.60,
        reason: `Ambiguity signal: ${msgLen > 500 ? 'very long message' : 'temporal scope'}`,
      });
    }
  }

  // 4. Pick the highest-confidence match
  if (scores.length === 0) return null;

  // Sort by confidence desc, then by tier priority (sonnet > haiku > minimax) for tiebreaking
  const tierPriority = { sonnet: 3, haiku: 2, minimax: 1 };
  scores.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return (tierPriority[b.tier] || 0) - (tierPriority[a.tier] || 0);
  });

  return scores[0];
}

/**
 * Count how many distinct domains a message touches.
 * Domains: work, household, content, health, travel, finance
 */
function countDomains(msgLower) {
  const domains = {
    work: /\b(work|job|career|recruiter|interview|competitor|market|product|team|manager|company)\b/,
    household: /\b(abhigna|wife|groceries|shopping|meal|dinner|cook|house|apartment|cleaning)\b/,
    content: /\b(content|blog|post|article|linkedin|twitter|write|publish|ideas?)\b/,
    health: /\b(health|medicine|supplement|doctor|dentist|gym|exercise|workout|diet)\b/,
    travel: /\b(trip|travel|flight|hotel|vacation|holiday|visit|airport)\b/,
    finance: /\b(money|budget|expense|salary|tax|invest|savings|cost)\b/,
  };

  let count = 0;
  for (const regex of Object.values(domains)) {
    if (regex.test(msgLower)) count++;
  }
  return count;
}

// --- LLM classifier (Haiku fallback) ---

/**
 * Use Claude Haiku to classify an ambiguous message.
 * Only called when rule-based confidence < threshold.
 */
async function classifyByLLM(message) {
  if (!ANTHROPIC_KEY) {
    return { tier: 'minimax', category: 'llm_fallback_no_key', confidence: 0.5, reason: 'No API key — defaulting to MiniMax' };
  }

  const systemPrompt = `You are a routing classifier for Lyra, a personal AI assistant. Classify the user's message into ONE of three tiers based on complexity.

TIER DEFINITIONS:
- minimax: Simple, single-action tasks. Notion writes, lookups, reminders, weather, greetings, short replies. No reasoning needed.
- haiku: Moderate complexity. Email drafting, web search, multi-step tasks, data formatting, cross-user coordination. Some reasoning.
- sonnet: Complex reasoning. Synthesis across sources, strategic analysis, competitive intelligence, long-form drafting, planning, pattern-finding.

DECISION RULE:
- If it's a single tool call → minimax
- If it needs 2-3 tool calls or moderate judgment → haiku
- If it needs reasoning across multiple domains, strategic thinking, or synthesis → sonnet

Respond with ONLY a JSON object: {"tier": "minimax|haiku|sonnet", "category": "<short_category>", "reasoning": "<one sentence>"}`;

  const body = JSON.stringify({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 100,
    system: systemPrompt,
    messages: [{ role: 'user', content: `Classify this message:\n"${message.slice(0, 500)}"` }],
  });

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.anthropic.com',
      port: 443,
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            resolve({ tier: 'minimax', category: 'llm_error', confidence: 0.5, reason: `LLM error: ${parsed.error.message}` });
            return;
          }
          let text = parsed.content?.[0]?.text || '';
          text = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
          const result = JSON.parse(text);
          const tier = ['minimax', 'haiku', 'sonnet'].includes(result.tier) ? result.tier : 'minimax';
          resolve({
            tier,
            category: result.category || 'llm_classified',
            confidence: 0.80,
            reason: `LLM classifier: ${result.reasoning || 'no reason'}`,
          });
        } catch (err) {
          resolve({ tier: 'minimax', category: 'llm_parse_error', confidence: 0.5, reason: `LLM parse error: ${err.message}` });
        }
      });
    });

    req.on('error', (err) => {
      resolve({ tier: 'minimax', category: 'llm_network_error', confidence: 0.5, reason: `Network error: ${err.message}` });
    });

    req.setTimeout(5000, () => {
      req.destroy();
      resolve({ tier: 'minimax', category: 'llm_timeout', confidence: 0.5, reason: 'LLM classifier timed out — defaulting to MiniMax' });
    });

    req.write(body);
    req.end();
  });
}

// --- Main router ---

/**
 * Route a message to the appropriate model.
 * @param {string} message - The user's message
 * @param {object} context - Optional context { sender, channel, session_type }
 * @returns {Promise<{ model, tier, category, confidence, reason, classifier }>}
 */
export async function routeMessage(message, context = {}) {
  const startTime = Date.now();

  // Step 1: Rule-based classification
  const ruleResult = classifyByRules(message);

  let decision;
  let classifier;

  if (ruleResult && ruleResult.confidence >= (config.confidence_threshold || 0.7)) {
    // High-confidence rule match
    decision = ruleResult;
    classifier = 'rules';
  } else if (ruleResult && ruleResult.confidence >= 0.5) {
    // Medium confidence — try LLM for confirmation
    const llmResult = await classifyByLLM(message);
    // If LLM agrees with rules, boost confidence
    if (llmResult.tier === ruleResult.tier) {
      decision = { ...ruleResult, confidence: Math.min(ruleResult.confidence + 0.2, 0.95), reason: `${ruleResult.reason} (confirmed by LLM)` };
      classifier = 'rules+llm';
    } else {
      // LLM disagrees — trust LLM (it has better judgment)
      decision = llmResult;
      classifier = 'llm_override';
    }
  } else {
    // No rule match — use LLM classifier
    const llmResult = await classifyByLLM(message);
    decision = llmResult;
    classifier = 'llm';
  }

  const result = {
    model: MODELS[decision.tier] || MODELS.minimax,
    tier: decision.tier,
    category: decision.category,
    confidence: decision.confidence,
    reason: decision.reason,
    classifier,
    latency_ms: Date.now() - startTime,
  };

  // Log the decision
  logDecision(message, result, context);

  return result;
}

/**
 * Log routing decisions for analytics and tuning.
 */
function logDecision(message, result, context) {
  try {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
    const entry = {
      timestamp: new Date().toISOString(),
      message_preview: message.slice(0, 100),
      message_length: message.length,
      ...result,
      sender: context.sender || 'unknown',
      channel: context.channel || 'unknown',
    };
    appendFileSync(LOG_PATH, JSON.stringify(entry) + '\n');
  } catch {
    // Silent fail on logging
  }
}

// --- Stats ---

/**
 * Print routing stats from the log file.
 */
function printStats() {
  if (!existsSync(LOG_PATH)) {
    console.log('No routing log found. Run the router first.');
    return;
  }

  const lines = readFileSync(LOG_PATH, 'utf8').trim().split('\n');
  const entries = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

  if (entries.length === 0) {
    console.log('No routing entries found.');
    return;
  }

  // Tier distribution
  const tierCounts = {};
  const categoryCounts = {};
  const classifierCounts = {};
  let totalLatency = 0;

  for (const e of entries) {
    tierCounts[e.tier] = (tierCounts[e.tier] || 0) + 1;
    categoryCounts[e.category] = (categoryCounts[e.category] || 0) + 1;
    classifierCounts[e.classifier] = (classifierCounts[e.classifier] || 0) + 1;
    totalLatency += e.latency_ms || 0;
  }

  console.log('=== Lyra Model Router — Statistics ===\n');
  console.log(`Total routed: ${entries.length}`);
  console.log(`Avg latency: ${Math.round(totalLatency / entries.length)}ms\n`);

  console.log('Tier distribution:');
  for (const [tier, count] of Object.entries(tierCounts).sort((a, b) => b[1] - a[1])) {
    const pct = Math.round((count / entries.length) * 100);
    const bar = '█'.repeat(Math.round(pct / 2));
    console.log(`  ${tier.padEnd(8)} ${String(count).padStart(4)} (${String(pct).padStart(2)}%) ${bar}`);
  }

  console.log('\nClassifier distribution:');
  for (const [cls, count] of Object.entries(classifierCounts).sort((a, b) => b[1] - a[1])) {
    const pct = Math.round((count / entries.length) * 100);
    console.log(`  ${cls.padEnd(15)} ${String(count).padStart(4)} (${String(pct).padStart(2)}%)`);
  }

  console.log('\nTop categories:');
  const sorted = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  for (const [cat, count] of sorted) {
    console.log(`  ${cat.padEnd(25)} ${count}`);
  }

  // Recent decisions
  console.log('\nLast 5 decisions:');
  for (const e of entries.slice(-5)) {
    console.log(`  ${e.tier.padEnd(8)} → ${e.category.padEnd(20)} "${e.message_preview.slice(0, 50)}..." (${e.confidence.toFixed(2)}, ${e.classifier})`);
  }
}

// --- CLI ---

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--stats')) {
    printStats();
    return;
  }

  if (args.includes('--help') || args.length === 0) {
    console.log(`
Lyra Model Router — Classify and route messages to the right model.

Usage:
  node model-router.js "Your message here"
  node model-router.js --json "Your message here"    (JSON output)
  node model-router.js --stats                        (show routing stats)
  node model-router.js --batch                        (read messages from stdin, one per line)
  node model-router.js --test                         (run built-in test suite)

Environment:
  ROUTING_CONFIG      Path to routing-rules.yaml (default: ../config/routing-rules.yaml)
  ANTHROPIC_API_KEY   Required for LLM classifier fallback
  ROUTING_LOG_DIR     Directory for routing logs (default: ../logs/)
`);
    return;
  }

  if (args.includes('--test')) {
    await runBuiltInTests();
    return;
  }

  if (args.includes('--batch')) {
    // Read from stdin
    const { createInterface } = await import('readline');
    const rl = createInterface({ input: process.stdin });
    for await (const line of rl) {
      if (line.trim()) {
        const result = await routeMessage(line.trim());
        console.log(JSON.stringify({ message: line.trim().slice(0, 80), ...result }));
      }
    }
    return;
  }

  const isJson = args.includes('--json');
  const message = args.filter(a => !a.startsWith('--')).join(' ');

  if (!message) {
    console.error('No message provided.');
    process.exit(1);
  }

  const result = await routeMessage(message);

  if (isJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Model:      ${result.model}`);
    console.log(`Tier:       ${result.tier}`);
    console.log(`Category:   ${result.category}`);
    console.log(`Confidence: ${result.confidence.toFixed(2)}`);
    console.log(`Classifier: ${result.classifier}`);
    console.log(`Reason:     ${result.reason}`);
    console.log(`Latency:    ${result.latency_ms}ms`);
  }
}

/**
 * Built-in test suite to validate routing rules.
 */
async function runBuiltInTests() {
  const tests = [
    // MiniMax (simple)
    { message: 'Add milk to the shopping list', expected: 'minimax' },
    { message: 'Thanks!', expected: 'minimax' },
    { message: 'What time does my morning digest run?', expected: 'minimax' },
    { message: "What's the weather in Berlin?", expected: 'minimax' },
    { message: 'Remind me to call the dentist by Friday', expected: 'minimax' },
    { message: 'Mark the electrician task as done', expected: 'minimax' },
    { message: 'How many content ideas do I have?', expected: 'minimax' },
    { message: 'List my cron jobs', expected: 'minimax' },
    { message: 'ok', expected: 'minimax' },
    { message: 'good morning', expected: 'minimax' },

    // Haiku (moderate)
    { message: 'Check my email for anything urgent', expected: 'haiku' },
    { message: 'Draft a reply to the recruiter about the timeline', expected: 'haiku' },
    { message: 'Search for the latest ECB digital euro updates', expected: 'haiku' },
    { message: 'Add milk to the list, then remind Abhigna to buy it, and check if we have eggs', expected: 'haiku' },
    { message: 'Show my tasks as a table with deadlines', expected: 'haiku' },

    // Sonnet (complex)
    { message: 'Summarize my week — what decisions did I make, what ideas did I capture?', expected: 'sonnet' },
    { message: "Analyze Revolut vs Monzo's approach to crypto", expected: 'sonnet' },
    { message: 'Draft a blog post about my experience building a personal AI', expected: 'sonnet' },
    { message: 'Help me plan the next quarter\'s content strategy', expected: 'sonnet' },
    { message: 'What patterns do you see across my content ideas this month?', expected: 'sonnet' },
    { message: 'Give me a competitive digest for this week', expected: 'sonnet' },
    { message: 'weekly review', expected: 'sonnet' },
    { message: 'brain brief', expected: 'sonnet' },
  ];

  console.log('=== Model Router — Built-in Tests ===\n');
  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    const result = await routeMessage(test.message, { sender: 'test', channel: 'test' });
    const match = result.tier === test.expected;
    const status = match ? '✅' : '❌';

    if (!match) {
      console.log(`${status} "${test.message.slice(0, 60)}"`);
      console.log(`   Expected: ${test.expected}, Got: ${result.tier} (${result.category}, ${result.confidence.toFixed(2)}, ${result.classifier})`);
      failed++;
    } else {
      console.log(`${status} "${test.message.slice(0, 60)}" → ${result.tier} (${result.confidence.toFixed(2)})`);
      passed++;
    }
  }

  console.log(`\n${passed}/${tests.length} passed (${Math.round((passed / tests.length) * 100)}%)`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
