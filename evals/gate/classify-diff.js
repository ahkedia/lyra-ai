#!/usr/bin/env node
/**
 * classify-diff.js — classify a set of changed files for the eval-coverage gate.
 *
 * Maps each changed path to a category (eval_case | behavior | infra | docs | unknown)
 * using evals/gate/path-rules.json (first matching rule wins), then derives whether the
 * changeset REQUIRES an eval touch and whether it HAS one.
 *
 * Pure + dependency-free so it runs identically in CI and locally. No network, no git.
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RULES_PATH = process.env.EVAL_GATE_RULES || join(__dirname, 'path-rules.json');

/** Convert a glob (supporting ** and *) to an anchored RegExp. */
export function globToRegExp(glob) {
  // Escape regex specials except * which we handle below.
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // ** matches across path separators (and an optional trailing slash)
        i++;
        if (glob[i + 1] === '/') i++; // consume the slash so "a/**/b" and "a/**" both work
        re += '.*';
      } else {
        // * matches within a path segment (not /)
        re += '[^/]*';
      }
    } else if ('\\^$.|?+()[]{}'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp('^' + re + '$');
}

export function loadRules(rulesPath = RULES_PATH) {
  const raw = JSON.parse(readFileSync(rulesPath, 'utf8'));
  return raw.rules.map((r) => ({
    category: r.category,
    matchers: r.globs.map((g) => ({ glob: g, re: globToRegExp(g) })),
  }));
}

/** Classify a single file path. Returns { path, category, matchedGlob }. */
export function classifyPath(path, rules) {
  const p = path.replace(/^\.\//, '');
  for (const rule of rules) {
    for (const m of rule.matchers) {
      if (m.re.test(p)) return { path: p, category: rule.category, matchedGlob: m.glob };
    }
  }
  return { path: p, category: 'unknown', matchedGlob: null };
}

/**
 * Classify a changeset (array of file paths) and derive the gate decision.
 * @returns {{ files, counts, requiresEval, hasEvalTouch, unknownPaths, decision, wouldBlock }}
 */
export function classifyChangeset(paths, rulesPath = RULES_PATH) {
  const rules = loadRules(rulesPath);
  const files = paths.filter(Boolean).map((p) => classifyPath(p, rules));

  const counts = { eval_case: 0, behavior: 0, infra: 0, docs: 0, unknown: 0 };
  for (const f of files) counts[f.category] = (counts[f.category] || 0) + 1;

  const requiresEval = counts.behavior > 0;
  const hasEvalTouch = counts.eval_case > 0;
  const unknownPaths = files.filter((f) => f.category === 'unknown').map((f) => f.path);

  let decision;
  if (!requiresEval) decision = 'no_behavior_change';
  else if (hasEvalTouch) decision = 'covered';
  else decision = 'needs_eval';

  return {
    files,
    counts,
    requiresEval,
    hasEvalTouch,
    unknownPaths,
    decision,
    wouldBlock: decision === 'needs_eval',
  };
}

// CLI: pass file paths as args, or pipe newline-separated paths on stdin. Prints JSON.
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  let paths = args;
  if (paths.length === 0) {
    const stdin = readFileSync(0, 'utf8');
    paths = stdin.split('\n').map((s) => s.trim()).filter(Boolean);
  }
  const result = classifyChangeset(paths);
  console.log(JSON.stringify(result, null, 2));
}
