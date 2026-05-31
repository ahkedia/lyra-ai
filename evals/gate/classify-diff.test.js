/**
 * Unit tests for the eval-coverage path classifier.
 * Run: node --test evals/gate/classify-diff.test.js
 */
import test from 'node:test';
import assert from 'node:assert';
import { globToRegExp, classifyChangeset } from './classify-diff.js';

test('globToRegExp: ** spans path separators, * does not', () => {
  assert.ok(globToRegExp('content-engine/**').test('content-engine/scripts/lib/anthropic.js'));
  assert.ok(globToRegExp('**/SOUL.md').test('config/SOUL.md'));
  assert.ok(globToRegExp('*.md').test('README.md'));
  assert.ok(!globToRegExp('*.md').test('docs/guide.md')); // * must not cross /
  assert.ok(globToRegExp('evals/cases/**').test('evals/cases/tier1-core-capability.yaml'));
});

test('behavior change without eval -> needs_eval / wouldBlock', () => {
  const r = classifyChangeset(['content-engine/scripts/draft-generator.js', 'crud/cli.py']);
  assert.equal(r.decision, 'needs_eval');
  assert.equal(r.wouldBlock, true);
  assert.equal(r.requiresEval, true);
  assert.equal(r.hasEvalTouch, false);
});

test('behavior change WITH an eval touch -> covered', () => {
  const r = classifyChangeset(['config/SOUL.md', 'evals/cases/tier3-judgment.yaml']);
  assert.equal(r.decision, 'covered');
  assert.equal(r.wouldBlock, false);
});

test('eval harness infra (non-cases) is NOT behavior -> no_behavior_change', () => {
  const r = classifyChangeset(['evals/runner.js', 'evals/ws-client.js']);
  assert.equal(r.decision, 'no_behavior_change');
  assert.equal(r.counts.infra, 2);
  assert.equal(r.counts.behavior, 0);
});

test('editing only eval cases does not require coverage', () => {
  const r = classifyChangeset(['evals/cases/tier5-production-gaps.yaml']);
  assert.equal(r.decision, 'no_behavior_change');
  assert.equal(r.counts.eval_case, 1);
});

test('docs-only change -> no_behavior_change', () => {
  const r = classifyChangeset(['docs/eval-rollout-plan.md', 'README.md', 'blog/building-lyra.md']);
  assert.equal(r.decision, 'no_behavior_change');
  assert.equal(r.counts.docs, 3);
});

test('SOUL.md is behavior-bearing even at repo root', () => {
  const r = classifyChangeset(['SOUL.md']);
  assert.equal(r.requiresEval, true);
});

test('unknown paths are surfaced but do not require eval in shadow', () => {
  const r = classifyChangeset(['some-new-toplevel-thing/foo.js']);
  assert.equal(r.counts.unknown, 1);
  assert.equal(r.requiresEval, false);
  assert.deepEqual(r.unknownPaths, ['some-new-toplevel-thing/foo.js']);
});

test('eval_case rule beats the broad evals/** infra rule (order matters)', () => {
  const r = classifyChangeset(['evals/cases/tier1-core-capability.yaml', 'evals/runner.js']);
  assert.equal(r.counts.eval_case, 1);
  assert.equal(r.counts.infra, 1);
});
