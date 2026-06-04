#!/usr/bin/env node
/**
 * build-eval-dashboard.js — Phase 3 of "evals before changes".
 *
 * Generates a self-contained dark-theme HTML dashboard from the eval results history,
 * git log, and the Phase 2 gate classifier. The headline feature is the change ->
 * eval-delta timeline: for each pair of consecutive runs it shows the pass-rate and
 * per-tier deltas alongside the commits that landed between them, each annotated with
 * the eval-coverage gate decision. Also surfaces the "days since last successful full
 * run" health metric (the thing whose absence let the harness rot for 13 days).
 *
 * Output: /var/www/lyra-evals/index.html (+ data.json). Regenerated each eval run.
 * No external deps, no server process — served as static files by Caddy at /evals.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { classifyChangeset } from '../gate/classify-diff.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const RESULTS_DIR = process.env.EVAL_RESULTS_DIR || join(__dirname, '..', 'results');
const OUT_DIR = process.env.EVAL_DASHBOARD_DIR || '/var/www/lyra-evals';
const MIN_FULL_RUN = 20; // a "full run" has >= this many tests (excludes single-test/manual)

function git(args) {
  try {
    return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function loadFullRuns() {
  const files = readdirSync(RESULTS_DIR).filter((f) => /^\d{4}-\d{2}-\d{2}-summary\.json$/.test(f));
  const runs = [];
  for (const f of files) {
    try {
      const d = JSON.parse(readFileSync(join(RESULTS_DIR, f), 'utf8'));
      if ((d.total || 0) >= MIN_FULL_RUN) runs.push(d);
    } catch { /* skip malformed */ }
  }
  runs.sort((a, b) => (a.timestamp || a.date).localeCompare(b.timestamp || b.date));
  return runs;
}

function tierRate(run, tier) {
  const t = (run.by_tier || {})[tier];
  return t ? t.pass_rate : null;
}

function classifyCommit(sha) {
  const out = git(['diff', '--no-renames', '--name-only', `${sha}^`, sha]);
  if (!out) return null;
  const files = out.split('\n').map((s) => s.trim()).filter(Boolean);
  return classifyChangeset(files);
}

function commitsBetween(prevTs, ts) {
  // Commits authored in (prevTs, ts]. Uses committer date for ordering.
  const fmt = '%H%x1f%s%x1f%cI';
  const args = ['log', `--pretty=format:${fmt}`, '--no-merges'];
  if (prevTs) args.push(`--since=${prevTs}`);
  if (ts) args.push(`--until=${ts}`);
  const out = git(args);
  if (!out) return [];
  return out.split('\n').filter(Boolean).map((line) => {
    const [sha, subject, cdate] = line.split('\x1f');
    const cls = classifyCommit(sha);
    return {
      sha: sha.slice(0, 8),
      subject,
      date: cdate,
      decision: cls ? cls.decision : 'unknown',
      behavior: cls ? cls.counts.behavior : 0,
      eval_case: cls ? cls.counts.eval_case : 0,
    };
  });
}

function buildModel() {
  const runs = loadFullRuns();
  const latest = runs[runs.length - 1] || null;

  // Health: days since last successful (valid) full run.
  const lastValid = [...runs].reverse().find((r) => (r.gates ? r.gates.run_valid : true));
  let daysSince = null;
  if (lastValid) {
    const ms = Date.now() - new Date(lastValid.timestamp || lastValid.date).getTime();
    daysSince = Math.floor(ms / 86400000);
  }

  // Timeline: newest first, with deltas + commits since previous run.
  const tiers = ['core_capability', 'architectural', 'judgment', 'showcase', 'gap'];
  const timeline = [];
  for (let i = runs.length - 1; i >= 0; i--) {
    const run = runs[i];
    const prev = runs[i - 1] || null;
    const tierDeltas = [];
    for (const t of tiers) {
      const cur = tierRate(run, t);
      const old = prev ? tierRate(prev, t) : null;
      if (cur != null && old != null && Math.abs(cur - old) >= 0.005) {
        tierDeltas.push({ tier: t, from: old, to: cur, delta: cur - old });
      }
    }
    timeline.push({
      date: run.date,
      ts: run.timestamp,
      pass_rate: run.pass_rate,
      passed: run.passed,
      total: run.total,
      capability: run.scores ? run.scores.capability_pass_rate : null,
      avg_latency_ms: run.avg_latency_ms,
      delta: prev ? run.pass_rate - prev.pass_rate : null,
      failure_breakdown: run.failure_breakdown || {},
      tierDeltas,
      commits: prev ? commitsBetween(prev.timestamp, run.timestamp) : [],
    });
  }

  return { generatedAt: new Date().toISOString(), runs, latest, lastValid, daysSince, timeline };
}

// ── HTML rendering (self-contained) ──────────────────────────────────────────
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
const sign = (x) => (x == null ? '' : x > 0 ? `+${Math.round(x * 100)}` : `${Math.round(x * 100)}`);

function deltaSpan(d) {
  if (d == null) return '<span class="d zero">baseline</span>';
  if (d > 0.001) return `<span class="d up">▲ ${sign(d)} pts</span>`;
  if (d < -0.001) return `<span class="d down">▼ ${sign(d)} pts</span>`;
  return '<span class="d zero">no change</span>';
}

function decisionBadge(c) {
  if (c.decision === 'needs_eval') return `<span class="badge warn" title="behavior change, no eval">⚠ behavior · no eval (${c.behavior})</span>`;
  if (c.decision === 'covered') return `<span class="badge ok">✓ behavior + eval</span>`;
  if (c.eval_case > 0) return `<span class="badge eval">eval edit</span>`;
  return `<span class="badge muted">infra/docs</span>`;
}

function healthBand(m) {
  const ds = m.daysSince;
  const cls = ds == null ? 'muted' : ds <= 1 ? 'ok' : ds <= 4 ? 'warn' : 'down';
  const l = m.latest || {};
  const gatesOk = l.gates && l.gates.all_ok;
  return `
  <div class="band">
    <div class="metric"><div class="mlabel">Last full run</div><div class="mval">${esc((l.date) || '—')}</div></div>
    <div class="metric"><div class="mlabel">Pass rate</div><div class="mval big">${pct(l.pass_rate)}</div><div class="msub">${l.passed || 0}/${l.total || 0} · cap ${pct(l.scores ? l.scores.capability_pass_rate : null)}</div></div>
    <div class="metric"><div class="mlabel">Days since good run</div><div class="mval big ${cls}">${ds == null ? '—' : ds}</div><div class="msub">harness ${ds != null && ds <= 1 ? 'healthy' : 'check'}</div></div>
    <div class="metric"><div class="mlabel">Avg latency</div><div class="mval">${l.avg_latency_ms ? (l.avg_latency_ms / 1000).toFixed(1) + 's' : '—'}</div></div>
    <div class="metric"><div class="mlabel">Ship gate</div><div class="mval ${gatesOk ? 'ok' : 'down'}">${gatesOk ? 'GREEN' : 'RED'}</div><div class="msub">${gatesOk ? 'all_ok' : 'blocking on real bugs'}</div></div>
  </div>`;
}

function trendTable(runs) {
  const last = runs.slice(-8);
  const rows = last.map((r) => `
    <tr>
      <td>${esc(r.date)}</td>
      <td class="num">${pct(r.pass_rate)}</td>
      <td class="num">${pct(tierRate(r, 'core_capability'))}</td>
      <td class="num">${pct(tierRate(r, 'judgment'))}</td>
      <td class="num">${pct(tierRate(r, 'showcase'))}</td>
      <td class="num">${pct(tierRate(r, 'gap'))}</td>
      <td class="num">${r.avg_latency_ms ? (r.avg_latency_ms / 1000).toFixed(1) + 's' : '—'}</td>
    </tr>`).join('');
  return `<table class="trend"><thead><tr><th>Date</th><th>Pass</th><th>Core</th><th>Judgment</th><th>Showcase</th><th>Gap</th><th>Latency</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function timelineHtml(timeline) {
  return timeline.map((e) => {
    const tierD = e.tierDeltas.map((t) => `<span class="tierd ${t.delta > 0 ? 'up' : 'down'}">${esc(t.tier.replace('_', ' '))} ${pct(t.from)}→${pct(t.to)}</span>`).join('');
    const commits = e.commits.length
      ? e.commits.map((c) => `<li class="commit ${c.decision === 'needs_eval' ? 'flag' : ''}"><code>${esc(c.sha)}</code> ${decisionBadge(c)} <span class="csubj">${esc(c.subject)}</span></li>`).join('')
      : '<li class="commit muted">no commits recorded between runs</li>';
    const fb = Object.entries(e.failure_breakdown).map(([k, v]) => `${esc(k)}:${v}`).join(' · ') || 'none';
    return `
    <div class="run">
      <div class="runhead">
        <div class="rundate">${esc(e.date)}</div>
        <div class="runpass">${pct(e.pass_rate)} <span class="rsub">${e.passed}/${e.total}</span></div>
        <div class="rundelta">${deltaSpan(e.delta)}</div>
      </div>
      <div class="tierrow">${tierD || '<span class="tierd zero">no tier change</span>'}</div>
      <div class="fbrow">failures: ${esc(fb)}</div>
      <ul class="commits">${commits}</ul>
    </div>`;
  }).join('');
}

function renderHtml(m) {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Lyra Eval Dashboard</title>
<style>
  :root{--bg:#0d1117;--card:#161b22;--bd:#30363d;--fg:#e6edf3;--mut:#8b949e;--ok:#3fb950;--warn:#d29922;--down:#f85149;--up:#3fb950;--acc:#58a6ff}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:24px;max-width:1040px;margin:0 auto}
  h1{font-size:20px;margin:0 0 2px}.sub{color:var(--mut);font-size:12px;margin-bottom:20px}
  .band{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:24px}
  .metric{background:var(--card);border:1px solid var(--bd);border-radius:8px;padding:12px}
  .mlabel{color:var(--mut);font-size:11px;text-transform:uppercase;letter-spacing:.04em}
  .mval{font-size:20px;font-weight:600;margin-top:4px}.mval.big{font-size:28px}.msub{color:var(--mut);font-size:11px;margin-top:2px}
  .ok{color:var(--ok)}.warn{color:var(--warn)}.down{color:var(--down)}.muted{color:var(--mut)}.up{color:var(--up)}
  h2{font-size:14px;text-transform:uppercase;letter-spacing:.04em;color:var(--mut);margin:28px 0 12px;border-bottom:1px solid var(--bd);padding-bottom:6px}
  table.trend{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--bd);border-radius:8px;overflow:hidden}
  table.trend th,table.trend td{padding:8px 10px;text-align:left;border-bottom:1px solid var(--bd);font-size:13px}
  table.trend th{color:var(--mut);font-weight:500;font-size:11px;text-transform:uppercase}.num{text-align:right;font-variant-numeric:tabular-nums}
  .run{background:var(--card);border:1px solid var(--bd);border-radius:8px;padding:14px 16px;margin-bottom:12px}
  .runhead{display:flex;align-items:baseline;gap:16px;margin-bottom:8px}
  .rundate{font-weight:600;font-size:15px}.runpass{font-size:15px;color:var(--acc)}.rsub{color:var(--mut);font-size:12px}
  .rundelta{margin-left:auto}.d{font-size:12px;font-weight:600}.d.up{color:var(--up)}.d.down{color:var(--down)}.d.zero{color:var(--mut)}
  .tierrow{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px}
  .tierd{font-size:11px;padding:2px 7px;border-radius:10px;background:#21262d;border:1px solid var(--bd)}.tierd.up{color:var(--up)}.tierd.down{color:var(--down)}.tierd.zero{color:var(--mut)}
  .fbrow{color:var(--mut);font-size:11px;margin-bottom:8px}
  ul.commits{list-style:none;margin:0;padding:0;border-top:1px dashed var(--bd);padding-top:8px}
  .commit{padding:3px 0;font-size:12.5px}.commit.flag{background:rgba(210,153,34,.08);margin:0 -16px;padding:3px 16px}
  .commit code{color:var(--acc);font-size:11px}.csubj{color:var(--fg)}
  .badge{font-size:10px;padding:1px 6px;border-radius:9px;border:1px solid var(--bd);margin:0 4px}
  .badge.warn{color:var(--warn);border-color:var(--warn)}.badge.ok{color:var(--ok);border-color:var(--ok)}.badge.eval{color:var(--acc)}.badge.muted{color:var(--mut)}
  .foot{color:var(--mut);font-size:11px;margin-top:28px;border-top:1px solid var(--bd);padding-top:12px}
</style></head><body>
  <h1>Lyra Eval Dashboard</h1>
  <div class="sub">evals-before-changes · generated ${esc(m.generatedAt)} · ${m.runs.length} full runs</div>
  ${healthBand(m)}
  <h2>Pass-rate trend (last 8 runs)</h2>
  ${trendTable(m.runs)}
  <h2>Change → eval-delta timeline</h2>
  <div class="sub">Each run shows its pass-rate delta and the commits that landed since the prior run. <span class="badge warn">⚠ behavior · no eval</span> = a change to Lyra's behavior that shipped without an eval (what the gate will block).</div>
  ${timelineHtml(m.timeline)}
  <div class="foot">Static page regenerated by evals/dashboard/build-eval-dashboard.js on each eval run. Data: results/*-summary.json + git log + gate classifier.</div>
</body></html>`;
}

function main() {
  const model = buildModel();
  const html = renderHtml(model);
  const data = JSON.stringify(model, null, 2);

  // Primary target: Hetzner web root.
  const targets = [OUT_DIR];
  // Mirror to the GitHub-published docs/dashboard/ so it rides the existing publish flow.
  const docsMirror = join(REPO_ROOT, 'docs', 'dashboard');
  if (existsSync(docsMirror)) targets.push(docsMirror);

  for (const dir of targets) {
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'index.html'), html); // self-contained (data embedded)
      // data.json (full model, ~600KB) only to the web root — avoid git churn in the mirror.
      if (dir === OUT_DIR) writeFileSync(join(dir, 'data.json'), data);
    } catch (e) {
      console.error(`[dashboard] write failed for ${dir}: ${e.message}`);
    }
  }
  const l = model.latest || {};
  console.log(`[dashboard] ${model.runs.length} runs · last ${l.date || '—'} ${pct(l.pass_rate)} · days-since-good-run=${model.daysSince} → ${targets.join(', ')}`);
}

main();
