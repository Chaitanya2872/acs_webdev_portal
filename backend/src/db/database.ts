import fs from 'node:fs';
import path from 'node:path';
import { Pool, PoolClient } from 'pg';

export type QueryResult<T> = { rows: T[]; rowCount: number };

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
}

export interface Database extends Queryable {
  readonly kind: 'postgres' | 'pglite';
  transaction<T>(work: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

class PostgresDatabase implements Database {
  readonly kind = 'postgres' as const;

  constructor(private readonly pool: Pool) {}

  async query<T>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    const result = await this.pool.query(sql, params);
    return { rows: result.rows as T[], rowCount: result.rowCount ?? result.rows.length };
  }

  async transaction<T>(work: (tx: Queryable) => Promise<T>): Promise<T> {
    const client: PoolClient = await this.pool.connect();
    const tx: Queryable = {
      query: async <R>(sql: string, params: unknown[] = []) => {
        const result = await client.query(sql, params);
        return { rows: result.rows as R[], rowCount: result.rowCount ?? result.rows.length };
      },
    };

    try {
      await client.query('BEGIN');
      const value = await work(tx);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

type PGliteLike = {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[]; affectedRows?: number }>;
  transaction<T>(work: (tx: { query<R>(sql: string, params?: unknown[]): Promise<{ rows: R[]; affectedRows?: number }> }) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};

class PGliteDatabase implements Database {
  readonly kind = 'pglite' as const;

  constructor(private readonly db: PGliteLike) {}

  async query<T>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    const result = await this.db.query<T>(sql, params);
    return { rows: result.rows, rowCount: result.affectedRows || result.rows.length };
  }

  async transaction<T>(work: (tx: Queryable) => Promise<T>): Promise<T> {
    return this.db.transaction(async (inner) =>
      work({
        query: async <R>(sql: string, params: unknown[] = []) => {
          const result = await inner.query<R>(sql, params);
          return { rows: result.rows, rowCount: result.affectedRows || result.rows.length };
        },
      }),
    );
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}

/**
 * Creates a database from a connection string:
 *  - postgres://user:pass@host:5432/db  → PostgreSQL (production)
 *  - pglite:memory                      → embedded, in-memory PostgreSQL (tests)
 *  - pglite:./.data/pglite              → embedded PostgreSQL persisted to a directory (local development)
 */
export async function createDatabase(url: string): Promise<Database> {
  if (url.startsWith('pglite:')) {
    // Loaded lazily so production (PostgreSQL) never initialises the embedded engine.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PGlite } = require('@electric-sql/pglite') as { PGlite: new (dataDir?: string) => PGliteLike };
    const target = url.slice('pglite:'.length);
    if (!target || target === 'memory') {
      return new PGliteDatabase(new PGlite());
    }
    const dataDir = path.resolve(target);
    fs.mkdirSync(dataDir, { recursive: true });
    return new PGliteDatabase(new PGlite(dataDir));
  }

  if (!/^postgres(ql)?:\/\//.test(url)) {
    throw new Error('DATABASE_URL must start with postgres://, postgresql:// or pglite:');
  }

  return new PostgresDatabase(new Pool({ connectionString: url, max: 10 }));
}
