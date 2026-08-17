import { readdir, readFile } from 'node:fs/promises';
import pg from 'pg';

const migrationsDir = new URL('./migrations/', import.meta.url);

async function migrationFiles() {
  const names = await readdir(migrationsDir);
  return names.filter(name => /^\d{3}-[a-z0-9-]+\.sql$/i.test(name)).sort();
}

export async function migrate(databaseUrl = process.env.LYRA_DATABASE_URL) {
  if (!databaseUrl) return { skipped: true, reason: 'LYRA_DATABASE_URL is not configured' };
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const client = await pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock(hashtext($1))', ['lyra-app-migrations']);
      await client.query('CREATE TABLE IF NOT EXISTS lyra_schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
      const applied = new Set((await client.query('SELECT version FROM lyra_schema_migrations')).rows.map(row => row.version));
      const completed = [];
      for (const name of await migrationFiles()) {
        const version = name.replace(/\.sql$/, '');
        if (applied.has(version)) continue;
        await client.query('BEGIN');
        try {
          await client.query(await readFile(new URL(`./migrations/${name}`, import.meta.url), 'utf8'));
          await client.query('INSERT INTO lyra_schema_migrations (version) VALUES ($1) ON CONFLICT (version) DO NOTHING', [version]);
          await client.query('COMMIT');
          completed.push(version);
        } catch (error) { await client.query('ROLLBACK'); throw error; }
      }
      return { applied: completed, current: [...applied, ...completed] };
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', ['lyra-app-migrations']).catch(() => {});
      client.release();
    }
  } finally { await pool.end(); }
}

if (import.meta.url === `file://${process.argv[1]}`) migrate().then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1; });
