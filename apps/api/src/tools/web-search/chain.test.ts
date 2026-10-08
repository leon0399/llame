import {
  createEngine,
  EngineFailure,
  executeSearchChain,
  type Engine,
  type EngineOutcome,
  type EngineRequest,
} from './chain';
import { createAggregateEngine } from './aggregate';
import {
  type WebSearchConfig,
  type WebSearchEngineConfig,
} from '../../instance-config/llame-config';
import { type VendorFetch } from './http';
import { requestUrl, captureFetch } from '../../testing/web-search-fetch';
import { type ModelClient } from '../../models/model-client';
import {
  answerStream,
  scriptedModelClient,
  urlSourcePart,
} from '../../testing/hosted-search-client';

const request = (
  signal: AbortSignal = new AbortController().signal,
): EngineRequest => ({
  query: 'llame',
  limit: 10,
  signal,
  recency: undefined,
  userAgent: undefined,
  chatId: 'chat',
});
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
it('uses the stable EngineFailure name', () => {
  expect(new EngineFailure('auth').name).toBe('EngineFailure');
});
const result = (): Promise<EngineOutcome> => Promise.resolve(hit);
const empty = (): Promise<EngineOutcome> => Promise.resolve({ kind: 'empty' });

type FactoryCase = {
  readonly name: string;
  readonly config: Exclude<WebSearchEngineConfig, { type: 'aggregate' }>;
  readonly body: string;
  readonly expectedUrl: string;
  readonly headers?: HeadersInit;
};
const factoryCases: ReadonlyArray<FactoryCase> = [
  {
    name: 'brave',
    config: { id: 'brave', type: 'brave', key: 'key', timeoutSeconds: 60 },
    body: JSON.stringify({
      web: { results: [{ title: 'Result', url: 'https://example.test/a' }] },
    }),
    expectedUrl: 'https://api.search.brave.com/res/v1/web/search',
  },
  {
    name: 'exa',
    config: { id: 'exa', type: 'exa', key: 'key', timeoutSeconds: 60 },
    body: JSON.stringify({
      results: [{ title: 'Result', url: 'https://example.test/a' }],
    }),
    expectedUrl: 'https://api.exa.ai/search',
  },
  {
    name: 'perplexity',
    config: {
      id: 'perplexity',
      type: 'perplexity',
      key: 'key',
      timeoutSeconds: 60,
    },
    body: JSON.stringify({
      results: [
        {
          title: 'Result',
          url: 'https://example.test/a',
          snippet: 'Snippet',
        },
      ],
    }),
    expectedUrl: 'https://api.perplexity.ai/search',
  },
  {
    name: 'searxng',
    config: {
      id: 'searxng',
      type: 'searxng',
      baseUrl: 'http://localhost:8888/prefix',
      timeoutSeconds: 60,
    },
    body: JSON.stringify({
      results: [{ title: 'Result', url: 'https://example.test/a' }],
    }),
    expectedUrl: 'http://localhost:8888/prefix/search',
  },
  {
    name: 'duckduckgo',
    config: { id: 'duckduckgo', type: 'duckduckgo', timeoutSeconds: 60 },
    body: '<div class="result"><a class="result__a" href="https://example.test/a">Result</a></div>',
    expectedUrl: 'https://html.duckduckgo.com/html/',
    headers: { 'content-type': 'text/html' },
  },
];
it.each(factoryCases)(
  'createEngine wires $name',
  async ({ config: configEntry, body, expectedUrl, headers }) => {
    const captured = captureFetch(body, 200, headers);
    const output = await createEngine(configEntry, {
      fetch: captured.fetch,
    })(request());
    const actual = new URL(captured.seen().url);
    expect(actual.origin + actual.pathname).toBe(expectedUrl);
    expect(output.kind).toBe('results');
  },
);

it('createEngine wires exa-mcp', async () => {
  const urls: Array<string> = [];
  const fetch: VendorFetch = (input) => {
    urls.push(requestUrl(input));
    return Promise.reject(new Error('fixture upstream failure'));
  };
  await expect(
    createEngine(
      {
        id: 'exa-mcp',
        type: 'exa-mcp',
        key: undefined,
        timeoutSeconds: 60,
      },
      { fetch },
    )(request()),
  ).rejects.toMatchObject({ failureClass: 'upstream_error' });
  expect(urls[0]).toBe('https://mcp.exa.ai/mcp');
});
it('createEngine wires model-hosted', async () => {
  const createClient = (modelId: string): ModelClient => {
    expect(modelId).toBe('search-model');
    return scriptedModelClient(() =>
      Promise.resolve(
        answerStream('grounded', [urlSourcePart('https://example.test/a')]),
      ),
    );
  };
  const output = await createEngine(
    {
      id: 'hosted',
      type: 'model-hosted',
      model: 'search-model',
      wire: 'openai-responses',
      timeoutSeconds: 60,
    },
    { fetch: globalThis.fetch },
  )({ ...request(), modelClients: { createClient } });
  expect(output).toStrictEqual({
    kind: 'answer',
    answer: 'grounded',
    citations: [{ url: 'https://example.test/a' }],
  });
});

it('appends engine notes after chain notes', async () => {
  const output = await executeSearchChain(
    config(['empty', 'answer']),
    request(),
    lookup({
      empty,
      answer: () => Promise.resolve({ ...hit, notes: ['engine note'] }),
    }),
  );
  expect(output).toMatchObject({
    kind: 'results',
    engine: 'answer',
    notes: ['empty: empty', 'engine note'],
  });
});

const fallthroughCases: ReadonlyArray<
  readonly [string, Engine, ReadonlyArray<string>]
> = [
  [
    'failure',
    () => Promise.reject<EngineOutcome>(new EngineFailure('upstream_error')),
    ['brave: upstream_error'],
  ],
  ['empty', empty, ['brave: empty']],
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
      results: [{ title: 'Result', url: 'https://example.test/a' }],
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

it('records an engine that canonicalizes to no results as empty', async () => {
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
  expect(output).toMatchObject({
    kind: 'results',
    engine: 'backup',
    results: [{ title: 'Result', url: 'https://example.test/a' }],
    notes: ['invalid: empty'],
  });
});
it('removes the canonicalized empty note when a later engine fails', async () => {
  const output = await executeSearchChain(
    config(['invalid', 'backup']),
    request(),
    lookup({
      invalid: () =>
        Promise.resolve({
          kind: 'results',
          results: [{ title: 'Invalid', url: 'javascript:alert(1)' }],
        }),
      backup: () => Promise.reject(new EngineFailure('auth')),
    }),
  );
  expect(output).toEqual({
    kind: 'results',
    engine: 'invalid',
    query: 'llame',
    results: [],
    notes: ['backup: auth'],
  });
});
it('removes only the answering empty engine note at any chain position', async () => {
  const output = await executeSearchChain(
    config(['first', 'invalid', 'last']),
    request(),
    lookup({
      first: () => Promise.reject(new EngineFailure('upstream_error')),
      invalid: () =>
        Promise.resolve({
          kind: 'results',
          results: [{ title: 'Invalid', url: 'not a url' }],
        }),
      last: () => Promise.reject(new EngineFailure('upstream_error')),
    }),
  );
  expect(output).toEqual({
    kind: 'results',
    engine: 'invalid',
    query: 'llame',
    results: [],
    notes: ['first: upstream_error', 'last: upstream_error'],
  });
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
it('keeps failures after an earlier empty engine', async () => {
  const output = await executeSearchChain(
    config(['brave', 'backup']),
    request(),
    lookup({
      brave: empty,
      backup: () => Promise.reject(new EngineFailure('auth')),
    }),
  );
  expect(output).toEqual({
    kind: 'results',
    engine: 'brave',
    query: 'llame',
    results: [],
    notes: ['backup: auth'],
  });
});
it('omits the note when the only engine is empty', async () => {
  const output = await executeSearchChain(
    config(['backup']),
    request(),
    lookup({ backup: empty }),
  );
  expect(output).toEqual({
    kind: 'results',
    engine: 'backup',
    query: 'llame',
    results: [],
  });
});
it('keeps notes from a final empty engine', async () => {
  const output = await executeSearchChain(
    config(['backup']),
    request(),
    lookup({
      backup: () =>
        Promise.resolve({
          kind: 'empty',
          notes: ['recency unsupported'],
        }),
    }),
  );
  expect(output).toEqual({
    kind: 'results',
    engine: 'backup',
    query: 'llame',
    results: [],
    notes: ['recency unsupported'],
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
it('returns a grounded answer with a canonical citation', async () => {
  const output = await executeSearchChain(
    config(['answer']),
    request(),
    lookup({
      answer: () =>
        Promise.resolve({
          kind: 'answer',
          answer: 'grounded',
          citations: [{ url: 'https://Example.test/a#top' }],
        }),
    }),
  );
  expect(output).toEqual({
    kind: 'answer',
    engine: 'answer',
    query: 'llame',
    answer: 'grounded',
    citations: [{ url: 'https://example.test/a' }],
  });
});
it('falls through a whitespace-only answer with a citation', async () => {
  const output = await executeSearchChain(
    config(['answer', 'backup']),
    request(),
    lookup({
      answer: () =>
        Promise.resolve({
          kind: 'answer',
          answer: '   ',
          citations: [{ url: 'https://example.test/a' }],
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
it('lets an aggregate merge a fast child past equal child deadlines', async () => {
  const timeoutSeconds = 0.01;
  const aggregate = createAggregateEngine([
    {
      id: 'slow',
      timeoutSeconds,
      engine: ({ signal }) =>
        new Promise<EngineOutcome>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new Error('child deadline')),
            { once: true },
          );
        }),
    },
    {
      id: 'fast',
      timeoutSeconds,
      engine: result,
    },
  ]);
  const output = await executeSearchChain(
    {
      engines: [
        {
          id: 'slow',
          type: 'brave',
          key: 'test-key',
          timeoutSeconds,
        },
        {
          id: 'fast',
          type: 'brave',
          key: 'test-key',
          timeoutSeconds,
        },
        { id: 'all', type: 'aggregate', engines: ['slow', 'fast'] },
      ],
      chain: ['all'],
    },
    request(),
    lookup({ all: aggregate }),
  );
  expect(output).toEqual({
    kind: 'results',
    engine: 'all',
    query: 'llame',
    results: [{ title: 'Result', url: 'https://example.test/a' }],
    notes: ['slow: timeout'],
  });
});
it('uses the chain entry matching the requested engine id', async () => {
  const chainConfig: WebSearchConfig = {
    engines: [
      {
        id: 'wrong',
        type: 'brave',
        key: 'test-key',
        timeoutSeconds: -1,
      },
      {
        id: 'right',
        type: 'brave',
        key: 'test-key',
        timeoutSeconds: 1,
      },
    ],
    chain: ['right'],
  };
  const output = await executeSearchChain(
    chainConfig,
    request(),
    lookup({ right: result }),
  );
  expect(output).toMatchObject({
    kind: 'results',
    engine: 'right',
    results: [{ title: 'Result' }],
  });
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
it('rejects an engine result after call cancellation', async () => {
  const controller = new AbortController();
  const promise = executeSearchChain(
    config(['first']),
    request(controller.signal),
    lookup({
      first: () => {
        controller.abort(new Error('cancelled after result'));
        return result();
      },
    }),
  );
  await expect(promise).rejects.toThrow('cancelled after result');
});
it('rethrows an engine rejection after call cancellation', async () => {
  const controller = new AbortController();
  const promise = executeSearchChain(
    config(['first']),
    request(controller.signal),
    lookup({
      first: () => {
        controller.abort(new Error('cancelled during rejection'));
        return Promise.reject(new Error('engine failed'));
      },
    }),
  );
  await expect(promise).rejects.toThrow('cancelled during rejection');
});
it('uses the fixed abort error for a non-Error call reason', async () => {
  const controller = new AbortController();
  controller.abort('cancelled');
  const promise = executeSearchChain(
    config(['first']),
    request(controller.signal),
    lookup({ first: result }),
  );
  await expect(promise).rejects.toMatchObject({
    name: 'AbortError',
    message: 'The web search was aborted.',
  });
});
it('checks cancellation after classifying an outcome', async () => {
  const controller = new AbortController();
  let secondStarted = false;
  // SAFETY: the getter supplies the discriminant while the test observes cancellation between steps.
  const firstOutcome = {
    get kind(): 'empty' {
      controller.abort('cancelled');
      return 'empty';
    },
  } as EngineOutcome;
  const promise = executeSearchChain(
    config(['first', 'second']),
    request(controller.signal),
    lookup({
      first: () => Promise.resolve(firstOutcome),
      second: () => {
        secondStarted = true;
        return result();
      },
    }),
  );
  await expect(promise).rejects.toMatchObject({
    name: 'AbortError',
    message: 'The web search was aborted.',
  });
  expect(secondStarted).toBe(false);
});
it('checks call cancellation before starting a later engine', async () => {
  const controller = new AbortController();
  const promise = executeSearchChain(
    config(['first', 'second']),
    request(controller.signal),
    lookup({
      first: () => {
        controller.abort('cancelled');
        return empty();
      },
      second: result,
    }),
  );
  await expect(promise).rejects.toMatchObject({
    name: 'AbortError',
    message: 'The web search was aborted.',
  });
});
