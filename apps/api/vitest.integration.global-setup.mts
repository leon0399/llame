/**
 * Self-provisioning database for the integration project (and nothing else):
 * starts a throwaway Postgres via Testcontainers and reproduces the worst-case
 * self-hosted role topology — a NON-superuser `app` role that OWNS the schema
 * and runs the migrations, so a green RLS suite proves FORCE ROW LEVEL
 * SECURITY constrains even the table owner, plus the `app_rls` BYPASSRLS
 * function owner (docker/postgres/rls-function-owner.sql, which needs
 * superuser — see apps/api/src/db/AGENTS.md "app_rls (BYPASSRLS)").
 *
 * TEST_DATABASE_URL overrides everything: point it at an already-provisioned
 * database (e.g. when docker is unavailable) and no container is started.
 * Runs in the vitest main process before workers spawn, so the env it sets is
 * inherited by every test worker.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

// Pinned by digest, same as compose.yaml's dev database — a floating tag
// would let an upstream refresh change test behavior with no code change.
// pgvector/pgvector:pg17 (not stock postgres:17-alpine) — the `vector`
// extension must be available for embeddings-backed search.
// Refresh both together:
//   docker pull pgvector/pgvector:pg17 && docker inspect \
//     --format '{{index .RepoDigests 0}}' pgvector/pgvector:pg17
const POSTGRES_IMAGE =
  'pgvector/pgvector:pg17@sha256:cf134a767f474095eeba57e0117be8e568e011a63f33fbf252f14c9b760f8e6f';

function sqlFile(relativePath: string): string {
  return readFileSync(path.resolve(import.meta.dirname, relativePath), 'utf8');
}

/**
 * Reproduces the worst-case self-hosted role topology on a fresh container
 * and returns the `app` connection plus an unrelated login used to prove
 * PUBLIC cannot execute privileged functions. Every client it opens is closed
 * on the way out, including when a step throws.
 */
/**
 * Cluster-level superuser work: the two login roles and the test database.
 * Separate from the rest because it runs on a DIFFERENT connection, before
 * `llame_test` exists to connect to.
 */
async function createRolesAndDatabase(superuserUri: string): Promise<void> {
  const asSuperuser = postgres(superuserUri, { max: 1 });
  try {
    await asSuperuser.unsafe(
      `CREATE ROLE app LOGIN PASSWORD 'app' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`,
    );
    await asSuperuser.unsafe(
      `CREATE ROLE llame_test_unprivileged LOGIN PASSWORD 'llame_test_unprivileged' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`,
    );
    await asSuperuser.unsafe(`CREATE DATABASE llame_test OWNER app`);
  } finally {
    await asSuperuser.end();
  }
}

/**
 * Everything inside the test database, in the order the privilege model
 * requires: superuser-only extensions and schema ownership first, then the
 * migrations AS `app` (the non-superuser role production uses), then
 * superuser again for the one ALTER FUNCTION ... OWNER TO app_rls that `app`
 * must never be able to perform itself. The alternation between the two
 * connections is the reason this reads as one sequence — see
 * src/db/AGENTS.md's "app_rls (BYPASSRLS)".
 */
async function prepareTestDatabase(
  superuserOnTestDbUri: string,
  appUrl: string,
): Promise<void> {
  const superuserOnTestDb = postgres(superuserOnTestDbUri, { max: 1 });
  try {
    await superuserOnTestDb.unsafe(
      sqlFile('../../docker/postgres/initdb/02-app-rls-role.sql'),
    );
    // `vector` (pgvector) is not a trusted extension, so only the superuser can
    // install it (docker/postgres/initdb/03-vector-extension.sql provisions the
    // same thing for the compose dev database). Must run before migrate(): the
    // chat-search-embeddings migration's ADD COLUMN uses the `vector` type.
    await superuserOnTestDb.unsafe(
      sqlFile('../../docker/postgres/initdb/03-vector-extension.sql'),
    );
    // app must own schema `public` to create tables in it (PG15+ locks this down).
    await superuserOnTestDb.unsafe(`ALTER SCHEMA public OWNER TO app`);

    const asApp = postgres(appUrl, { max: 1 });
    try {
      await migrate(drizzle(asApp), {
        migrationsFolder: path.resolve(
          import.meta.dirname,
          'src/db/migrations',
        ),
      });
    } finally {
      await asApp.end();
    }

    // Superuser again: ALTER FUNCTION ... OWNER TO app_rls needs membership the
    // migrating `app` role must never have.
    await superuserOnTestDb.unsafe(
      sqlFile('../../docker/postgres/rls-function-owner.sql'),
    );
    await superuserOnTestDb.unsafe(
      `GRANT USAGE ON SCHEMA public TO llame_test_unprivileged`,
    );
  } finally {
    await superuserOnTestDb.end();
  }
}

async function provision(
  superuserUri: string,
): Promise<{ appUrl: string; unprivilegedUrl: string }> {
  await createRolesAndDatabase(superuserUri);

  const url = new URL(superuserUri);
  url.pathname = '/llame_test';
  const appUrl = `postgres://app:app@${url.host}/llame_test`;

  await prepareTestDatabase(url.href, appUrl);

  const unprivilegedUrl = new URL(url.href);
  unprivilegedUrl.username = 'llame_test_unprivileged';
  unprivilegedUrl.password = 'llame_test_unprivileged';

  return { appUrl, unprivilegedUrl: unprivilegedUrl.href };
}

/**
 * Drops the queue schemas THIS run created — matched by the run-scoped
 * prefix, never by a bare `pgboss_%`: a caller-supplied database may be
 * serving a concurrent run, whose schemas must survive ours.
 */
async function dropRunSchemas(url: string, prefix: string): Promise<void> {
  const sql = postgres(url, { max: 1 });
  try {
    const schemas = await sql<Array<{ nspname: string }>>`
      SELECT nspname FROM pg_namespace WHERE nspname LIKE ${prefix + '%'}
    `;
    for (const { nspname } of schemas) {
      // Identifier interpolation, not string concatenation: a schema name is
      // data here, and `"` inside one would otherwise close the quote.
      await sql`DROP SCHEMA IF EXISTS ${sql(nspname)} CASCADE`;
    }
  } catch (error) {
    // Teardown must never fail an otherwise-green run; the schemas are inert.
    // But say what leaked — on an external TEST_DATABASE_URL these accumulate
    // invisibly otherwise.
    console.warn(
      `[integration teardown] failed to drop run schemas '${prefix}%':`,
      error,
    );
  } finally {
    await sql.end();
  }
}

export default async function setup(): Promise<(() => Promise<void>) | void> {
  // The HTTP-boundary suites boot the real app, whose stream cap would
  // otherwise wait out production-length timeouts (same default the retired
  // rls-test.sh provisioning script set).
  process.env.RUN_STREAM_MAX_MS ??= '20000';

  // Every queue schema this run creates (per-file pg-boss schemas, the worker
  // harness, worker.module) is named from this prefix, so teardown can drop
  // exactly ours and nothing belonging to a concurrent run.
  const runPrefix = `llame_t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  process.env.LLAME_TEST_SCHEMA_PREFIX = runPrefix;

  if (process.env.TEST_DATABASE_URL) {
    const externalUrl = process.env.TEST_DATABASE_URL;
    process.env.POSTGRES_URL = externalUrl;
    // A throwaway container takes its schemas away with it; a caller-supplied
    // database would accumulate a set per run forever, so drop ours on exit.
    return async () => {
      await dropRunSchemas(externalUrl, runPrefix);
    };
  }

  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();

  let appUrl: string;
  let unprivilegedUrl: string;
  try {
    ({ appUrl, unprivilegedUrl } = await provision(
      container.getConnectionUri(),
    ));
  } catch (error) {
    // Provisioning failed: stop the container rather than leaking it for the
    // rest of the CI job (or the developer's machine).
    await container.stop();
    throw error;
  }

  process.env.TEST_DATABASE_URL = appUrl;
  process.env.TEST_UNPRIVILEGED_DATABASE_URL = unprivilegedUrl;
  process.env.POSTGRES_URL = appUrl;

  return async () => {
    await container.stop();
  };
}
