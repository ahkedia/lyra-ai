#!/usr/bin/env node

/**
 * Lyra Router Hook — OpenClaw pre-processing hook for model routing.
 *
 * This hook intercepts incoming messages BEFORE they reach the LLM,
 * classifies the task, and overrides the model selection accordingly.
 *
 * Integration with OpenClaw:
 *   1. As a message preprocessor (stdin/stdout JSON)
 *   2. As a webhook filter
 *   3. As a standalone classifier callable from SOUL.md instructions
 *
 * The hook reads a message from stdin (JSON), classifies it,
 * and outputs the routing decision + modified config to stdout.
 *
 * Usage in OpenClaw hooks:
 *   openclaw.json → hooks.internal.entries.model-router
 *
 * Standalone:
 *   echo '{"message":"Add milk to list","sender":"7057922182"}' | node router-hook.js
 */

import { routeMessage } from './model-router.js';

/**
 * Process a single routing request from stdin.
 */
async function processStdin() {
  let input = '';

  process.stdin.setEncoding('utf8');

  for await (const chunk of process.stdin) {
    input += chunk;
  }

  if (!input.trim()) {
    outputResult({ error: 'No input provided' });
    return;
  }

  try {
    const request = JSON.parse(input.trim());
    const message = request.message || request.text || '';
    const context = {
      sender: request.sender || request.from || 'unknown',
      channel: request.channel || 'telegram',
      session_type: request.session_type || 'dm',
    };

    if (!message) {
      outputResult({ error: 'No message in request', default_model: 'minimax/MiniMax-M2.7' });
      return;
    }

    const result = await routeMessage(message, context);

    outputResult({
      routing: result,
      openclaw_override: {
        model: result.model,
        max_tokens: getMaxTokens(result.tier),
      },
      message: message,
      context,
    });
  } catch (err) {
    outputResult({
      error: `Parse error: ${err.message}`,
      default_model: 'minimax/MiniMax-M2.7',
    });
  }
}

/**
 * Get max tokens for a tier.
 */
function getMaxTokens(tier) {
  const limits = {
    minimax: 2048,
    haiku: 4096,
    sonnet: 8192,
  };
  return limits[tier] || 2048;
}

/**
 * Output result as JSON to stdout.
 */
function outputResult(data) {
  console.log(JSON.stringify(data));
}

processStdin().catch(err => {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
});
