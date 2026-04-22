#!/usr/bin/env node

/**
 * Lyra Model Router — CLI shim over production routing (plugins/lyra-model-router).
 *
 * L-9: No duplicate YAML/LLM pipeline — `routeMessage` delegates to the same policy
 * as the OpenClaw plugin (`routeForCli`).
 *
 * Usage:
 *   node model-router.js "Add milk to the shopping list"
 *   node model-router.js --json "Synthesize my week"
 *   node model-router.js --stats
 *   node model-router.js --test
 *
 * As module:
 *   import { routeMessage } from './model-router.js';
 *   const result = await routeMessage("…", { sender: 'eval', channel: 'eval' });
 */

import { readFileSync, existsSync, mkdirSync, appendFileSync } from "fs";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { routeForCli, ROUTING_DECISIONS_LOG } from "../plugins/lyra-model-router/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_PATH = process.env.LYRA_ROUTING_LOG_PATH || ROUTING_DECISIONS_LOG;
const LOG_DIR = dirname(LOG_PATH);

/**
 * Route a message — same semantics as Telegram/production (plugin).
 * @returns {Promise<object>}
 */
export async function routeMessage(message, context = {}) {
  return routeForCli(message, context);
}

function logDecisionCli(message, result, context) {
  try {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
    const entry = {
      timestamp: new Date().toISOString(),
      message_preview: String(message).slice(0, 100),
      message_length: String(message).length,
      ...result,
      sender: context.sender || "unknown",
      channel: context.channel || "unknown",
    };
    appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n");
  } catch {
    // mirror legacy behavior: never fail routing on log errors
  }
}

/**
 * Optional second JSONL line for CLI analytics (plugin already logs scored paths).
 * Keeps `node model-router.js "…"` useful for ad-hoc debugging without duplicating tier0 lines.
 */
export async function routeMessageWithCliLog(message, context = {}) {
  const result = routeForCli(message, context);
  logDecisionCli(message, result, context);
  return result;
}

function printStats() {
  if (!existsSync(LOG_PATH)) {
    console.log("No routing log found at", LOG_PATH);
    return;
  }

  const lines = readFileSync(LOG_PATH, "utf8").trim().split("\n");
  const entries = lines
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  if (entries.length === 0) {
    console.log("No routing entries found.");
    return;
  }

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

  console.log("=== Lyra Model Router — Statistics ===\n");
  console.log(`Log file:   ${LOG_PATH}`);
  console.log(`Total rows: ${entries.length}`);
  console.log(`Avg latency (rows with latency_ms): ${Math.round(totalLatency / entries.length)}ms\n`);

  console.log("Tier distribution:");
  for (const [tier, count] of Object.entries(tierCounts).sort((a, b) => b[1] - a[1])) {
    const pct = Math.round((count / entries.length) * 100);
    const bar = "█".repeat(Math.round(pct / 2));
    console.log(`  ${tier.padEnd(8)} ${String(count).padStart(4)} (${String(pct).padStart(2)}%) ${bar}`);
  }

  console.log("\nClassifier distribution:");
  for (const [cls, count] of Object.entries(classifierCounts).sort((a, b) => b[1] - a[1])) {
    const pct = Math.round((count / entries.length) * 100);
    console.log(`  ${String(cls).padEnd(15)} ${String(count).padStart(4)} (${String(pct).padStart(2)}%)`);
  }

  console.log("\nTop categories:");
  const sorted = Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);
  for (const [cat, count] of sorted) {
    console.log(`  ${String(cat).slice(0, 40).padEnd(40)} ${count}`);
  }

  console.log("\nLast 5 entries:");
  for (const e of entries.slice(-5)) {
    const prev = (e.message_preview || "").slice(0, 50);
    console.log(
      `  ${String(e.tier || "?").padEnd(8)} → ${String(e.category || "").slice(0, 22).padEnd(22)} "${prev}..."`,
    );
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--stats")) {
    printStats();
    return;
  }

  if (args.includes("--help") || args.length === 0) {
    console.log(`
Lyra Model Router — production policy (plugin) via CLI.

Usage:
  node model-router.js "Your message here"
  node model-router.js --json "Your message here"
  node model-router.js --stats
  node model-router.js --batch
  node model-router.js --test

Environment:
  LYRA_ROUTING_LOG_PATH   Override JSONL path (default: repo logs/ or server path)
  LYRA_CRUD_CLI           Override crud/cli.py path for Tier0
`);
    return;
  }

  if (args.includes("--test")) {
    await runBuiltInTests();
    return;
  }

  if (args.includes("--batch")) {
    const { createInterface } = await import("readline");
    const rl = createInterface({ input: process.stdin });
    for await (const line of rl) {
      if (line.trim()) {
        const result = await routeMessage(line.trim());
        console.log(JSON.stringify({ message: line.trim().slice(0, 80), ...result }));
      }
    }
    return;
  }

  const isJson = args.includes("--json");
  const message = args.filter((a) => !a.startsWith("--")).join(" ");

  if (!message) {
    console.error("No message provided.");
    process.exit(1);
  }

  const result = await routeMessage(message);

  if (isJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Model:      ${result.model}`);
    console.log(`Tier:       ${result.tier}`);
    console.log(`Category:   ${result.category}`);
    console.log(`Confidence: ${typeof result.confidence === "number" ? result.confidence.toFixed(2) : result.confidence}`);
    console.log(`Classifier: ${result.classifier}`);
    console.log(`Reason:     ${result.reason}`);
    console.log(`Latency:    ${result.latency_ms}ms`);
  }
}

async function runBuiltInTests() {
  const tests = [
    { message: "Add milk to the shopping list", expected: "minimax" },
    { message: "Thanks!", expected: "minimax" },
    { message: "What time does my morning digest run?", expected: "minimax" },
    { message: "What's the weather in Berlin?", expected: "minimax" },
    { message: "Remind me to call the dentist by Friday", expected: "minimax" },
    { message: "Mark the electrician task as done", expected: "minimax" },
    { message: "How many content ideas do I have?", expected: "minimax" },
    { message: "List my cron jobs", expected: "minimax" },
    { message: "ok", expected: "minimax" },
    { message: "good morning", expected: "minimax" },
    { message: "Check my email for anything urgent", expected: "minimax" },
    { message: "Draft a reply to the recruiter about the timeline", expected: "minimax" },
    { message: "Search for the latest ECB digital euro updates", expected: "minimax" },
    { message: "Add milk to the list, then remind Abhigna to buy it, and check if we have eggs", expected: "minimax" },
    { message: "Show my tasks as a table with deadlines", expected: "minimax" },
    { message: "Summarize my week — what decisions did I make, what ideas did I capture?", expected: "minimax" },
    { message: "Analyze Revolut vs Monzo's approach to crypto", expected: "minimax" },
    { message: "Draft a blog post about my experience building a personal AI", expected: "minimax" },
    { message: "Help me plan the next quarter's content strategy", expected: "minimax" },
    { message: "What patterns do you see across my content ideas this month?", expected: "minimax" },
    { message: "Give me a competitive digest for this week", expected: "minimax" },
    { message: "weekly review", expected: "minimax" },
    { message: "brain brief", expected: "minimax" },
  ];

  console.log("=== Model Router — Built-in Tests (plugin policy) ===\n");
  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    const result = await routeMessage(test.message, { sender: "test", channel: "test" });
    const match = result.tier === test.expected;
    const status = match ? "✅" : "❌";

    if (!match) {
      console.log(`${status} "${test.message.slice(0, 60)}"`);
      console.log(`   Expected: ${test.expected}, Got: ${result.tier} (${result.category}, ${result.confidence}, ${result.classifier})`);
      failed++;
    } else {
      console.log(`${status} "${test.message.slice(0, 60)}" → ${result.tier} (${result.confidence})`);
      passed++;
    }
  }

  console.log(`\n${passed}/${tests.length} passed (${Math.round((passed / tests.length) * 100)}%)`);
  if (failed > 0) process.exit(1);
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  main()
    .then(() => {
      // Plugin registers module-scope setInterval timers (Anthropic cooldown,
      // hookRunner patching fallback) that keep the event loop alive. As a CLI
      // consumer we don't need them — exit explicitly so the process terminates.
      process.exit(0);
    })
    .catch((err) => {
      console.error("Fatal:", err);
      process.exit(1);
    });
}
