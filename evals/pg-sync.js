#!/usr/bin/env node
/**
 * Sync eval summary JSON → Postgres eval_runs table.
 * Replaces notion-sync.js for machine-read eval data.
 */

import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(__dirname, 'results');

const PG_URL = process.env.LYRA_PG_URL || 'postgres://lyra:lyra_secure_pw@127.0.0.1:5432/lyra';

async function main() {
  const files = readdirSync(RESULTS_DIR)
    .filter((f) => f.endsWith('-summary.json'))
    .sort();

  if (files.length === 0) {
    console.log('No summaries found.');
    return;
  }

  const client = new pg.Client({ connectionString: PG_URL });
  await client.connect();

  let inserted = 0;
  let skipped = 0;

  for (const file of files) {
    const summary = JSON.parse(readFileSync(join(RESULTS_DIR, file), 'utf8'));

    const exists = await client.query(
      'SELECT 1 FROM eval_runs WHERE run_date = $1',
      [summary.date]
    );
    if (exists.rows.length > 0) {
      skipped++;
      continue;
    }

    await client.query(
      `INSERT INTO eval_runs (
        run_date, run_timestamp, commit_sha, total, passed, failed,
        pass_rate, capability_pass_rate, avg_latency_ms, p95_latency_ms,
        infra_failure_rate, timeout_count, judge_failure_count,
        by_tier, by_category, failures, gates, scores,
        leakage_ok, leakage_count
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [
        summary.date,
        summary.timestamp,
        summary.commit_sha || null,
        summary.total,
        summary.passed,
        summary.failed,
        summary.pass_rate,
        summary.scores?.capability_pass_rate ?? null,
        summary.avg_latency_ms ?? null,
        summary.p95_latency_ms ?? null,
        summary.stability?.infra_failure_rate ?? null,
        summary.failure_breakdown?.timeout ?? 0,
        summary.failure_breakdown?.judge ?? 0,
        JSON.stringify(summary.by_tier || {}),
        JSON.stringify(summary.by_category || {}),
        JSON.stringify(summary.failures || []),
        JSON.stringify(summary.gates || {}),
        JSON.stringify(summary.scores || {}),
        summary.leakage?.ok ?? null,
        summary.leakage?.leaks?.length ?? 0,
      ]
    );
    inserted++;
    console.log(`  Inserted ${summary.date}: ${summary.passed}/${summary.total} (${(summary.pass_rate * 100).toFixed(1)}%)`);
  }

  console.log(`Done. Inserted: ${inserted}, Skipped (already exists): ${skipped}`);
  await client.end();
}

main().catch((err) => {
  console.error('pg-sync error:', err.message);
  process.exit(1);
});
