import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

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

export function createSessionStore({ storeDir = process.env.LYRA_APP_DATA_DIR || '.lyra-app', databaseUrl = process.env.LYRA_DATABASE_URL } = {}) {
  const file = path.join(storeDir, 'sessions.json');
  const sessions = new Map();
  const loadFile = () => {
    if (!existsSync(file)) return;
    try {
      for (const item of JSON.parse(readFileSync(file, 'utf8')).sessions || []) {
        if (Date.parse(item.expiresAt) > Date.now()) sessions.set(item.id, item);
      }
    } catch { /* A corrupt local fallback must never authorise a session. */ }
  };
  const persistFile = () => {
    mkdirSync(storeDir, { recursive: true });
    writeFileSync(file, JSON.stringify({ sessions: [...sessions.values()] }, null, 2), { mode: 0o600 });
  };
  loadFile();
  const pool = databaseUrl ? new pg.Pool({ connectionString: databaseUrl, max: 2 }) : null;
  const ready = (async () => {
    if (!pool) return;
    await pool.query('CREATE TABLE IF NOT EXISTS lyra_app_sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL, expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ)');
    const result = await pool.query('SELECT id, user_id, created_at, expires_at FROM lyra_app_sessions WHERE revoked_at IS NULL AND expires_at > NOW()');
    for (const item of result.rows) sessions.set(item.id, { id: item.id, userId: item.user_id, createdAt: item.created_at.toISOString(), expiresAt: item.expires_at.toISOString() });
    persistFile();
  })().catch(() => {});
  const prune = () => {
    for (const [id, item] of sessions) if (Date.parse(item.expiresAt) <= Date.now()) sessions.delete(id);
  };
  return {
    ready,
    async create(userId = 'akash', maxAgeSeconds = 2_592_000) {
      prune();
      const createdAt = new Date().toISOString();
      const item = { id: randomUUID(), userId, createdAt, expiresAt: new Date(Date.now() + maxAgeSeconds * 1_000).toISOString() };
      sessions.set(item.id, item); persistFile();
      if (pool) await pool.query('INSERT INTO lyra_app_sessions (id, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING', [item.id, item.userId, item.createdAt, item.expiresAt]);
      return item.id;
    },
    async has(id) {
      prune();
      const item = sessions.get(id);
      if (!item) return false;
      if (Date.parse(item.expiresAt) <= Date.now()) { await this.revoke(id); return false; }
      return true;
    },
    async revoke(id) {
      sessions.delete(id); persistFile();
      if (pool) await pool.query('UPDATE lyra_app_sessions SET revoked_at = NOW() WHERE id = $1', [id]);
    },
  };
}
