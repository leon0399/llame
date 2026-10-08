import {
  EngineFailure,
  executeSearchChain,
  type Engine,
  type EngineOutcome,
  type EngineRequest,
} from './chain';
import { type WebSearchConfig } from '../../instance-config/llame-config';

const request = (
  signal: AbortSignal = new AbortController().signal,
): EngineRequest => ({ query: 'llame', limit: 10, signal });
const config = (
  ids: ReadonlyArray<string>,
  timeoutSeconds = 60,
): WebSearchConfig => ({
  engines: ids.map((id) => ({
    id,
    type: 'brave' as const,
    key: 'test-key',
    timeoutSeconds,
  })),
  chain: ids,
});
const lookup = (engines: Record<string, Engine>) => (id: string) => engines[id];
const hit: EngineOutcome = {
  kind: 'results',
  results: [{ title: 'Result', url: 'https://example.test/a' }],
};
const result = (): Promise<EngineOutcome> => Promise.resolve(hit);
const empty = (): Promise<EngineOutcome> => Promise.resolve({ kind: 'empty' });

const fallthroughCases: ReadonlyArray<
  readonly [string, Engine, ReadonlyArray<string>]
> = [
  [
    'failure',
    () => Promise.reject<EngineOutcome>(new EngineFailure('upstream_error')),
    ['brave: upstream_error'],
  ],
  ['empty', empty, []],
];
it.each(fallthroughCases)(
  'falls through a %s and records its failures',
  async (_kind, first, notes) => {
    const output = await executeSearchChain(
      config(['brave', 'backup']),
      request(),
      lookup({ brave: first, backup: result }),
    );
    expect(output).toMatchObject({
      kind: 'results',
      engine: 'backup',
      ...(notes.length > 0 && { notes }),
    });
  },
);

it('falls through an answer with no canonical citations', async () => {
  const output = await executeSearchChain(
    config(['answer', 'backup']),
    request(),
    lookup({
      answer: () =>
        Promise.resolve({
          kind: 'answer',
          answer: 'answer',
          citations: [{ url: 'javascript:alert(1)' }],
        }),
      backup: result,
    }),
  );
  expect(output).toMatchObject({
    kind: 'results',
    engine: 'backup',
    notes: ['answer: ungrounded'],
  });
});

it('falls through results with no canonical URLs', async () => {
  const output = await executeSearchChain(
    config(['invalid', 'backup']),
    request(),
    lookup({
      invalid: () =>
        Promise.resolve({
          kind: 'results',
          results: [{ title: 'Invalid', url: 'javascript:alert(1)' }],
        }),
      backup: result,
    }),
  );
  expect(output).toMatchObject({ kind: 'results', engine: 'backup' });
  expect(output).not.toHaveProperty('notes');
});

it('returns the last empty engine after failures and emptiness', async () => {
  const output = await executeSearchChain(
    config(['brave', 'backup']),
    request(),
    lookup({
      brave: () => Promise.reject(new EngineFailure('auth')),
      backup: empty,
    }),
  );
  expect(output).toMatchObject({
    kind: 'results',
    engine: 'backup',
    results: [],
    notes: ['brave: auth'],
  });
});

it('names every failed engine in a total failure', async () => {
  const output = await executeSearchChain(
    config(['brave', 'backup']),
    request(),
    lookup({
      brave: () => Promise.reject(new EngineFailure('auth')),
      backup: () => Promise.reject(new EngineFailure('rate_limited')),
    }),
  );
  expect(output).toEqual({
    status: 'error',
    type: 'web_search_failed',
    message: 'All web search engines failed: brave: auth; backup: rate_limited',
  });
});

it('aborts an engine at its deadline and starts the next engine', async () => {
  let signalAborted = false;
  let backupStarted = false;
  const output = await executeSearchChain(
    config(['slow', 'backup'], 0.05),
    request(),
    lookup({
      slow: ({ signal }: EngineRequest) =>
        new Promise<EngineOutcome>((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              expect(signal.aborted).toBe(true);
              signalAborted = true;
              resolve({ kind: 'empty' });
            },
            { once: true },
          );
        }),
      backup: () => {
        backupStarted = true;
        return result();
      },
    }),
  );
  expect(signalAborted).toBe(true);
  expect(backupStarted).toBe(true);
  expect(output).toMatchObject({ engine: 'backup', notes: ['slow: timeout'] });
});

it('rethrows call cancellation and does not start later engines', async () => {
  const controller = new AbortController();
  let started = 0;
  const promise = executeSearchChain(
    config(['slow', 'backup']),
    request(controller.signal),
    lookup({
      slow: async ({ signal }: EngineRequest): Promise<EngineOutcome> => {
        started += 1;
        await new Promise<never>((_resolve, reject) =>
          signal.addEventListener(
            'abort',
            () => reject(new Error('call cancelled')),
            { once: true },
          ),
        );
        throw new Error('unreachable');
      },
      backup: empty,
    }),
  );
  controller.abort(new Error('cancelled'));
  await expect(promise).rejects.toThrow('cancelled');
  expect(started).toBe(1);
});
