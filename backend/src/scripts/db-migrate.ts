import { env } from '../config/env';
import { createDatabase } from '../db/database';
import { runMigrations } from '../db/migrate';

async function main() {
  const db = await createDatabase(env.DATABASE_URL);
  try {
    const applied = await runMigrations(db);
    console.log(applied.length ? `Applied migrations: ${applied.join(', ')}` : 'Database is up to date.');
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
