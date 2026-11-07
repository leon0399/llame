import { z } from 'zod';

import { type CohereRerankProviderConfig } from '../instance-config/rerank-config';
import { DECISION_RESPONSE_MAX_BYTES } from './decision-protocol';
import {
  createRerankClient,
  type RerankClientDependencies,
} from './rerank-client';

const KEY = 'rr-secret-key';
const DOCUMENTS = ['alpha', 'beta', 'gamma'];

type Call = { url: string; init: RequestInit };

function provider(
  overrides: Partial<CohereRerankProviderConfig> = {},
): CohereRerankProviderConfig {
  return {
    id: 'rerank',
    type: 'cohere-rerank',
    key: KEY,
    baseUrl: 'https://openrouter.ai/api/v1',
    headers: {},
    ...overrides,
  };
}

function results(scores: ReadonlyArray<number>) {
  return scores.map((score, index) => ({ index, relevance_score: score }));
}

type WireResult = { index: number; relevance_score: number | string };

type WireBody = {
  id?: string;
  model?: string | number | undefined;
  results?: ReadonlyArray<WireResult>;
  usage?: Readonly<Record<string, number | string>> | undefined;
  meta?: { billed_units: { search_units: number } };
};

/** The OpenRouter shape: no `meta`, usage with a cost. */
function okBody(overrides: WireBody = {}): WireBody {
  return {
    id: 'gen-1',
    model: 'cohere/rerank-v5.0-fast',
    results: results([0.9, 0.5, 0.1]),
    usage: { total_tokens: 2139, cost: 0.00004278 },
    ...overrides,
  };
}

function json(
  body: WireBody | ReadonlyArray<number>,
  status = 200,
  headers: HeadersInit = {},
) {
  return new Response(JSON.stringify(body), { status, headers });
}

function scripted(
  handler: (index: number, call: Call) => Response | Promise<Response>,
) {
  const calls: Array<Call> = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: new Request(input).url, init: init ?? {} };
    calls.push(call);
    return handler(calls.length - 1, call);
  };
  return { calls, fetch };
}

function recordedSleep() {
  const waits: Array<number> = [];
  return {
    waits,
    sleep: (ms: number) => {
      waits.push(ms);
      return Promise.resolve();
    },
  };
}

function rerank(
  fetch: NonNullable<RerankClientDependencies['fetch']>,
  extra: RerankClientDependencies = {},
  signal?: AbortSignal,
  config: CohereRerankProviderConfig = provider(),
) {
  return createRerankClient(config, 'cohere/rerank-5-fast', {
    fetch,
    sleep: () => Promise.resolve(),
    ...extra,
  }).rerank({
    query: 'retry budget',
    documents: DOCUMENTS,
    ...(signal !== undefined && { signal }),
  });
}

const SentBodySchema = z.object({
  model: z.string(),
  query: z.string(),
  documents: z.array(z.string()),
});

function sentBody(call: Call | undefined) {
  return SentBodySchema.parse(JSON.parse(z.string().parse(call?.init.body)));
}

function sentHeaders(call: Call | undefined): Headers {
  return new Headers(call?.init.headers);
}

function abortOnSignal(call: Call): Promise<Response> {
  const { promise, reject } = Promise.withResolvers<Response>();
  call.init.signal?.addEventListener('abort', () => {
    reject(new DOMException('timed out', 'TimeoutError'));
  });
  return promise;
}

function streamOf(chunks: ReadonlyArray<Uint8Array>, onCancel: () => void) {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index];
      index += 1;
      if (chunk === undefined) controller.close();
      else controller.enqueue(chunk);
    },
    cancel: onCancel,
  });
}

describe('rerank client request', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('posts {model,query,documents} to {baseUrl}/rerank with a bearer key', async () => {
    const { calls, fetch } = scripted(() => json(okBody()));

    await rerank(fetch);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://openrouter.ai/api/v1/rerank');
    expect(sentBody(calls[0])).toMatchObject({
      model: 'cohere/rerank-5-fast',
      query: 'retry budget',
      documents: DOCUMENTS,
    });
    expect(sentHeaders(calls[0]).get('authorization')).toBe(`Bearer ${KEY}`);
  });

  it('sends no Authorization header and no environment credential when keyless', async () => {
    vi.stubEnv('COHERE_API_KEY', 'env-cohere-secret');
    const { calls, fetch } = scripted(() => json(okBody()));

    await rerank(fetch, {}, undefined, provider({ key: null }));

    expect(sentHeaders(calls[0]).has('authorization')).toBe(false);
    expect(JSON.stringify([...sentHeaders(calls[0])])).not.toContain(
      'env-cohere-secret',
    );
  });

  it('never reads COHERE_API_KEY for a keyed entry either', async () => {
    vi.stubEnv('COHERE_API_KEY', 'env-cohere-secret');
    const { calls, fetch } = scripted(() => json(okBody()));

    await rerank(fetch);

    expect(sentHeaders(calls[0]).get('authorization')).toBe(`Bearer ${KEY}`);
  });

  it('lets an operator Authorization win on a keyless entry', async () => {
    const { calls, fetch } = scripted(() => json(okBody()));

    await rerank(
      fetch,
      {},
      undefined,
      provider({ key: null, headers: { authorization: ['Bearer operator'] } }),
    );

    expect(sentHeaders(calls[0]).get('authorization')).toBe('Bearer operator');
  });

  it('lets an operator Authorization of another letter case replace the key', async () => {
    const { calls, fetch } = scripted(() => json(okBody()));

    await rerank(
      fetch,
      {},
      undefined,
      provider({ headers: { authorization: ['Bearer operator'] } }),
    );

    expect(sentHeaders(calls[0]).get('authorization')).toBe('Bearer operator');
  });

  it('refuses redirects without a second call', async () => {
    const { calls, fetch } = scripted(
      () =>
        new Response(null, {
          status: 307,
          headers: { location: 'https://evil.example/rerank' },
        }),
    );

    await expect(rerank(fetch)).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'rejected',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init.redirect).toBe('manual');
  });
});

describe('rerank client response', () => {
  it('accepts an OpenRouter body without meta and scores each index', async () => {
    const { fetch } = scripted(() => json(okBody()));

    const outcome = await rerank(fetch);

    expect(outcome).toMatchObject({
      status: 'answered',
      model: 'cohere/rerank-v5.0-fast',
      usage: { inputTokens: 2139, outputTokens: 0, costUsd: 0.00004278 },
    });
    expect(outcome.status === 'answered' ? [...outcome.scores] : []).toEqual([
      [0, 0.9],
      [1, 0.5],
      [2, 0.1],
    ]);
  });

  it('accepts results in any order and a body that carries meta', async () => {
    const { fetch } = scripted(() =>
      json(
        okBody({
          meta: { billed_units: { search_units: 1 } },
          results: [
            { index: 2, relevance_score: 0.2 },
            { index: 0, relevance_score: 0.8 },
            { index: 1, relevance_score: 0.4 },
          ],
        }),
      ),
    );

    const outcome = await rerank(fetch);

    expect(outcome.status === 'answered' ? outcome.scores.get(0) : null).toBe(
      0.8,
    );
  });

  it.each([
    [
      'skips an index',
      [
        { index: 0, relevance_score: 1 },
        { index: 2, relevance_score: 0 },
      ],
    ],
    [
      'repeats an index',
      [
        { index: 0, relevance_score: 1 },
        { index: 0, relevance_score: 0.5 },
        { index: 2, relevance_score: 0 },
      ],
    ],
    [
      'names an index out of range',
      [
        { index: 0, relevance_score: 1 },
        { index: 1, relevance_score: 0.5 },
        { index: 3, relevance_score: 0 },
      ],
    ],
    [
      'names a negative index',
      [
        { index: 0, relevance_score: 1 },
        { index: 1, relevance_score: 0.5 },
        { index: -1, relevance_score: 0 },
      ],
    ],
    [
      'names a fractional index',
      [
        { index: 0, relevance_score: 1 },
        { index: 1, relevance_score: 0.5 },
        { index: 1.5, relevance_score: 0 },
      ],
    ],
    ['scores more documents than were sent', [...results([1, 0.5, 0.2, 0.1])]],
    ['holds no results', []],
  ])(
    'makes the request unavailable when a response %s',
    async (_name, body) => {
      const { calls, fetch } = scripted(() => json(okBody({ results: body })));

      await expect(rerank(fetch)).resolves.toMatchObject({
        status: 'unavailable',
        reason: 'invalid_response',
      });
      expect(calls).toHaveLength(1);
    },
  );

  it('makes the request unavailable on a nonfinite score', async () => {
    const { calls, fetch } = scripted(
      () =>
        new Response(
          '{"results":[{"index":0,"relevance_score":0.9},{"index":1,"relevance_score":1e999},{"index":2,"relevance_score":0.1}]}',
        ),
    );

    await expect(rerank(fetch)).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'invalid_response',
    });
    expect(calls).toHaveLength(1);
  });

  it.each([
    ['a non-JSON body', () => new Response('<html>bad gateway</html>')],
    ['a body with no results', () => json({ id: 'x' })],
    ['a JSON array', () => json([1, 2, 3])],
    [
      'a body with a string score',
      () => json(okBody({ results: [{ index: 0, relevance_score: 'high' }] })),
    ],
  ])(
    'maps %s on a 200 to invalid_response, not rejected, without a retry',
    async (_name, respond) => {
      const { calls, fetch } = scripted(respond);

      await expect(rerank(fetch)).resolves.toMatchObject({
        status: 'unavailable',
        reason: 'invalid_response',
      });
      expect(calls).toHaveLength(1);
    },
  );

  it('cancels a stream without Content-Length at the byte bound', async () => {
    let cancelled = false;
    const chunk = new Uint8Array(64 * 1024).fill(0x20);
    const chunks = Array.from(
      { length: DECISION_RESPONSE_MAX_BYTES / chunk.byteLength + 8 },
      () => chunk,
    );
    const { calls, fetch } = scripted(
      () =>
        new Response(
          streamOf(chunks, () => {
            cancelled = true;
          }),
        ),
    );

    await expect(rerank(fetch)).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'invalid_response',
    });
    expect(cancelled).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('retries when the body stream errors', async () => {
    const { calls, fetch } = scripted((index) =>
      index === 0
        ? new Response(
            new ReadableStream<Uint8Array>({
              pull() {
                throw new Error('stream broken');
              },
            }),
          )
        : json(okBody()),
    );

    await expect(rerank(fetch)).resolves.toMatchObject({ status: 'answered' });
    expect(calls).toHaveLength(2);
  });
});

describe('rerank client served model', () => {
  it('falls back to the catalog model when the response names none', async () => {
    const { fetch } = scripted(() => json(okBody({ model: undefined })));

    await expect(rerank(fetch)).resolves.toMatchObject({
      model: 'cohere/rerank-5-fast',
    });
  });

  it('falls back to the catalog model for an empty or non-string model', async () => {
    const empty = scripted(() => json(okBody({ model: '' })));
    const numeric = scripted(() => json(okBody({ model: 5 })));

    await expect(rerank(empty.fetch)).resolves.toMatchObject({
      model: 'cohere/rerank-5-fast',
    });
    await expect(rerank(numeric.fetch)).resolves.toMatchObject({
      model: 'cohere/rerank-5-fast',
    });
  });

  it('makes the request unavailable when the served model contains the key', async () => {
    const { fetch } = scripted(() => json(okBody({ model: `m-${KEY}-x` })));

    const outcome = await rerank(fetch);

    expect(outcome).toMatchObject({
      status: 'unavailable',
      reason: 'invalid_response',
    });
    expect(JSON.stringify(outcome)).not.toContain(KEY);
  });

  it('keeps the key out of the outcome when fetch throws it', async () => {
    const { fetch } = scripted(() => {
      throw new Error(`connect failed for ${KEY}`);
    });

    const outcome = await rerank(fetch);

    expect(outcome).toMatchObject({ status: 'unavailable' });
    expect(JSON.stringify(outcome)).not.toContain(KEY);
  });
});

describe('rerank client usage', () => {
  it.each([
    ['total_tokens first', { total_tokens: 10, prompt_tokens: 7 }, 10],
    ['prompt_tokens when total is absent', { prompt_tokens: 7 }, 7],
    [
      'prompt_tokens when total is invalid',
      { total_tokens: -1, prompt_tokens: 7 },
      7,
    ],
    ['zero', { total_tokens: 0 }, 0],
    [
      'the safe-integer bound',
      { total_tokens: Number.MAX_SAFE_INTEGER },
      Number.MAX_SAFE_INTEGER,
    ],
    ['null for a fraction', { total_tokens: 1.5 }, null],
    ['null for a negative count', { total_tokens: -3 }, null],
    ['null for a string count', { total_tokens: '12' }, null],
    ['null for an absent count', {}, null],
  ])('reads the count as %s', async (_name, usage, expected) => {
    const { fetch } = scripted(() => json(okBody({ usage })));

    const outcome = await rerank(fetch);

    expect(outcome).toMatchObject({ usage: { inputTokens: expected } });
  });

  it('reads the count as null above the safe-integer bound', async () => {
    const { fetch } = scripted(
      () =>
        new Response(
          `{"results":[{"index":0,"relevance_score":1},{"index":1,"relevance_score":0.5},{"index":2,"relevance_score":0}],"usage":{"total_tokens":9007199254740993}}`,
        ),
    );

    await expect(rerank(fetch)).resolves.toMatchObject({
      usage: { inputTokens: null },
    });
  });

  it.each([
    ['a reported cost', { cost: 0.5 }, 0.5],
    ['a zero cost', { cost: 0 }, 0],
    ['no cost', {}, null],
    ['a negative cost', { cost: -1 }, null],
    ['a string cost', { cost: '0.5' }, null],
  ])('reads the cost as %s', async (_name, usage, expected) => {
    const { fetch } = scripted(() => json(okBody({ usage })));

    await expect(rerank(fetch)).resolves.toMatchObject({
      usage: { costUsd: expected },
    });
  });

  it('reports null count and cost when the body has no usage', async () => {
    const { fetch } = scripted(() => json(okBody({ usage: undefined })));

    await expect(rerank(fetch)).resolves.toMatchObject({
      usage: { inputTokens: null, outputTokens: 0, costUsd: null },
    });
  });
});

describe('rerank client retries', () => {
  it.each([408, 429, 500, 503])(
    'retries %i and accepts the next response',
    async (status) => {
      const { calls, fetch } = scripted((index) =>
        index === 0 ? new Response('', { status }) : json(okBody()),
      );

      await expect(rerank(fetch)).resolves.toMatchObject({
        status: 'answered',
      });
      expect(calls).toHaveLength(2);
    },
  );

  it.each([400, 401, 402, 403, 404, 409, 413, 422])(
    'does not retry %i',
    async (status) => {
      const { calls, fetch } = scripted(() => new Response('', { status }));

      await expect(rerank(fetch)).resolves.toMatchObject({
        status: 'unavailable',
        reason: 'rejected',
      });
      expect(calls).toHaveLength(1);
    },
  );

  it('retries a transport failure', async () => {
    const { calls, fetch } = scripted((index) => {
      if (index === 0) throw new TypeError('fetch failed');
      return json(okBody());
    });

    await expect(rerank(fetch)).resolves.toMatchObject({ status: 'answered' });
    expect(calls).toHaveLength(2);
  });

  it('stops after three attempts with the last reason', async () => {
    const { calls, fetch } = scripted(() => new Response('', { status: 503 }));

    await expect(rerank(fetch)).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'upstream_error',
    });
    expect(calls).toHaveLength(3);
  });

  it('reports rate_limited when the last attempt is a 429', async () => {
    const { fetch } = scripted(() => new Response('', { status: 429 }));

    await expect(rerank(fetch)).resolves.toMatchObject({
      reason: 'rate_limited',
    });
  });

  it('waits the decision backoff between attempts', async () => {
    const { fetch } = scripted(() => new Response('', { status: 503 }));
    const { waits, sleep } = recordedSleep();

    await rerank(fetch, { sleep });

    expect(waits).toEqual([500, 1000]);
  });

  it('honours retry-after seconds and caps it at five seconds', async () => {
    const { fetch } = scripted((index) =>
      index === 0
        ? new Response('', { status: 429, headers: { 'retry-after': '30' } })
        : json(okBody()),
    );
    const { waits, sleep } = recordedSleep();

    await rerank(fetch, { sleep });

    expect(waits).toEqual([5000]);
  });

  it('honours a short retry-after', async () => {
    const { fetch } = scripted((index) =>
      index === 0
        ? new Response('', { status: 503, headers: { 'retry-after': '2' } })
        : json(okBody()),
    );
    const { waits, sleep } = recordedSleep();

    await rerank(fetch, { sleep });

    expect(waits).toEqual([2000]);
  });

  it('times each attempt out and retries it', async () => {
    const { calls, fetch } = scripted((index, call) =>
      index === 0 ? abortOnSignal(call) : json(okBody()),
    );

    await expect(
      rerank(fetch, { attemptTimeoutMs: 20 }),
    ).resolves.toMatchObject({ status: 'answered' });
    expect(calls).toHaveLength(2);
  });

  it('reports timeout when every attempt times out', async () => {
    const { calls, fetch } = scripted((_index, call) => abortOnSignal(call));

    await expect(
      rerank(fetch, { attemptTimeoutMs: 10 }),
    ).resolves.toMatchObject({ status: 'unavailable', reason: 'timeout' });
    expect(calls).toHaveLength(3);
  });
});

describe('rerank client abort', () => {
  it('rejects with the abort and starts no request when already aborted', async () => {
    const { calls, fetch } = scripted(() => json(okBody()));
    const controller = new AbortController();
    controller.abort(new Error('run cancelled'));

    await expect(rerank(fetch, {}, controller.signal)).rejects.toThrow(
      'run cancelled',
    );
    expect(calls).toHaveLength(0);
  });

  it('aborts the in-flight fetch and rejects instead of retrying', async () => {
    const controller = new AbortController();
    const { calls, fetch } = scripted((_index, call) => {
      const { promise, reject } = Promise.withResolvers<Response>();
      call.init.signal?.addEventListener('abort', () => {
        reject(new Error('aborted'));
      });
      controller.abort(new Error('deadline'));
      return promise;
    });

    await expect(rerank(fetch, {}, controller.signal)).rejects.toThrow(
      'deadline',
    );
    expect(calls).toHaveLength(1);
  });

  it('stops a retry wait on abort and starts no retry', async () => {
    const controller = new AbortController();
    const { calls, fetch } = scripted(() => new Response('', { status: 503 }));
    // The abort lands while the backoff wait runs, which ends the wait early.
    const sleep = (_ms: number, signal?: AbortSignal) => {
      expect(signal).toBe(controller.signal);
      controller.abort(new Error('cancelled'));
      return Promise.resolve();
    };

    await expect(rerank(fetch, { sleep }, controller.signal)).rejects.toThrow(
      'cancelled',
    );
    expect(calls).toHaveLength(1);
  });
});
