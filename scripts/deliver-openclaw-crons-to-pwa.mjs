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
const looksOperational = value => /(?:credit balance|all models failed|cannot prompt|not a tty|\/root\/|himalaya|stack trace|traceback|error:)/i.test(value);
const contentFrom = entry => clean(entry.output || entry.text || entry.message || entry.summary || entry.diagnostics?.summary);

const state = await loadState();
const { jobs = [] } = await command(['cron', 'list', '--json']);
let delivered = 0;
for (const job of jobs.filter(item => item.enabled && item.name !== 'lyra-pwa-cron-delivery')) {
  const history = await command(['cron', 'runs', '--id', job.id, '--limit', '1']);
  const entry = history.entries?.[0];
  if (!entry || entry.action !== 'finished' || !entry.ts || state.delivered[job.id] === entry.ts) continue;
  const content = contentFrom(entry);
  if (!content || content === 'SKIP') { state.delivered[job.id] = entry.ts; continue; }
  const failed = entry.status !== 'ok' || looksOperational(content);
  const payload = {
    id: `openclaw-cron:${job.id}:${entry.ts}`, jobId: job.id, runId: String(entry.ts), title: job.name,
    status: failed ? 'failed' : 'completed', finishedAt: entry.tsIso || new Date(entry.ts).toISOString(), deliveryBridge: 'openclaw-cron',
    // The PWA API parses structured lyra-ui blocks when supplied. Failure text is intentionally never forwarded.
    ...(failed ? { envelope: { schemaVersion: 1, blocks: [{ id: 'delivery-failure', type: 'callout', tone: 'warning', title: 'Update unavailable', body: 'Lyra could not complete this scheduled update. It has been recorded and will not interrupt your conversation.' }], actions: [], provenance: [] } } : { output: content }),
  };
  const response = await fetch(endpoint, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  if (!response.ok) throw new Error(`PWA delivery failed for ${job.name}: ${response.status}`);
  state.delivered[job.id] = entry.ts;
  delivered += 1;
}
await mkdir(path.dirname(statePath), { recursive: true });
await writeFile(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ delivered, jobs: jobs.length }));
