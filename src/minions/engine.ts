/**
 * PgEngine — minimal Postgres adapter providing the three methods Minions
 * calls on the upstream gbrain BrainEngine: executeRaw, transaction, getConfig.
 *
 * Vendored from gbrain @ 08b3698e. See UPSTREAM-LICENSE for MIT attribution.
 */
import pg from 'pg';

const { Pool } = pg;
type PoolClient = pg.PoolClient;

export interface BrainEngine {
  executeRaw<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  transaction<T>(fn: (tx: BrainEngine) => Promise<T>): Promise<T>;
  getConfig(key: string): Promise<string | null>;
}

interface PgEngineOpts {
  connectionString?: string;
  pool?: pg.Pool;
}

export class PgEngine implements BrainEngine {
  private pool: pg.Pool;
  private owned: boolean;

  constructor(opts: PgEngineOpts = {}) {
    if (opts.pool) {
      this.pool = opts.pool;
      this.owned = false;
    } else {
      this.pool = new Pool({
        connectionString: opts.connectionString ?? process.env.LYRA_MINIONS_DB_URL ?? process.env.DATABASE_URL,
        max: 8,
      });
      this.owned = true;
    }
  }

  async executeRaw<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.pool.query(sql, params as unknown[]);
    return res.rows as T[];
  }

  async transaction<T>(fn: (tx: BrainEngine) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const tx = new ClientEngine(client);
      const out = await fn(tx);
      await client.query('COMMIT');
      return out;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw err;
    } finally {
      client.release();
    }
  }

  async getConfig(key: string): Promise<string | null> {
    const rows = await this.executeRaw<{ value: string }>(
      'SELECT value FROM minions_config WHERE key = $1',
      [key],
    );
    return rows[0]?.value ?? null;
  }

  async close(): Promise<void> {
    if (this.owned) await this.pool.end();
  }
}

class ClientEngine implements BrainEngine {
  constructor(private client: PoolClient) {}

  async executeRaw<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.client.query(sql, params as unknown[]);
    return res.rows as T[];
  }

  // Nested transactions: treat as savepoint-less passthrough (Minions does not nest).
  async transaction<T>(fn: (tx: BrainEngine) => Promise<T>): Promise<T> {
    return fn(this);
  }

  async getConfig(key: string): Promise<string | null> {
    const rows = await this.executeRaw<{ value: string }>(
      'SELECT value FROM minions_config WHERE key = $1',
      [key],
    );
    return rows[0]?.value ?? null;
  }
}
