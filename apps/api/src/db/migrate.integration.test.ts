/**
 * The `db:migrate` entry point, driven as the operator drives it: a real child
 * process against a real database, with `POSTGRES_URL` in its environment.
 *
 * The ledger guard's predicate has unit coverage in `migration-ledger.test.ts`,
 * and its wiring cannot have any other kind. The guard exists to stop a run
 * that reports success while applying nothing, so the only observable that
 * matters is the process's own exit status and what it says it did. Deleting
 * the call, reading the ledger with the wrong sort key, or dropping the query
 * altogether all leave the unit suite green and are caught here.
 *
 * Requires TEST_DATABASE_URL; run by test:integration.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

import postgres, { type Sql } from 'postgres';

const TEST_DB_URL = process.env['TEST_DATABASE_URL'];
if (!TEST_DB_URL) {
  throw new Error(
    'migrate.integration.test.ts requires TEST_DATABASE_URL; run it with `pnpm --filter api test:integration`.',
  );
}

const apiRoot = path.resolve(__dirname, '../..');
const tsx = path.join(apiRoot, 'node_modules', '.bin', 'tsx');

/**
 * Two ledger stamps that order differently under the two candidate sort keys:
 *
 *   lexicographic desc -> 1789377107588 (a real journal `when`, in ms)
 *   numeric desc       -> 1789327485929566752 (the poisoned row, in ns)
 *
 * A guard reading `order by created_at` against the projected `::text` sees
 * the millisecond row and reports success; only the `::bigint` cast sees the
 * future-stamped one.
 */
const NANOSECOND_HASH = 'integration-test-nanosecond-stamp';
const NANOSECOND_STAMP = '1789327485929566752';
const MILLISECOND_HASH = 'integration-test-millisecond-stamp';
const MILLISECOND_STAMP = '1789377107588';

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runMigrate(): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(tsx, ['src/db/migrate.ts'], {
      cwd: apiRoot,
      env: { ...process.env, POSTGRES_URL: TEST_DB_URL },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

describe('db:migrate ledger guard', () => {
  let sql: Sql;

  beforeAll(() => {
    sql = postgres(TEST_DB_URL, { max: 1 });
  });

  afterAll(async () => {
    await sql.end();
  });

  afterEach(async () => {
    await sql`DELETE FROM drizzle.__drizzle_migrations WHERE hash IN (${NANOSECOND_HASH}, ${MILLISECOND_HASH})`;
  });

  it('exits nonzero, naming the row, when the newest ledger stamp is in the future', async () => {
    await sql`
      INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
      VALUES (${NANOSECOND_HASH}, ${NANOSECOND_STAMP}::bigint)
    `;

    const result = await runMigrate();

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(NANOSECOND_HASH);
    expect(result.stderr).toContain(NANOSECOND_STAMP);
    expect(result.stderr).toMatch(/stamped in the future/u);
  });

  it('completes and reports the run when the ledger is sane', async () => {
    const result = await runMigrate();

    expect(result.stderr).not.toMatch(/stamped in the future/u);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Migrations completed in \d+ ms/u);
  });

  it('reads the numerically newest row, not the lexicographically first', async () => {
    await sql`
      INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
      VALUES
        (${NANOSECOND_HASH}, ${NANOSECOND_STAMP}::bigint),
        (${MILLISECOND_HASH}, ${MILLISECOND_STAMP}::bigint)
    `;

    const result = await runMigrate();

    expect(result.stderr).toContain(NANOSECOND_HASH);
    expect(result.status).not.toBe(0);
  });
});
