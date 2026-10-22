/**
 * Sentry initialization for both entrypoints (main.ts and worker.ts). It must
 * be their first import: the SDK instruments modules (http, pg, postgres.js,
 * the AI SDK) as they load, so anything required earlier goes untraced.
 *
 * ConfigModule reads `.env.local` only once Nest boots, which is too late
 * here, so this file loads it first; dotenv never overrides a variable the
 * process already has.
 */
import { config } from 'dotenv';
import * as Sentry from '@sentry/nestjs';

config({ path: '.env.local', quiet: true });

const dsn = process.env.SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || 'local',
    // `SENTRY_RELEASE` is read by the SDK itself.
    tracesSampleRate: 1,
    // Outgoing requests reach model providers, MCP servers, and arbitrary web
    // reads; none of them get trace headers. Hops llame owns (pg-boss jobs,
    // Machine requests) carry the trace explicitly instead.
    tracePropagationTargets: [],
    // `pg` serves only pg-boss, whose timers keep the boot trace's context:
    // its polling and maintenance queries would pile up under that one trace
    // forever. Queue work is traced by the queue spans instead; application
    // queries go through postgres.js, which stays instrumented.
    integrations: (defaults) =>
      defaults.filter((integration) => integration.name !== 'Postgres'),
    // Request and stored data belong to their owners and may hold secrets, so
    // only structural data leaves the process. The one exception is model
    // traffic: agent tracing and its conversation transcripts need prompts,
    // responses, and tool calls, and model context never carries a resolved
    // secret. Tool output can still echo whatever a host command printed.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      genAI: { inputs: true, outputs: true },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    },
  });
}
