#!/usr/bin/env node
/**
 * Preflight — run on the eval host before runner.js.
 *
 * Catches the recurring "fixed the wrong copy" failure: OpenClaw loads the plugin
 * from a fixed path (e.g. /root/lyra-model-router), not necessarily lyra-ai/plugins/...
 *
 * Also catches transport/protocol drift: the eval ws-client must be able to complete
 * the gateway handshake. HTTP /health being OK is NOT sufficient — the gateway upgraded
 * its wire protocol (3 -> 4) on 2026-05-12 and the ws handshake silently broke for ~13
 * days while /health stayed green. This check connects for real and alerts on failure.
 *
 * Env:
 *   SKIP_ROUTER_CHECK=1     — skip file marker check (local dev without server paths)
 *   SKIP_TRANSPORT_CHECK=1  — skip ws handshake check (local dev without a gateway)
 *   LYRA_ROUTER_CHECK_PATH  — default /root/lyra-model-router/index.js
 *   LYRA_ROUTER_MARKER      — substring that must exist (default: normalizeTier0)
 */

import { readFileSync, existsSync } from 'fs';
import { OpenClawClient } from './ws-client.js';

const GATEWAY_HEALTH_URL = process.env.GATEWAY_HEALTH_URL || 'http://127.0.0.1:18789/health';
const GATEWAY_WS_URL = process.env.OPENCLAW_GATEWAY_URL || 'ws://localhost:18789';

async function telegramAlert(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_USER_ID;
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch {
    /* alerting is best-effort */
  }
}

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

// Real ws handshake — the check that would have caught the protocol-3->4 drift.
async function transportHandshakeOk() {
  if (process.env.SKIP_TRANSPORT_CHECK === '1') {
    console.log('[preflight] SKIP_TRANSPORT_CHECK=1 — ws handshake not verified');
    return true;
  }
  const client = new OpenClawClient(GATEWAY_WS_URL, process.env.OPENCLAW_GATEWAY_TOKEN);
  try {
    await client.connect();
    client.disconnect();
    console.log('[preflight] Transport handshake OK (eval ws-client connected to gateway)');
    return true;
  } catch (e) {
    const msg = e.message || String(e);
    console.error(`[preflight] FAIL: eval ws-client cannot connect: ${msg}`);
    console.error('[preflight] Likely gateway wire-protocol drift — check minProtocol/maxProtocol in evals/ws-client.js against the installed OpenClaw client.');
    await telegramAlert(
      `🛑 Lyra eval preflight FAILED: ws transport handshake broken.\n` +
        `Error: ${msg}\n` +
        `Evals cannot run. Likely gateway protocol drift after an OpenClaw upgrade — ` +
        `check minProtocol/maxProtocol in evals/ws-client.js.`,
    );
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
    await telegramAlert(`🛑 Lyra eval preflight FAILED: gateway not healthy at ${GATEWAY_HEALTH_URL}`);
    process.exit(1);
  }
  console.log('[preflight] Gateway health OK');

  if (!(await transportHandshakeOk())) {
    process.exit(1);
  }

  if (!routerMarkerOk()) {
    process.exit(1);
  }

  console.log('[preflight] All checks passed');
}

main().catch((e) => {
  console.error('[preflight] Fatal:', e.message);
  process.exit(1);
});
