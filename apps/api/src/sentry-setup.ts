import { parse } from 'node:path';

import type { NodeOptions } from '@sentry/nestjs';

/** What instrument.ts hands over: the process's environment and the SDK. */
export type SentrySetup = {
  readonly env: NodeJS.ProcessEnv;
  /** `process.argv[1]`: the entrypoint script, `main` or `worker`. */
  readonly entrypoint: string | undefined;
  readonly loadEnvFile: (options: { path: string; quiet: boolean }) => void;
  readonly init: (options: NodeOptions) => void;
};

/**
 * Loads `.env.local` (ConfigModule reads it only once Nest boots, which is
 * too late for the SDK; dotenv never overrides a variable the process already
 * has), then starts Sentry when `SENTRY_DSN` is set.
 */
export function setUpSentry(setup: SentrySetup): void {
  setup.loadEnvFile({ path: '.env.local', quiet: true });
  const options = sentryOptions(setup.env, setup.entrypoint);
  if (options !== undefined) setup.init(options);
}

/** The SDK options for this process, or nothing without a DSN. */
export function sentryOptions(
  env: NodeJS.ProcessEnv,
  entrypoint: string | undefined,
): NodeOptions | undefined {
  const dsn = env.SENTRY_DSN;
  if (!dsn) return undefined;
  const process =
    entrypoint !== undefined && parse(entrypoint).name === 'worker'
      ? 'worker'
      : 'api';
  return {
    dsn,
    environment: env.SENTRY_ENVIRONMENT || 'local',
    // `SENTRY_RELEASE` is read by the SDK itself.
    tracesSampleRate: 1,
    initialScope: { tags: { 'llame.process': process } },
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
  };
}
