/**
 * The Chat Completions wire's failure contract (`provider-api-selection`:
 * "Chat Completions failures reach the run as bounded messages"), proven over
 * the real `@ai-sdk/openai-compatible` adapter and AI SDK `streamText`: only
 * the transport is stubbed, through the client's own `fetch` setting, so an
 * adapter upgrade that changes how a failure is delivered fails here.
 */

import { jsonSchema, type ModelMessage } from 'ai';
import { z } from 'zod';
import type { ChatIdentity, ModelClient } from './model-client';
import { ProviderFailure } from './provider-failure/provider-failure';
import { createOpenAICompletionsModelClient } from './openai-completions-model-client';

import type { ProviderOptionRecord } from './provider-options';

vi.mock('node:timers/promises', () => ({
  setTimeout: () => Promise.resolve(),
}));

const CHAT: ChatIdentity = { id: 'chat-test', lane: 'main' };

const messages = [
  { role: 'user', content: 'Say hello.' },
] satisfies Array<ModelMessage>;

/** A value that exists only inside the endpoint's response. */
const CANARY = 'RESPONSE-CANARY-7f3a';

const TEXT_CHUNK = JSON.stringify({
  id: 'chunk-1',
  object: 'chat.completion.chunk',
  created: 0,
  model: 'test-model',
  choices: [
    {
      index: 0,
      delta: { role: 'assistant', content: 'partial' },
      finish_reason: null,
    },
  ],
});

function streamOf(...events: Array<string>): Response {
  return new Response(
    [...events, '[DONE]'].map((event) => `data: ${event}\n\n`).join(''),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}

function redirectResponse(): Response {
  return new Response('', {
    status: 302,
    statusText: 'Found',
    headers: { location: `https://${CANARY}.example.test/v1` },
  });
}

function buildClient(
  fetch: typeof globalThis.fetch,
  overrides: {
    providerOptions?: ProviderOptionRecord;
    maxOutputTokens?: number;
    sessionHeader?: (chat: ChatIdentity) => { name: string; value: string };
  } = {},
): ModelClient {
  return createOpenAICompletionsModelClient({
    providerModelId: 'test-model',
    modelId: 'system:test:test-model',
    contextWindowTokens: 128_000,
    userAgent: 'llame/0.0.0-test',
    baseUrl: 'https://endpoint.example.test/v1',
    requestHeaders: {},
    fetch,
    ...overrides,
  });
}

/** A transport that answers the n-th request with the n-th response. */
function serve(...responses: Array<() => Response>) {
  let call = 0;

  return vi.fn<typeof globalThis.fetch>(() => {
    const response = responses[Math.min(call++, responses.length - 1)];

    if (response === undefined) throw new TypeError('no response scripted');

    return Promise.resolve(response());
  });
}

/**
 * The single failure the streaming request reports to its caller's handler,
 * proven to be an `Error` — what the run records (its message) and logs (its
 * stack). The stream's own settlement is the wait, so nothing delivered after
 * it is missed.
 */
async function reportedError(client: ModelClient): Promise<Error> {
  const reported: Array<Error> = [];
  await client
    .streamText({
      chat: CHAT,
      messages,
      onTextDelta: vi.fn(),
      onError: ({ error }) => {
        if (!(error instanceof Error)) {
          throw new TypeError(`expected an Error, received ${String(error)}`);
        }

        reported.push(error);
      },
    })
    .text.then(
      () => undefined,
      () => undefined,
    );
  expect(reported).toHaveLength(1);
  const [failure] = reported;

  if (failure === undefined) throw new TypeError('no failure was reported');

  return failure;
}

function surfaces(error: Error): string {
  return `${error.message}\n${error.stack ?? ''}`;
}

describe('Chat Completions structured retries', () => {
  it('preserves per-call settings through transient 529 and 503 responses', async () => {
    const requestSettings = z.object({
      user: z.string(),
      max_tokens: z.number(),
    });

    const requests: Array<{
      headers: Headers;
      body: z.infer<typeof requestSettings>;
    }> = [];

    const responses = [
      new Response(JSON.stringify({ error: { message: 'overloaded' } }), {
        status: 529,
      }),
      new Response(JSON.stringify({ error: { message: 'unavailable' } }), {
        status: 503,
      }),
      new Response(
        JSON.stringify({
          id: 'completion-1',
          object: 'chat.completion',
          created: 0,
          model: 'test-model',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call-0',
                    type: 'function',
                    function: {
                      name: 'structured_title',
                      arguments: '{"title":"A title"}',
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
    ];

    let attempt = 0;

    const fetch = vi.fn<typeof globalThis.fetch>(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        requests.push({
          headers: request.headers,
          body: requestSettings.parse(JSON.parse(await request.text())),
        });
        const response = responses[attempt++];

        if (response === undefined) throw new TypeError('no response scripted');

        return response;
      },
    );

    const client = buildClient(fetch, {
      providerOptions: { user: 'configured-user' },
      maxOutputTokens: 1234,
      sessionHeader: (chat) => ({ name: 'x-chat-id', value: chat.id }),
    });

    if (!client.generateObject) {
      throw new TypeError('expected structured generation to be available');
    }

    await expect(
      client.generateObject({
        chat: CHAT,
        messages,
        schemaName: 'structured_title',
        schema: jsonSchema<{ title: string }>({
          type: 'object',
          properties: { title: { type: 'string' } },
          required: ['title'],
        }),
      }),
    ).resolves.toEqual({ title: 'A title' });

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(requests).toHaveLength(3);

    for (const { headers, body } of requests) {
      expect(headers.get('x-chat-id')).toBe(CHAT.id);
      expect(body).toMatchObject({
        user: 'configured-user',
        max_tokens: 1234,
      });
    }
  });
});

describe('createOpenAICompletionsModelClient — bounded stream failures', () => {
  it('classifies an authentication failure when usage is consumed before text', async () => {
    const client = buildClient(
      serve(
        () =>
          new Response(
            JSON.stringify({
              error: {
                message: 'Authentication failed',
                code: 'invalid_api_key',
              },
            }),
            { status: 401, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );

    const result = client.streamText({
      chat: CHAT,
      messages,
      onError: () => undefined,
    });

    await expect(result.usage).rejects.toMatchObject({
      code: 'auth',
      statusCode: 401,
    });
  });

  it.each(['text', 'consumeStream'] as const)(
    'preserves a rejected owner error callback through %s',
    async (channel) => {
      const ownerError = new Error('Owner persistence failed');

      const client = buildClient(
        serve(
          () =>
            new Response(
              JSON.stringify({
                error: {
                  message: 'Authentication failed',
                  code: 'invalid_api_key',
                },
              }),
              { status: 401, headers: { 'content-type': 'application/json' } },
            ),
        ),
      );

      const result = client.streamText({
        chat: CHAT,
        messages,
        onError: () => Promise.reject(ownerError),
      });

      await expect(
        channel === 'text' ? result.text : result.consumeStream(),
      ).rejects.toBe(ownerError);
    },
  );

  it.each(['text', 'consumeStream'] as const)(
    'preserves abort-persistence failure identity through %s',
    async (channel) => {
      const requested = Promise.withResolvers<void>();
      const controller = new AbortController();
      const abortReason = new DOMException('Stopped', 'AbortError');
      const ownerError = new Error('Owner persistence failed');

      const client = buildClient(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(abortReason), {
              once: true,
            });
            requested.resolve();
          }),
      );

      const result = client.streamText({
        chat: CHAT,
        messages,
        abortSignal: controller.signal,
        onError: () => {
          throw ownerError;
        },
      });

      const pending = channel === 'text' ? result.text : result.consumeStream();

      const failure = pending.then(
        () => undefined,
        (error: unknown) => error,
      );

      await requested.promise;
      controller.abort(abortReason);

      expect(await failure).toBe(ownerError);
    },
  );
  it('retries an empty stream that closes without a provider finish reason', async () => {
    const fetch = serve(
      () => streamOf(),
      () =>
        streamOf(
          TEXT_CHUNK,
          JSON.stringify({
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          }),
        ),
    );

    const onRetry = vi.fn();

    await expect(
      buildClient(fetch).streamText({ chat: CHAT, messages, onRetry }).text,
    ).resolves.toBe('partial');
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'stream_broken', retry: 1 }),
    );
  });

  it('reports an unparseable and a schema-mismatched event with one fixed text and none of either event', async () => {
    const notJson = await reportedError(
      buildClient(
        serve(() => streamOf(TEXT_CHUNK, `<html>proxy echo ${CANARY}</html>`)),
      ),
    );

    const mismatched = await reportedError(
      buildClient(
        serve(() =>
          streamOf(
            TEXT_CHUNK,
            JSON.stringify({ choices: `${CANARY}-not-an-array` }),
          ),
        ),
      ),
    );

    expect(notJson.message).toMatch(/stream event that could not be read/);
    expect(mismatched.message).toBe(notJson.message);

    for (const error of [notJson, mismatched]) {
      expect(surfaces(error)).not.toContain(CANARY);
      expect(error.cause).toBeUndefined();
    }
  });

  it.each([
    ['a string', CANARY],
    ['an object without a message', { code: 500, metadata: { note: CANARY } }],
  ])(
    'reports an event whose error value is %s as unreadable, not raw',
    async (_label, errorValue) => {
      const error = await reportedError(
        buildClient(
          serve(() =>
            streamOf(
              TEXT_CHUNK,
              JSON.stringify({ choices: [], error: errorValue }),
            ),
          ),
        ),
      );

      expect(error.message).toMatch(/stream event that could not be read/);
      expect(error.message).not.toBe('[object Object]');
      expect(surfaces(error)).not.toContain(CANARY);
    },
  );

  it('reports an in-stream error envelope as its parsed message alone', async () => {
    const error = await reportedError(
      buildClient(
        serve(() =>
          streamOf(
            TEXT_CHUNK,
            JSON.stringify({
              error: {
                message: 'Upstream overloaded',
                type: 'server_error',
                param: CANARY,
                code: CANARY,
              },
            }),
          ),
        ),
      ),
    );

    expect(error.message).toBe('Upstream overloaded');
    expect(surfaces(error)).not.toContain(CANARY);
  });

  it('reports a redirect with the fixed text naming its status and not its target', async () => {
    const fetch = serve(redirectResponse);

    const error = await reportedError(buildClient(fetch));

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(error.message).toMatch(/redirect \(HTTP 302\)/);
    expect(surfaces(error)).not.toContain(CANARY);
    expect(error.message).not.toContain('Found');
    expect(error.cause).toBeUndefined();
  });

  it('reports a redirect after llame retries a transient provider failure', async () => {
    const fetch = serve(
      () =>
        new Response('', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'retry-after': '0' },
        }),
      redirectResponse,
    );

    const error = await reportedError(buildClient(fetch));

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(error.message).toMatch(/redirect \(HTTP 302\)/);
    expect(error.message).not.toMatch(/Found|attempts/);
    expect(surfaces(error)).not.toContain(CANARY);
    expect(error.cause).toBeUndefined();
  });

  it('classifies a transport failure without retaining its error graph', async () => {
    const transportFailure = new TypeError('fetch failed', {
      cause: Object.assign(new Error(`unreachable ${CANARY}`), {
        code: 'ECONNREFUSED',
      }),
    });

    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.reject(transportFailure),
    );

    const error = await reportedError(buildClient(fetch));

    expect(error).toBeInstanceOf(ProviderFailure);
    expect(error).toMatchObject({
      code: 'unreachable',
    });
    expect(error.cause).toBeUndefined();
    expect(error).not.toHaveProperty('responseBody');
    expect(error).not.toHaveProperty('responseHeaders');
    expect(error).not.toHaveProperty('requestBodyValues');
  });

  it("keeps the stream's drain waiting on the caller's asynchronous handler", async () => {
    // The worker drains the stream and then requires the run's terminal
    // state, which the run's async handler persists: the bound must not
    // detach that handler from the drain.
    // Executor form: the API's TypeScript lib predates `Promise.withResolvers`.
    let markInvoked: () => void = () => {};

    const invoked = new Promise<void>((resolve) => {
      markInvoked = resolve;
    });

    let release: () => void = () => {};

    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const client = buildClient(
      serve(() => streamOf(TEXT_CHUNK, `<html>${CANARY}</html>`)),
    );

    let drained = false;

    const drain = client
      .streamText({
        chat: CHAT,
        messages,
        onError: () => {
          markInvoked();

          return gate;
        },
      })
      .consumeStream()
      .then(() => {
        drained = true;
      });

    await invoked;
    // A detached handler would let the drain settle within the stream's
    // remaining work; one macrotask yield (no duration) gives it that chance.
    await new Promise((resolve) => setImmediate(resolve));
    expect(drained).toBe(false);
    release();
    await drain;
    expect(drained).toBe(true);
  });

  it('prints the bounded error, not the parse error, when the caller supplies no handler', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    try {
      const client = buildClient(
        serve(() => streamOf(TEXT_CHUNK, `<html>${CANARY}</html>`)),
      );

      await client.streamText({ chat: CHAT, messages }).text;

      expect(consoleError).toHaveBeenCalledTimes(1);
      const printed: unknown = consoleError.mock.calls[0]?.[0];

      if (!(printed instanceof Error)) {
        throw new TypeError('expected an Error to be printed');
      }

      expect(printed.message).toMatch(/stream event that could not be read/);
      expect(surfaces(printed)).not.toContain(CANARY);
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain(CANARY);
    } finally {
      consoleError.mockRestore();
    }
  });
});
