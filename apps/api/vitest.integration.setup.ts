/**
 * Per-suite pg-boss schema (see queue.module.ts): integration suites run
 * sequentially in one worker against one throwaway Postgres, and a suite's
 * stopping consumers must never steal the next suite's jobs from a shared
 * 'pgboss' schema. Set in beforeAll (not at module eval) so expect.getState()
 * is bound to this file; each suite boots Nest in its own beforeAll, which
 * runs after this one. Suites that provision their own schema (the worker
 * harness) simply override it.
 */
import { beforeAll } from 'vitest';

beforeAll(() => {
  const suite = (expect.getState().testPath ?? 'unknown')
    .split('/')
    .pop()!
    .replace(/[^a-zA-Z0-9]/g, '_')
    .toLowerCase()
    .slice(0, 40);
  process.env.PGBOSS_SCHEMA = `pgboss_${suite}`;
});
