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

export default async function setup(): Promise<(() => Promise<void>) | void> {
  // The HTTP-boundary suites boot the real app, whose stream cap would
  // otherwise wait out production-length timeouts (same default the retired
  // rls-test.sh provisioning script set).
  process.env.RUN_STREAM_MAX_MS ??= '20000';

  if (process.env.TEST_DATABASE_URL) {
    process.env.POSTGRES_URL = process.env.TEST_DATABASE_URL;
    return;
  }

  const container = await new PostgreSqlContainer('postgres:17-alpine').start();

  const asSuperuser = postgres(container.getConnectionUri(), { max: 1 });
  await asSuperuser.unsafe(
    `CREATE ROLE app LOGIN PASSWORD 'app' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`,
  );
  await asSuperuser.unsafe(`CREATE DATABASE llame_test OWNER app`);
  await asSuperuser.end();

  const url = new URL(container.getConnectionUri());
  url.pathname = '/llame_test';
  const superuserOnTestDb = postgres(url.href, { max: 1 });
  await superuserOnTestDb.unsafe(
    `CREATE ROLE app_rls WITH NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE`,
  );
  // app must own schema `public` to create tables in it (PG15+ locks this down).
  await superuserOnTestDb.unsafe(`ALTER SCHEMA public OWNER TO app`);

  const appUrl = `postgres://app:app@${url.host}/llame_test`;
  const asApp = postgres(appUrl, { max: 1 });
  await migrate(drizzle(asApp), {
    migrationsFolder: path.resolve(import.meta.dirname, 'src/db/migrations'),
  });
  await asApp.end();

  // Superuser again: ALTER FUNCTION ... OWNER TO app_rls needs membership the
  // migrating `app` role must never have.
  await superuserOnTestDb.unsafe(
    readFileSync(
      path.resolve(
        import.meta.dirname,
        '../../docker/postgres/rls-function-owner.sql',
      ),
      'utf8',
    ),
  );
  await superuserOnTestDb.end();

  process.env.TEST_DATABASE_URL = appUrl;
  process.env.POSTGRES_URL = appUrl;

  return async () => {
    await container.stop();
  };
}
