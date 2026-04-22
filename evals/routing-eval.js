#!/usr/bin/env node

/**
 * Lyra Routing Eval — Tests model router accuracy and logs results.
 *
 * Runs as part of the 4 AM UTC eval pipeline:
 *   1. Tests the router against ground-truth labeled messages
 *   2. Validates routing decisions across rolling windows (24h, 3d, 7d)
 *   3. Generates routing accuracy metrics
 *   4. Writes results to routing-eval-{date}.json
 *
 * Usage:
 *   node routing-eval.js              (run full eval)
 *   node routing-eval.js --analyze    (analyze last 24h routing log only)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { routeMessage } from '../scripts/model-router.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(__dirname, 'results');
const LOG_PATH = join(__dirname, '..', 'logs', 'routing-decisions.jsonl');
const MIN_N_24H = parseInt(process.env.ROUTING_POLICY_MIN_N_24H || '50', 10);
const MIN_N_3D = parseInt(process.env.ROUTING_POLICY_MIN_N_3D || '100', 10);
const MIN_N_7D = parseInt(process.env.ROUTING_POLICY_MIN_N_7D || '200', 10);
const GT_MIN_ACCURACY = parseFloat(process.env.ROUTING_GT_MIN_ACCURACY || '0.90');

if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });

// --- Ground truth test cases ---
// Expected tiers match plugins/lyra-model-router (v16) with eval-like context
// (sender/channel eval): MiniMax-first thresholds route most traffic to minimax.
// Revisit when raising Haiku/Sonnet thresholds in decideTier/computeScores.

const GROUND_TRUTH = [
  // === MiniMax (includes Tier0 Python bypass where CRUD parse matches) ===
  { message: 'Add milk to the shopping list', tier: 'minimax', category: 'default_minimax' },
  { message: 'Create a reminder to call the dentist by Friday', tier: 'minimax', category: 'tier0_python' },
  { message: "What's on my shopping list?", tier: 'minimax', category: 'default_minimax' },
  { message: 'Show me my cron jobs as a table', tier: 'minimax', category: 'default_minimax' },
  { message: "What's the weather in Berlin?", tier: 'minimax', category: 'default_minimax' },
  { message: 'Mark the electrician task as done', tier: 'minimax', category: 'default_minimax' },
  { message: 'Remind Abhigna to pick up the prescription', tier: 'minimax', category: 'default_minimax' },
  { message: 'How many content ideas do I have?', tier: 'minimax', category: 'default_minimax' },
  { message: 'What time does my morning digest run?', tier: 'minimax', category: 'default_minimax' },
  { message: 'List my cron jobs', tier: 'minimax', category: 'default_minimax' },
  { message: 'ok', tier: 'minimax', category: 'ack_force_minimax' },
  { message: 'Thanks!', tier: 'minimax', category: 'default_minimax' },
  { message: 'good morning', tier: 'minimax', category: 'default_minimax' },
  { message: 'yes', tier: 'minimax', category: 'ack_force_minimax' },
  { message: 'done', tier: 'minimax', category: 'ack_force_minimax' },
  { message: '👍', tier: 'minimax', category: 'ack_force_minimax' },
  { message: 'Set status of grocery shopping to complete', tier: 'minimax', category: 'default_minimax' },
  { message: 'Add eggs to shopping list', tier: 'minimax', category: 'default_minimax' },
  { message: 'Will it rain tomorrow?', tier: 'minimax', category: 'default_minimax' },
  { message: 'When is my next dentist appointment?', tier: 'minimax', category: 'default_minimax' },

  // === Same policy: scored path still defaults to minimax at current thresholds ===
  { message: 'Check my email for anything urgent', tier: 'minimax', category: 'default_minimax' },
  { message: 'Draft a reply to the recruiter about the timeline', tier: 'minimax', category: 'default_minimax' },
  { message: 'Search for the latest ECB digital euro updates', tier: 'minimax', category: 'default_minimax' },
  { message: 'Add milk to the list, then remind Abhigna to buy it, and check if we have eggs', tier: 'minimax', category: 'default_minimax' },
  { message: 'Show my tasks as a table with deadlines', tier: 'minimax', category: 'tier0_python' },
  { message: 'Summarize my unread emails', tier: 'minimax', category: 'default_minimax' },
  { message: 'Write an email declining the meeting', tier: 'minimax', category: 'default_minimax' },
  { message: 'Look up the latest news about Revolut', tier: 'minimax', category: 'default_minimax' },
  { message: 'Research what competitors launched this week', tier: 'minimax', category: 'default_minimax' },
  { message: 'Check email, add tasks to Notion, then draft replies', tier: 'minimax', category: 'default_minimax' },
  { message: 'Export my content ideas as a CSV', tier: 'minimax', category: 'default_minimax' },
  { message: 'Assign the grocery shopping to Abhigna for this weekend', tier: 'minimax', category: 'default_minimax' },

  { message: 'Summarize my week — what decisions did I make, what ideas did I capture?', tier: 'minimax', category: 'default_minimax' },
  { message: "Analyze Revolut vs Monzo's approach to crypto in Q1", tier: 'minimax', category: 'default_minimax' },
  { message: 'Draft a blog post about my experience building a personal AI', tier: 'minimax', category: 'default_minimax' },
  { message: "Help me plan the next quarter's content strategy", tier: 'minimax', category: 'default_minimax' },
  { message: 'What patterns do you see across my content ideas this month?', tier: 'minimax', category: 'default_minimax' },
  { message: 'Give me a competitive digest for this week', tier: 'minimax', category: 'default_minimax' },
  { message: 'weekly review', tier: 'minimax', category: 'default_minimax' },
  { message: 'brain brief', tier: 'minimax', category: 'default_minimax' },
  { message: 'Should I focus on LinkedIn or Twitter for my content strategy?', tier: 'minimax', category: 'default_minimax' },
  { message: 'What should my priorities be this week given everything on my plate?', tier: 'minimax', category: 'default_minimax' },
  { message: 'Based on my competitor tracking and content ideas, what career move makes the most sense?', tier: 'minimax', category: 'default_minimax' },
  { message: 'Write a proposal for the new product feature', tier: 'minimax', category: 'default_minimax' },
  { message: 'Compare Revolut and Monzo latest feature launches and what it means for us', tier: 'minimax', category: 'default_minimax' },
  { message: 'Analyze the themes across my recent Second Brain entries', tier: 'minimax', category: 'default_minimax' },
];

// --- Run ground truth eval ---

async function runGroundTruthEval() {
  console.log('=== Routing Eval — Ground Truth Tests ===\n');

  const results = [];
  let passed = 0;
  let failed = 0;
  const tierResults = { minimax: { correct: 0, total: 0 }, haiku: { correct: 0, total: 0 }, sonnet: { correct: 0, total: 0 } };
  const misroutes = [];

  for (const testCase of GROUND_TRUTH) {
    const result = await routeMessage(testCase.message, { sender: 'eval', channel: 'eval' });
    const tierMatch = result.tier === testCase.tier;

    tierResults[testCase.tier].total++;
    if (tierMatch) {
      tierResults[testCase.tier].correct++;
      passed++;
    } else {
      failed++;
      misroutes.push({
        message: testCase.message.slice(0, 80),
        expected_tier: testCase.tier,
        actual_tier: result.tier,
        actual_category: result.category,
        confidence: result.confidence,
        classifier: result.classifier,
      });
    }

    results.push({
      message: testCase.message.slice(0, 80),
      expected_tier: testCase.tier,
      actual_tier: result.tier,
      tier_match: tierMatch,
      expected_category: testCase.category,
      actual_category: result.category,
      confidence: result.confidence,
      classifier: result.classifier,
      latency_ms: result.latency_ms,
    });
  }

  const accuracy = passed / GROUND_TRUTH.length;

  return {
    type: 'ground_truth',
    total: GROUND_TRUTH.length,
    passed,
    failed,
    accuracy,
    tier_counts: {
      minimax: tierResults.minimax.total,
      haiku: tierResults.haiku.total,
      sonnet: tierResults.sonnet.total,
    },
    tier_accuracy: {
      minimax: tierResults.minimax.total > 0 ? tierResults.minimax.correct / tierResults.minimax.total : 0,
      haiku: tierResults.haiku.total > 0 ? tierResults.haiku.correct / tierResults.haiku.total : 0,
      sonnet: tierResults.sonnet.total > 0 ? tierResults.sonnet.correct / tierResults.sonnet.total : 0,
    },
    misroutes,
    results,
  };
}

// --- Analyze live routing log ---

function windowStats(allEntries, hours) {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const rows = allEntries.filter((e) => {
    if (e.timestamp < cutoff) return false;
    const sender = String(e.sender || '');
    const channel = String(e.channel || '');
    return sender !== 'test' && sender !== 'eval' && channel !== 'test' && channel !== 'eval';
  });
  let anthropicCount = 0;
  for (const e of rows) {
    const model = String(e.model || '');
    if (Boolean(e.anthropic_call) || model.includes('anthropic') || model.includes('claude')) anthropicCount++;
  }
  const share = rows.length > 0 ? anthropicCount / rows.length : 0;
  return {
    hours,
    entries: rows.length,
    anthropic_count: anthropicCount,
    anthropic_share: share,
    anthropic_share_pct: Math.round(share * 1000) / 10,
    rows,
  };
}

function analyzeLiveRouting() {
  if (!existsSync(LOG_PATH)) {
    return { type: 'live_analysis', error: 'No routing log found', entries: 0 };
  }

  const lines = readFileSync(LOG_PATH, 'utf8').trim().split('\n');
  const allEntries = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

  const w24 = windowStats(allEntries, 24);
  const w72 = windowStats(allEntries, 72);
  const w168 = windowStats(allEntries, 168);
  const recentEntries = w24.rows;
  const trailingBaselineRows = w168.rows.filter((e) => e.timestamp < new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

  const tierCounts = {};
  const classifierCounts = {};
  const categoryFrequency = {};
  let totalLatency = 0;
  let lowConfidenceCount = 0;
  const lowConfidenceMessages = [];

  for (const e of recentEntries) {
    tierCounts[e.tier] = (tierCounts[e.tier] || 0) + 1;
    classifierCounts[e.classifier] = (classifierCounts[e.classifier] || 0) + 1;
    categoryFrequency[e.category] = (categoryFrequency[e.category] || 0) + 1;
    totalLatency += e.latency_ms || 0;

    if (e.confidence < 0.6) {
      lowConfidenceCount++;
      lowConfidenceMessages.push({
        message: e.message_preview,
        tier: e.tier,
        confidence: e.confidence,
        classifier: e.classifier,
      });
    }
  }

  // Expected distribution sanity check (MiniMax-first)
  const totalRecent = recentEntries.length || 1;
  const minimaxPct = (tierCounts.minimax || 0) / totalRecent;
  const haikuPct = (tierCounts.haiku || 0) / totalRecent;
  const sonnetPct = (tierCounts.sonnet || 0) / totalRecent;

  const distributionHealthy =
    minimaxPct >= 0.50 && minimaxPct <= 0.95 &&
    sonnetPct <= 0.30;

  const anthroWarn = (w24.entries > 0 && w24.anthropic_share > 0.12) || (w168.entries > 0 && w168.anthropic_share > 0.13);
  const anthroClamp = (w24.entries >= 50 && w24.anthropic_share >= 0.15) || (w72.entries >= 100 && w72.anthropic_share >= 0.14);
  const anthroEmergency = (w24.entries >= 50 && w24.anthropic_share >= 0.25) || (w168.entries >= 200 && w168.anthropic_share >= 0.20);
  const reliable24 = w24.entries >= MIN_N_24H;
  const reliable3d = w72.entries >= MIN_N_3D;
  const reliable7d = w168.entries >= MIN_N_7D;
  const canEnforceClamp = (reliable24 && w24.anthropic_share >= 0.15) || (reliable3d && w72.anthropic_share >= 0.14);
  const canEnforceEmergency = (reliable24 && w24.anthropic_share >= 0.25) || (reliable7d && w168.anthropic_share >= 0.20);

  const baselineCounts = { minimax: 0, haiku: 0, sonnet: 0 };
  for (const e of trailingBaselineRows) baselineCounts[e.tier] = (baselineCounts[e.tier] || 0) + 1;
  const baselineTotal = trailingBaselineRows.length || 1;
  const baselinePct = {
    minimax: (baselineCounts.minimax || 0) / baselineTotal,
    haiku: (baselineCounts.haiku || 0) / baselineTotal,
    sonnet: (baselineCounts.sonnet || 0) / baselineTotal,
  };
  const drift = {
    baseline_entries: trailingBaselineRows.length,
    delta_pct: {
      minimax: Math.round((minimaxPct - baselinePct.minimax) * 1000) / 10,
      haiku: Math.round((haikuPct - baselinePct.haiku) * 1000) / 10,
      sonnet: Math.round((sonnetPct - baselinePct.sonnet) * 1000) / 10,
    },
  };

  // Rule-based vs LLM classifier ratio
  const ruleBasedPct = recentEntries.length > 0 ? (classifierCounts.rules || 0) / recentEntries.length : 0;

  const result = {
    type: 'live_analysis',
    entries: recentEntries.length,
    all_time_entries: allEntries.length,
    period: '24h',
    tier_distribution: {
      minimax: { count: tierCounts.minimax || 0, pct: Math.round(minimaxPct * 100) },
      haiku: { count: tierCounts.haiku || 0, pct: Math.round(haikuPct * 100) },
      sonnet: { count: tierCounts.sonnet || 0, pct: Math.round(sonnetPct * 100) },
    },
    classifier_distribution: classifierCounts,
    rule_based_pct: Math.round(ruleBasedPct * 100),
    avg_latency_ms: Math.round(totalLatency / totalRecent),
    distribution_healthy: distributionHealthy,
    anthropic_policy: {
      target_share_pct: 15,
      h24: { entries: w24.entries, share_pct: w24.anthropic_share_pct },
      d3: { entries: w72.entries, share_pct: w72.anthropic_share_pct },
      d7: { entries: w168.entries, share_pct: w168.anthropic_share_pct },
      reliability: { h24: reliable24, d3: reliable3d, d7: reliable7d },
      warn: anthroWarn,
      clamp: anthroClamp,
      emergency: anthroEmergency,
      enforce_clamp: canEnforceClamp,
      enforce_emergency: canEnforceEmergency,
    },
    low_confidence: {
      count: lowConfidenceCount,
      pct: Math.round((lowConfidenceCount / totalRecent) * 100),
      samples: lowConfidenceMessages.slice(0, 5),
    },
    top_categories: Object.entries(categoryFrequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([cat, count]) => ({ category: cat, count })),
    drift,
  };

  if (recentEntries.length === 0) {
    result.message = 'No routing decisions in last 24h';
  }
  return result;
}

// --- Main ---

async function main() {
  const isAnalyzeOnly = process.argv.includes('--analyze');

  const today = new Date().toISOString().split('T')[0];
  const report = {
    date: today,
    timestamp: new Date().toISOString(),
  };

  // Always analyze live routing if log exists
  console.log('Analyzing live routing decisions...');
  report.live_analysis = analyzeLiveRouting();

  if (report.live_analysis.entries > 0) {
    console.log(`  ${report.live_analysis.entries} decisions in last 24h`);
    console.log(`  Distribution: MiniMax ${report.live_analysis.tier_distribution.minimax.pct}% | Haiku ${report.live_analysis.tier_distribution.haiku.pct}% | Sonnet ${report.live_analysis.tier_distribution.sonnet.pct}%`);
    console.log(`  Rule-based: ${report.live_analysis.rule_based_pct}% | Low confidence: ${report.live_analysis.low_confidence.count}`);
    console.log(`  Distribution healthy: ${report.live_analysis.distribution_healthy ? '✅' : '⚠️'}`);
    if (report.live_analysis.anthropic_policy) {
      const p = report.live_analysis.anthropic_policy;
      console.log(`  Anthropic share: 24h=${p.h24.share_pct}% (${p.h24.entries}) | 3d=${p.d3.share_pct}% (${p.d3.entries}) | 7d=${p.d7.share_pct}% (${p.d7.entries})`);
      console.log(`  Anthropic policy: warn=${p.warn ? 'yes' : 'no'} clamp=${p.clamp ? 'yes' : 'no'} emergency=${p.emergency ? 'yes' : 'no'} enforceClamp=${p.enforce_clamp ? 'yes' : 'no'} enforceEmergency=${p.enforce_emergency ? 'yes' : 'no'}`);
    }
    if (report.live_analysis.drift) {
      const d = report.live_analysis.drift.delta_pct;
      console.log(`  Drift vs trailing baseline: MiniMax ${d.minimax >= 0 ? '+' : ''}${d.minimax}pp | Haiku ${d.haiku >= 0 ? '+' : ''}${d.haiku}pp | Sonnet ${d.sonnet >= 0 ? '+' : ''}${d.sonnet}pp`);
    }
  } else {
    console.log(`  ${report.live_analysis.message || 'No log data'}`);
    if (report.live_analysis.anthropic_policy) {
      const p = report.live_analysis.anthropic_policy;
      console.log(`  Anthropic share: 24h=${p.h24.share_pct}% (${p.h24.entries}) | 3d=${p.d3.share_pct}% (${p.d3.entries}) | 7d=${p.d7.share_pct}% (${p.d7.entries})`);
      console.log(`  Reliability: 24h=${p.reliability.h24 ? 'ok' : 'low'} 3d=${p.reliability.d3 ? 'ok' : 'low'} 7d=${p.reliability.d7 ? 'ok' : 'low'}`);
    }
  }

  // Run ground truth eval (skip if --analyze only)
  if (!isAnalyzeOnly) {
    console.log('\nRunning ground truth routing tests...');
    report.ground_truth = await runGroundTruthEval();

    const gt = report.ground_truth;
    console.log(`\n  Overall accuracy: ${gt.passed}/${gt.total} (${Math.round(gt.accuracy * 100)}%)`);
    console.log(`  MiniMax accuracy: ${Math.round(gt.tier_accuracy.minimax * 100)}%`);
    console.log(`  Haiku accuracy:   ${Math.round(gt.tier_accuracy.haiku * 100)}%`);
    console.log(`  Sonnet accuracy:  ${Math.round(gt.tier_accuracy.sonnet * 100)}%`);

    if (gt.misroutes.length > 0) {
      console.log(`\n  Misroutes (${gt.misroutes.length}):`);
      for (const m of gt.misroutes) {
        console.log(`    "${m.message.slice(0, 50)}..." → expected ${m.expected_tier}, got ${m.actual_tier} (${m.confidence.toFixed(2)}, ${m.classifier})`);
      }
    }

    // Pass/fail thresholds (tiers with zero labeled cases are skipped — e.g. MiniMax-only ground truth)
    const tc = gt.tier_counts || { minimax: 0, haiku: 0, sonnet: 0 };
    report.routing_health = {
      ground_truth_pass: gt.accuracy >= GT_MIN_ACCURACY,
      minimax_accuracy_pass: tc.minimax === 0 || gt.tier_accuracy.minimax >= 0.85,
      haiku_accuracy_pass: tc.haiku === 0 || gt.tier_accuracy.haiku >= 0.75,
      sonnet_accuracy_pass: tc.sonnet === 0 || gt.tier_accuracy.sonnet >= 0.85,
      overall_pass:
        gt.accuracy >= GT_MIN_ACCURACY &&
        (tc.minimax === 0 || gt.tier_accuracy.minimax >= 0.85) &&
        (tc.haiku === 0 || gt.tier_accuracy.haiku >= 0.75) &&
        (tc.sonnet === 0 || gt.tier_accuracy.sonnet >= 0.85),
    };
  }

  const policy = report.live_analysis.anthropic_policy || null;
  const gating = {
    min_sample: { h24: MIN_N_24H, d3: MIN_N_3D, d7: MIN_N_7D },
    fail_reasons: [],
    warn_reasons: [],
  };
  if (policy) {
    if (policy.enforce_emergency) gating.fail_reasons.push('Anthropic emergency threshold breached with sufficient sample');
    else if (policy.enforce_clamp) gating.fail_reasons.push('Anthropic clamp threshold breached with sufficient sample');
    else if (policy.warn) gating.warn_reasons.push('Anthropic warn threshold breached (monitor only)');
    if (!policy.reliability.h24 || !policy.reliability.d3 || !policy.reliability.d7) {
      gating.warn_reasons.push('Insufficient sample size for strict policy enforcement on one or more windows');
    }
  }
  if (report.routing_health && !report.routing_health.overall_pass) {
    gating.fail_reasons.push('Ground-truth routing accuracy below threshold');
  }
  const verdict = gating.fail_reasons.length > 0 ? 'FAIL' : (gating.warn_reasons.length > 0 ? 'WARN' : 'PASS');
  gating.verdict = verdict;
  report.gating = gating;

  // Write results
  const outputFile = join(RESULTS_DIR, `${today}-routing.json`);
  writeFileSync(outputFile, JSON.stringify(report, null, 2));
  console.log(`\nResults: ${outputFile}`);

  if (gating.warn_reasons.length > 0) {
    console.log('\nWarnings:');
    for (const reason of gating.warn_reasons) console.log(`  - ${reason}`);
  }

  console.log(`\nVERDICT: ${verdict}`);

  if (gating.fail_reasons.length > 0) {
    console.log('\n❌ Eval failed:');
    for (const reason of gating.fail_reasons) console.log(`  - ${reason}`);
    process.exit(1);
  }
}

main()
  .then(() => {
    // Plugin (imported transitively via scripts/model-router.js) registers
    // module-scope setInterval timers that keep the event loop alive. Exit
    // explicitly so this script terminates under cron/CI.
    process.exit(0);
  })
  .catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
  });
