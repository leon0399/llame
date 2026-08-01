/**
 * Self-provisioning database for the integration project (and nothing else):
 * starts a throwaway Postgres via Testcontainers and reproduces the worst-case
 * self-hosted role topology — a NON-superuser `app` role that OWNS the schema
 * and runs the migrations, so a green RLS suite proves FORCE ROW LEVEL
 * SECURITY constrains even the table owner, plus the `app_rls` BYPASSRLS
 * function owner (docker/postgres/rls-function-owner.sql, which needs
 * superuser — see apps/api/AGENTS.md "app_rls (BYPASSRLS)").
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
// Refresh both together:
//   docker pull postgres:17-alpine && docker inspect \
//     --format '{{index .RepoDigests 0}}' postgres:17-alpine
const POSTGRES_IMAGE =
  'postgres:17-alpine@sha256:dc17045ccfd343b49600570ea734b9c4991cf1c3f3302e67df51e3b402dd55c4';

function sqlFile(relativePath: string): string {
  return readFileSync(
    path.resolve(import.meta.dirname, relativePath),
    'utf8',
  );
}

/**
 * Reproduces the worst-case self-hosted role topology on a fresh container
 * and returns the `app`-role connection string. Every client it opens is
 * closed on the way out, including when a step throws.
 */
async function provision(superuserUri: string): Promise<string> {
  const asSuperuser = postgres(superuserUri, { max: 1 });
  try {
    await asSuperuser.unsafe(
      `CREATE ROLE app LOGIN PASSWORD 'app' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`,
    );
    await asSuperuser.unsafe(`CREATE DATABASE llame_test OWNER app`);
  } finally {
    await asSuperuser.end();
  }

  const url = new URL(superuserUri);
  url.pathname = '/llame_test';
  const appUrl = `postgres://app:app@${url.host}/llame_test`;

  const superuserOnTestDb = postgres(url.href, { max: 1 });
  try {
    await superuserOnTestDb.unsafe(
      sqlFile('../../docker/postgres/initdb/02-app-rls-role.sql'),
    );
    // app must own schema `public` to create tables in it (PG15+ locks this down).
    await superuserOnTestDb.unsafe(`ALTER SCHEMA public OWNER TO app`);

    const asApp = postgres(appUrl, { max: 1 });
    try {
      await migrate(drizzle(asApp), {
        migrationsFolder: path.resolve(import.meta.dirname, 'src/db/migrations'),
      });
    } finally {
      await asApp.end();
    }

    // Superuser again: ALTER FUNCTION ... OWNER TO app_rls needs membership the
    // migrating `app` role must never have.
    await superuserOnTestDb.unsafe(
      sqlFile('../../docker/postgres/rls-function-owner.sql'),
    );
  } finally {
    await superuserOnTestDb.end();
  }

  return appUrl;
}

/** Drops the per-file `pgboss_*` schemas this run created. */
async function dropPgBossSchemas(url: string): Promise<void> {
  const sql = postgres(url, { max: 1 });
  try {
    const schemas = await sql<{ nspname: string }[]>`
      SELECT nspname FROM pg_namespace WHERE nspname LIKE 'pgboss\\_%'
    `;
    for (const { nspname } of schemas) {
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${nspname}" CASCADE`);
    }
  } catch {
    // Teardown must never fail an otherwise-green run; the schemas are inert.
  } finally {
    await sql.end();
  }
}

export default async function setup(): Promise<(() => Promise<void>) | void> {
  // The HTTP-boundary suites boot the real app, whose stream cap would
  // otherwise wait out production-length timeouts (same default the retired
  // rls-test.sh provisioning script set).
  process.env.RUN_STREAM_MAX_MS ??= '20000';

  if (process.env.TEST_DATABASE_URL) {
    const externalUrl = process.env.TEST_DATABASE_URL;
    process.env.POSTGRES_URL = externalUrl;
    // Each integration file provisions its own pg-boss schema (see
    // vitest.integration.setup.ts). A throwaway container takes them away
    // with it; a caller-supplied database would accumulate one set per run
    // forever, so drop ours on the way out.
    return async () => {
      await dropPgBossSchemas(externalUrl);
    };
  }

  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();

  let appUrl: string;
  try {
    appUrl = await provision(container.getConnectionUri());
  } catch (error) {
    // Provisioning failed: stop the container rather than leaking it for the
    // rest of the CI job (or the developer's machine).
    await container.stop();
    throw error;
  }

  process.env.TEST_DATABASE_URL = appUrl;
  process.env.POSTGRES_URL = appUrl;

  return async () => {
    await container.stop();
  };
}
