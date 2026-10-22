import type { NodeOptions } from '@sentry/nestjs';

import { sentryOptions, setUpSentry } from './sentry-setup';

const DSN = 'https://public@o0.ingest.sentry.io/1';

function integrationsOf(options: NodeOptions | undefined) {
  const integrations = options?.integrations;
  if (integrations === undefined || Array.isArray(integrations)) {
    throw new TypeError('expected an integrations filter');
  }
  return integrations;
}

describe('setUpSentry', () => {
  it('loads .env.local quietly before reading the DSN it may define', () => {
    const env: NodeJS.ProcessEnv = {};
    const loadEnvFile = vi.fn(() => {
      env.SENTRY_DSN = DSN;
    });
    const init = vi.fn();

    setUpSentry({ env, entrypoint: 'dist/main', loadEnvFile, init });

    expect(loadEnvFile).toHaveBeenCalledWith({
      path: '.env.local',
      quiet: true,
    });
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: DSN, environment: 'local' }),
    );
  });

  it('starts no client without a DSN', () => {
    const init = vi.fn();

    setUpSentry({
      env: { SENTRY_DSN: '' },
      entrypoint: 'dist/main',
      loadEnvFile: vi.fn(),
      init,
    });

    expect(init).not.toHaveBeenCalled();
  });
});

describe('sentryOptions', () => {
  it('names the environment from SENTRY_ENVIRONMENT', () => {
    expect(
      sentryOptions(
        { SENTRY_DSN: DSN, SENTRY_ENVIRONMENT: 'production' },
        'dist/main',
      )?.environment,
    ).toBe('production');
  });

  it('tags the process from its entrypoint script', () => {
    const tagOf = (entrypoint: string | undefined) =>
      sentryOptions({ SENTRY_DSN: DSN }, entrypoint)?.initialScope;

    expect(tagOf('/app/dist/worker.js')).toEqual({
      tags: { 'llame.process': 'worker' },
    });
    expect(tagOf('/app/dist/main')).toEqual({
      tags: { 'llame.process': 'api' },
    });
    expect(tagOf(undefined)).toEqual({ tags: { 'llame.process': 'api' } });
  });

  it('sends no trace headers on outgoing requests and keeps owner data out', () => {
    const options = sentryOptions({ SENTRY_DSN: DSN }, 'dist/main');

    expect(options).toMatchObject({ tracesSampleRate: 1 });
    expect(options?.tracePropagationTargets).toEqual([]);
    expect(options?.dataCollection).toEqual({
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      genAI: { inputs: true, outputs: true },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    });
  });

  it('drops only the pg integration from the defaults', () => {
    const filter = integrationsOf(sentryOptions({ SENTRY_DSN: DSN }, 'main'));
    const postgres = { name: 'Postgres' };
    const postgresJs = { name: 'PostgresJs' };
    const http = { name: 'Http' };

    expect(filter([postgres, postgresJs, http])).toEqual([postgresJs, http]);
  });
});
