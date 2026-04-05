/**
 * Aggregate JSONL eval results into dashboard-ready JSON files.
 * Produces: summary.json, history.json, failures.json, architecture.json
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { computeSplitScores, classifyFailureKind } from './lib/metrics.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(__dirname, 'results');
const OUTPUT_DIR = process.env.OUTPUT_DIR || join(__dirname, 'output');

if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

/**
 * Read all summary JSON files from the results directory.
 */
function loadSummaries() {
  const summaries = [];
  if (!existsSync(RESULTS_DIR)) return summaries;

  const files = readdirSync(RESULTS_DIR)
    .filter((f) => f.endsWith('-summary.json'))
    .sort();

  for (const file of files) {
    try {
      const content = readFileSync(join(RESULTS_DIR, file), 'utf8');
      summaries.push(JSON.parse(content));
    } catch (err) {
      console.warn(`[warn] Skipping ${file}: ${err.message}`);
    }
  }

  return summaries;
}

/**
 * Read JSONL results for a specific date.
 */
function loadDayResults(date) {
  const file = join(RESULTS_DIR, `${date}.jsonl`);
  if (!existsSync(file)) return [];

  return readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); }
      catch { return null; }
    })
    .filter(Boolean);
}

function main() {
  console.log('=== Aggregating eval results ===\n');

  const summaries = loadSummaries();
  if (summaries.length === 0) {
    console.log('No summaries found. Run evals first.');
    // Write empty files
    writeJSON('summary.json', { message: 'No eval runs yet' });
    writeJSON('history.json', []);
    writeJSON('failures.json', []);
    writeJSON('architecture.json', buildArchitecture());
    return;
  }

  // Latest summary — recompute split metrics from JSONL if older run lacks Phase 0 fields
  let latest = summaries[summaries.length - 1];
  if (!latest.scores && !latest.stability) {
    const rows = loadDayResults(latest.date);
    if (rows.length > 0) {
      const split = computeSplitScores(rows);
      latest = { ...latest, ...split };
    }
  }
  console.log(`Latest run: ${latest.date} (${latest.total} tests, ${Math.round(latest.pass_rate * 100)}% legacy pass rate)`);

  // 1. summary.json — latest run (Phase 0: split metrics when present on -summary.json)
  const summaryPayload = {
    date: latest.date,
    timestamp: latest.timestamp,
    total_tests: latest.total,
    passed: latest.passed,
    failed: latest.failed,
    pass_rate: latest.pass_rate,
    avg_latency_ms: latest.avg_latency_ms,
    p95_latency_ms: latest.p95_latency_ms,
    by_tier: latest.by_tier,
    by_category: latest.by_category,
  };
  if (latest.stability) summaryPayload.stability = latest.stability;
  if (latest.scores) summaryPayload.scores = latest.scores;
  if (latest.gates) summaryPayload.gates = latest.gates;
  if (latest.eval_lane) summaryPayload.eval_lane = latest.eval_lane;
  if (latest.eval_lane_counts) summaryPayload.eval_lane_counts = latest.eval_lane_counts;
  if (latest.run_mode) summaryPayload.run_mode = latest.run_mode;
  if (latest.failure_breakdown) summaryPayload.failure_breakdown = latest.failure_breakdown;
  if (latest.eval_config) summaryPayload.eval_config = latest.eval_config;
  if (latest.error_fingerprint_top) summaryPayload.error_fingerprint_top = latest.error_fingerprint_top;
  writeJSON('summary.json', summaryPayload);

  // 2. history.json — last 90 days
  const history = summaries.slice(-90).map((s) => {
    const row = {
      date: s.date,
      total: s.total,
      passed: s.passed,
      failed: s.failed,
      pass_rate: s.pass_rate,
      avg_latency_ms: s.avg_latency_ms,
      p95_latency_ms: s.p95_latency_ms,
      by_tier: s.by_tier,
    };
    if (s.scores?.capability_pass_rate != null) {
      row.capability_pass_rate = s.scores.capability_pass_rate;
    }
    if (s.stability?.infra_failure_rate != null) {
      row.infra_failure_rate = s.stability.infra_failure_rate;
    }
    if (s.eval_lane) row.eval_lane = s.eval_lane;
    if (s.failure_breakdown) row.failure_breakdown = s.failure_breakdown;
    return row;
  });
  writeJSON('history.json', history);

  // 3. failures.json — last 20 failures across all runs
  const allFailures = [];
  for (const summary of summaries.slice(-7)) {
    const results = loadDayResults(summary.date);
    for (const r of results) {
      if (!r.passed) {
        allFailures.push({
          date: summary.date,
          id: r.id,
          name: r.name,
          tier: r.tier,
          category: r.category,
          prompt: r.prompt,
          response_preview: r.response_preview?.slice(0, 200),
          error: r.failure_reason || r.error || r.validators?.find((v) => !v.passed)?.detail || 'Unknown',
          failure_kind: r.failure_kind || classifyFailureKind({
            passed: r.passed,
            error: r.error,
            failure_reason: r.failure_reason || r.validators?.find((v) => !v.passed)?.detail || '',
            response_preview: r.response_preview,
          }),
          latency_ms: r.latency_ms,
          timed_out_stage: r.timed_out_stage || null,
          tool_chain_depth: r.tool_chain_depth ?? null,
          expected_tool_chain_depth: r.expected_tool_chain_depth ?? null,
          idle_ms: r.idle_ms ?? null,
        });
      }
    }
  }
  writeJSON('failures.json', allFailures.slice(-20));

  // 4. architecture.json — static system info
  writeJSON('architecture.json', buildArchitecture());

  console.log('\nDashboard data written to:', OUTPUT_DIR);
}

function buildArchitecture() {
  return {
    server: {
      provider: 'Hetzner',
      type: 'CX22',
      ram: '4 GB',
      location: 'Nuremberg, Germany',
      os: 'Ubuntu 24.04',
      cost: '6 EUR/month',
    },
    framework: {
      name: 'OpenClaw',
      version: 'v2026.3.13',
    },
    models: {
      default: 'MiniMax M2.5',
      fallback: 'Claude Haiku 4.5',
      escalation: 'Claude Sonnet 4.6',
    },
    channels: ['Telegram'],
    databases: {
      count: 13,
      engine: 'Notion API',
    },
    cron_jobs: 7,
    persistence: 'PostgreSQL',
    monitoring: '15-min health checks + Telegram alerts',
    backup: 'Daily at 3am UTC, 7-day retention',
    sync: 'Bidirectional GitHub every 5 min',
    monthly_cost: '~18 EUR (VPS + APIs)',
  };
}

function writeJSON(filename, data) {
  const path = join(OUTPUT_DIR, filename);
  writeFileSync(path, JSON.stringify(data, null, 2));
  console.log(`  Written: ${filename}`);
}

main();
