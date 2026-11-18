import {
  jsonSchema,
  type ModelMessage,
  type StreamTextOnErrorCallback,
} from 'ai';

import { createOpenAICodexModelClient } from './openai-codex-model-client';
import { createOpenAIModelClient } from './openai-model-client';
import { ProviderFailure } from './provider-failure/provider-failure';
import { createAnthropicModelClient } from './anthropic-model-client';

const CHAT = { id: 'failure-test', lane: 'main' } as const;

const messages = [
  { role: 'user', content: 'Check the request.' },
] satisfies Array<ModelMessage>;

async function rejectionOf(promise: PromiseLike<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error('request rejected with a non-Error value', {
      cause: error,
    });
  }

  throw new Error('expected request to fail');
}

function fixtureFetch(respond: () => Response): typeof globalThis.fetch {
  return () => Promise.resolve(respond());
}

describe('OpenAI Responses provider failures', () => {
  it.each(['responses', 'codex', 'anthropic'] as const)(
    'keeps usage-first failures typed while %s error persistence is deferred',
    async (wire) => {
      const previousFetch = globalThis.fetch;
      const persistence = Promise.withResolvers<void>();
      globalThis.fetch = fixtureFetch(
        () =>
          new Response(
            JSON.stringify({
              error: {
                message: 'Authentication failed',
                code: 'invalid_api_key',
                type: 'authentication_error',
              },
            }),
            { status: 401, headers: { 'content-type': 'application/json' } },
          ),
      );

      const common = {
        credential: 'credential-canary',
        providerModelId: 'gpt-test',
        modelId: 'usage-first-test',
        contextWindowTokens: 32_000,
        userAgent: 'llame/test',
        requestHeaders: {},
      };

      const clients = {
        responses: () => createOpenAIModelClient(common),
        codex: () =>
          createOpenAICodexModelClient({ ...common, accountId: 'account-id' }),
        anthropic: () =>
          createAnthropicModelClient({
            ...common,
            baseUrl: 'https://api.anthropic.com/v1',
            reasoningDeclared: false,
          }),
      };

      try {
        const result = clients[wire]().streamText({
          chat: CHAT,
          messages,
          onReasoningDelta: () => undefined,
          onError: async () => {
            await persistence.promise;
          },
        });

        const failure = await rejectionOf(result.usage);

        expect(failure).toBeInstanceOf(ProviderFailure);
        expect(failure).toMatchObject({ code: 'auth', statusCode: 401 });
        expect(failure).not.toHaveProperty('responseBody');
        expect(failure).not.toHaveProperty('requestBodyValues');
        persistence.resolve();
        await result.consumeStream();
      } finally {
        persistence.resolve();
        globalThis.fetch = previousFetch;
      }
    },
  );

  it('classifies a Responses body code ahead of an HTTP 500 status', async () => {
    const fetchMock = vi.fn(
      fixtureFetch(
        () =>
          new Response(
            JSON.stringify({
              error: {
                code: 'insufficient_quota',
                message: 'provider body secret',
              },
            }),
            {
              status: 500,
              headers: {
                'content-type': 'application/json',
                'retry-after-ms': '1',
              },
            },
          ),
      ),
    );

    const client = createOpenAIModelClient({
      credential: 'credential-canary',
      providerModelId: 'gpt-test',
      modelId: 'test-model',
      contextWindowTokens: 32_000,
      userAgent: 'llame/test',
      requestHeaders: {},
      fetch: fetchMock,
    });

    const result = client.streamText({ chat: CHAT, messages });
    const error = await rejectionOf(result.text);

    expect(error).toBeInstanceOf(ProviderFailure);
    expect(error).toMatchObject({ code: 'billing', statusCode: 500 });
  });

  it('classifies structured-generation authentication failures', async () => {
    const fetchMock = vi.fn(
      fixtureFetch(
        () =>
          new Response(
            JSON.stringify({
              error: { code: 'invalid_api_key', message: 'auth body secret' },
            }),
            { status: 401, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );

    const client = createOpenAIModelClient({
      credential: 'credential-canary',
      providerModelId: 'gpt-test',
      modelId: 'test-model',
      contextWindowTokens: 32_000,
      userAgent: 'llame/test',
      requestHeaders: {},
      fetch: fetchMock,
    });

    const error = await rejectionOf(
      client.generateObject!({
        chat: CHAT,
        messages,
        schema: jsonSchema<{ answer: string }>({
          type: 'object',
          properties: { answer: { type: 'string' } },
          required: ['answer'],
        }),
        schemaName: 'answer',
      }),
    );

    expect(error).toBeInstanceOf(ProviderFailure);
    expect(error).toMatchObject({ code: 'auth', statusCode: 401 });
    expect(String(error)).not.toContain('credential-canary');
  });

  it('keeps Codex quota reset metadata while bounding provider text', async () => {
    const fetchMock = vi.fn(
      fixtureFetch(
        () =>
          new Response(
            JSON.stringify({
              error: {
                code: 'usage_limit_reached',
                message: 'quota response contains private text',
                resets_at: 1_900_000_000,
              },
            }),
            {
              status: 429,
              headers: {
                'content-type': 'application/json',
                'retry-after': '0',
              },
            },
          ),
      ),
    );

    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    try {
      const client = createOpenAICodexModelClient({
        credential: 'credential-canary',
        accountId: 'account-canary',
        providerModelId: 'gpt-test',
        modelId: 'codex-test',
        contextWindowTokens: 32_000,
        userAgent: 'llame/test',
        requestHeaders: {},
      });

      const result = client.streamText({ chat: CHAT, messages });
      const error = await rejectionOf(result.text);

      expect(error).toBeInstanceOf(ProviderFailure);
      expect(error).toMatchObject({
        code: 'quota_exhausted',
        resetsAt: 1_900_000_000_000,
        statusCode: 429,
        message: 'Codex subscription limit reached. Retry manually later.',
      });
      expect(String(error)).not.toContain(
        'quota response contains private text',
      );
      expect(String(error)).not.toContain('credential-canary');
      expect(String(error)).not.toContain('account-canary');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('uses per-response rate-limit headers for reset timing', async () => {
    const fetchMock = vi.fn(
      fixtureFetch(
        () =>
          new Response(
            [
              `data: ${JSON.stringify({
                type: 'response.failed',
                sequence_number: 1,
                response: {
                  status: 'failed',
                  error: { code: 'rate_limit_exceeded', message: 'slow down' },
                },
              })}\n\n`,
              'data: [DONE]\n\n',
            ].join(''),
            {
              headers: {
                'content-type': 'text/event-stream',
                'retry-after-ms': '1',
                'x-ratelimit-remaining-requests': '0',
                'x-ratelimit-reset-requests': '1s',
              },
            },
          ),
      ),
    );

    const onError = vi.fn<StreamTextOnErrorCallback>();

    const client = createOpenAIModelClient({
      credential: 'credential-canary',
      providerModelId: 'gpt-test',
      modelId: 'test-model',
      contextWindowTokens: 32_000,
      userAgent: 'llame/test',
      requestHeaders: {},
      fetch: fetchMock,
    });

    const receivedAt = Date.now();
    const result = client.streamText({ chat: CHAT, messages, onError });
    await Promise.resolve(result.text).catch(() => undefined);
    const error = onError.mock.calls[0]?.[0].error;

    if (!(error instanceof ProviderFailure)) {
      throw new Error('expected classified provider failure callback');
    }

    expect(error.code).toBe('rate_limited');
    expect(error.resetsAt).toBeGreaterThan(receivedAt);
    expect(error.resetsAt).toBeLessThan(receivedAt + 10_000);
  });

  it('leaves retryable Responses request failures available to SDK retries', async () => {
    let requestCount = 0;

    const fetchMock = vi.fn(
      fixtureFetch(() => {
        requestCount += 1;

        if (requestCount === 1) {
          return new Response(
            JSON.stringify({
              error: { code: 'api_error', message: 'temporary' },
            }),
            { status: 503, headers: { 'content-type': 'application/json' } },
          );
        }

        return new Response(
          [
            'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"message","id":"item-1"}}\n\n',
            'data: {"type":"response.output_text.delta","item_id":"item-1","delta":"ok"}\n\n',
            'data: {"type":"response.completed","response":{"incomplete_details":null,"usage":{"input_tokens":1,"output_tokens":1}}}\n\n',
            'data: [DONE]\n\n',
          ].join(''),
          { headers: { 'content-type': 'text/event-stream' } },
        );
      }),
    );

    const client = createOpenAIModelClient({
      credential: 'credential-canary',
      providerModelId: 'gpt-test',
      modelId: 'test-model',
      contextWindowTokens: 32_000,
      userAgent: 'llame/test',
      requestHeaders: {},
      fetch: fetchMock,
    });

    await expect(
      client.streamText({ chat: CHAT, messages }).text,
    ).resolves.toBe('ok');
    expect(requestCount).toBeGreaterThan(1);
  });
});
