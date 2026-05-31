#!/usr/bin/env node
/**
 * check-eval-coverage.js — the eval-coverage gate (Phase 2: shadow / warn-only).
 *
 * Given a git range, classify the changed files and decide whether a behavior-bearing
 * change shipped WITHOUT touching any eval case. In shadow mode it only WARNS + logs;
 * with --enforce (Phase 4) it exits non-zero on an uncovered behavior change.
 *
 * Usage:
 *   node check-eval-coverage.js [--base <ref>] [--head <ref>] [--range <base>..<head>]
 *                               [--enforce] [--log <path>] [--quiet]
 *   node check-eval-coverage.js                 # defaults to origin/main...HEAD
 *
 * Break-glass: a commit whose message contains "[break-glass: <reason>]" (or the env
 * EVAL_GATE_BREAK_GLASS=1) bypasses enforcement but is still logged + flagged.
 *
 * Exit codes: 0 = pass/shadow. 1 = (only with --enforce) uncovered behavior change.
 */

import { execFileSync } from 'child_process';
import { appendFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { classifyChangeset } from './classify-diff.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_LOG = join(__dirname, 'logs', 'shadow-decisions.jsonl');

function parseArgs(argv) {
  const o = { enforce: false, quiet: false, log: process.env.EVAL_GATE_LOG || DEFAULT_LOG };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--enforce') o.enforce = true;
    else if (a === '--quiet') o.quiet = true;
    else if (a === '--base') o.base = argv[++i];
    else if (a === '--head') o.head = argv[++i];
    else if (a === '--range') o.range = argv[++i];
    else if (a === '--log') o.log = argv[++i];
  }
  return o;
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function resolveRange(o) {
  if (o.range) {
    // Parse the head ref out of "base...head" / "base..head" for accurate commit metadata.
    const m = o.range.match(/\.{2,3}(.+)$/);
    return { range: o.range, headRef: o.head || (m ? m[1] : 'HEAD') };
  }
  const base = o.base || process.env.EVAL_GATE_BASE || 'origin/main';
  const head = o.head || process.env.EVAL_GATE_HEAD || 'HEAD';
  return { range: `${base}...${head}`, headRef: head };
}

function changedFiles(range) {
  // --no-renames so a rename surfaces both old+new for honest classification.
  const out = git(['diff', '--no-renames', '--name-only', range]);
  return out ? out.split('\n').map((s) => s.trim()).filter(Boolean) : [];
}

function headCommitMeta(ref = 'HEAD') {
  try {
    const sha = git(['rev-parse', ref]);
    const subject = git(['log', '-1', '--pretty=%s', sha]);
    const body = git(['log', '-1', '--pretty=%B', sha]);
    return { sha, subject, body };
  } catch {
    return { sha: null, subject: '', body: '' };
  }
}

function detectBreakGlass(body) {
  if (process.env.EVAL_GATE_BREAK_GLASS === '1') return { active: true, reason: 'env:EVAL_GATE_BREAK_GLASS' };
  const m = (body || '').match(/\[break-glass:\s*([^\]]+)\]/i);
  return m ? { active: true, reason: m[1].trim() } : { active: false, reason: null };
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  const { range, headRef } = resolveRange(o);

  let files;
  try {
    files = changedFiles(range);
  } catch (e) {
    console.error(`[eval-gate] could not diff range ${range}: ${e.message}`);
    process.exit(0); // never break CI on our own infra error in shadow mode
  }

  const result = classifyChangeset(files);
  const meta = headCommitMeta(headRef);
  const breakGlass = detectBreakGlass(meta.body);

  const record = {
    ts: new Date().toISOString(),
    mode: o.enforce ? 'enforce' : 'shadow',
    range,
    commit: meta.sha,
    subject: meta.subject,
    decision: result.decision,
    would_block: result.wouldBlock,
    requires_eval: result.requiresEval,
    has_eval_touch: result.hasEvalTouch,
    counts: result.counts,
    behavior_files: result.files.filter((f) => f.category === 'behavior').map((f) => f.path),
    unknown_files: result.unknownPaths,
    break_glass: breakGlass.active,
    break_glass_reason: breakGlass.reason,
  };

  // Persist shadow record (best-effort).
  try {
    mkdirSync(dirname(o.log), { recursive: true });
    appendFileSync(o.log, JSON.stringify(record) + '\n');
  } catch (e) {
    if (!o.quiet) console.error(`[eval-gate] log write failed (non-fatal): ${e.message}`);
  }

  if (!o.quiet) printSummary(result, record, o);

  // Decide exit code.
  if (result.wouldBlock && o.enforce && !breakGlass.active) {
    process.exit(1);
  }
  process.exit(0);
}

function printSummary(result, record, o) {
  const { counts } = result;
  const tag = o.enforce ? 'ENFORCE' : 'SHADOW';
  console.log(`\n  ── eval-coverage gate (${tag}) ──────────────────────────────`);
  console.log(`  range:    ${record.range}`);
  console.log(`  changed:  behavior=${counts.behavior} eval_case=${counts.eval_case} infra=${counts.infra} docs=${counts.docs} unknown=${counts.unknown}`);
  if (record.unknown_files.length) {
    console.log(`  ⚠ unclassified (refine path-rules.json): ${record.unknown_files.slice(0, 8).join(', ')}`);
  }
  if (record.decision === 'no_behavior_change') {
    console.log(`  ✅ PASS — no behavior-bearing change; no eval required.`);
  } else if (record.decision === 'covered') {
    console.log(`  ✅ PASS — behavior change is accompanied by an eval-case change.`);
  } else if (record.decision === 'needs_eval') {
    if (record.break_glass) {
      console.log(`  🟡 BREAK-GLASS — behavior change WITHOUT an eval (reason: ${record.break_glass_reason}). Logged; not blocked.`);
    } else if (o.enforce) {
      console.log(`  🛑 BLOCK — behavior change with NO eval-case touch. Add/adjust a case in evals/cases/ or tag the commit [break-glass: <reason>].`);
    } else {
      console.log(`  🟡 WARN (shadow) — behavior change with NO eval-case touch. Would block under enforcement.`);
      console.log(`     behavior files: ${record.behavior_files.slice(0, 8).join(', ')}${record.behavior_files.length > 8 ? ' …' : ''}`);
    }
  }
  console.log(`  ─────────────────────────────────────────────────────────────\n`);
}

main();
