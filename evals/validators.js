/**
 * Validator implementations for eval test cases.
 * Each validator takes a response string and config, returns { passed, detail }.
 */

export const validators = {
  /**
   * Check if response contains a substring (case-insensitive).
   */
  contains(response, config) {
    const value = config.value.toLowerCase();
    const passed = response.toLowerCase().includes(value);
    return {
      passed,
      detail: passed
        ? `Contains "${config.value}"`
        : `Missing "${config.value}" in response`,
    };
  },

  /**
   * Check if response does NOT contain a substring.
   */
  not_contains(response, config) {
    const value = config.value.toLowerCase();
    const passed = !response.toLowerCase().includes(value);
    return {
      passed,
      detail: passed
        ? `Correctly excludes "${config.value}"`
        : `Unexpectedly contains "${config.value}"`,
    };
  },

  /**
   * Check if response matches a regex pattern.
   */
  regex(response, config) {
    const regex = new RegExp(config.pattern, config.flags || 'i');
    const passed = regex.test(response);
    return {
      passed,
      detail: passed
        ? `Matches pattern /${config.pattern}/`
        : `Does not match pattern /${config.pattern}/`,
    };
  },

  /**
   * Check if latency is within threshold.
   */
  latency_p95(response, config, meta = {}) {
    const latency = meta.latencyMs || 0;
    const threshold = config.threshold_ms;
    const passed = latency <= threshold;
    return {
      passed,
      detail: passed
        ? `Latency ${latency}ms <= ${threshold}ms`
        : `Latency ${latency}ms > ${threshold}ms threshold`,
    };
  },

  /**
   * Check if response length is within range.
   */
  length_range(response, config) {
    const len = response.length;
    const min = config.min || 0;
    const max = config.max || Infinity;
    const passed = len >= min && len <= max;
    return {
      passed,
      detail: passed
        ? `Length ${len} within [${min}, ${max}]`
        : `Length ${len} outside [${min}, ${max}]`,
    };
  },

  /**
   * LLM-as-judge validator (stub - calls external judge function).
   * The actual LLM call is handled by llm-judge.js.
   */
  llm_judge(response, config, meta = {}) {
    // This is resolved by the runner which calls llm-judge.js
    // Return a placeholder that will be replaced
    return {
      passed: meta.llmJudgeResult?.passed ?? false,
      detail: meta.llmJudgeResult?.detail ?? 'LLM judge not yet evaluated',
      score: meta.llmJudgeResult?.score ?? 0,
    };
  },
};

/**
 * Run all validators for a test case against a response.
 * @param {string} response - The LLM response text
 * @param {Array} validatorConfigs - Array of {type, ...config}
 * @param {object} meta - { latencyMs, ttftMs, llmJudgeResults }
 * @returns {{ passed: boolean, results: Array }}
 */
export function runValidators(response, validatorConfigs, meta = {}) {
  const results = [];
  let allPassed = true;

  for (let i = 0; i < validatorConfigs.length; i++) {
    const config = validatorConfigs[i];
    const validatorFn = validators[config.type];

    if (!validatorFn) {
      results.push({
        type: config.type,
        passed: false,
        detail: `Unknown validator type: ${config.type}`,
      });
      allPassed = false;
      continue;
    }

    // For llm_judge, inject the pre-computed result
    const judgeMeta = config.type === 'llm_judge'
      ? { ...meta, llmJudgeResult: meta.llmJudgeResults?.[i] }
      : meta;

    const result = validatorFn(response, config, judgeMeta);
    results.push({
      type: config.type,
      ...result,
    });

    if (!result.passed) {
      allPassed = false;
    }
  }

  return { passed: allPassed, results };
}
