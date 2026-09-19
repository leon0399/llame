import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import { assertLedgerStampIsUsable } from './migration-ledger';

config({
  path: '.env.local',
});

const runMigrate = async () => {
  if (!process.env.POSTGRES_URL) {
    throw new Error('POSTGRES_URL is not defined');
  }

  const connection = postgres(process.env.POSTGRES_URL, { max: 1 });
  const db = drizzle(connection);

  console.log('⏳ Running migrations...');

  const start = Date.now();
  await migrate(db, { migrationsFolder: './src/db/migrations' });
  const end = Date.now();

  // Drizzle applies a journal entry only when its `when` is newer than the
  // newest ledger row (`order by created_at desc limit 1`), so one row stamped
  // in nanoseconds instead of milliseconds makes every later migration skip
  // with no error. Fail loudly instead of reporting a run that applied nothing.
  // The sort key is cast so it stays the column: an unqualified `order by
  // created_at` would resolve to the projected text and sort lexicographically.
  const [newestLedgerRow] = await connection<
    Array<{ hash: string; created_at: string | null }>
  >`
    select hash, created_at::text
    from drizzle.__drizzle_migrations
    order by created_at::bigint desc
    limit 1
  `;
  assertLedgerStampIsUsable(newestLedgerRow, Date.now());

  console.log('✅ Migrations completed in', end - start, 'ms');
  process.exit(0);
};

runMigrate().catch((error: unknown) => {
  console.error('❌ Migration failed');
  console.error(error);
  process.exit(1);
});
