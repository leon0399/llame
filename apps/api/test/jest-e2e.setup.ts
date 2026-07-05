/**
 * Per-suite pg-boss schema (see queue.module.ts): e2e suites in one serial
 * jest process share the throwaway Postgres, and a suite's stopping consumers
 * must never steal the next suite's jobs from a shared 'pgboss' schema.
 */
const suite = (expect.getState().testPath ?? 'unknown')
  .split('/')
  .pop()!
  .replace(/[^a-zA-Z0-9]/g, '_')
  .toLowerCase()
  .slice(0, 40);
process.env.PGBOSS_SCHEMA = `pgboss_${suite}`;
