import type * as TimerPromises from 'node:timers/promises';
import { afterEach } from 'vitest';
import type { ModelMessage } from 'ai';

import type {
  ChatIdentity,
  ModelClient,
  ModelStreamInput,
} from './model-client';
import { createOpenAICompletionsModelClient } from './openai-completions-model-client';
import { createOpenCodeGoModelClient } from './opencode-go-model-client';
import {
  buildClient as buildAnthropicClient,
  buildHarness,
} from '../testing/anthropic-model-client-fixtures';
import { ProviderFailure } from './provider-failure/provider-failure';

vi.mock('node:timers/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof TimerPromises>()),
  setTimeout: () => Promise.resolve(),
}));

afterEach(() => vi.unstubAllGlobals());

const CHAT: ChatIdentity = { id: 'wire-failure-test', lane: 'main' };

const MESSAGES = [
  { role: 'user', content: 'Say hello.' },
] satisfies Array<ModelMessage>;

const NOW = 1_800_000_000_000;
const CANARY = 'UPSTREAM-FAILURE-CANARY';

function input(overrides: Partial<ModelStreamInput> = {}): ModelStreamInput {
  return { chat: CHAT, messages: MESSAGES, ...overrides };
}

function response(
  body: string,
  status = 200,
  headers: Readonly<Record<string, string>> = {},
): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function sse(
  body: string,
  headers: Readonly<Record<string, string>> = {},
): Response {
  return new Response(body, {
    headers: { 'content-type': 'text/event-stream', ...headers },
  });
}

function anthroErrorEvent(type: string): string {
  return [
    'event: error',
    `data: ${JSON.stringify({
      type: 'error',
      error: { type, message: CANARY },
    })}`,
    '',
    '',
  ].join('\n');
}

async function reportedFailure(client: ModelClient): Promise<ProviderFailure> {
  const reported: Array<ProviderFailure> = [];

  const result = client.streamText(
    input({
      onError: ({ error }) => {
        if (!(error instanceof ProviderFailure)) {
          throw new Error('expected a classified provider failure', {
            cause: error,
          });
        }

        reported.push(error);
      },
    }),
  );

  await Promise.resolve(result.text).catch(() => undefined);
  const failure = reported[0];

  if (!failure) throw new Error('expected a failure callback');

  return failure;
}

describe('provider failure classification on real SDK wires', () => {
  it('classifies Anthropic HTTP 529 as overloaded without exposing upstream text in callback or rejection', async () => {
    const harness = buildHarness({
      respond: () =>
        response(
          JSON.stringify({
            type: 'error',
            error: { type: 'overloaded_error', message: CANARY },
          }),
          529,
          { 'retry-after-ms': '1' },
        ),
    });

    const client = buildAnthropicClient(harness, { providerType: 'anthropic' });
    const failure = await reportedFailure(client);
    expect(failure).toMatchObject({ code: 'overloaded', statusCode: 529 });
    expect(failure.message).not.toContain(CANARY);
    expect(
      await Promise.resolve(client.streamText(input()).text).catch(
        (error: unknown) => error,
      ),
    ).toMatchObject({ code: 'overloaded', statusCode: 529 });
  });

  it('lets Anthropic spend-cap details override the generic rate limit and does not infer a reset', async () => {
    const harness = buildHarness({
      respond: () =>
        response(
          JSON.stringify({
            type: 'error',
            error: {
              type: 'rate_limit_error',
              message: CANARY,
              details: { error_code: 'enforced_spend_limit_reached' },
            },
          }),
          429,
          {
            'retry-after-ms': '1',
            'retry-after': '120',
            'anthropic-ratelimit-requests-remaining': '0',
            'anthropic-ratelimit-requests-reset': new Date(
              NOW + 120_000,
            ).toISOString(),
          },
        ),
    });

    const failure = await reportedFailure(
      buildAnthropicClient(harness, { providerType: 'anthropic' }),
    );

    expect(failure).toMatchObject({ code: 'quota_exhausted' });
    expect(failure.resetsAt).toBeUndefined();
    expect(failure.message).not.toContain(CANARY);
  });

  it('reads Anthropic exhausted-bucket reset metadata from the response headers', async () => {
    const reset = new Date(NOW + 60_000).toISOString();

    const harness = buildHarness({
      respond: () =>
        sse(anthroErrorEvent('rate_limit_error'), {
          'anthropic-ratelimit-requests-remaining': '0',
          'anthropic-ratelimit-requests-reset': reset,
        }),
    });

    const failure = await reportedFailure(
      buildAnthropicClient(harness, { providerType: 'anthropic' }),
    );

    expect(failure).toMatchObject({
      code: 'rate_limited',
      resetsAt: Date.parse(reset),
    });
  });

  it('classifies OpenRouter budget details and reset while retaining a raw numeric 429 classification', async () => {
    const budgetResponse = () =>
      response(
        JSON.stringify({
          error: {
            code: 'rate_limit_exceeded',
            message: CANARY,
            metadata: {
              limit_source: 'account',
              resets_at: new Date(NOW + 90_000).toISOString(),
            },
          },
        }),
        429,
        { 'retry-after-ms': '1' },
      );

    const budgetClient = createOpenAICompletionsModelClient({
      modelId: 'test',
      providerModelId: 'test-model',
      contextWindowTokens: 100,
      userAgent: 'llame/test',
      requestHeaders: {},
      baseUrl: 'https://example.test/v1',
      providerType: 'openrouter',
      fetch: () => Promise.resolve(budgetResponse()),
    });

    const budgetFailure = await reportedFailure(budgetClient);
    expect(budgetFailure).toMatchObject({
      code: 'quota_exhausted',
      resetsAt: Date.parse(new Date(NOW + 90_000).toISOString()),
    });
    expect(budgetFailure).not.toHaveProperty('responseBody');
    expect(budgetFailure).not.toHaveProperty('responseHeaders');

    const numericClient = createOpenAICompletionsModelClient({
      modelId: 'test',
      providerModelId: 'test-model',
      contextWindowTokens: 100,
      userAgent: 'llame/test',
      requestHeaders: {},
      baseUrl: 'https://example.test/v1',
      providerType: 'openrouter',
      fetch: () =>
        Promise.resolve(
          response(JSON.stringify({ error: { message: CANARY } }), 429, {
            'retry-after-ms': '1',
          }),
        ),
    });

    expect(await reportedFailure(numericClient)).toMatchObject({
      code: 'rate_limited',
      statusCode: 429,
    });
  });

  it('bounds malformed, redirected, and unknown Completions failures with the established messages', async () => {
    const makeClient = (fetch: typeof globalThis.fetch) =>
      createOpenAICompletionsModelClient({
        modelId: 'test',
        providerModelId: 'test-model',
        contextWindowTokens: 100,
        userAgent: 'llame/test',
        requestHeaders: {},
        baseUrl: 'https://example.test/v1',
        fetch,
      });

    const malformed = await reportedFailure(
      makeClient(() => Promise.resolve(sse('data: <html>' + CANARY + '\n\n'))),
    );

    expect(malformed.message).toBe(
      'Model request failed: the provider sent a stream event that could not be read.',
    );
    expect(malformed.message).not.toContain(CANARY);

    const redirected = await reportedFailure(
      makeClient(() =>
        Promise.resolve(
          response('', 302, { location: `https://${CANARY}.invalid` }),
        ),
      ),
    );

    expect(redirected.message).toBe(
      'Model request failed: the provider answered with a redirect (HTTP 302), which is not followed.',
    );
    expect(redirected.message).not.toContain(CANARY);

    const unknown = await reportedFailure(
      makeClient(() => Promise.resolve(sse('data: {"error": {}}\n\n'))),
    );

    expect(unknown.message).toBe(
      'Model request failed: the provider sent a stream event that could not be read.',
    );
    expect(unknown.message).not.toContain(CANARY);
    expect(unknown).toMatchObject({ code: 'unknown' });
  });

  it('preserves usage from Go Messages and Completions wires', async () => {
    const messagesBody = [
      'event: message_start',
      'data: {"type":"message_start","message":{"id":"msg-1","type":"message","role":"assistant","content":[],"model":"test","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":1}}}',
      '',
      'event: content_block_start',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}',
      '',
      'event: content_block_stop',
      'data: {"type":"content_block_stop","index":0}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":2}}',
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}',
      '',
      '',
    ].join('\n');

    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>(() => Promise.resolve(sse(messagesBody))),
    );

    const messagesClient = createOpenCodeGoModelClient({
      credential: 'test',
      providerModelId: 'claude-test',
      modelId: 'go-messages',
      contextWindowTokens: 100,
      userAgent: 'llame/test',
      requestHeaders: {},
      wire: 'anthropic-messages',
    });

    const messagesUsage: Array<unknown> = [];
    await messagesClient.streamText(
      input({
        onFinish: (event) => {
          messagesUsage.push(event.usage);
        },
      }),
    ).text;
    expect(messagesUsage[0]).toMatchObject({
      inputTokens: 10,
      outputTokens: 2,
    });
    expect(messagesClient.provider).toBe('opencode-go');

    const completionsBody = [
      'data: {"id":"chunk-1","object":"chat.completion.chunk","created":0,"model":"test","choices":[{"index":0,"delta":{"content":"hello"},"finish_reason":null}]}',
      'data: {"id":"chunk-2","object":"chat.completion.chunk","created":0,"model":"test","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
      'data: {"id":"chunk-3","object":"chat.completion.chunk","created":0,"model":"test","choices":[],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}',
      'data: [DONE]',
      '',
    ].join('\n\n');

    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>(() =>
        Promise.resolve(sse(completionsBody)),
      ),
    );

    const completionsClient = createOpenCodeGoModelClient({
      credential: 'test',
      providerModelId: 'test-model',
      modelId: 'go-completions',
      contextWindowTokens: 100,
      userAgent: 'llame/test',
      requestHeaders: {},
    });

    const completionUsage: Array<unknown> = [];
    await completionsClient.streamText(
      input({
        onFinish: (event) => {
          completionUsage.push(event.usage);
        },
      }),
    ).text;
    expect(completionUsage[0]).toMatchObject({
      inputTokens: 3,
      outputTokens: 2,
    });
    expect(completionsClient.provider).toBe('opencode-go');
  });
});
