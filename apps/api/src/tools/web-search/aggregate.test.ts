import {
  EngineFailure,
  type Engine,
  type EngineOutcome,
  type EngineRequest,
  type RawResult,
} from './chain';
import { createAggregateEngine, type AggregateChild } from './aggregate';

const request = (
  signal: AbortSignal = new AbortController().signal,
  limit = 10,
): EngineRequest => ({
  query: 'query',
  recency: undefined,
  limit,
  signal,
  userAgent: undefined,
  chatId: 'chat',
});

const result = (
  url: string,
  fields: Partial<Omit<RawResult, 'url'>> = {},
): RawResult => ({ title: '', url, ...fields });

const results = (...items: ReadonlyArray<RawResult>): Promise<EngineOutcome> =>
  Promise.resolve({ kind: 'results', results: items });
const rankedResults = (
  id: string,
  length: number,
  specialRank: number,
  url: string,
): Promise<EngineOutcome> =>
  results(
    ...Array.from({ length }, (_, index) =>
      result(
        index + 1 === specialRank
          ? url
          : `https://example.test/filler-${id}-${index}`,
      ),
    ),
  );

const child = (
  id: string,
  engine: Engine,
  timeoutSeconds = 60,
): AggregateChild => ({ id, engine, timeoutSeconds });

it('puts a shared result first with reciprocal rank fusion', async () => {
  const engine = createAggregateEngine([
    child('a', () =>
      results(
        result('https://example.test/u1'),
        result('https://example.test/u2'),
      ),
    ),
    child('b', () =>
      results(
        result('https://example.test/u3'),
        result('https://example.test/u1'),
      ),
    ),
  ]);

  await expect(engine(request())).resolves.toStrictEqual({
    kind: 'results',
    results: [
      result('https://example.test/u1'),
      result('https://example.test/u3'),
      result('https://example.test/u2'),
    ],
  });
});
it('counts one reciprocal-rank contribution per child and URL group', async () => {
  const engine = createAggregateEngine([
    child('a', () =>
      results(
        result('https://example.test/x#first'),
        result('https://example.test/x#second'),
        result('https://example.test/y'),
      ),
    ),
    child('b', () => results(result('https://example.test/y'))),
  ]);

  const output = await engine(request());
  if (output.kind !== 'results') throw new Error('expected results');
  expect(output.results.map(({ url }) => url)).toStrictEqual([
    'https://example.test/y',
    'https://example.test/x',
  ]);
});

it('groups www and slash spellings while merging fields', async () => {
  const engine = createAggregateEngine([
    child('a', () =>
      results(
        result('https://www.example.test/docs/', {
          snippet: 'short',
          title: '',
          published: '',
        }),
      ),
    ),
    child('b', () =>
      results(
        result('https://example.test/docs', {
          snippet: 'a much longer snippet',
          title: 'The docs',
          published: '2026-10-08',
        }),
      ),
    ),
  ]);

  await expect(engine(request())).resolves.toStrictEqual({
    kind: 'results',
    results: [
      {
        title: 'The docs',
        url: 'https://www.example.test/docs/',
        snippet: 'a much longer snippet',
        published: '2026-10-08',
      },
    ],
  });
});

it('returns results with a note for a partial child failure', async () => {
  const engine = createAggregateEngine([
    child('limited', () => Promise.reject(new EngineFailure('rate_limited'))),
    child('ok', () => results(result('https://example.test/ok'))),
  ]);

  await expect(engine(request())).resolves.toStrictEqual({
    kind: 'results',
    results: [result('https://example.test/ok')],
    notes: ['limited: rate_limited'],
  });
});
it('preserves child notes after aggregate failure notes', async () => {
  const engine = createAggregateEngine([
    child('limited', () => Promise.reject(new EngineFailure('rate_limited'))),
    child('noted', () =>
      Promise.resolve({
        kind: 'results',
        results: [result('https://example.test/ok')],
        notes: ['recency unsupported'],
      }),
    ),
  ]);

  await expect(engine(request())).resolves.toStrictEqual({
    kind: 'results',
    results: [result('https://example.test/ok')],
    notes: ['limited: rate_limited', 'recency unsupported'],
  });
});

it('returns empty with failure and empty notes', async () => {
  const engine = createAggregateEngine([
    child('auth', () => Promise.reject(new EngineFailure('auth'))),
    child('empty', () => Promise.resolve({ kind: 'empty' })),
  ]);

  await expect(engine(request())).resolves.toStrictEqual({
    kind: 'empty',
    notes: ['auth: auth', 'empty: empty'],
  });
});

it('fails upstream when every child fails', async () => {
  const engine = createAggregateEngine([
    child('auth', () => Promise.reject(new EngineFailure('auth'))),
    child('upstream', () =>
      Promise.reject(new EngineFailure('upstream_error')),
    ),
  ]);

  await expect(engine(request())).rejects.toMatchObject({
    name: 'EngineFailure',
    failureClass: 'upstream_error',
  });
});

it('notes a timed-out child while merging the others', async () => {
  const engine = createAggregateEngine([
    child(
      'slow',
      ({ signal }) =>
        new Promise<EngineOutcome>((resolve) => {
          signal.addEventListener('abort', () => resolve({ kind: 'empty' }), {
            once: true,
          });
        }),
      0.01,
    ),
    child('fast', () => results(result('https://example.test/fast'))),
  ]);

  await expect(engine(request())).resolves.toStrictEqual({
    kind: 'results',
    results: [result('https://example.test/fast')],
    notes: ['slow: timeout'],
  });
});
it('notes a child timeout when the child rejects on abort', async () => {
  const engine = createAggregateEngine([
    child(
      'slow',
      ({ signal }) =>
        new Promise<EngineOutcome>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new Error('deadline')),
            { once: true },
          );
        }),
      0.01,
    ),
    child('fast', () => results(result('https://example.test/fast'))),
  ]);

  await expect(engine(request())).resolves.toStrictEqual({
    kind: 'results',
    results: [result('https://example.test/fast')],
    notes: ['slow: timeout'],
  });
});
it('classifies results that canonicalize to nothing as empty', async () => {
  const engine = createAggregateEngine([
    child('invalid', () => results(result('javascript:alert(1)'))),
    child('failed', () => Promise.reject(new EngineFailure('auth'))),
  ]);

  await expect(engine(request())).resolves.toStrictEqual({
    kind: 'empty',
    notes: ['invalid: empty', 'failed: auth'],
  });
});

it('aborts every in-flight child and rethrows call cancellation', async () => {
  const controller = new AbortController();
  const aborted: Array<string> = [];
  const waiting =
    (id: string): Engine =>
    ({ signal }) =>
      new Promise<EngineOutcome>((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            aborted.push(id);
            reject(new Error('cancelled'));
          },
          { once: true },
        );
      });
  const engine = createAggregateEngine([
    child('a', waiting('a')),
    child('b', waiting('b')),
  ]);
  const promise = engine(request(controller.signal));
  controller.abort(new Error('cancelled by caller'));

  await expect(promise).rejects.toThrow('cancelled by caller');
  expect(aborted.sort()).toStrictEqual(['a', 'b']);
});

it('cuts merged results to the request limit', async () => {
  const engine = createAggregateEngine([
    child('a', () =>
      results(
        result('https://example.test/a1'),
        result('https://example.test/a2'),
        result('https://example.test/a3'),
      ),
    ),
    child('b', () =>
      results(
        result('https://example.test/b1'),
        result('https://example.test/b2'),
      ),
    ),
  ]);

  const output = await engine(request(new AbortController().signal, 2));
  expect(output).toStrictEqual({
    kind: 'results',
    results: [
      result('https://example.test/a1'),
      result('https://example.test/b1'),
    ],
  });
});

it('drops invalid URLs before assigning result ranks', async () => {
  const engine = createAggregateEngine([
    child('a', () =>
      results(
        result('javascript:alert(1)'),
        result('https://www.example.test/valid/'),
      ),
    ),
    child('b', () => results(result('https://example.test/valid'))),
  ]);

  await expect(engine(request())).resolves.toStrictEqual({
    kind: 'results',
    results: [result('https://www.example.test/valid/')],
  });
});
it('uses a later child spelling when it has the better rank', async () => {
  const engine = createAggregateEngine([
    child('a', () =>
      results(
        result('https://example.test/filler'),
        result('https://example.test/docs'),
      ),
    ),
    child('b', () => results(result('https://www.example.test/docs/'))),
  ]);

  await expect(
    engine(request(new AbortController().signal, 1)),
  ).resolves.toStrictEqual({
    kind: 'results',
    results: [result('https://www.example.test/docs/')],
  });
});

it('breaks equal scores by a better best rank than insertion order', async () => {
  const first = 'https://example.test/best-rank';
  const second = 'https://example.test/lower-best-rank';
  const engine = createAggregateEngine([
    child('a', () => rankedResults('a', 12, 12, second)),
    child('b', () => rankedResults('b', 3, 3, first)),
    child('c', () => rankedResults('c', 12, 12, second)),
    child('d', () => rankedResults('d', 24, 24, first)),
  ]);

  const output = await engine(request());
  if (output.kind !== 'results') throw new Error('expected results');
  expect(output.results.slice(0, 2).map(({ url }) => url)).toStrictEqual([
    first,
    second,
  ]);
});

it('breaks equal scores and ranks by the lower child order', async () => {
  const first = 'https://example.test/first';
  const second = 'https://example.test/second';
  const engine = createAggregateEngine([
    child('a', () => rankedResults('a', 3, 3, first)),
    child('b', () => rankedResults('b', 1, 1, second)),
    child('c', () => rankedResults('c', 1, 1, first)),
    child('d', () => rankedResults('d', 3, 3, second)),
  ]);

  const output = await engine(request());
  if (output.kind !== 'results') throw new Error('expected results');
  expect(output.results.slice(0, 2).map(({ url }) => url)).toStrictEqual([
    second,
    first,
  ]);
});

it('classifies an unknown child exception as an upstream error', async () => {
  const engine = createAggregateEngine([
    child('broken', () => Promise.reject(new Error('secret upstream body'))),
    child('ok', () => results(result('https://example.test/ok'))),
  ]);

  await expect(engine(request())).resolves.toStrictEqual({
    kind: 'results',
    results: [result('https://example.test/ok')],
    notes: ['broken: upstream_error'],
  });
});

it('rejects an already-cancelled call without starting children', async () => {
  const controller = new AbortController();
  controller.abort('cancelled');
  let started = false;
  const engine = createAggregateEngine([
    child('a', () => {
      started = true;
      return results(result('https://example.test/a'));
    }),
    child('b', () => results(result('https://example.test/b'))),
  ]);

  await expect(engine(request(controller.signal))).rejects.toMatchObject({
    name: 'AbortError',
    message: 'The web search was aborted.',
  });
  expect(started).toBe(false);
});
