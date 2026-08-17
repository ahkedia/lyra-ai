import { readFile } from 'node:fs/promises';
import pg from 'pg';

const file = new URL('./migrations/001-pwa-v2.sql', import.meta.url);

export async function migrate(databaseUrl = process.env.LYRA_DATABASE_URL) {
  if (!databaseUrl) return { skipped: true, reason: 'LYRA_DATABASE_URL is not configured' };
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await pool.query(await readFile(file, 'utf8'));
    return { applied: ['001-pwa-v2'] };
  } finally { await pool.end(); }
}

if (import.meta.url === `file://${process.argv[1]}`) migrate().then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1; });
