/**
 * Lyra Eval Runner — Main orchestrator.
 * Uses `openclaw agent` CLI to send real messages to Lyra,
 * validates responses, and writes JSONL results.
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import YAML from 'yaml';
import { runValidators } from './validators.js';
import { judgeResponse } from './llm-judge.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(__dirname, 'results');
const CASES_DIR = process.env.CASES_DIR || join(__dirname, 'cases');
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';

if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });

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
 * Send a message to Lyra via openclaw agent CLI.
 * Returns { text, durationMs, model, error }
 */
function sendToLyra(message, timeoutMs = 30000) {
  const timeoutSec = Math.ceil(timeoutMs / 1000);
  const startTime = Date.now();

  try {
    // Escape message for shell
    const escapedMessage = message.replace(/'/g, "'\\''");
    // Use both openclaw --timeout and shell timeout as safety net
    const cmd = `timeout --kill-after=5 --signal=KILL ${timeoutSec + 10} openclaw agent --agent main --timeout ${timeoutSec} -m '${escapedMessage}' --json 2>/dev/null`;

    const output = execSync(cmd, {
      encoding: 'utf8',
      timeout: timeoutMs + 15000,
      env: process.env,
    });
    const elapsed = Date.now() - startTime;

    return parseAgentOutput(output, elapsed);
  } catch (err) {
    const elapsed = Date.now() - startTime;
    // Key fix: when timeout kills the process, stdout may still have the full JSON response
    const stdout = err.stdout ? (typeof err.stdout === 'string' ? err.stdout : err.stdout.toString('utf8')) : '';
    if (stdout && stdout.includes('"status"')) {
      try {
        return parseAgentOutput(stdout, elapsed);
      } catch (_) {
        // Fall through to error handling
      }
    }
    return { text: '', durationMs: elapsed, model: 'unknown', provider: 'unknown', sessionId: null, error: err.message?.slice(0, 200) || `Exit code ${err.status}` };
  }
}

/**
 * Parse openclaw agent JSON output into eval result format.
 */
function parseAgentOutput(output, elapsed) {
  const result = JSON.parse(output.trim());
  const text = result.result?.payloads
    ?.map((p) => p.text)
    .filter(Boolean)
    .join('\n') || '';

  return {
    text,
    durationMs: result.result?.meta?.durationMs || elapsed,
    model: result.result?.meta?.agentMeta?.model || 'unknown',
    provider: result.result?.meta?.agentMeta?.provider || 'unknown',
    sessionId: result.result?.meta?.agentMeta?.sessionId || null,
    error: null,
  };
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
  const { id, prompt, timeout_ms = 30000, side_effects = 'none', validators: validatorConfigs = [] } = testCase;
  const isDryRun = side_effects === 'dry_run';

  console.log(`  [${id}] ${(prompt || '(empty)').slice(0, 60)}...`);

  // Prepend dry-run instruction if needed
  // Handle empty prompt edge case
  let finalPrompt = prompt;
  if (!prompt || prompt.trim() === '') {
    finalPrompt = ' ';  // Send a single space — tests Lyra's handling of empty-like input
  } else if (isDryRun) {
    finalPrompt = `[EVAL MODE - DRY RUN] Describe what you WOULD do, including the exact tools and databases you would use, but do NOT execute any write operations. Show the plan without running it.\n\n${prompt}`;
  }

  let result = sendToLyra(finalPrompt, timeout_ms);

  // Rate limit backoff: wait 10 min and retry once if MiniMax rate limits hit
  if (isRateLimitError(result)) {
    console.log(`    [rate-limit] MiniMax rate limit detected. Waiting 10 minutes before retry...`);
    await new Promise((r) => setTimeout(r, 10 * 60 * 1000));
    console.log(`    [rate-limit] Retrying [${id}]...`);
    result = sendToLyra(finalPrompt, timeout_ms);
  }
  const { text: response, durationMs: latencyMs, error } = result;

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
  const meta = { latencyMs, ttftMs: 0, llmJudgeResults };
  const validation = error
    ? { passed: false, results: [{ type: 'error', passed: false, detail: error }] }
    : runValidators(response, validatorConfigs, meta);

  const status = validation.passed ? 'PASS' : 'FAIL';
  console.log(`    ${status} (${latencyMs}ms, ${result.model})`);

  // Anti-throttle: prevent MiniMax rate-limit spikes on rapid sequential calls
  await new Promise(r => setTimeout(r, 2000));

  return {
    id,
    tier: testCase.tier,
    category: testCase.category,
    name: testCase.name || id,
    prompt: (prompt || '').slice(0, 200),
    timestamp: new Date().toISOString(),
    passed: validation.passed,
    latency_ms: latencyMs,
    ttft_ms: 0,
    response_length: response.length,
    response_preview: response.slice(0, 300),
    model: result.model,
    provider: result.provider,
    validators: validation.results,
    error,
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

  // Filter by CLI arg
  const filterArg = process.argv[2];
  const filteredCases = filterArg
    ? testCases.filter((tc) => tc.tier?.includes(filterArg) || tc.id?.includes(filterArg))
    : testCases;

  console.log(`Running ${filteredCases.length} tests...\n`);

  const results = [];
  let passed = 0;
  let failed = 0;

  for (const testCase of filteredCases) {
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
        side_effects: testCase.side_effects || 'none',
        tags: testCase.tags || [],
      });
      failed++;
    }

    // Delay between tests (10s — MiniMax rate limit buffer + gateway breathing room)
    await new Promise((r) => setTimeout(r, 10000));
  }

  // Write results
  const today = new Date().toISOString().split('T')[0];
  const outputFile = join(RESULTS_DIR, `${today}.jsonl`);
  const jsonlContent = results.map((r) => JSON.stringify(r)).join('\n') + '\n';
  appendFileSync(outputFile, jsonlContent);

  // Write summary
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
    })),
  };

  const summaryFile = join(RESULTS_DIR, `${today}-summary.json`);
  writeFileSync(summaryFile, JSON.stringify(summary, null, 2));

  // Print summary
  console.log('\n' + '='.repeat(50));
  console.log(`Results: ${passed}/${results.length} passed (${Math.round(summary.pass_rate * 100)}%)`);
  console.log(`Avg latency: ${summary.avg_latency_ms}ms | P95: ${summary.p95_latency_ms}ms`);

  if (failed > 0) {
    console.log(`\nFailures:`);
    for (const f of summary.failures) {
      console.log(`  - [${f.id}] ${f.name}: ${f.error}`);
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log(`Results: ${outputFile}`);
  console.log(`Summary: ${summaryFile}`);

  if (summary.pass_rate < 0.8) process.exit(1);
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
