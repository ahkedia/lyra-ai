/**
 * Eval result classification — Phase 0 split metrics.
 *
 * Devil's-advocate notes (why this isn't "foolproof"):
 * - Infra vs capability is heuristic: new failure strings need updating.
 * - "Stable" excludes transport/timeout; a slow but valid response still counts as stable.
 * - Integration subset is tag/category-based; mistagged tests skew integration_pass_rate.
 * - capability_pass_rate can be gamed by tagging everything unstable — gates also check run_valid.
 */

import { createHash } from 'crypto';

/** @typedef {'ok'|'timeout'|'transport'|'infra'|'error'} StabilityKind */

/**
 * Short stable fingerprint for grouping errors in dashboards (no PII — message is already truncated upstream).
 * @param {string|null|undefined} error
 */
export function errorFingerprint(error) {
  const raw = (error || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!raw) return '';
  return createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 12);
}

/**
 * Classify a single test outcome for stability reporting.
 * @param {string|null|undefined} error
 * @returns {StabilityKind}
 */
export function classifyStability(error) {
  const e = (error || '').toLowerCase();
  if (!e) return 'ok';
  if (e.includes('timeout') || e.includes('timed out')) return 'timeout';
  if (
    e.includes('connection closed') ||
    e.includes('not connected') ||
    e.includes('econnrefused') ||
    e.includes('websocket error') ||
    e.includes('econnreset') ||
    e.includes('socket hang up') ||
    e.includes('enetunreach') ||
    e.includes('enotfound')
  ) {
    return 'transport';
  }
  // Gateway OOM / overload / upstream 5xx — exclude from capability score like timeouts
  if (
    e.includes('heap') ||
    e.includes('out of memory') ||
    e.includes('allocation failed') ||
    e.includes('javascript heap') ||
    e.includes('enomem') ||
    e.includes('503') ||
    e.includes('502') ||
    e.includes('504') ||
    e.includes('500') ||
    e.includes('bad gateway') ||
    e.includes('service unavailable') ||
    e.includes('gateway timeout') ||
    e.includes('status code 503') ||
    e.includes('status code 502') ||
    e.includes('status code 504') ||
    e.includes('status code 500') ||
    e.includes('cloudflare') ||
    e.includes('working memory') ||
    e.includes('payload too large')
  ) {
    return 'infra';
  }
  return 'error';
}

/**
 * True when the failure is likely gateway/load/transport — exclude from capability score.
 */
export function isInfrastructureFailure(error) {
  const kind = classifyStability(error);
  return kind === 'timeout' || kind === 'transport' || kind === 'infra';
}

/**
 * Coarse failure taxonomy for dashboards and gate triage.
 * Keeps legacy pass/fail unchanged; this only adds explainability.
 *
 * @param {{ passed?: boolean, error?: string|null, failure_reason?: string|null, response_preview?: string|null }} r
 * @returns {'none'|'timeout'|'infra'|'heartbeat_leak'|'judge'|'latency_threshold'|'assertion'|'auth'|'other'}
 */
export function classifyFailureKind(r = {}) {
  if (r.passed) return 'none';

  const error = (r.error || '').toString();
  const reason = (r.failure_reason || '').toString();
  const preview = (r.response_preview || '').toString();
  const haystack = `${error} ${reason}`.toLowerCase();

  if (preview.trim().toUpperCase() === 'HEARTBEAT_OK' || haystack.includes('heartbeat_ok')) {
    return 'heartbeat_leak';
  }

  const stability = classifyStability(haystack);
  if (stability === 'timeout') return 'timeout';
  if (stability === 'transport' || stability === 'infra') return 'infra';

  if (haystack.includes('llm judge')) return 'judge';
  if (haystack.includes('latency') && haystack.includes('threshold')) return 'latency_threshold';
  if (
    haystack.includes('unexpectedly contains') ||
    haystack.includes('missing "') ||
    haystack.includes('does not match pattern') ||
    haystack.includes('unknown validator type')
  ) {
    return 'assertion';
  }
  if (
    haystack.includes('unauthorized') ||
    haystack.includes('forbidden') ||
    haystack.includes('permission') ||
    haystack.includes('auth')
  ) {
    return 'auth';
  }
  return 'other';
}

/**
 * @param {{ error?: string|null, tags?: string[], category?: string, side_effects?: string }} r
 */
export function isIntegrationShapedTest(r) {
  const tags = r.tags || [];
  if (tags.includes('tier0') || tags.includes('crud')) return true;
  const cat = r.category || '';
  if (cat === 'tier0_crud' || cat === 'write_verification') return true;
  if (r.side_effects === 'write') return true;
  return false;
}

/**
 * Aggregate split metrics from a result list (same shape as runner JSONL lines).
 */
export function computeSplitScores(results) {
  const total = results.length;
  let infraFailures = 0;
  const byReason = { timeout: 0, transport: 0, infra: 0, error: 0 };
  const failureKinds = {
    timeout: 0,
    infra: 0,
    heartbeat_leak: 0,
    judge: 0,
    latency_threshold: 0,
    assertion: 0,
    auth: 0,
    other: 0,
  };

  for (const r of results) {
    if (!r.passed) {
      const kind = classifyFailureKind(r);
      if (failureKinds[kind] == null) failureKinds[kind] = 0;
      failureKinds[kind] += 1;
    }
    const kind = classifyStability(r.error);
    if (kind === 'timeout') {
      infraFailures++;
      byReason.timeout++;
    } else if (kind === 'transport') {
      infraFailures++;
      byReason.transport++;
    } else if (kind === 'infra') {
      infraFailures++;
      byReason.infra++;
    } else if (kind === 'error') {
      byReason.error++;
    }
  }

  const stable = results.filter((r) => !isInfrastructureFailure(r.error));
  const stableCount = stable.length;
  const passedStable = stable.filter((r) => r.passed).length;
  const capabilityPassRate =
    stableCount > 0 ? Math.round((passedStable / stableCount) * 10000) / 10000 : null;

  const integ = results.filter(isIntegrationShapedTest);
  const integStable = integ.filter((r) => !isInfrastructureFailure(r.error));
  const integPassed = integStable.filter((r) => r.passed).length;
  const integrationPassRate =
    integStable.length > 0
      ? Math.round((integPassed / integStable.length) * 10000) / 10000
      : null;

  const infraFailureRate = total > 0 ? Math.round((infraFailures / total) * 10000) / 10000 : 0;
  const timeoutRate = total > 0 ? Math.round((failureKinds.timeout / total) * 10000) / 10000 : 0;
  const authFailureRate = total > 0 ? Math.round((failureKinds.auth / total) * 10000) / 10000 : 0;

  const stableRetrievalJudgeFailures = stable.filter((r) =>
    !r.passed &&
    (r.category || '') === 'retrieval_quality' &&
    classifyFailureKind(r) === 'judge',
  ).length;

  const legacyPassed = results.filter((r) => r.passed).length;
  const legacyPassRate = total > 0 ? Math.round((legacyPassed / total) * 10000) / 10000 : 0;

  /** Too many infra failures → whole run is not comparable to prior days */
  const runValid = total === 0 ? false : stableCount >= Math.ceil(total * 0.5);

  const STABILITY_MAX_INFRA = Number(process.env.EVAL_MAX_INFRA_FAILURE_RATE || 0.25);
  const CAPABILITY_MIN = Number(process.env.EVAL_CAPABILITY_MIN_PASS_RATE || 0.8);
  const STRICT_KIND_GATES = process.env.EVAL_ENABLE_STRICT_KIND_GATES !== '0';
  const MAX_TIMEOUT_RATE = Number(process.env.EVAL_MAX_TIMEOUT_RATE || 0.25);
  const MAX_HEARTBEAT_LEAKS = Number(process.env.EVAL_MAX_HEARTBEAT_LEAKS || 0);
  const MAX_AUTH_FAILURE_RATE = Number(process.env.EVAL_MAX_AUTH_FAILURE_RATE || 0.2);
  const MAX_RETRIEVAL_JUDGE_FAILURES = Number(process.env.EVAL_MAX_RETRIEVAL_JUDGE_FAILURES || 0);

  const stabilityOk = infraFailureRate <= STABILITY_MAX_INFRA;
  const capabilityOk =
    capabilityPassRate !== null && capabilityPassRate >= CAPABILITY_MIN;
  const timeoutOk = timeoutRate <= MAX_TIMEOUT_RATE;
  const heartbeatOk = (failureKinds.heartbeat_leak || 0) <= MAX_HEARTBEAT_LEAKS;
  const authOk = authFailureRate <= MAX_AUTH_FAILURE_RATE;
  const retrievalGroundingOk = stableRetrievalJudgeFailures <= MAX_RETRIEVAL_JUDGE_FAILURES;
  const kindGatesOk = !STRICT_KIND_GATES || (timeoutOk && heartbeatOk && authOk && retrievalGroundingOk);

  return {
    stability: {
      total,
      infra_failures: infraFailures,
      infra_failure_rate: infraFailureRate,
      by_reason: byReason,
      by_failure_kind: failureKinds,
      stable_count: stableCount,
      unstable_count: total - stableCount,
    },
    scores: {
      legacy_pass_rate: legacyPassRate,
      legacy_passed: legacyPassed,
      capability_pass_rate: capabilityPassRate,
      capability_passed: passedStable,
      integration_total: integ.length,
      integration_stable: integStable.length,
      integration_passed: integPassed,
      integration_pass_rate: integrationPassRate,
      stable_retrieval_judge_failures: stableRetrievalJudgeFailures,
    },
    gates: {
      run_valid: runValid,
      stability_ok: stabilityOk,
      capability_ok: capabilityOk,
      timeout_ok: timeoutOk,
      heartbeat_ok: heartbeatOk,
      auth_ok: authOk,
      retrieval_grounding_ok: retrievalGroundingOk,
      strict_kind_gates_enabled: STRICT_KIND_GATES,
      kind_gates_ok: kindGatesOk,
      /** All gates for a "green" eval */
      all_ok: runValid && stabilityOk && capabilityOk && kindGatesOk,
    },
  };
}

/**
 * Top N error fingerprints for summary (infra triage).
 */
export function topErrorFingerprints(results, limit = 15) {
  const m = {};
  for (const r of results) {
    const fp = r.error_fingerprint || '';
    if (!fp) continue;
    const key = fp;
    if (!m[key]) m[key] = { fingerprint: fp, count: 0, example_error: (r.error || '').slice(0, 120) };
    m[key].count++;
  }
  return Object.values(m)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
