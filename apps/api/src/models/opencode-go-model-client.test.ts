/**
 * `createOpenCodeGoModelClient` — OpenCode Go's Chat Completions transport
 * (openspec/changes/opencode-go-provider, design D1/D2/D4/D5/D6/D7/D9 and
 * tasks 3.2/3.3/3.3a/3.3b). The REAL `@ai-sdk/openai-compatible` adapter and
 * the real `streamText`/`generateText` run against a stubbed platform fetch,
 * so every assertion reads the request the SDK serialized and the failure the
 * SDK surfaced — no module is mocked and no client internals are inspected.
 */
import type { ModelMessage, LanguageModelUsage } from 'ai';
import type { Mock } from 'vitest';
import { z } from 'zod';

import { isRecord, type UnknownRecord } from '@workspace/runtime-safety';

import {
  buildTurnTelemetry,
  type TurnTelemetry,
} from '../chats/turn-telemetry';
import { createModelClient } from './model-client-factory';
import type {
  ChatIdentity,
  ModelClient,
  ModelStreamInput,
} from './model-client';
import type { ModelPricingUsdPer1M } from './model-catalog';
import {
  OPENCODE_GO_BASE_URL,
  createOpenCodeGoModelClient,
} from './opencode-go-model-client';

const messages = [
  { role: 'user', content: 'Use the configured transport.' },
] satisfies Array<ModelMessage>;

/** The product token llame's boot-read identity supplies to every client. */
const USER_AGENT = 'llame/0.0.0-test';

/**
 * The transport-only canaries one failure exchange carries: a value in the
 * gateway envelope's metadata, one in its `param`, one in a response header,
 * one in the request body's own content, and the credential the request
 * authenticates with. Each is declared once and used on BOTH sides of the
 * check — written into the exchange and listed for absence — so no checked
 * canary can be one that never left the test.
 */
const WORKSPACE_CANARY = 'WORKSPACE-CANARY';
const LIMIT_NAME_CANARY = 'LIMIT-NAME-CANARY';
const BODY_PARAM_CANARY = 'BODY-PARAM-CANARY';
const RESPONSE_HEADER_CANARY = 'RESPONSE-HEADER-CANARY';
const REQUEST_BODY_CANARY = 'REQUEST-BODY-CANARY';

/** The credential the entry's own key resolves to — the canary the request authenticates with. */
const CREDENTIAL = 'CREDENTIAL-CANARY';

/** The main-lane Chat identity every turn and compaction request carries. */
const MAIN_CHAT: ChatIdentity = { id: 'chat-canary-id', lane: 'main' };

/** The title lane, whose prompt shares nothing with the conversation's prefix. */
const TITLE_CHAT: ChatIdentity = { id: 'chat-canary-id', lane: 'title' };

/** The wire's own path appended to the fixed Go root — the literal anchor for the endpoint. */
const GO_CHAT_COMPLETIONS_URL =
  'https://opencode.ai/zen/go/v1/chat/completions';

const STREAM_BODY = [
  'data: {"id":"chunk-1","object":"chat.completion.chunk","created":0,"model":"glm-5.3-flash","choices":[{"index":0,"delta":{"content":"done"},"finish_reason":null}]}\n\n',
  'data: {"id":"chunk-1","object":"chat.completion.chunk","created":0,"model":"glm-5.3-flash","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n\n',
  'data: [DONE]\n\n',
].join('');

/** The forced-tool answer the title path reads back as its structured object. */
const STRUCTURED_BODY = JSON.stringify({
  id: 'chatcmpl-canary',
  object: 'chat.completion',
  created: 0,
  model: 'glm-5.3-flash',
  choices: [
    {
      index: 0,
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call-canary',
            type: 'function',
            function: {
              name: 'chat_title',
              arguments: '{"title":"A title"}',
            },
          },
        ],
      },
      finish_reason: 'tool_calls',
    },
  ],
  usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
});

function streamResponse(): Response {
  return new Response(STREAM_BODY, {
    headers: { 'content-type': 'text/event-stream' },
  });
}

function structuredResponse(): Response {
  return new Response(STRUCTURED_BODY, {
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * The transport one test stubbed: the platform fetch it replaced and the
 * teardown that puts the real one back.
 */
type TransportStub = {
  readonly fetchMock: Mock<typeof globalThis.fetch>;
  readonly restore: () => void;
};

/**
 * Installs the transport stub: the Go client builds its redirect-rejecting
 * wrapper from `globalThis.fetch` at construction, so the stub must be in
 * place before the client is built. Every response is constructed per call,
 * because a body can be read once and a retried failure reads a new one.
 */
function serveFetch(responseFor: (call: number) => Response): TransportStub {
  let call = 0;
  const fetchMock = vi.fn<typeof globalThis.fetch>(() =>
    Promise.resolve(responseFor(call++)),
  );
  const previousFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
  return {
    fetchMock,
    restore: () => {
      globalThis.fetch = previousFetch;
    },
  };
}

function buildClient(
  overrides: Partial<Parameters<typeof createOpenCodeGoModelClient>[0]> = {},
) {
  return createOpenCodeGoModelClient({
    credential: CREDENTIAL,
    providerModelId: 'glm-5.3-flash',
    modelId: 'system:opencode-go:glm-5.3-flash',
    contextWindowTokens: 200_000,
    userAgent: USER_AGENT,
    ...overrides,
  });
}

/**
 * One recorded call, parsed at the transport boundary into the real request
 * the SDK sent: assertions then read the request's own fields — its URL, its
 * headers, its serialized body — instead of a representation of them.
 */
function recordedRequest(stub: TransportStub, call = 0): Request {
  const [input, init] = stub.fetchMock.mock.calls[call] ?? [];
  if (input === undefined) {
    throw new TypeError('no fetch call was recorded');
  }
  return new Request(input, init);
}

function requestUrl(stub: TransportStub, call = 0): string {
  return recordedRequest(stub, call).url;
}

function requestHeaders(stub: TransportStub, call = 0): Headers {
  return recordedRequest(stub, call).headers;
}

/**
 * The serialized request body of one recorded call, proven to be a JSON
 * object: this is the request as the adapter wrote it, not a client-side
 * reconstruction.
 */
async function requestBody(
  stub: TransportStub,
  call = 0,
): Promise<UnknownRecord> {
  const body: unknown = JSON.parse(await recordedRequest(stub, call).text());
  if (!isRecord(body)) {
    throw new TypeError('expected a JSON object request body');
  }
  return body;
}

/**
 * Runs one streaming request that must fail and returns the error the run
 * loop records (its message) and logs (its stack) — the executor reads both
 * from the delivery to the client's `onError` (design D7), so that is the
 * surface this helper captures.
 */
async function streamFailure(
  client: ModelClient,
  input: ModelStreamInput,
): Promise<Error> {
  const reported: Array<Error> = [];
  // The failed stream's own settlement is the wait (`StreamTextResult.text` is
  // a `PromiseLike`, so it is awaited through its own `then`): the executor
  // learns about the failure from `onError`, and reading what was delivered
  // before the stream settles would race it.
  const settlement: unknown = await client
    .streamText({
      ...input,
      onError: ({ error }) => {
        reported.push(
          error instanceof Error ? error : new Error(String(error)),
        );
      },
    })
    .text.then(
      () => undefined,
      (error: unknown) => error,
    );

  const failure = reported[0];
  if (failure === undefined) {
    throw new TypeError(
      `expected the request to report a failure, settled with: ${
        settlement instanceof Error ? settlement.message : 'no error'
      }`,
    );
  }
  return failure;
}

/**
 * Canaries every failure exchange carries — a response header, the request
 * body's own content, and the credential — and which therefore may never
 * appear in a failure's message or stack.
 */
const TRANSPORT_ONLY_CANARIES: ReadonlyArray<string> = [
  RESPONSE_HEADER_CANARY,
  REQUEST_BODY_CANARY,
  CREDENTIAL,
];

/**
 * The canaries only the gateway's error envelope carries, checked on the
 * exchanges that serve one. Both sets are checked only where the value really
 * happens to occur: a canary that never left the test would prove nothing.
 */
const ENVELOPE_CANARIES: ReadonlyArray<string> = [
  WORKSPACE_CANARY,
  LIMIT_NAME_CANARY,
  BODY_PARAM_CANARY,
];

/**
 * The canaries that exist only inside one exchange and leaked into either
 * failure surface the executor reads: the error's message, and the stack it
 * logs.
 */
function leakedCanaries(
  error: Error,
  canaries: ReadonlyArray<string>,
): Array<string> {
  const surfaces = `${error.message}\n${error.stack ?? ''}`;
  return canaries.filter((canary) => surfaces.includes(canary));
}

/** The gateway's error envelope, with every transport-only canary in place. */
function errorEnvelope(errorType: string, message: string): string {
  return JSON.stringify({
    type: 'error',
    error: {
      type: errorType,
      message,
      param: BODY_PARAM_CANARY,
      metadata: {
        workspace: WORKSPACE_CANARY,
        limitName: LIMIT_NAME_CANARY,
      },
    },
  });
}

const REQUEST_MESSAGES = [
  { role: 'user', content: `Continue ${REQUEST_BODY_CANARY}` },
] satisfies Array<ModelMessage>;

describe('createOpenCodeGoModelClient — fixed transport (design D1/D2)', () => {
  it("sends the request to the endpoint fixed in llame's code and reports the Go provider", async () => {
    const stub = serveFetch(streamResponse);
    try {
      const client = buildClient();

      await expect(
        client.streamText({ chat: MAIN_CHAT, messages }).text,
      ).resolves.toBe('done');

      // The endpoint is llame's, not the entry's: the operator declares a key
      // and no destination, so no `id`, configuration value, or environment
      // variable can move this URL.
      expect(requestUrl(stub)).toBe(GO_CHAT_COMPLETIONS_URL);
      expect(requestUrl(stub)).toBe(`${OPENCODE_GO_BASE_URL}/chat/completions`);
      // The wire module's own name is not the provider: run events, telemetry,
      // and model metadata read this label.
      expect(client).toMatchObject({
        model: 'system:opencode-go:glm-5.3-flash',
        provider: 'opencode-go',
        contextWindowTokens: 200_000,
      });
      expect(requestHeaders(stub).get('authorization')).toBe(
        `Bearer ${CREDENTIAL}`,
      );
      const body = await requestBody(stub);
      expect(body['model']).toBe('glm-5.3-flash');
    } finally {
      stub.restore();
    }
  });

  it('is neither moved nor authenticated by the ambient OpenAI variables', async () => {
    vi.stubEnv('OPENAI_BASE_URL', 'https://ambient.example.test/v1');
    vi.stubEnv('OPENAI_API_KEY', 'sk-ambient-canary');
    const stub = serveFetch(streamResponse);
    try {
      const client = buildClient();

      await expect(
        client.streamText({ chat: MAIN_CHAT, messages }).text,
      ).resolves.toBe('done');

      expect(requestUrl(stub)).toBe(GO_CHAT_COMPLETIONS_URL);
      expect(requestHeaders(stub).get('authorization')).toBe(
        `Bearer ${CREDENTIAL}`,
      );
    } finally {
      stub.restore();
      vi.unstubAllEnvs();
    }
  });

  it('rejects a redirect without a second request, carrying nothing off the endpoint', async () => {
    const stub = serveFetch(
      () =>
        new Response('', {
          status: 302,
          statusText: 'Found',
          headers: { location: 'https://redirected-canary.example.test/v1' },
        }),
    );
    try {
      const client = buildClient();

      const error = await streamFailure(client, {
        chat: MAIN_CHAT,
        messages,
      });

      // Every request went to the fixed endpoint and exactly one was made: the
      // redirect was never followed, so neither the credential nor the session
      // header reached the redirect destination.
      expect(
        stub.fetchMock.mock.calls.map((_, call) => requestUrl(stub, call)),
      ).toEqual([GO_CHAT_COMPLETIONS_URL]);
      expect(stub.fetchMock.mock.calls[0]?.[1]?.redirect).toBe('manual');
      // The owner learns what happened (the refused redirect and its status)
      // but not where it pointed.
      expect(error.message).toMatch(/redirect \(HTTP 302\)/);
      expect(`${error.message}\n${error.stack ?? ''}`).not.toContain(
        'redirected-canary',
      );
    } finally {
      stub.restore();
    }
  });

  it('forwards the model metadata the entry declared', async () => {
    const stub = serveFetch(streamResponse);
    try {
      const client = buildClient({
        maxOutputTokens: 4096,
        compactionThresholdTokens: 4000,
        pricing: { inputUsdPer1M: 1.5, outputUsdPer1M: 6 },
      });

      await expect(
        client.streamText({ chat: MAIN_CHAT, messages }).text,
      ).resolves.toBe('done');

      // The catalog limit reaches the wire as the adapter's `max_tokens` —
      // the reserved seat an operator option may not take — while the
      // compaction trigger and the declared rates ride the client for
      // post-turn work.
      const body = await requestBody(stub);
      expect(body['max_tokens']).toBe(4096);
      expect(client).toMatchObject({
        compactionThresholdTokens: 4000,
        pricing: { inputUsdPer1M: 1.5, outputUsdPer1M: 6 },
      });
    } finally {
      stub.restore();
    }
  });

  it('composes operator options under the namespace the adapter derives from the Go name', async () => {
    const stub = serveFetch(streamResponse);
    try {
      const client = buildClient({
        providerOptions: {
          model: 'smuggled-model',
          max_tokens: 1,
          tool_choice: 'none',
          user: 'run-owner',
        },
      });

      await expect(
        client.streamText({ chat: MAIN_CHAT, messages }).text,
      ).resolves.toBe('done');

      // The adapter spreads the record it finds under the camel-case of the
      // configured provider name into the request body, so `opencodeGo` is the
      // namespace the operator's options must be composed under; the wire's
      // reserved seats were stripped before composition.
      const body = await requestBody(stub);
      expect(body['user']).toBe('run-owner');
      expect(body['model']).toBe('glm-5.3-flash');
      expect(body).not.toHaveProperty('max_tokens');
      expect(body).not.toHaveProperty('tool_choice');
    } finally {
      stub.restore();
    }
  });
});

describe('createOpenCodeGoModelClient — the Chat identity as the session header (design D3/D4/D5)', () => {
  it("sends the main lane's Chat id verbatim", async () => {
    const stub = serveFetch(streamResponse);
    try {
      const client = buildClient();

      await expect(
        client.streamText({ chat: MAIN_CHAT, messages }).text,
      ).resolves.toBe('done');

      expect(requestHeaders(stub).get('x-opencode-session')).toBe(MAIN_CHAT.id);
    } finally {
      stub.restore();
    }
  });

  it('sends the title lane under the title: prefix', async () => {
    const stub = serveFetch(streamResponse);
    try {
      const client = buildClient();

      await expect(
        client.streamText({ chat: TITLE_CHAT, messages }).text,
      ).resolves.toBe('done');

      expect(requestHeaders(stub).get('x-opencode-session')).toBe(
        `title:${TITLE_CHAT.id}`,
      );
    } finally {
      stub.restore();
    }
  });

  it('sends the same value for every main-lane request of one Chat', async () => {
    const stub = serveFetch(streamResponse);
    try {
      const client = buildClient();

      // The turn and the compaction summarizer both reach the client as the
      // Chat's main lane, so both requests share one cache identity.
      await expect(
        client.streamText({ chat: MAIN_CHAT, messages }).text,
      ).resolves.toBe('done');
      await expect(
        client.streamText({ chat: MAIN_CHAT, messages }).text,
      ).resolves.toBe('done');

      expect(requestHeaders(stub, 0).get('x-opencode-session')).toBe(
        MAIN_CHAT.id,
      );
      expect(requestHeaders(stub, 1).get('x-opencode-session')).toBe(
        requestHeaders(stub, 0).get('x-opencode-session'),
      );
    } finally {
      stub.restore();
    }
  });

  it('carries the identity on the structured-generation path too', async () => {
    const stub = serveFetch(structuredResponse);
    try {
      const client = buildClient();

      await expect(
        client.generateObject?.({
          chat: TITLE_CHAT,
          messages,
          schemaName: 'chat_title',
          schema: z.object({ title: z.string() }),
        }),
      ).resolves.toEqual({ title: 'A title' });

      expect(requestHeaders(stub).get('x-opencode-session')).toBe(
        `title:${TITLE_CHAT.id}`,
      );
    } finally {
      stub.restore();
    }
  });
});

describe('createOpenCodeGoModelClient — the headers and body llame sends (design D6/D8, task 3.3a)', () => {
  it('sends exactly the identity headers on a streaming request', async () => {
    const stub = serveFetch(streamResponse);
    try {
      const client = buildClient();

      await expect(
        client.streamText({ chat: MAIN_CHAT, messages }).text,
      ).resolves.toBe('done');

      const headers = requestHeaders(stub);
      // The full header set, in order: the SDK's own content type and
      // credential header, llame's product token, Go's fixed client header,
      // and the session header rendered from the Chat identity. A header
      // added to this request fails this test.
      expect([...headers.keys()].sort()).toEqual([
        'authorization',
        'content-type',
        'user-agent',
        'x-opencode-client',
        'x-opencode-session',
      ]);
      expect(headers.get('user-agent')).toMatch(/^llame\/0\.0\.0-test( |$)/);
      expect(headers.get('x-opencode-client')).toBe('llame');
      expect(headers.get('x-opencode-session')).toBe(MAIN_CHAT.id);
      // Never sent: the gateway's request-id and project headers, the generic
      // sticky-session pair (#881), and any other product's identity.
      for (const absent of [
        'x-opencode-request',
        'x-opencode-project',
        'x-session-id',
        'x-session-affinity',
      ]) {
        expect(headers.get(absent)).toBeNull();
      }
      // No cache control and no cache-breakpoint marker: caching is the
      // gateway's, keyed on the session header.
      expect(await recordedRequest(stub).text()).not.toMatch(/cache/i);
    } finally {
      stub.restore();
    }
  });

  it('sends the same header set on the structured request', async () => {
    const stub = serveFetch(structuredResponse);
    try {
      const client = buildClient();

      await expect(
        client.generateObject?.({
          chat: MAIN_CHAT,
          messages,
          schemaName: 'chat_title',
          schema: z.object({ title: z.string() }),
        }),
      ).resolves.toEqual({ title: 'A title' });

      const headers = requestHeaders(stub);
      expect([...headers.keys()].sort()).toEqual([
        'authorization',
        'content-type',
        'user-agent',
        'x-opencode-client',
        'x-opencode-session',
      ]);
      expect(headers.get('user-agent')).toMatch(/^llame\/0\.0\.0-test ai\//);
      expect(headers.get('x-opencode-client')).toBe('llame');
      expect(headers.get('x-opencode-session')).toBe(MAIN_CHAT.id);
      expect(await recordedRequest(stub).text()).not.toMatch(/cache/i);
    } finally {
      stub.restore();
    }
  });
});

describe('createOpenCodeGoModelClient — the failure surface (design D7, task 3.3b)', () => {
  it('surfaces the parsed envelope message of a rejected model and leaks nothing else', async () => {
    const parsedMessage =
      'model glm-5.3-flash is not supported for format oa-compat';
    const stub = serveFetch(
      () =>
        new Response(errorEnvelope('ModelError', parsedMessage), {
          status: 401,
          statusText: 'Unauthorized',
          headers: { 'x-gateway-request-id': RESPONSE_HEADER_CANARY },
        }),
    );
    try {
      const client = buildClient();

      const error = await streamFailure(client, {
        chat: MAIN_CHAT,
        messages: REQUEST_MESSAGES,
      });

      // A 401 is not retryable: one attempt, and the parsed message is the
      // failure's message — the owner sees the gateway's own words.
      expect(stub.fetchMock).toHaveBeenCalledTimes(1);
      expect(error.message).toBe(parsedMessage);
      expect(
        leakedCanaries(error, [
          ...TRANSPORT_ONLY_CANARIES,
          ...ENVELOPE_CANARIES,
        ]),
      ).toEqual([]);
    } finally {
      stub.restore();
    }
  });

  it("surfaces a usage rejection after the SDK's own retries, against the same endpoint and model", async () => {
    const parsedMessage = 'usage limit reached for this subscription';
    const stub = serveFetch(
      () =>
        new Response(errorEnvelope('GoUsageLimitError', parsedMessage), {
          status: 429,
          statusText: 'Too Many Requests',
          headers: {
            'content-type': 'application/json',
            'retry-after': '0',
            'x-gateway-request-id': RESPONSE_HEADER_CANARY,
          },
        }),
    );
    try {
      const client = buildClient();

      const error = await streamFailure(client, {
        chat: MAIN_CHAT,
        messages: REQUEST_MESSAGES,
      });

      // The SDK's own rule applies: a retryable status is attempted
      // `maxRetries + 1` times before the last message surfaces. llame keeps
      // no quota state, never replaces that message, and never tries another
      // provider, wire, or model — every attempt went to the same endpoint
      // with the same model.
      expect(stub.fetchMock).toHaveBeenCalledTimes(3);
      expect(
        stub.fetchMock.mock.calls.map((_, call) => requestUrl(stub, call)),
      ).toEqual([
        GO_CHAT_COMPLETIONS_URL,
        GO_CHAT_COMPLETIONS_URL,
        GO_CHAT_COMPLETIONS_URL,
      ]);
      const attemptedBodies = await Promise.all(
        stub.fetchMock.mock.calls.map((_, call) => requestBody(stub, call)),
      );
      expect(attemptedBodies.map((body) => body['model'])).toEqual([
        'glm-5.3-flash',
        'glm-5.3-flash',
        'glm-5.3-flash',
      ]);
      // The identity is stable across a retry: the SDK re-issuing the request
      // re-renders the same session value from the same Chat, so no attempt
      // mints a new identity.
      expect(
        stub.fetchMock.mock.calls.map((_, call) =>
          requestHeaders(stub, call).get('x-opencode-session'),
        ),
      ).toEqual([MAIN_CHAT.id, MAIN_CHAT.id, MAIN_CHAT.id]);
      expect(error.message).toBe(
        `Failed after 3 attempts. Last error: ${parsedMessage}`,
      );
      expect(
        leakedCanaries(error, [
          ...TRANSPORT_ONLY_CANARIES,
          ...ENVELOPE_CANARIES,
        ]),
      ).toEqual([]);
    } finally {
      stub.restore();
    }
  });

  it('surfaces the HTTP status text when the failure body is not the envelope', async () => {
    const stub = serveFetch(
      () =>
        new Response(`<html>${RESPONSE_HEADER_CANARY}</html>`, {
          status: 502,
          statusText: 'Bad Gateway',
          headers: {
            'retry-after': '0',
            'x-gateway-request-id': RESPONSE_HEADER_CANARY,
          },
        }),
    );
    try {
      const client = buildClient();

      const error = await streamFailure(client, {
        chat: MAIN_CHAT,
        messages: REQUEST_MESSAGES,
      });

      // An edge proxy's HTML is not the gateway's envelope, so the status text
      // is the message and the body stays on the error object.
      expect(error.message).toBe(
        'Failed after 3 attempts. Last error: Bad Gateway',
      );
      expect(leakedCanaries(error, TRANSPORT_ONLY_CANARIES)).toEqual([]);
    } finally {
      stub.restore();
    }
  });

  it('reports a malformed stream chunk with the fixed text, quoting none of it', async () => {
    const malformedChunk = '{"choices": [} MALFORMED-CHUNK-CANARY';
    const stub = serveFetch(
      () =>
        new Response(
          [
            'data: {"id":"chunk-1","object":"chat.completion.chunk","created":0,"model":"glm-5.3-flash","choices":[{"index":0,"delta":{"content":"partial"},"finish_reason":null}]}\n\n',
            `data: ${malformedChunk}\n\n`,
            'data: [DONE]\n\n',
          ].join(''),
          {
            headers: {
              'content-type': 'text/event-stream',
              'x-gateway-request-id': RESPONSE_HEADER_CANARY,
            },
          },
        ),
    );
    try {
      const client = buildClient();

      const error = await streamFailure(client, {
        chat: MAIN_CHAT,
        messages: REQUEST_MESSAGES,
      });

      // The Chat Completions wire's bounded message: a chunk the adapter
      // cannot parse is reported by a fixed text, never quoted, and the text
      // received before it stays out of the failure too.
      expect(error.message).toMatch(/stream event that could not be read/);
      expect(`${error.message}\n${error.stack ?? ''}`).not.toContain(
        'MALFORMED-CHUNK-CANARY',
      );
      expect(error.message).not.toContain('partial');
      expect(leakedCanaries(error, TRANSPORT_ONLY_CANARIES)).toEqual([]);
    } finally {
      stub.restore();
    }
  });
});

describe('createOpenCodeGoModelClient — cost is unknown unless declared (design D9, task 3.3c)', () => {
  /** The gateway's own report for one completed request. */
  const reportedUsage = {
    inputTokens: 1000,
    outputTokens: 500,
    totalTokens: 1500,
  } satisfies Partial<LanguageModelUsage>;

  /** A Go catalog entry resolved through the factory, exactly as boot does it. */
  function goClient(pricingUsdPer1M?: ModelPricingUsdPer1M): ModelClient {
    return createModelClient({
      userAgent: USER_AGENT,
      provider: { id: 'opencode-go', type: 'opencode-go', key: CREDENTIAL },
      model: {
        id: 'system:opencode-go:glm-5.3-flash',
        source: 'system',
        provider: 'opencode-go',
        providerModelId: 'glm-5.3-flash',
        contextWindowTokens: 200_000,
        systemPromptTemplate: 'Test prompt',
        systemPromptSource: 'project_default',
        referencesSkills: false,
        ...(pricingUsdPer1M !== undefined && { pricingUsdPer1M }),
      },
    });
  }

  /**
   * The telemetry the run persists for one completed request: the provider's
   * reported usage and its latency, priced from the client the factory built.
   */
  function recordedTelemetry(client: ModelClient): TurnTelemetry {
    return buildTurnTelemetry({
      usage: reportedUsage,
      finishReason: 'stop',
      status: 'completed',
      modelId: client.model,
      latencyMs: 100,
      price: client.pricing,
    });
  }

  it('records the reported usage with an unknown dollar cost when no pricing is declared', () => {
    const client = goClient();

    expect(client.provider).toBe('opencode-go');
    expect(client.pricing).toBeUndefined();
    // Go bills a subscription with usage windows, not a per-token invoice:
    // without operator-declared rates the dollar figure is null rather than
    // zero or an estimate, while usage and latency are recorded as usual.
    expect(recordedTelemetry(client)).toMatchObject({
      inputTokens: 1000,
      outputTokens: 500,
      status: 'completed',
      costUsd: null,
    });
  });

  it('prices the reported usage at the declared rates and nothing else', () => {
    const client = goClient({ input: 1.5, output: 6 });

    expect(client.pricing).toEqual({
      inputUsdPer1M: 1.5,
      outputUsdPer1M: 6,
    });
    // 1,000 input tokens at $1.50/1M plus 500 output tokens at $6.00/1M.
    expect(recordedTelemetry(client).costUsd).toBe(0.0045);
  });
});
