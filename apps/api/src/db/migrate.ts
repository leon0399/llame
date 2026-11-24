import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres, { type Sql } from 'postgres';

import {
  enforceMigrationLedgerNameConstraint,
  prepareMigrationLedger,
  withMigrationAdvisoryLock,
} from './migration-ledger-upgrade';
import { establishFreshRecencyDigestWitness } from './recency-digest-upgrade';

config({
  path: '.env.local',
});

export async function migrateDatabase(
  pool: Sql,
  migrationsFolder: string,
): Promise<void> {
  await withMigrationAdvisoryLock(pool, async (tx) => {
    tx.options = pool.options;
    // Drizzle must stay on the advisory-locked transaction, including savepoints.
    Object.defineProperty(tx, 'begin', {
      value: <T>(callback: (client: typeof tx) => Promise<T>) =>
        tx.savepoint(callback),
    });
    const db = drizzle({ client: tx });

    await establishFreshRecencyDigestWitness(tx);
    await prepareMigrationLedger(tx, migrationsFolder);
    await migrate(db, { migrationsFolder });
    await enforceMigrationLedgerNameConstraint(tx);
  });
}

export const runMigrate = async () => {
  if (!process.env.POSTGRES_URL) {
    throw new Error('POSTGRES_URL is not defined');
  }

  const pool = postgres(process.env.POSTGRES_URL, { max: 1 });

  try {
    console.log('⏳ Running migrations...');
    const start = Date.now();

    await migrateDatabase(pool, './src/db/migrations');

    console.log('✅ Migrations completed in', Date.now() - start, 'ms');
  } finally {
    await pool.end();
  }
};

if (require.main === module) {
  runMigrate().catch((error: unknown) => {
    console.error('❌ Migration failed');
    console.error(error);
    process.exit(1);
  });
}
