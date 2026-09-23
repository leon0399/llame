/**
 * The Chat Completions wire's failure contract (`provider-api-selection`:
 * "Chat Completions failures reach the run as bounded messages"), proven over
 * the real `@ai-sdk/openai-compatible` adapter and AI SDK `streamText`: only
 * the transport is stubbed, through the client's own `fetch` setting, so an
 * adapter upgrade that changes how a failure is delivered fails here.
 */
import type { ModelMessage } from 'ai';

import type { ChatIdentity, ModelClient } from './model-client';
import { createOpenAICompletionsModelClient } from './openai-completions-model-client';

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

function buildClient(fetch: typeof globalThis.fetch): ModelClient {
  return createOpenAICompletionsModelClient({
    providerModelId: 'test-model',
    modelId: 'system:test:test-model',
    contextWindowTokens: 128_000,
    userAgent: 'llame/0.0.0-test',
    baseUrl: 'https://endpoint.example.test/v1',
    fetch,
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

describe('createOpenAICompletionsModelClient — bounded stream failures', () => {
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

  it('reports a redirect answering a retried request as the redirect alone', async () => {
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

  it('passes a transport failure through unchanged', async () => {
    const transportFailure = new TypeError('network unreachable');
    const fetch = vi.fn<typeof globalThis.fetch>(() =>
      Promise.reject(transportFailure),
    );

    await expect(reportedError(buildClient(fetch))).resolves.toBe(
      transportFailure,
    );
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
