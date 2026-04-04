/**
 * Lyra Eval Runner — Main orchestrator.
 * Uses WebSocket client (ws-client.js) for persistent session to Lyra gateway.
 * Validates responses and writes JSONL results.
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import YAML from 'yaml';
import { runValidators } from './validators.js';
import { judgeResponse } from './llm-judge.js';
import { OpenClawClient } from './ws-client.js';
import {
  classifyStability,
  isInfrastructureFailure,
  computeSplitScores,
} from './lib/metrics.js';

const RUN_ID = Date.now().toString(36);

/** Pacing — tune via env (Phase 1: reduce gateway OOM under long runs) */
const POST_TEST_MS = Math.max(0, parseInt(process.env.EVAL_POST_TEST_MS || '2000', 10));
const INTER_TEST_DELAY_MS = Math.max(0, parseInt(process.env.EVAL_INTER_TEST_DELAY_MS || '10000', 10));
const BATCH_SIZE = Math.max(1, parseInt(process.env.EVAL_BATCH_SIZE || '12', 10));
const BATCH_PAUSE_MS = Math.max(0, parseInt(process.env.EVAL_BATCH_PAUSE_MS || '45000', 10));
const HEALTH_WAIT_MS = Math.max(5000, parseInt(process.env.EVAL_HEALTH_WAIT_MS || '120000', 10));
const GATEWAY_HEALTH_URL = process.env.GATEWAY_HEALTH_URL || 'http://127.0.0.1:18789/health';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(__dirname, 'results');
const CASES_DIR = process.env.CASES_DIR || join(__dirname, 'cases');
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';

if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });

// WebSocket client — shared across all tests for persistent session
let wsClient = null;

async function ensureConnected() {
  if (wsClient && wsClient.connected) return;
  wsClient = new OpenClawClient(
    'ws://localhost:18789',
    process.env.OPENCLAW_GATEWAY_TOKEN
  );
  await wsClient.connect();
  console.log('[ws] Connected to gateway.');
}

/**
 * Wait until gateway /health reports ok (after batch pause or OOM recovery).
 */
async function waitForGatewayHealth() {
  const start = Date.now();
  while (Date.now() - start < HEALTH_WAIT_MS) {
    try {
      const r = await fetch(GATEWAY_HEALTH_URL);
      if (r.ok) {
        const j = await r.json();
        if (j.ok === true) return true;
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
}

/**
 * Load all test cases from YAML files.
 */
function loadTestCases() {
  const cases = [];
  const files = [
    'tier1-core-capability.yaml',
    'tier2-architectural.yaml',
    'tier3-judgment.yaml',
    'tier4-showcase.yaml',
    'tier5-production-gaps.yaml',
  ];

  for (const file of files) {
    const path = join(CASES_DIR, file);
    if (!existsSync(path)) {
      console.warn(`[warn] Test file not found: ${path}`);
      continue;
    }
    const content = readFileSync(path, 'utf8');
    const parsed = YAML.parse(content);
    if (Array.isArray(parsed?.tests)) {
      cases.push(...parsed.tests);
    }
  }

  return cases;
}

/**
 * Send a message to Lyra via persistent WebSocket session.
 * Returns { text, durationMs, ttftMs, model, provider, sessionId, error }
 */
async function sendToLyra(message, timeoutMs = 30000, sessionKey = null) {
  await ensureConnected(); // reconnects if gateway restarted mid-run
  const startTime = Date.now();
  try {
    const opts = { timeout: timeoutMs };
    if (sessionKey) opts.sessionKey = sessionKey;
    const result = await wsClient.chat(message, opts);
    return {
      text: result.text,
      durationMs: result.latencyMs,
      ttftMs: result.ttftMs,
      model: 'unknown',
      provider: 'unknown',
      sessionId: null,
      error: null,
    };
  } catch (err) {
    // Mark disconnected so ensureConnected() reconnects on next test
    if (err.message?.includes('Connection closed') || err.message?.includes('Not connected')) {
      if (wsClient) wsClient.connected = false;
    }
    return {
      text: '',
      durationMs: Date.now() - startTime,
      ttftMs: 0,
      model: 'unknown',
      provider: 'unknown',
      sessionId: null,
      error: err.message?.slice(0, 200) || 'error',
    };
  }
}

/**
 * Minimal Notion API helper for cleanup operations.
 */
function notionRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.notion.com',
      path,
      method,
      headers: {
        'Authorization': `Bearer ${process.env.NOTION_API_KEY}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve({}); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/**
 * Post-test cleanup hook for write+cleanup tests.
 * Archives Notion pages matching title_contains (reversible soft-delete).
 */
async function runCleanup(cleanupConfig) {
  if (!cleanupConfig) return;
  if (cleanupConfig.action === 'notion_delete_matching') {
    const { database, title_contains } = cleanupConfig;
    try {
      const result = await notionRequest('POST', `/v1/databases/${database}/query`, {
        filter: { property: 'Name', title: { contains: title_contains } },
      });
      if (!result.results?.length) return;
      for (const page of result.results) {
        await notionRequest('PATCH', `/v1/pages/${page.id}`, { archived: true });
        console.log(`    [cleanup] Archived: ${page.id} (matched: "${title_contains}")`);
      }
    } catch (err) {
      console.warn(`    [cleanup] Failed (non-fatal): ${err.message}`);
    }
  }
}

const RATE_LIMIT_PATTERNS = ['rate limit', 'ratelimit', 'too many requests', '429'];

function isRateLimitError(result) {
  const haystack = ((result.error || '') + ' ' + (result.text || '')).toLowerCase();
  return RATE_LIMIT_PATTERNS.some((p) => haystack.includes(p));
}

/**
 * Run a single test case against Lyra.
 */
async function runTest(testCase) {
  const {
    id,
    prompt,
    timeout_ms = 30000,
    side_effects = 'none',
    validators: validatorConfigs = [],
    cleanup,
    multi_turn,
    turns,
  } = testCase;

  console.log(`  [${id}] ${(prompt || '(empty)').slice(0, 60)}...`);

  let response = '';
  let latencyMs = 0;
  let ttftMs = 0;
  let resultMeta = { model: 'unknown', provider: 'unknown', error: null };

  if (multi_turn && Array.isArray(turns) && turns.length > 0) {
    // Multi-turn: send each user turn, validate only the final response.
    // All turns share the same sessionKey so context carries through.
    for (const turn of turns) {
      if (turn.role === 'user') {
        const turnResult = await sendToLyra(turn.message, timeout_ms, `eval-${RUN_ID}-${id}`);
        response = turnResult.text;
        latencyMs = turnResult.durationMs;
        ttftMs = turnResult.ttftMs;
        resultMeta = { model: turnResult.model, provider: turnResult.provider, error: turnResult.error };
        if (turnResult.error) break; // stop on error
        await new Promise(r => setTimeout(r, 1000)); // pacing between turns
      }
    }
  } else {
    // Single-turn path
    let finalPrompt = prompt;
    if (!prompt || prompt.trim() === '') {
      finalPrompt = ' '; // tests Lyra's handling of empty-like input
    }
    // Note: EVAL MODE dry-run prefix removed — tests now use natural prompts

    let result = await sendToLyra(finalPrompt, timeout_ms, `eval-${RUN_ID}-${id}`);

    // Rate limit backoff: wait 10 min and retry once if MiniMax rate limits hit
    if (isRateLimitError(result)) {
      console.log(`    [rate-limit] MiniMax rate limit detected. Waiting 10 minutes before retry...`);
      await new Promise((r) => setTimeout(r, 10 * 60 * 1000));
      console.log(`    [rate-limit] Retrying [${id}]...`);
      result = await sendToLyra(finalPrompt, timeout_ms, `eval-${RUN_ID}-${id}`);
    }

    response = result.text;
    latencyMs = result.durationMs;
    ttftMs = result.ttftMs;
    resultMeta = { model: result.model, provider: result.provider, error: result.error };
  }

  const { error } = resultMeta;
  if (error) {
    console.log(`    ERROR: ${error}`);
  }

  // Pre-compute LLM judge results
  const llmJudgeResults = {};
  if (!error && response) {
    for (let i = 0; i < validatorConfigs.length; i++) {
      const v = validatorConfigs[i];
      if (v.type === 'llm_judge' && ANTHROPIC_KEY) {
        try {
          llmJudgeResults[i] = await judgeResponse(response, {
            rubric: v.rubric,
            prompt: prompt,
          }, ANTHROPIC_KEY);
          console.log(`    Judge: ${llmJudgeResults[i].score}/5 — ${llmJudgeResults[i].detail.slice(0, 80)}`);
        } catch (err) {
          llmJudgeResults[i] = { passed: false, score: 0, detail: `Judge error: ${err.message}` };
        }
      }
    }
  }

  // Run validators
  const meta = { latencyMs, ttftMs, llmJudgeResults };
  const validation = error
    ? { passed: false, results: [{ type: 'error', passed: false, detail: error }] }
    : runValidators(response, validatorConfigs, meta);

  const status = validation.passed ? 'PASS' : 'FAIL';
  console.log(`    ${status} (${latencyMs}ms ttft:${ttftMs}ms, ${resultMeta.model})`);

  // Post-test cleanup (write+cleanup tests only)
  if (cleanup) await runCleanup(cleanup);

  // Anti-throttle: prevent MiniMax rate-limit spikes on rapid sequential calls
  await new Promise((r) => setTimeout(r, POST_TEST_MS));

  const stability = classifyStability(error);

  return {
    id,
    tier: testCase.tier,
    category: testCase.category,
    name: testCase.name || id,
    prompt: (prompt || '').slice(0, 200),
    timestamp: new Date().toISOString(),
    passed: validation.passed,
    latency_ms: latencyMs,
    ttft_ms: ttftMs,
    response_length: response.length,
    response_preview: response.slice(0, 300),
    model: resultMeta.model,
    provider: resultMeta.provider,
    validators: validation.results,
    error,
    stability,
    infrastructure_failure: isInfrastructureFailure(error),
    side_effects,
    tags: testCase.tags || [],
  };
}

/**
 * Main eval run.
 */
async function main() {
  console.log('=== Lyra Eval Runner ===');
  console.log(`Time: ${new Date().toISOString()}\n`);

  const testCases = loadTestCases();
  if (testCases.length === 0) {
    console.error('No test cases found. Check CASES_DIR.');
    process.exit(1);
  }
  console.log(`Loaded ${testCases.length} test cases.\n`);

  // Filter by CLI arg (--only id1,id2 or tier name)
  const filterArg = process.argv[2];
  const filteredCases = filterArg
    ? testCases.filter((tc) => {
        if (filterArg.startsWith('--only')) {
          const ids = (process.argv[3] || '').split(',').map(s => s.trim());
          return ids.some(id => tc.id === id || tc.id?.includes(id));
        }
        return tc.tier?.includes(filterArg) || tc.id?.includes(filterArg);
      })
    : testCases;

  console.log(`Running ${filteredCases.length} tests...\n`);

  const results = [];
  let passed = 0;
  let failed = 0;

  try {
    await ensureConnected();

    for (let idx = 0; idx < filteredCases.length; idx++) {
      const testCase = filteredCases[idx];
      try {
        const result = await runTest(testCase);
        results.push(result);
        if (result.passed) passed++;
        else failed++;
      } catch (err) {
        console.error(`  [${testCase.id}] Unexpected error: ${err.message}`);
        results.push({
          id: testCase.id,
          tier: testCase.tier,
          category: testCase.category,
          name: testCase.name || testCase.id,
          prompt: testCase.prompt?.slice(0, 200),
          timestamp: new Date().toISOString(),
          passed: false,
          latency_ms: 0,
          ttft_ms: 0,
          response_length: 0,
          response_preview: '',
          model: 'unknown',
          provider: 'unknown',
          validators: [{ type: 'error', passed: false, detail: err.message }],
          error: err.message,
          stability: classifyStability(err.message),
          infrastructure_failure: isInfrastructureFailure(err.message),
          side_effects: testCase.side_effects || 'none',
          tags: testCase.tags || [],
        });
        failed++;
      }

      const isLast = idx === filteredCases.length - 1;
      const batchEnd = (idx + 1) % BATCH_SIZE === 0;
      if (!isLast) {
        await new Promise((r) => setTimeout(r, INTER_TEST_DELAY_MS));
      }

      // Phase 1: pause between batches so the gateway can recover memory / finish GC
      if (batchEnd && !isLast) {
        console.log(
          `\n[batch] --- batch ${Math.floor((idx + 1) / BATCH_SIZE)} complete (${idx + 1}/${filteredCases.length}) — cooling ${BATCH_PAUSE_MS}ms ---\n`,
        );
        if (wsClient) {
          wsClient.disconnect();
          wsClient = null;
        }
        await new Promise((r) => setTimeout(r, BATCH_PAUSE_MS));
        const healthy = await waitForGatewayHealth();
        if (!healthy) {
          console.error('[batch] Gateway health check failed after batch pause — aborting run');
          throw new Error('Gateway unhealthy after batch pause');
        }
        await ensureConnected();
      }
    }
  } finally {
    if (wsClient) wsClient.disconnect();
  }

  // Write results
  const today = new Date().toISOString().split('T')[0];
  const outputFile = join(RESULTS_DIR, `${today}.jsonl`);
  const jsonlContent = results.map((r) => JSON.stringify(r)).join('\n') + '\n';
  appendFileSync(outputFile, jsonlContent);

  const split = computeSplitScores(results);

  // Write summary (legacy fields preserved for dashboards; split metrics added)
  const summary = {
    date: today,
    timestamp: new Date().toISOString(),
    total: results.length,
    passed,
    failed,
    pass_rate: results.length > 0 ? Math.round((passed / results.length) * 100) / 100 : 0,
    avg_latency_ms: results.length > 0
      ? Math.round(results.reduce((sum, r) => sum + r.latency_ms, 0) / results.length)
      : 0,
    p95_latency_ms: results.length > 0
      ? results.map((r) => r.latency_ms).sort((a, b) => a - b)[Math.floor(results.length * 0.95)] || 0
      : 0,
    by_tier: groupBy(results, 'tier'),
    by_category: groupBy(results, 'category'),
    failures: results.filter((r) => !r.passed).map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      error: r.error || r.validators?.find((v) => !v.passed)?.detail || 'Unknown',
      infrastructure_failure: r.infrastructure_failure === true,
      stability: r.stability,
    })),
    ...split,
    eval_config: {
      batch_size: BATCH_SIZE,
      batch_pause_ms: BATCH_PAUSE_MS,
      inter_test_delay_ms: INTER_TEST_DELAY_MS,
      post_test_ms: POST_TEST_MS,
    },
  };

  const summaryFile = join(RESULTS_DIR, `${today}-summary.json`);
  writeFileSync(summaryFile, JSON.stringify(summary, null, 2));

  // Print summary
  console.log('\n' + '='.repeat(50));
  console.log(`Legacy pass rate: ${passed}/${results.length} (${Math.round(summary.pass_rate * 100)}%) — includes infra failures`);
  if (split.scores.capability_pass_rate !== null) {
    console.log(
      `Capability pass rate (stable tests only): ${split.scores.capability_passed}/${split.stability.stable_count} (${Math.round(split.scores.capability_pass_rate * 100)}%)`,
    );
  } else {
    console.log('Capability pass rate: N/A (no stable tests)');
  }
  console.log(
    `Infra failures: ${split.stability.infra_failures} (${Math.round(split.stability.infra_failure_rate * 100)}%) — timeouts/transport excluded from capability score`,
  );
  if (split.scores.integration_pass_rate !== null) {
    console.log(
      `Integration-shaped (stable): ${split.scores.integration_passed}/${split.scores.integration_stable} (${Math.round(split.scores.integration_pass_rate * 100)}%)`,
    );
  }
  console.log(`Gates: run_valid=${split.gates.run_valid} stability_ok=${split.gates.stability_ok} capability_ok=${split.gates.capability_ok}`);
  console.log(`Avg latency: ${summary.avg_latency_ms}ms | P95: ${summary.p95_latency_ms}ms`);

  if (failed > 0) {
    console.log(`\nFailures (sample):`);
    for (const f of summary.failures.slice(0, 25)) {
      const tag = f.infrastructure_failure ? ' [infra]' : '';
      console.log(`  - [${f.id}] ${f.name}: ${f.error}${tag}`);
    }
    if (summary.failures.length > 25) {
      console.log(`  ... and ${summary.failures.length - 25} more`);
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log(`Results: ${outputFile}`);
  console.log(`Summary: ${summaryFile}`);

  // Exit codes: 0 = green, 1 = capability/stability gate, 2 = invalid run (too unstable)
  if (process.env.EVAL_LEGACY_EXIT === '1') {
    if (summary.pass_rate < 0.8) {
      console.error('\n[exit 1] EVAL_LEGACY_EXIT=1: legacy pass_rate < 80%');
      process.exit(1);
    }
  } else {
    if (!split.gates.run_valid) {
      console.error('\n[exit 2] Run invalid: >50% tests had infra failures — do not compare to prior pass rates');
      process.exit(2);
    }
    if (!split.gates.all_ok) {
      const reasons = [];
      if (!split.gates.stability_ok) reasons.push('infra_failure_rate too high');
      if (!split.gates.capability_ok) reasons.push('capability_pass_rate below minimum');
      console.error(`\n[exit 1] Gate failed: ${reasons.join(', ')}`);
      process.exit(1);
    }
  }
}

function groupBy(results, field) {
  const groups = {};
  for (const r of results) {
    const key = r[field] || 'unknown';
    if (!groups[key]) groups[key] = { total: 0, passed: 0 };
    groups[key].total++;
    if (r.passed) groups[key].passed++;
  }
  for (const key of Object.keys(groups)) {
    groups[key].pass_rate = Math.round((groups[key].passed / groups[key].total) * 100) / 100;
  }
  return groups;
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
