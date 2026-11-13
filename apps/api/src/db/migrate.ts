import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import {
  enforceMigrationLedgerNameConstraint,
  prepareMigrationLedger,
  withMigrationAdvisoryLock,
} from './migration-ledger-upgrade';

config({
  path: '.env.local',
});

const runMigrate = async () => {
  if (!process.env.POSTGRES_URL) {
    throw new Error('POSTGRES_URL is not defined');
  }

  const pool = postgres(process.env.POSTGRES_URL, { max: 1 });

  // Hold the advisory lock, ledger conversion, and Drizzle migrations in one
  // transaction on one connection. Drizzle needs client.options, and its
  // transaction path calls client.begin; on a transaction client, begin must
  // create a savepoint rather than reserve a different pool connection.
  try {
    console.log('⏳ Running migrations...');
    const start = Date.now();

    await withMigrationAdvisoryLock(pool, async (tx) => {
      tx.options = pool.options;
      Object.defineProperty(tx, 'begin', {
        value: <T>(callback: (client: typeof tx) => Promise<T>) =>
          tx.savepoint(callback),
      });
      const db = drizzle({ client: tx });

      await prepareMigrationLedger(tx, './src/db/migrations');
      await migrate(db, { migrationsFolder: './src/db/migrations' });
      await enforceMigrationLedgerNameConstraint(tx);
    });

    console.log('✅ Migrations completed in', Date.now() - start, 'ms');
  } finally {
    await pool.end();
  }
};

runMigrate().catch((error: unknown) => {
  console.error('❌ Migration failed');
  console.error(error);
  process.exit(1);
});
