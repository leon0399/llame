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
//
// Registered once per worker (guarded by a global flag) — this setup file
// re-evaluates per test file in the same worker, and duplicate listeners
// would both accumulate past Node's max-listeners warning and print N
// copies of the same error. The handlers resolve the active filepath at
// fire time, not at registration time, so the tag always names the file
// that was running when the error surfaced.
//
// `uncaughtExceptionMonitor` observes without overriding Node's default
// crash behavior — `process.on('uncaughtException')` would swallow the
// exit, silently turning a real leaked-handle crash into a green run.
const HANDLER_INSTALLED = Symbol.for('llame_integration_error_handlers');
if (!Reflect.get(globalThis, HANDLER_INSTALLED)) {
  Reflect.set(globalThis, HANDLER_INSTALLED, true);

  const activeFile = () => {
    const w = Reflect.get(globalThis, '__vitest_worker__') as
      | { filepath?: string }
      | undefined;
    return w?.filepath ?? 'unknown';
  };

  process.on('uncaughtExceptionMonitor', (err) => {
    console.error(
      `[integration/${activeFile()}] uncaughtException (leaked handle?):`,
      err,
    );
  });
  process.on('unhandledRejection', (reason) => {
    console.error(
      `[integration/${activeFile()}] unhandledRejection (leaked handle?):`,
      reason,
    );
  });
}
