#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const statePath = process.env.LYRA_CRON_DELIVERY_STATE || '/var/lib/lyra-app/openclaw-cron-delivery.json';
const endpoint = process.env.LYRA_APP_INTERNAL_URL || 'http://127.0.0.1:8787/v1/internal/cron-deliver';
const token = process.env.LYRA_CRON_TOKEN;
if (!token) throw new Error('LYRA_CRON_TOKEN is required');

async function loadState() { try { return JSON.parse(await readFile(statePath, 'utf8')); } catch { return { delivered: {} }; } }
async function command(args) { const { stdout } = await run('openclaw', args, { timeout: 30_000, maxBuffer: 2_000_000 }); return JSON.parse(stdout); }
const clean = value => String(value || '').trim().slice(0, 20_000);

const state = await loadState();
const { jobs = [] } = await command(['cron', 'list', '--json']);
let delivered = 0;
for (const job of jobs.filter(item => item.enabled && item.name !== 'lyra-pwa-cron-delivery')) {
  const history = await command(['cron', 'runs', '--id', job.id, '--limit', '1']);
  const entry = history.entries?.[0];
  if (!entry || entry.action !== 'finished' || !entry.ts || state.delivered[job.id] === entry.ts) continue;
  const status = entry.status === 'ok' ? 'completed' : 'failed';
  const summary = clean(entry.summary || entry.diagnostics?.summary);
  if (!summary || summary === 'SKIP') { state.delivered[job.id] = entry.ts; continue; }
  const response = await fetch(endpoint, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ id: `openclaw-cron:${job.id}:${entry.ts}`, jobId: job.id, runId: String(entry.ts), title: job.name, status, text: summary, finishedAt: entry.tsIso || new Date(entry.ts).toISOString(), deliveryBridge: 'openclaw-cron' }) });
  if (!response.ok) throw new Error(`PWA delivery failed for ${job.name}: ${response.status}`);
  state.delivered[job.id] = entry.ts;
  delivered += 1;
}
await mkdir(path.dirname(statePath), { recursive: true });
await writeFile(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ delivered, jobs: jobs.length }));
