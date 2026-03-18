#!/usr/bin/env node

/**
 * Lyra Routing Eval — Tests model router accuracy and logs results.
 *
 * Runs as part of the 4 AM UTC eval pipeline:
 *   1. Tests the router against ground-truth labeled messages
 *   2. Validates routing decisions from the past 24h (if log exists)
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

if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });

// --- Ground truth test cases ---
// These are labeled messages with their CORRECT tier.
// The router must match these to pass.

const GROUND_TRUTH = [
  // === MiniMax (simple, single-action) ===
  { message: 'Add milk to the shopping list', tier: 'minimax', category: 'notion_write' },
  { message: 'Create a reminder to call the dentist by Friday', tier: 'minimax', category: 'reminders' },
  { message: "What's on my shopping list?", tier: 'minimax', category: 'notion_read' },
  { message: 'Show me my cron jobs as a table', tier: 'minimax', category: 'notion_read' },
  { message: "What's the weather in Berlin?", tier: 'minimax', category: 'weather' },
  { message: 'Mark the electrician task as done', tier: 'minimax', category: 'notion_write' },
  { message: 'Remind Abhigna to pick up the prescription', tier: 'minimax', category: 'reminders' },
  { message: 'How many content ideas do I have?', tier: 'minimax', category: 'notion_read' },
  { message: 'What time does my morning digest run?', tier: 'minimax', category: 'quick_lookup' },
  { message: 'List my cron jobs', tier: 'minimax', category: 'cron_management' },
  { message: 'ok', tier: 'minimax', category: 'override_simple' },
  { message: 'Thanks!', tier: 'minimax', category: 'short_reply' },
  { message: 'good morning', tier: 'minimax', category: 'override_simple' },
  { message: 'yes', tier: 'minimax', category: 'override_simple' },
  { message: 'done', tier: 'minimax', category: 'override_simple' },
  { message: '👍', tier: 'minimax', category: 'override_simple' },
  { message: 'Set status of grocery shopping to complete', tier: 'minimax', category: 'notion_write' },
  { message: 'Add eggs to shopping list', tier: 'minimax', category: 'notion_write' },
  { message: 'Will it rain tomorrow?', tier: 'minimax', category: 'weather' },
  { message: 'When is my next dentist appointment?', tier: 'minimax', category: 'quick_lookup' },

  // === Haiku (moderate complexity) ===
  { message: 'Check my email for anything urgent', tier: 'haiku', category: 'email_read' },
  { message: 'Draft a reply to the recruiter about the timeline', tier: 'haiku', category: 'email_draft' },
  { message: 'Search for the latest ECB digital euro updates', tier: 'haiku', category: 'web_search' },
  { message: 'Add milk to the list, then remind Abhigna to buy it, and check if we have eggs', tier: 'haiku', category: 'multi_step' },
  { message: 'Show my tasks as a table with deadlines', tier: 'haiku', category: 'data_formatting' },
  { message: 'Summarize my unread emails', tier: 'haiku', category: 'email_read' },
  { message: 'Write an email declining the meeting', tier: 'haiku', category: 'email_draft' },
  { message: 'Look up the latest news about Revolut', tier: 'haiku', category: 'web_search' },
  { message: 'Research what competitors launched this week', tier: 'haiku', category: 'web_search' },
  { message: 'Check email, add tasks to Notion, then draft replies', tier: 'haiku', category: 'multi_step' },
  { message: 'Export my content ideas as a CSV', tier: 'haiku', category: 'data_formatting' },
  { message: 'Assign the grocery shopping to Abhigna for this weekend', tier: 'haiku', category: 'cross_user_coordination' },

  // === Sonnet (complex reasoning, synthesis) ===
  { message: 'Summarize my week — what decisions did I make, what ideas did I capture?', tier: 'sonnet', category: 'synthesis' },
  { message: "Analyze Revolut vs Monzo's approach to crypto in Q1", tier: 'sonnet', category: 'strategic_analysis' },
  { message: 'Draft a blog post about my experience building a personal AI', tier: 'sonnet', category: 'complex_drafting' },
  { message: "Help me plan the next quarter's content strategy", tier: 'sonnet', category: 'planning' },
  { message: 'What patterns do you see across my content ideas this month?', tier: 'sonnet', category: 'synthesis' },
  { message: 'Give me a competitive digest for this week', tier: 'sonnet', category: 'competitive_intelligence' },
  { message: 'weekly review', tier: 'sonnet', category: 'override_synthesis' },
  { message: 'brain brief', tier: 'sonnet', category: 'override_synthesis' },
  { message: 'Should I focus on LinkedIn or Twitter for my content strategy?', tier: 'sonnet', category: 'strategic_analysis' },
  { message: 'What should my priorities be this week given everything on my plate?', tier: 'sonnet', category: 'planning' },
  { message: 'Based on my competitor tracking and content ideas, what career move makes the most sense?', tier: 'sonnet', category: 'multi_source_reasoning' },
  { message: 'Write a proposal for the new product feature', tier: 'sonnet', category: 'complex_drafting' },
  { message: 'Compare Revolut and Monzo latest feature launches and what it means for us', tier: 'sonnet', category: 'competitive_intelligence' },
  { message: 'Analyze the themes across my recent Second Brain entries', tier: 'sonnet', category: 'synthesis' },
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

function analyzeLiveRouting() {
  if (!existsSync(LOG_PATH)) {
    return { type: 'live_analysis', error: 'No routing log found', entries: 0 };
  }

  const lines = readFileSync(LOG_PATH, 'utf8').trim().split('\n');
  const allEntries = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

  // Filter to last 24 hours
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const recentEntries = allEntries.filter(e => e.timestamp >= cutoff);

  if (recentEntries.length === 0) {
    return {
      type: 'live_analysis',
      entries: 0,
      message: 'No routing decisions in last 24h',
      all_time_entries: allEntries.length,
    };
  }

  // Tier distribution
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

  // Expected distribution sanity check
  // MiniMax should be 70-90%, Haiku 5-20%, Sonnet 2-15%
  const totalRecent = recentEntries.length;
  const minimaxPct = (tierCounts.minimax || 0) / totalRecent;
  const haikuPct = (tierCounts.haiku || 0) / totalRecent;
  const sonnetPct = (tierCounts.sonnet || 0) / totalRecent;

  const distributionHealthy =
    minimaxPct >= 0.50 && minimaxPct <= 0.95 &&
    sonnetPct <= 0.30;

  // Rule-based vs LLM classifier ratio
  const ruleBasedPct = (classifierCounts.rules || 0) / totalRecent;

  return {
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
    low_confidence: {
      count: lowConfidenceCount,
      pct: Math.round((lowConfidenceCount / totalRecent) * 100),
      samples: lowConfidenceMessages.slice(0, 5),
    },
    top_categories: Object.entries(categoryFrequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([cat, count]) => ({ category: cat, count })),
  };
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
  } else {
    console.log(`  ${report.live_analysis.message || 'No log data'}`);
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

    // Pass/fail thresholds
    report.routing_health = {
      ground_truth_pass: gt.accuracy >= 0.90,
      minimax_accuracy_pass: gt.tier_accuracy.minimax >= 0.85,
      haiku_accuracy_pass: gt.tier_accuracy.haiku >= 0.75,
      sonnet_accuracy_pass: gt.tier_accuracy.sonnet >= 0.85,
      overall_pass: gt.accuracy >= 0.90 && gt.tier_accuracy.minimax >= 0.85 && gt.tier_accuracy.sonnet >= 0.85,
    };
  }

  // Write results
  const outputFile = join(RESULTS_DIR, `${today}-routing.json`);
  writeFileSync(outputFile, JSON.stringify(report, null, 2));
  console.log(`\nResults: ${outputFile}`);

  // Exit with failure if ground truth accuracy < 90%
  if (report.ground_truth && report.ground_truth.accuracy < 0.90) {
    console.log('\n⚠️ Routing accuracy below 90% threshold!');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
