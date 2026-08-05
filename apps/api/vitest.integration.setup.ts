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

// Make leaked handles attributable: if a previous file's pg-boss worker (or
// any other handle) fires after its pool closed, the error lands on whichever
// file happens to be running — the varying-victim signature that makes #263
// hard to diagnose. Logging the active file turns "chats-messages failed"
// into "leaked handle from X contaminated chats-messages".
const worker = (globalThis as Record<string, { filepath?: string }>)
  .__vitest_worker__;
const file: string = worker?.filepath ?? 'unknown';
const tag = `[integration/${file}]`;
process.on('uncaughtException', (err) => {
  console.error(`${tag} uncaughtException (leaked handle?):`, err);
});
process.on('unhandledRejection', (reason) => {
  console.error(`${tag} unhandledRejection (leaked handle?):`, reason);
});
