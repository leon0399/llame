/**
 * Per-suite pg-boss schema (see queue.module.ts): integration suites run
 * sequentially against one throwaway Postgres, and a suite's stopping
 * consumers must never steal the next suite's jobs from a shared 'pgboss'
 * schema. Setup files re-evaluate per test file (isolate: true), so a random
 * name here is unique per suite — same pattern as worker-harness.ts. Suites
 * that provision their own schema simply override it.
 */
process.env.PGBOSS_SCHEMA = `pgboss_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
