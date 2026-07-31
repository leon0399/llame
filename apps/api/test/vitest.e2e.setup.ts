/**
 * E2E suites also need a real Postgres — fail loudly, never green-skip.
 *
 * Per-suite pg-boss schema (see queue.module.ts): e2e suites in one serial
 * vitest fork share the throwaway Postgres, and a suite's stopping consumers
 * must never steal the next suite's jobs from a shared 'pgboss' schema. Set in
 * beforeAll (not at module eval) so expect.getState() is bound to this file;
 * each spec boots Nest in its own beforeAll, which runs after this one.
 */
import { beforeAll } from 'vitest';

if (!process.env.POSTGRES_URL) {
  throw new Error(
    'api e2e tests require POSTGRES_URL pointing at a real, migrated Postgres. ' +
      'apps/api/scripts/rls-test.sh provisions one and runs this suite against it.',
  );
}

beforeAll(() => {
  const suite = (expect.getState().testPath ?? 'unknown')
    .split('/')
    .pop()!
    .replace(/[^a-zA-Z0-9]/g, '_')
    .toLowerCase()
    .slice(0, 40);
  process.env.PGBOSS_SCHEMA = `pgboss_${suite}`;
});
