#!/usr/bin/env node
/**
 * Preflight — run on the eval host before runner.js.
 *
 * Catches the recurring "fixed the wrong copy" failure: OpenClaw loads the plugin
 * from a fixed path (e.g. /root/lyra-model-router), not necessarily lyra-ai/plugins/...
 *
 * Env:
 *   SKIP_ROUTER_CHECK=1     — skip file marker check (local dev without server paths)
 *   LYRA_ROUTER_CHECK_PATH  — default /root/lyra-model-router/index.js
 *   LYRA_ROUTER_MARKER      — substring that must exist (default: normalizeTier0)
 */

import { readFileSync, existsSync } from 'fs';

const GATEWAY_HEALTH_URL = process.env.GATEWAY_HEALTH_URL || 'http://127.0.0.1:18789/health';

async function gatewayHealthy() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(GATEWAY_HEALTH_URL, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return false;
    const j = await r.json();
    return j.ok === true;
  } catch {
    return false;
  }
}

function routerMarkerOk() {
  if (process.env.SKIP_ROUTER_CHECK === '1') {
    console.log('[preflight] SKIP_ROUTER_CHECK=1 — router file not verified');
    return true;
  }
  const path = process.env.LYRA_ROUTER_CHECK_PATH || '/root/lyra-model-router/index.js';
  const marker = process.env.LYRA_ROUTER_MARKER || 'normalizeTier0';
  if (!existsSync(path)) {
    console.warn(
      `[preflight] Router path not found: ${path} — set SKIP_ROUTER_CHECK=1 for local dev or fix path`,
    );
    return process.env.REQUIRE_ROUTER_FILE === '1' ? false : true;
  }
  const src = readFileSync(path, 'utf8');
  if (!src.includes(marker)) {
    console.error(
      `[preflight] FAIL: ${path} missing marker "${marker}". Deploy to the path OpenClaw actually loads.`,
    );
    return false;
  }
  console.log(`[preflight] Router deploy contract OK (${marker} in ${path})`);
  return true;
}

async function main() {
  console.log('[preflight] Checking gateway health...');
  if (!(await gatewayHealthy())) {
    console.error('[preflight] FAIL: gateway not healthy at', GATEWAY_HEALTH_URL);
    process.exit(1);
  }
  console.log('[preflight] Gateway health OK');

  if (!routerMarkerOk()) {
    process.exit(1);
  }

  console.log('[preflight] All checks passed');
}

main().catch((e) => {
  console.error('[preflight] Fatal:', e.message);
  process.exit(1);
});
