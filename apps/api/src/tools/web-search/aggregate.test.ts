import {
  EngineFailure,
  type Engine,
  type EngineOutcome,
  type EngineRequest,
  type RawCitation,
  type RawResult,
} from './chain';
import { removalFor } from '../../testing/web-search-removal';
import { createAggregateEngine, type AggregateChild } from './aggregate';
import { createDeepseekEngine } from './deepseek';
import { createParallelEngine } from './parallel';
import { ENGINE_LIMITS } from './limits';
import { type VendorFetch } from './http';
import { jsonResponse, requestUrl } from '../../testing/web-search-fetch';

const request = (
  signal: AbortSignal = new AbortController().signal,
  limit = 10,
  overrides: Partial<EngineRequest> = {},
): EngineRequest => ({
  query: 'query',
  objective: undefined,
  recency: undefined,
  limit,
  signal,
  userAgent: undefined,
  chatId: 'chat',
  removal: removalFor(undefined),
  ...overrides,
});

const result = (
  url: string,
  fields: Partial<Omit<RawResult, 'url'>> = {},
): RawResult => ({ title: '', url, ...fields });

const results = (...items: ReadonlyArray<RawResult>): Promise<EngineOutcome> =>
  Promise.resolve({ kind: 'results', results: items });
const answer = (
  text: string,
  citations: ReadonlyArray<RawCitation>,
): Promise<EngineOutcome> =>
  Promise.resolve({ kind: 'answer', answer: text, citations });
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
): AggregateChild => ({ id, engine, timeoutSeconds, limits: {} });

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

it('runs only the children whose query limit the query fits', async () => {
  const started: Array<string> = [];
  const engine = createAggregateEngine([
    {
      ...child('narrow', () => {
        started.push('narrow');
        return results(result('https://example.test/narrow'));
      }),
      limits: { query: { codePoints: 128 } },
    },
    {
      ...child('wide', () => {
        started.push('wide');
        return results(result('https://example.test/wide'));
      }),
      limits: { query: { codePoints: 200 } },
    },
  ]);
  const output = await engine({ ...request(), query: 'x'.repeat(150) });

  expect(started).toStrictEqual(['wide']);
  expect(output).toStrictEqual({
    kind: 'results',
    results: [result('https://example.test/wide')],
    notes: ['narrow: unsupported'],
  });
});

it('fails unsupported when every child skips the query', async () => {
  let started = 0;
  const count = (): Promise<EngineOutcome> => {
    started += 1;
    return results(result('https://example.test/a'));
  };
  const engine = createAggregateEngine([
    { ...child('narrow', count), limits: { query: { codePoints: 128 } } },
    { ...child('wide', count), limits: { query: { codePoints: 200 } } },
  ]);

  await expect(
    engine({ ...request(), query: 'x'.repeat(250) }),
  ).rejects.toMatchObject({
    name: 'EngineFailure',
    failureClass: 'unsupported',
  });
  expect(started).toBe(0);
});

it('skips a real deepseek child that a real parallel child accepts', async () => {
  const started: Array<string> = [];
  const fetch: VendorFetch = (input) => {
    const url = new URL(requestUrl(input));
    started.push(url.hostname);
    return Promise.resolve(
      jsonResponse(
        JSON.stringify({
          results: [
            {
              title: 'Result',
              url: `https://example.test/${url.hostname}`,
              excerpts: ['snippet'],
            },
          ],
        }),
      ),
    );
  };
  const engine = createAggregateEngine([
    {
      id: 'deepseek',
      timeoutSeconds: 60,
      limits: ENGINE_LIMITS.deepseek,
      engine: createDeepseekEngine({ key: 'secret' }, { fetch }),
    },
    {
      id: 'parallel',
      timeoutSeconds: 60,
      limits: ENGINE_LIMITS.parallel,
      engine: createParallelEngine({ key: 'secret', mode: 'fast' }, { fetch }),
    },
  ]);

  // 150 code points is over DeepSeek's 128 and within Parallel's 200.
  await expect(
    engine(request(undefined, 10, { query: 'x'.repeat(150) })),
  ).resolves.toStrictEqual({
    kind: 'results',
    results: [
      result('https://example.test/api.parallel.ai', {
        title: 'Result',
        snippet: 'snippet',
      }),
    ],
    notes: ['deepseek: unsupported'],
  });
  expect(started).toStrictEqual(['api.parallel.ai']);
});

it('skips two real children and fails unsupported without a request', async () => {
  const started: Array<string> = [];
  const fetch: VendorFetch = (input) => {
    started.push(requestUrl(input));
    return Promise.reject(new Error('no request expected'));
  };
  const engine = createAggregateEngine([
    {
      id: 'deepseek',
      timeoutSeconds: 60,
      limits: ENGINE_LIMITS.deepseek,
      engine: createDeepseekEngine({ key: 'secret' }, { fetch }),
    },
    {
      id: 'parallel',
      timeoutSeconds: 60,
      limits: ENGINE_LIMITS.parallel,
      engine: createParallelEngine({ key: 'secret', mode: 'fast' }, { fetch }),
    },
  ]);

  await expect(
    engine(request(undefined, 10, { query: 'x'.repeat(250) })),
  ).rejects.toMatchObject({
    name: 'EngineFailure',
    failureClass: 'unsupported',
  });
  expect(started).toStrictEqual([]);
});

it('stays an upstream failure when a skip mixes with a sent failure', async () => {
  const engine = createAggregateEngine([
    {
      ...child('narrow', () => results(result('https://example.test/narrow'))),
      limits: { query: { codePoints: 128 } },
    },
    {
      ...child('auth', () => Promise.reject(new EngineFailure('auth'))),
      limits: { query: { codePoints: 200 } },
    },
  ]);

  // The narrow child never sent the query, but the wide child did and failed,
  // so the aggregate is not a pure local decision.
  await expect(
    engine({ ...request(), query: 'x'.repeat(150) }),
  ).rejects.toMatchObject({
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

it('removes excluded entries before the merge and the limit cut', async () => {
  const engine = createAggregateEngine([
    child('a', () =>
      results(
        // Not an absolute URL: the host test must miss it, not throw.
        result('/relative/one'),
        result('https://old.reddit.com/r/one'),
        result('https://example.test/u1'),
      ),
    ),
    child('b', () =>
      results(
        result('https://reddit.com/r/two'),
        result('https://example.test/u2'),
      ),
    ),
  ]);

  const outcome = await engine(
    request(undefined, 2, { removal: removalFor(undefined, ['reddit.com']) }),
  );

  // The removed entries never take a result slot, so the cut keeps both
  // allowed entries instead of the two excluded ones.
  expect(outcome).toStrictEqual({
    kind: 'results',
    results: [
      result('https://example.test/u1'),
      result('https://example.test/u2'),
    ],
  });
});

const rejectsGrokipedia = {
  allow: [{ field: 'path', regex: '^https://' }],
  reject: [{ field: 'path', regex: '^https://grokipedia\\.com/' }],
};
it('attaches a grounded answer child and merges its citations', async () => {
  const engine = createAggregateEngine([
    child('brave', () =>
      results(
        result('https://example.test/u1', {
          title: 'Brave one',
          snippet: 'A snippet.',
        }),
      ),
    ),
    child('claude', () =>
      answer('The answer.', [
        { url: 'https://example.test/u1', title: 'U1' },
        { url: 'https://example.test/u2', title: 'U2' },
      ]),
    ),
  ]);

  await expect(engine(request())).resolves.toStrictEqual({
    kind: 'results',
    // u1 is returned by both children, so it ranks first; each citation takes
    // its own rank in the merge and carries its title with no snippet.
    results: [
      result('https://example.test/u1', {
        title: 'Brave one',
        snippet: 'A snippet.',
      }),
      result('https://example.test/u2', { title: 'U2' }),
    ],
    answers: [
      {
        engine: 'claude',
        answer: 'The answer.',
        citations: [
          { url: 'https://example.test/u1', title: 'U1' },
          { url: 'https://example.test/u2', title: 'U2' },
        ],
      },
    ],
  });
});
it('attaches answers in child order', async () => {
  const engine = createAggregateEngine([
    child('claude', () =>
      answer('First.', [{ url: 'https://example.test/first' }]),
    ),
    child('gpt', () =>
      answer('Second.', [{ url: 'https://example.test/second' }]),
    ),
  ]);

  const outcome = await engine(request());

  if (outcome.kind !== 'results') throw new Error('expected results output');
  expect(outcome.answers?.map((entry) => entry.engine)).toStrictEqual([
    'claude',
    'gpt',
  ]);
});
it('counts an answer child without citations as failed', async () => {
  const engine = createAggregateEngine([
    child('brave', () => results(result('https://example.test/u1'))),
    child('claude', () => answer('An uncited answer.', [])),
  ]);

  await expect(engine(request())).resolves.toStrictEqual({
    kind: 'results',
    results: [result('https://example.test/u1')],
    notes: ['claude: ungrounded'],
  });
});
it('removes a rejected citation and its link from an answer child', async () => {
  const engine = createAggregateEngine([
    child('claude', () =>
      answer(
        'See [Grokipedia](https://grokipedia.com/one) and [Docs](https://example.test/docs).',
        [
          { url: 'https://grokipedia.com/one', title: 'Grokipedia' },
          { url: 'https://example.test/docs', title: 'Docs' },
        ],
      ),
    ),
  ]);

  await expect(
    engine(request(undefined, 10, { removal: removalFor(rejectsGrokipedia) })),
  ).resolves.toStrictEqual({
    kind: 'results',
    results: [result('https://example.test/docs', { title: 'Docs' })],
    answers: [
      {
        engine: 'claude',
        answer: 'See Grokipedia and [Docs](https://example.test/docs).',
        citations: [{ url: 'https://example.test/docs', title: 'Docs' }],
      },
    ],
  });
});
it('drops an answer child that loses every citation to removal', async () => {
  const engine = createAggregateEngine([
    child('brave', () => results(result('https://example.test/u1'))),
    child('claude', () =>
      answer('See [Grokipedia](https://grokipedia.com/one).', [
        { url: 'https://grokipedia.com/one', title: 'Grokipedia' },
      ]),
    ),
  ]);

  await expect(
    engine(request(undefined, 10, { removal: removalFor(rejectsGrokipedia) })),
  ).resolves.toStrictEqual({
    kind: 'results',
    results: [result('https://example.test/u1')],
    notes: ['claude: ungrounded'],
  });
});
