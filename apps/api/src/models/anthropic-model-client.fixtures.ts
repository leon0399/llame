/**
 * Shared fixtures for the Messages-wire client's tests: a capturing transport
 * injected at the client's own dependency seam, so every assertion reads the
 * request the REAL pinned `@ai-sdk/anthropic` adapter built — its URL, its
 * headers, and the JSON body it POSTs. The adapters' own facts (option names
 * and enums, the thinking union's silent binding strip, the structured-output
 * capability table, the `max_tokens` table) are therefore proved rather than
 * assumed.
 */
import {
  createAnthropic,
  type AnthropicProvider,
  type AnthropicProviderSettings,
} from '@ai-sdk/anthropic';
import {
  generateObject,
  streamText,
  type ModelMessage,
  type ProviderMetadata,
} from 'ai';
import { isRecord, isString } from '@workspace/runtime-safety';

import {
  ANTHROPIC_DEFAULT_BASE_URL,
  createAnthropicModelClient,
  type AnthropicModelClientConfig,
  type AnthropicModelClientDependencies,
} from './anthropic-model-client';
import type { ModelStreamInput } from './model-client';
import {
  isProviderOptionRecord,
  type ProviderOptionRecord,
} from './provider-options';

export const messages = [
  { role: 'user', content: 'Hi.' },
] satisfies Array<ModelMessage>;

/** A recorded request: where it went, with which headers, and its JSON body. */
export type RecordedRequest = {
  url: string;
  headers: Headers;
  body: ProviderOptionRecord;
};

export type ClientHarness = {
  requests: Array<RecordedRequest>;
  settings: Array<AnthropicProviderSettings>;
  dependencies: AnthropicModelClientDependencies;
};

type ErrorCapture = {
  errors: Array<unknown>;
  onError: NonNullable<ModelStreamInput['onError']>;
};

type TextCapture = {
  texts: Array<string>;
  onTextDelta: NonNullable<ModelStreamInput['onTextDelta']>;
};

type ReasoningCapture = {
  deliveries: Array<[string, string | undefined, ProviderMetadata | undefined]>;
  onReasoningDelta: NonNullable<ModelStreamInput['onReasoningDelta']>;
};

function requestUrl(input: RequestInfo | URL): string {
  if (isString(input)) return input;
  return input instanceof URL ? input.href : input.url;
}

function readBody(init: RequestInit | undefined): ProviderOptionRecord {
  const raw = init?.body;
  if (!isString(raw)) {
    throw new Error('expected the adapter to send a JSON string body');
  }
  // SAFETY: JSON.parse returns any; the record proof below is the only way
  // this value is narrowed into the body type.
  const parsed: unknown = JSON.parse(raw);
  if (!isProviderOptionRecord(parsed)) {
    throw new Error('expected the adapter to send a JSON object body');
  }
  return parsed;
}

function streamResponse(events: Array<string>): Response {
  return new Response(events.join('\n') + '\n', {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function recordRequest(
  requests: Array<RecordedRequest>,
  requestInput: RequestInfo | URL,
  init: RequestInit | undefined,
): RecordedRequest {
  const request: RecordedRequest = {
    url: requestUrl(requestInput),
    headers: new Headers(init?.headers),
    body: readBody(init),
  };
  requests.push(request);
  return request;
}

export function buildHarness(
  input: {
    respond?: (request: RecordedRequest) => Response;
    streamEvents?: Array<string>;
    /**
     * A transport failure: `fetch` rejects instead of responding, the way an
     * unreachable endpoint (or a proxy in front of one) does. The adapter
     * sees the rejection and wraps it exactly as it wraps a real one — a
     * `TypeError` it recognizes becomes a status-less `APICallError`, while
     * other errors surface unchanged.
     */
    failWith?: (request: RecordedRequest) => Error;
  } = {},
): ClientHarness {
  const requests: Array<RecordedRequest> = [];
  const settings: Array<AnthropicProviderSettings> = [];
  const fetchStub = (
    requestInput: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const request = recordRequest(requests, requestInput, init);
    const failure = input.failWith?.(request);
    if (failure !== undefined) return Promise.reject(failure);
    return Promise.resolve(
      input.respond?.(request) ?? streamResponse(input.streamEvents ?? []),
    );
  };
  // The client passes an explicit baseURL plus the apiKey; only the capturing
  // transport is added here, so the recorded body is the adapter's own.
  const createAnthropicStub = (
    options?: AnthropicProviderSettings,
  ): AnthropicProvider => {
    if (options !== undefined) settings.push(options);
    return createAnthropic({ ...options, fetch: fetchStub });
  };
  return {
    requests,
    settings,
    dependencies: {
      createAnthropic: createAnthropicStub,
      streamText,
      generateObject,
    },
  };
}

export function buildClient(
  harness: ClientHarness,
  overrides: Partial<AnthropicModelClientConfig> = {},
) {
  const config: AnthropicModelClientConfig = {
    credential: 'sk-test',
    baseUrl: ANTHROPIC_DEFAULT_BASE_URL,
    providerModelId: 'claude-opus-4-8',
    modelId: 'system:anthropic:claude-opus-4-8',
    contextWindowTokens: 200_000,
    reasoningDeclared: true,
    ...overrides,
  };
  return createAnthropicModelClient(config, harness.dependencies);
}

/** The request under test: an absent one fails loudly instead of reading undefined. */
export function firstRequest(harness: ClientHarness): RecordedRequest {
  const request = harness.requests[0];
  if (!request) {
    throw new Error('expected the client to issue a request');
  }
  return request;
}

/** The tool names the adapter placed on a request body, if any. */
export function toolNames(body: ProviderOptionRecord): Array<string> {
  const tools = body['tools'];
  if (!Array.isArray(tools)) return [];
  return tools.flatMap((tool) =>
    isRecord(tool) && isString(tool['name']) ? [tool['name']] : [],
  );
}

/** One Messages text block at `index`, start through stop. */
export function textBlock(index: number, text: string): Array<string> {
  return [
    'event: content_block_start',
    `data: {"type":"content_block_start","index":${index},"content_block":{"type":"text","text":""}}`,
    '',
    'event: content_block_delta',
    `data: {"type":"content_block_delta","index":${index},"delta":{"type":"text_delta","text":${JSON.stringify(text)}}}`,
    '',
    'event: content_block_stop',
    `data: {"type":"content_block_stop","index":${index}}`,
    '',
  ];
}

/** One Messages thinking block at `index`: text delta, signature delta, stop. */
export function thinkingBlock(
  index: number,
  text: string,
  signature: string,
): Array<string> {
  const delta = (payload: string) => [
    'event: content_block_delta',
    `data: {"type":"content_block_delta","index":${index},"delta":${payload}}`,
    '',
  ];
  return [
    'event: content_block_start',
    `data: {"type":"content_block_start","index":${index},"content_block":{"type":"thinking","thinking":""}}`,
    '',
    ...delta(`{"type":"thinking_delta","thinking":${JSON.stringify(text)}}`),
    ...delta(
      `{"type":"signature_delta","signature":${JSON.stringify(signature)}}`,
    ),
    'event: content_block_stop',
    `data: {"type":"content_block_stop","index":${index}}`,
    '',
  ];
}

/** A complete Messages SSE envelope around `blocks`. */
export function messageEnvelope(blocks: Array<string>): Array<string> {
  return [
    'event: message_start',
    'data: {"type":"message_start","message":{"id":"msg-1","type":"message","role":"assistant","content":[],"model":"model","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":1}}}',
    '',
    ...blocks,
    'event: message_delta',
    'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":2}}',
    '',
    'event: message_stop',
    'data: {"type":"message_stop"}',
    '',
  ];
}

/**
 * The request details an endpoint can echo back at llame: the prompt text it
 * was sent, the credential it authenticated with, and the host it answered
 * on. Distinctive so a leak is unmistakable in an assertion.
 */
export const MESSAGES_CANARIES = {
  prompt: 'CANARY-PROMPT-a1b2c3',
  credential: 'CANARY-CREDENTIAL-d4e5f6',
  endpoint: 'CANARY-ENDPOINT-g7h8i9',
} as const;

/** The request whose details {@link truncatedEchoStream} reflects back. */
export const canaryMessages = [
  { role: 'user', content: `explain ${MESSAGES_CANARIES.prompt}` },
] satisfies Array<ModelMessage>;

/**
 * A Messages stream that starts normally and then truncates a
 * `content_block_delta` whose data reflects the request back — the prompt
 * text, the credential, the endpoint — the way a gateway's truncated body or
 * a reflected error page does. The adapter's SSE parse fails on that event, so
 * the client sees a late, status-less failure whose `JSONParseError` spells
 * the raw event data out in its message.
 */
export function truncatedEchoStream(): Array<string> {
  return [
    'event: content_block_start',
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
    '',
    'event: content_block_delta',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Partial answer."}}',
    '',
    'event: content_block_delta',
    `data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"","echo":{"prompt":"${MESSAGES_CANARIES.prompt}","x-api-key":"${MESSAGES_CANARIES.credential}","url":"https://${MESSAGES_CANARIES.endpoint}/v1/messages"`,
    '',
  ];
}

/**
 * The rejection `fetch` raises for an unreachable endpoint, in the exact shape
 * `@ai-sdk/provider-utils` recognizes and wraps into a status-less
 * `APICallError` ("Cannot connect to API: …"): the host it names is what must
 * never reach a run's diagnostics.
 */
export function unreachableEndpointFailure(host: string): TypeError {
  return new TypeError('fetch failed', {
    cause: Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), {
      code: 'ENOTFOUND',
    }),
  });
}

/** Captures the errors the client reports through the run's own channel. */
export function captureErrors(): ErrorCapture {
  const errors: Array<unknown> = [];
  return {
    errors,
    onError: (event) => {
      errors.push(event.error);
    },
  };
}

/** Captures text deltas exactly as the run's collector sees them. */
export function captureText(): TextCapture {
  const texts: Array<string> = [];
  return {
    texts,
    onTextDelta: (text) => {
      texts.push(text);
    },
  };
}

/** Captures reasoning deliveries exactly as the run's collector sees them. */
export function captureReasoning(): ReasoningCapture {
  const deliveries: Array<
    [string, string | undefined, ProviderMetadata | undefined]
  > = [];
  return {
    deliveries,
    onReasoningDelta: (text, partId, providerMetadata) => {
      deliveries.push([text, partId, providerMetadata]);
    },
  };
}
