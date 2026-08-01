/**
 * Per-suite pg-boss schema (see queue.module.ts): integration suites run
 * sequentially against one throwaway Postgres, and a suite's stopping
 * consumers must never steal the next suite's jobs from a shared 'pgboss'
 * schema. Setup files re-evaluate per test file (isolate: true), so a random
 * name here is unique per suite — same pattern as worker-harness.ts. Suites
 * that provision their own schema simply override it.
 */
// Prefixed by the run (globalSetup) so teardown drops exactly this run's
// schemas and never a concurrent run's.
const prefix = process.env.LLAME_TEST_SCHEMA_PREFIX ?? 'llame_t';
process.env.PGBOSS_SCHEMA = `${prefix}_pgboss_${Math.random().toString(36).slice(2, 8)}`;
