import { spawn } from 'node:child_process';
import path from 'node:path';

import postgres, { type Sql } from 'postgres';

const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

if (!testDatabaseUrl) {
  throw new Error('migrate.integration.test.ts requires TEST_DATABASE_URL');
}

const apiRoot = path.resolve(__dirname, '../..');
const tsx = path.join(apiRoot, 'node_modules', '.bin', 'tsx');

function runMigrate(): Promise<{ status: number | null; stderr: string }> {
  const { promise, resolve, reject } = Promise.withResolvers<{
    status: number | null;
    stderr: string;
  }>();

  const child = spawn(tsx, ['src/db/migrate.ts'], {
    cwd: apiRoot,
    env: { ...process.env, POSTGRES_URL: testDatabaseUrl },
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  child.on('error', reject);
  child.on('close', (status) => resolve({ status, stderr }));

  return promise;
}

describe('db:migrate ledger validation', () => {
  let sql: Sql;

  beforeAll(() => {
    sql = postgres(testDatabaseUrl, { max: 1 });
  });

  afterAll(async () => {
    await sql.end();
  });

  it('re-runs without applying historical migrations', async () => {
    const before =
      await sql`select count(*)::int as count from drizzle.__drizzle_migrations`;

    const result = await runMigrate();

    const after =
      await sql`select count(*)::int as count from drizzle.__drizzle_migrations`;

    expect(result.status).toBe(0);
    expect(after[0]?.count).toBe(before[0]?.count);
  });

  it('rejects a duplicate identity without applying migrations', async () => {
    const [row] = await sql<Array<{ id: number }>>`
      insert into drizzle.__drizzle_migrations (hash, created_at, name)
      select 'duplicate-ledger-test', created_at, name
      from drizzle.__drizzle_migrations order by id limit 1 returning id
    `;

    if (!row) throw new Error('Expected an existing migration');

    try {
      const before =
        await sql`select count(*)::int as count from drizzle.__drizzle_migrations`;

      const result = await runMigrate();

      const after =
        await sql`select count(*)::int as count from drizzle.__drizzle_migrations`;

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('duplicate migration name');
      expect(after[0]?.count).toBe(before[0]?.count);
    } finally {
      await sql`delete from drizzle.__drizzle_migrations where id = ${row.id}`;
    }
  });
});
