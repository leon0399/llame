import { isRecord, isString } from '@workspace/runtime-safety';

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
// any other handle) fires after its pool closed, the error lands as an
// uncaught exception on whichever file happens to be running — the
// varying-victim signature that makes #263 hard to diagnose.
//
// `uncaughtExceptionMonitor` observes without overriding Node's default
// crash behavior and without adding to `process.listeners('uncaughtException')`
// — Vitest's own catchError skips its RPC report when it sees >1 listener on
// either 'uncaughtException' or 'unhandledRejection', so a regular
// `process.on(...)` for either event would silently disable Vitest's built-in
// error reporting for the whole integration suite.
//
// No separate `unhandledRejection` handler: Node 22 defaults to
// No separate `unhandledRejection` handler: Vitest installs one that reports
// unhandled rejections and tags them with the active filepath. Adding another
// listener makes Vitest skip that RPC report; this monitor covers exceptions
// that reach `uncaughtException`.
// Registered once per worker (guarded on `process`) — this setup file
// re-evaluates per test file in the same worker. A module-level flag would
// reset on every re-evaluation, so the guard lives on `process` itself,
// which persists; the symbol key is typed via module augmentation instead
// of Reflect.get/set, which would bypass NodeJS.Process's own type.
const HANDLER_INSTALLED = Symbol.for('llame_integration_error_handlers');
declare global {
  namespace NodeJS {
    interface Process {
      [HANDLER_INSTALLED]?: boolean;
    }
  }
  // Vitest's own worker-context global — undocumented and untyped upstream,
  // so it's read defensively via isRecord below rather than trusted as-is.
  var __vitest_worker__: unknown;
}
if (!process[HANDLER_INSTALLED]) {
  process[HANDLER_INSTALLED] = true;

  process.on('uncaughtExceptionMonitor', (err) => {
    const w = globalThis.__vitest_worker__;
    const file = isRecord(w) && isString(w.filepath) ? w.filepath : 'unknown';
    console.error(
      `[integration/${file}] uncaughtException (leaked handle?):`,
      err,
    );
  });
}
