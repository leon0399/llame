import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { availableParallelism, tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { isNumber, isRecord, isString } from '@workspace/runtime-safety';
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

  it.skipIf(availableParallelism() < 4)(
    'runs sixteen crypto jobs on sixteen threads after startup',
    async () => {
      // The pool takes its width at its first use, so only a fresh process can
      // show it. Both children run the same sixteen jobs; the one that goes
      // through the setup waits a wave for four threads, the other does not.
      const narrow = await bestPoolProbe(false);
      const wide = await bestPoolProbe(true);
      expect(narrow.size).toBeUndefined();
      expect(wide.size).toBe('16');
      expect(wide.ms).toBeLessThan(narrow.ms * 0.8);
    },
    60_000,
  );
});

/** The pool width and elapsed time one probe child reports. */
type PoolProbe = { readonly ms: number; readonly size?: string };

/** The fastest of three probe runs, so a busy machine cannot skew one. */
async function bestPoolProbe(widen: boolean): Promise<PoolProbe> {
  let best: PoolProbe | undefined;
  for (let run = 0; run < 3; run += 1) {
    const probe = await runPoolProbe(widen);
    if (best === undefined || probe.ms < best.ms) best = probe;
  }
  if (best === undefined) throw new Error('the probe never ran');
  return best;
}

/** Run the probe in a fresh process, after the setup when `widen` is set. */
async function runPoolProbe(widen: boolean): Promise<PoolProbe> {
  const directory = await mkdtemp(path.join(tmpdir(), 'llame-pool-'));
  const script = path.join(directory, 'probe.ts');
  try {
    await writeFile(
      script,
      [
        `import { pbkdf2 } from 'node:crypto';`,
        `import { setUpSentry } from ${JSON.stringify(path.join(__dirname, 'sentry-setup.ts'))};`,
        `async function probe() {`,
        `  if (${String(widen)}) setUpSentry({ env: process.env, entrypoint: 'dist/main', loadEnvFile: () => {}, init: () => {} });`,
        `  const jobs = Array.from({ length: 16 }, (_, index) => new Promise((resolve, reject) => {`,
        `    pbkdf2('password' + String(index), 'salt', 150_000, 32, 'sha512', (error) => error ? reject(error) : resolve('done'));`,
        `  }));`,
        `  const started = process.hrtime.bigint();`,
        `  await Promise.all(jobs);`,
        `  const ms = Number(process.hrtime.bigint() - started) / 1e6;`,
        `  process.stdout.write(JSON.stringify({ ms, size: process.env.UV_THREADPOOL_SIZE }));`,
        `}`,
        `void probe();`,
      ].join('\n'),
    );
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.UV_THREADPOOL_SIZE;
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ['--experimental-strip-types', script],
      { env },
    );
    const parsed: unknown = JSON.parse(stdout);
    if (!isRecord(parsed) || !isNumber(parsed.ms))
      throw new Error('the probe reported no duration');
    return {
      ms: parsed.ms,
      ...(isString(parsed.size) && { size: parsed.size }),
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
