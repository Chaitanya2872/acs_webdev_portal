import fs from 'node:fs';
import path from 'node:path';
import { Database } from './database';

export const defaultMigrationsDir = () => process.env.MIGRATIONS_DIR ?? path.resolve(process.cwd(), 'migrations');

/** Applies every migrations/NNN_name.sql not yet recorded in schema_migrations, each in its own transaction. */
export async function runMigrations(db: Database, migrationsDir = defaultMigrationsDir()): Promise<string[]> {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);

  const applied = new Set((await db.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((row) => row.name));
  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();

  const newlyApplied: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    await db.transaction(async (tx) => {
      for (const statement of splitSqlStatements(sql)) {
        await tx.query(statement);
      }
      await tx.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    });
    newlyApplied.push(file);
  }

  return newlyApplied;
}

/** Splits a migration file on semicolons that end a line, ignoring `--` comment lines. */
export function splitSqlStatements(sql: string): string[] {
  return sql
    .split(/\n/)
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(/;\s*(?:\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
}
