import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import { isRecord, isString } from '@workspace/runtime-safety';
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

describe('setUpSentry pool width', () => {
  it('widens the libuv pool to sixteen when the operator set none', () => {
    const env: NodeJS.ProcessEnv = {};
    setUpSentry({
      env,
      entrypoint: 'dist/main',
      loadEnvFile: vi.fn(),
      init: vi.fn(),
    });
    expect(env.UV_THREADPOOL_SIZE).toBe('16');
  });

  it('keeps a preset pool width', () => {
    const env: NodeJS.ProcessEnv = { UV_THREADPOOL_SIZE: '4' };
    setUpSentry({
      env,
      entrypoint: 'dist/worker',
      loadEnvFile: vi.fn(),
      init: vi.fn(),
    });
    expect(env.UV_THREADPOOL_SIZE).toBe('4');
  });

  it('keeps the pool width .env.local sets', () => {
    const env: NodeJS.ProcessEnv = {};
    setUpSentry({
      env,
      entrypoint: 'dist/main',
      loadEnvFile: () => {
        env.UV_THREADPOOL_SIZE = '8';
      },
      init: vi.fn(),
    });
    expect(env.UV_THREADPOOL_SIZE).toBe('8');
  });

  it('sets the pool width before the SDK starts', async () => {
    // A fresh child is the only process whose first pool use follows the
    // setup; it reports the width the SDK saw at init, not a timing ratio.
    expect(await runPoolProbe()).toEqual({ atInit: '16', after: '16' });
  });

  it('keeps a preset pool width before the SDK starts', async () => {
    expect(await runPoolProbe('4')).toEqual({ atInit: '4', after: '4' });
  });
});

/** What the SDK saw at init, and what the process kept afterwards. */
type PoolProbe = { readonly atInit?: string; readonly after?: string };

/** Run the setup in a fresh process and read the width it left behind. */
async function runPoolProbe(preset?: string): Promise<PoolProbe> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.UV_THREADPOOL_SIZE;
  // The setup starts the SDK (and its own first pool use) only with a DSN.
  env.SENTRY_DSN = 'https://public@o0.ingest.sentry.io/1';
  if (preset !== undefined) env.UV_THREADPOOL_SIZE = preset;
  const script = [
    `const { setUpSentry } = await import(${JSON.stringify(path.join(__dirname, 'sentry-setup.ts'))});`,
    `let atInit;`,
    `setUpSentry({ env: process.env, entrypoint: 'dist/main', loadEnvFile: () => {}, init: () => { atInit = process.env.UV_THREADPOOL_SIZE; } });`,
    `process.stdout.write(JSON.stringify({ atInit, after: process.env.UV_THREADPOOL_SIZE }));`,
  ].join('\n');
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ['--experimental-strip-types', '--input-type=module', '-e', script],
    { env },
  );
  const parsed: unknown = JSON.parse(stdout);
  if (!isRecord(parsed)) throw new Error('the probe reported no width');
  return {
    ...(isString(parsed['atInit']) && { atInit: parsed['atInit'] }),
    ...(isString(parsed['after']) && { after: parsed['after'] }),
  };
}
