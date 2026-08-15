import pg from 'pg';

export function createDurableAuditStore() {
  if (!process.env.LYRA_DATABASE_URL) return { write: async () => {}, loadState: async () => null, writeState: async () => {} };
  const pool = new pg.Pool({ connectionString: process.env.LYRA_DATABASE_URL, max: 3 });
  let ready;
  const ensure = () => { ready ||= pool.query('CREATE TABLE IF NOT EXISTS lyra_app_audit (id BIGSERIAL PRIMARY KEY, occurred_at TIMESTAMPTZ NOT NULL, event JSONB NOT NULL)').catch(() => {}); return ready; };
  const stateReady = () => { ready ||= pool.query('CREATE TABLE IF NOT EXISTS lyra_app_state (key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())').catch(() => {}); return ready; };
  return {
    write: async event => { await ensure(); await pool.query('INSERT INTO lyra_app_audit (occurred_at, event) VALUES ($1, $2)', [event.at, event]); },
    loadState: async () => { await stateReady(); const result = await pool.query("SELECT value FROM lyra_app_state WHERE key = 'main'"); return result.rows[0]?.value || null; },
    writeState: async state => { await stateReady(); await pool.query("INSERT INTO lyra_app_state (key, value, updated_at) VALUES ('main', $1, NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()", [state]); },
  };
}
