#!/usr/bin/env node
/**
 * email-digest.js — daily eval digest email (Phase 3 extension).
 *
 * Sends an HTML summary of the latest eval run to the operator: pass-rate + deltas,
 * an LLM-written diagnosis of each failure's likely cause, the eval-coverage activity
 * since the last run (new evals added + behavior changes that shipped without an eval),
 * an embedded screenshot of the live dashboard, and the dashboard link.
 *
 * Runs as the last step of run-evals.sh on full-eval days. Gmail SMTP via app password.
 *
 * Env: GMAIL_SMTP_HOST, GMAIL_SMTP_PORT, GMAIL_EMAIL_ADDRESS, GMAIL_APP_PASSWORD,
 *      ANTHROPIC_API_KEY (diagnosis; falls back to MiniMax), EVAL_DIGEST_TO (default = self),
 *      EVAL_DASHBOARD_URL (default GitHub Pages).
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import https from 'https';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const RESULTS_DIR = process.env.EVAL_RESULTS_DIR || join(__dirname, '..', 'results');
const SHADOW_LOG = join(__dirname, '..', 'gate', 'logs', 'shadow-decisions.jsonl');
const DASHBOARD_URL = process.env.EVAL_DASHBOARD_URL || 'https://ahkedia.github.io/lyra-ai/dashboard/';
const SHOT_URL = `https://image.thum.io/get/width/1100/noanimate/${DASHBOARD_URL}`;
const MIN_FULL_RUN = 20;

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const HAIKU_MODEL = process.env.EVAL_HAIKU_MODEL || 'claude-haiku-4-5-20251001';
const MINIMAX_MODEL = process.env.EVAL_MINIMAX_MODEL || 'MiniMax-M2.7';

// ── data ─────────────────────────────────────────────────────────────────────
function git(args) {
  try { return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim(); } catch { return ''; }
}

function loadRuns() {
  const files = readdirSync(RESULTS_DIR).filter((f) => /^\d{4}-\d{2}-\d{2}-summary\.json$/.test(f));
  const runs = [];
  for (const f of files) {
    try {
      const d = JSON.parse(readFileSync(join(RESULTS_DIR, f), 'utf8'));
      if ((d.total || 0) >= MIN_FULL_RUN) runs.push(d);
    } catch { /* skip */ }
  }
  runs.sort((a, b) => (a.timestamp || a.date).localeCompare(b.timestamp || b.date));
  return runs;
}

function evalCoverageSince(prevTs) {
  // From the Phase 2 shadow log: new eval edits + uncovered behavior changes since prevTs.
  const out = { evalEdits: [], uncovered: [] };
  if (!existsSync(SHADOW_LOG)) return out;
  const seen = new Set();
  for (const line of readFileSync(SHADOW_LOG, 'utf8').split('\n').filter(Boolean)) {
    let r; try { r = JSON.parse(line); } catch { continue; }
    if (prevTs && r.ts && r.ts <= prevTs) continue;
    if (seen.has(r.commit)) continue;
    seen.add(r.commit);
    if ((r.counts?.eval_case || 0) > 0) out.evalEdits.push({ sha: (r.commit || '').slice(0, 8), subject: r.subject });
    if (r.would_block) out.uncovered.push({ sha: (r.commit || '').slice(0, 8), subject: r.subject, behavior: r.counts?.behavior || 0 });
  }
  return out;
}

// ── LLM diagnosis (self-contained Anthropic -> MiniMax fallback) ──────────────
function anthropicCall(system, user, maxTokens) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model: HAIKU_MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] });
    const req = https.request({
      hostname: 'api.anthropic.com', port: 443, path: '/v1/messages', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = ''; res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { const p = JSON.parse(data); if (p.error) return reject(new Error(p.error.message)); resolve(p.content?.[0]?.text || ''); }
        catch (e) { reject(new Error(`anthropic parse: ${data.slice(0, 150)}`)); }
      });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

function minimaxCall(system, user, maxTokens) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model: MINIMAX_MODEL, max_tokens: maxTokens * 2, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] });
    const req = https.request({
      hostname: 'api.minimaxi.chat', port: 443, path: '/v1/text/chatcompletion_v2', method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.MINIMAX_API_KEY || ''}`, 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = ''; res.on('data', (c) => (data += c));
      res.on('end', () => { try { const p = JSON.parse(data); resolve(p.choices?.[0]?.message?.content || ''); } catch (e) { reject(new Error('minimax parse')); } });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

async function llmDiagnose(failures) {
  if (!failures.length) return null;
  const system = 'You are an SRE assistant analyzing failures from an AI assistant\'s eval suite. For each failing test, give the single most likely root cause in <= 18 words, plainly. Distinguish: real capability/behavior bug vs test/rubric issue vs infra (timeout/throttle/gateway) vs auth. Return one line per test as "test-id: cause". End with one line "OVERALL: <one-sentence takeaway>".';
  const user = failures.map((f) => `- ${f.id} [kind=${f.kind}] ${f.reason}`).join('\n');
  try { return await anthropicCall(system, user, 400); }
  catch (e) {
    if (/credit balance/i.test(e.message)) { try { return await minimaxCall(system, user, 400); } catch { return null; } }
    return null;
  }
}

// ── rendering ────────────────────────────────────────────────────────────────
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pctf = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
const tiers = ['core_capability', 'architectural', 'judgment', 'showcase', 'gap'];
const KIND_HINT = {
  timeout: 'infra — slow synthesis or MiniMax throttle, not necessarily a capability gap',
  judge: 'capability/quality — the LLM judge scored the answer below the rubric',
  assertion: 'behavior — an exact-match validator failed (often a real bug)',
  infra: 'infra — gateway/transport, not Lyra quality',
  auth: 'auth — credential/scope problem',
  heartbeat_leak: 'infra — heartbeat text leaked into the response',
  other: 'uncategorized',
};

function diagnosisMap(text) {
  const map = {}; let overall = '';
  if (!text) return { map, overall };
  for (const line of text.split('\n')) {
    const m = line.match(/^[-*\s]*([a-z0-9-]+):\s*(.+)$/i);
    if (m && m[1].toUpperCase() === 'OVERALL') { overall = m[2].trim(); continue; }
    if (m) map[m[1]] = m[2].trim();
  }
  const ov = text.match(/OVERALL:\s*(.+)$/im);
  if (ov) overall = ov[1].trim();
  return { map, overall };
}

function renderHtml(model) {
  const { latest, prev, failures, diag, coverage } = model;
  const passDelta = prev ? latest.pass_rate - prev.pass_rate : null;
  const dColor = passDelta == null ? '#8b949e' : passDelta > 0 ? '#3fb950' : passDelta < 0 ? '#f85149' : '#8b949e';
  const dTxt = passDelta == null ? 'baseline' : `${passDelta > 0 ? '▲ +' : passDelta < 0 ? '▼ ' : ''}${Math.round(passDelta * 100)} pts vs prev`;
  const gatesOk = latest.gates && latest.gates.all_ok;

  const tierRows = tiers.map((t) => {
    const cur = latest.by_tier?.[t]?.pass_rate;
    const old = prev?.by_tier?.[t]?.pass_rate;
    if (cur == null) return '';
    const delta = old == null ? null : cur - old;
    const dc = delta == null ? '#8b949e' : delta > 0.001 ? '#3fb950' : delta < -0.001 ? '#f85149' : '#8b949e';
    const ds = delta == null ? '' : delta === 0 ? '–' : `${delta > 0 ? '+' : ''}${Math.round(delta * 100)}`;
    return `<tr><td style="padding:4px 10px">${esc(t.replace('_', ' '))}</td><td style="padding:4px 10px;text-align:right;font-variant-numeric:tabular-nums">${pctf(cur)}</td><td style="padding:4px 10px;text-align:right;color:${dc}">${ds}</td></tr>`;
  }).join('');

  const failRows = failures.length ? failures.map((f) => `
    <tr>
      <td style="padding:6px 10px;border-top:1px solid #30363d;vertical-align:top"><code style="color:#58a6ff">${esc(f.id)}</code><div style="color:#8b949e;font-size:11px">${esc(f.kind)} · ${esc((KIND_HINT[f.kind] || '').split('—')[0])}</div></td>
      <td style="padding:6px 10px;border-top:1px solid #30363d;vertical-align:top;font-size:12px">${esc(f.reason).slice(0, 240)}</td>
      <td style="padding:6px 10px;border-top:1px solid #30363d;vertical-align:top;font-size:12px;color:#d29922">${esc(diag.map[f.id] || KIND_HINT[f.kind] || '—')}</td>
    </tr>`).join('') : '<tr><td colspan="3" style="padding:8px 10px;color:#3fb950">No failures 🎉</td></tr>';

  const covEdits = coverage.evalEdits.length
    ? coverage.evalEdits.map((c) => `<li><code style="color:#58a6ff">${esc(c.sha)}</code> ${esc(c.subject)}</li>`).join('')
    : '<li style="color:#8b949e">No new or changed evals this period.</li>';
  const covUncovered = coverage.uncovered.length
    ? `<div style="margin-top:8px;color:#d29922"><b>⚠ Behavior changes shipped without an eval:</b><ul style="margin:4px 0">${coverage.uncovered.map((c) => `<li><code>${esc(c.sha)}</code> ${esc(c.subject)} <span style="color:#8b949e">(${c.behavior} files)</span></li>`).join('')}</ul></div>`
    : '';

  return `<!doctype html><html><body style="margin:0;background:#0d1117;color:#e6edf3;font-family:-apple-system,Segoe UI,Roboto,sans-serif;padding:0">
  <div style="max-width:720px;margin:0 auto;padding:24px">
    <h1 style="font-size:20px;margin:0 0 2px">Lyra Eval Digest — ${esc(latest.date)}</h1>
    <div style="color:#8b949e;font-size:12px;margin-bottom:18px">evals-before-changes · <a href="${esc(DASHBOARD_URL)}" style="color:#58a6ff">open full dashboard ↗</a></div>

    <table style="width:100%;border-collapse:collapse;margin-bottom:8px"><tr>
      <td style="background:#161b22;border:1px solid #30363d;border-radius:8px;padding:12px;width:33%">
        <div style="color:#8b949e;font-size:11px;text-transform:uppercase">Pass rate</div>
        <div style="font-size:26px;font-weight:600">${pctf(latest.pass_rate)}</div>
        <div style="font-size:12px;color:${dColor}">${dTxt}</div>
        <div style="font-size:11px;color:#8b949e">${latest.passed}/${latest.total} · cap ${pctf(latest.scores?.capability_pass_rate)}</div>
      </td>
      <td style="width:8px"></td>
      <td style="background:#161b22;border:1px solid #30363d;border-radius:8px;padding:12px;width:33%">
        <div style="color:#8b949e;font-size:11px;text-transform:uppercase">Ship gate</div>
        <div style="font-size:26px;font-weight:600;color:${gatesOk ? '#3fb950' : '#f85149'}">${gatesOk ? 'GREEN' : 'RED'}</div>
        <div style="font-size:11px;color:#8b949e">${gatesOk ? 'all_ok' : 'blocking on real bugs'}</div>
      </td>
      <td style="width:8px"></td>
      <td style="background:#161b22;border:1px solid #30363d;border-radius:8px;padding:12px;width:33%">
        <div style="color:#8b949e;font-size:11px;text-transform:uppercase">Avg latency</div>
        <div style="font-size:26px;font-weight:600">${latest.avg_latency_ms ? (latest.avg_latency_ms / 1000).toFixed(1) + 's' : '—'}</div>
        <div style="font-size:11px;color:#8b949e">failures: ${Object.entries(latest.failure_breakdown || {}).map(([k, v]) => `${k}:${v}`).join(' ') || 'none'}</div>
      </td>
    </tr></table>

    <h2 style="font-size:13px;text-transform:uppercase;color:#8b949e;border-bottom:1px solid #30363d;padding-bottom:6px;margin:22px 0 8px">Per-tier</h2>
    <table style="width:100%;border-collapse:collapse;font-size:13px">${tierRows}</table>

    <h2 style="font-size:13px;text-transform:uppercase;color:#8b949e;border-bottom:1px solid #30363d;padding-bottom:6px;margin:22px 0 8px">What failed & likely cause</h2>
    ${diag.overall ? `<div style="background:#161b22;border-left:3px solid #d29922;padding:8px 12px;font-size:13px;margin-bottom:8px"><b>Diagnosis:</b> ${esc(diag.overall)}</div>` : ''}
    <table style="width:100%;border-collapse:collapse;background:#161b22;border:1px solid #30363d;border-radius:8px">
      <tr><th style="text-align:left;padding:6px 10px;font-size:11px;color:#8b949e">Test</th><th style="text-align:left;padding:6px 10px;font-size:11px;color:#8b949e">Reason</th><th style="text-align:left;padding:6px 10px;font-size:11px;color:#8b949e">Likely cause</th></tr>
      ${failRows}
    </table>

    <h2 style="font-size:13px;text-transform:uppercase;color:#8b949e;border-bottom:1px solid #30363d;padding-bottom:6px;margin:22px 0 8px">Eval coverage this period</h2>
    <div style="font-size:13px"><b>New / changed evals:</b><ul style="margin:4px 0">${covEdits}</ul>${covUncovered}</div>

    <h2 style="font-size:13px;text-transform:uppercase;color:#8b949e;border-bottom:1px solid #30363d;padding-bottom:6px;margin:22px 0 8px">Dashboard</h2>
    <a href="${esc(DASHBOARD_URL)}"><img src="${esc(SHOT_URL)}" alt="Lyra eval dashboard" style="width:100%;border:1px solid #30363d;border-radius:8px"></a>
    <div style="color:#8b949e;font-size:11px;margin-top:10px">Generated by evals/dashboard/email-digest.js after the daily eval run. <a href="${esc(DASHBOARD_URL)}" style="color:#58a6ff">${esc(DASHBOARD_URL)}</a></div>
  </div></body></html>`;
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const runs = loadRuns();
  if (!runs.length) { console.error('[email-digest] no full runs found — skipping'); process.exit(0); }
  const latest = runs[runs.length - 1];
  const prev = runs[runs.length - 2] || null;

  const failures = (latest.failures || []).map((f) => ({
    id: f.id, kind: f.failure_kind || 'other', reason: f.failure_reason || '(no reason recorded)',
  }));
  const diagText = await llmDiagnose(failures);
  const diag = diagnosisMap(diagText);
  const coverage = evalCoverageSince(prev ? prev.timestamp : null);

  const html = renderHtml({ latest, prev, failures, diag, coverage });

  const to = process.env.EVAL_DIGEST_TO || process.env.GMAIL_EMAIL_ADDRESS;
  const transport = nodemailer.createTransport({
    host: process.env.GMAIL_SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.GMAIL_SMTP_PORT || '465', 10),
    secure: parseInt(process.env.GMAIL_SMTP_PORT || '465', 10) === 465,
    auth: { user: process.env.GMAIL_EMAIL_ADDRESS, pass: process.env.GMAIL_APP_PASSWORD },
  });

  const gate = latest.gates?.all_ok ? '🟢' : '🔴';
  const subject = `${gate} Lyra Eval Digest ${latest.date} — ${pctf(latest.pass_rate)} pass, ${failures.length} fail`;

  if (process.env.EVAL_DIGEST_DRY_RUN === '1') {
    console.log('[email-digest] DRY RUN — would send to', to, '\nsubject:', subject);
    console.log('html bytes:', html.length, '| diagnosis:', diag.overall || '(none)');
    process.exit(0);
  }

  await transport.sendMail({ from: `Lyra Evals <${process.env.GMAIL_EMAIL_ADDRESS}>`, to, subject, html });
  console.log(`[email-digest] sent to ${to} — ${subject}`);
}

main().catch((e) => { console.error('[email-digest] failed:', e.message); process.exit(0); });
