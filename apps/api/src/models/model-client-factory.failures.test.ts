/**
 * The client factory's failure redaction (`provider-api-selection`: "Provider
 * failures never carry a configured credential"; design D3), proven per wire
 * over the REAL clients and AI SDK `streamText`/`generateObject`: only the
 * transport is stubbed, through each client's own transport seam, so an
 * adapter or SDK change that stops routing a failure through `onError`, a
 * promise channel, or a rejection fails here.
 */
import { inspect } from 'node:util';

import { Logger } from '@nestjs/common';
import { jsonSchema, type ModelMessage } from 'ai';
import { isString, type UnknownRecord } from '@workspace/runtime-safety';
import { z } from 'zod';

import type { ProviderConfig } from '../instance-config/llame-config';
import { buildHarness } from '../testing/anthropic-model-client-fixtures';
import { createAnthropicModelClient } from './anthropic-model-client';
import type { ChatIdentity, ModelClient } from './model-client';
import { createModelClient } from './model-client-factory';
import { createOpenAICompletionsModelClient } from './openai-completions-model-client';
import { createOpenAIModelClient } from './openai-model-client';

const CHAT: ChatIdentity = { id: 'chat-test', lane: 'main' };

const messages = [
  { role: 'user', content: 'Say hello.' },
] satisfies Array<ModelMessage>;

const USER_AGENT = 'llame/0.0.0-test';

/** The entry's resolved credential; nothing upstream may echo it. */
const KEY = 'CONFIGURED-KEY-CANARY-4c1d';

/** A header substitution, the other configured credential a compaction request can carry. */
const HEADER_SECRET = 'CONFIGURED-HEADER-CANARY-91be';

const model = {
  id: 'system:test:test-model',
  source: 'system' as const,
  provider: 'test',
  providerModelId: 'glm-5.3-flash',
  displayName: 'Test model',
  contextWindowTokens: 128_000,
  input: ['text'] as const,
  systemPromptTemplate: 'Test prompt',
  systemPromptSource: 'project_default' as const,
  referencesSkills: false,
};

type Fetch = typeof globalThis.fetch;

function jsonResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function serve(response: () => Response): Fetch {
  return () => Promise.resolve(response());
}

/** The Responses wire forwards this envelope as a plain object, not an `Error`. */
function partialErrorStream(error: UnknownRecord): Response {
  return new Response(
    [
      {
        type: 'response.output_text.delta',
        sequence_number: 0,
        item_id: 'msg-1',
        output_index: 0,
        content_index: 0,
        delta: 'partial answer',
      },
      error,
    ]
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join(''),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}

/** The message text Nest prints, rendering object arguments the way it does. */
function printedLog(calls: ReadonlyArray<ReadonlyArray<unknown>>): string {
  return calls
    .flatMap((args) =>
      args.map((arg) => (isString(arg) ? arg : inspect(arg, { depth: 5 }))),
    )
    .join('\n');
}

/** A client built by the factory for `provider`, with only the transport stubbed. */
function factoryClient(
  provider: ProviderConfig,
  dependencies: Parameters<typeof createModelClient>[1],
  credentials: ReadonlyArray<string> = [KEY, HEADER_SECRET],
): ModelClient {
  return createModelClient(
    {
      provider,
      model: { ...model, provider: provider.id },
      userAgent: USER_AGENT,
      credentials,
    },
    dependencies,
  );
}

/**
 * Runs one streaming request that must fail and returns the failure the
 * caller's `onError` saw and the one the result's `text` channel rejected
 * with — the two surfaces a run records, shows, and logs.
 */
async function streamFailure(
  client: ModelClient,
): Promise<{ reported: unknown; settlement: unknown }> {
  const reported: Array<unknown> = [];

  const settlement: unknown = await client
    .streamText({
      chat: CHAT,
      messages,
      onError: ({ error }) => {
        reported.push(error);
      },
    })
    .text.then(
      () => undefined,
      (error: unknown) => error,
    );

  return { reported: reported[0], settlement };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function surfaces(error: unknown): string {
  return error instanceof Error
    ? `${error.message}\n${error.stack ?? ''}`
    : String(error);
}

function expectNoCredential(error: unknown): void {
  expect(surfaces(error)).not.toContain(KEY);
  expect(surfaces(error)).not.toContain(HEADER_SECRET);
}

const completionsProvider: ProviderConfig = {
  id: 'completions',
  type: 'openai-completions',
  key: KEY,
  baseUrl: 'https://endpoint.example.test/v1',
  headers: { authorization: ['Bearer ', HEADER_SECRET] },
};

/** A Chat Completions client whose stubbed upstream echoes `message`. */
function completionsClient(message: string, status = 401): ModelClient {
  return factoryClient(
    completionsProvider,
    completionsDependencies(
      serve(() => jsonResponse(JSON.stringify({ error: { message } }), status)),
    ),
  );
}

/** The Chat Completions client's dependencies, with only its transport stubbed. */
function completionsDependencies(
  fetch: Fetch = serve(() =>
    jsonResponse(JSON.stringify({ error: { message: `echoed ${KEY}` } }), 401),
  ),
): Parameters<typeof createModelClient>[1] {
  return {
    createOpenAIModelClient,
    createOpenAICompletionsModelClient: (config) =>
      createOpenAICompletionsModelClient({ ...config, fetch }),
  };
}

describe('createModelClient failure redaction', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    'openai-responses',
    'openai-completions',
    'anthropic-messages',
  ] as const)(
    'keeps OpenRouter budget classification through the %s override and redaction',
    async (wire) => {
      // A reset in the past changes how the failure is classified, so keep it
      // an hour ahead of the test's clock.
      const resetsAt = Date.now() + 3_600_000;
      const resetsAtText = new Date(resetsAt).toISOString();

      const fetch = serve(() =>
        jsonResponse(
          JSON.stringify({
            type: 'error',
            error: {
              code: 403,
              type: 'permission_error',
              message: `Budget rejected ${KEY}`,
              metadata: {
                limit_source: 'openrouter_workspace_budget',
                resets_at: resetsAtText,
              },
            },
          }),
          403,
        ),
      );

      const client = createModelClient(
        {
          provider: {
            id: 'router',
            type: 'openrouter',
            key: KEY,
            baseUrl: 'https://endpoint.example.test/v1',
            headers: {},
          },
          model: { ...model, provider: 'router', wire },
          userAgent: USER_AGENT,
          credentials: [KEY],
        },
        {
          createOpenAIModelClient: (config) =>
            createOpenAIModelClient({ ...config, fetch }),
          createOpenAICompletionsModelClient: (config) =>
            createOpenAICompletionsModelClient({ ...config, fetch }),
          createAnthropicModelClient: (config) =>
            createAnthropicModelClient({ ...config, fetch }),
        },
      );

      const { reported } = await streamFailure(client);
      expect(reported).toMatchObject({ code: 'quota_exhausted', resetsAt });
      expectNoCredential(reported);
    },
  );

  it('reports an echoed credential as [REDACTED] on the openai-responses wire', async () => {
    const client = factoryClient(
      {
        id: 'responses',
        type: 'openai-responses',
        key: KEY,
        baseUrl: 'https://endpoint.example.test/v1',
        headers: {},
      },
      {
        createOpenAIModelClient: (config) =>
          createOpenAIModelClient({
            ...config,
            fetch: serve(() =>
              jsonResponse(
                JSON.stringify({ error: { message: `echoed ${KEY}` } }),
                401,
              ),
            ),
          }),
      },
    );

    const { reported, settlement } = await streamFailure(client);

    expect(messageOf(reported)).toContain('[REDACTED]');
    expectNoCredential(reported);
    expectNoCredential(settlement);
  });

  it('reports an echoed credential as [REDACTED] on the openai-completions wire, including a configured header value', async () => {
    const client = completionsClient(`echoed ${KEY} and ${HEADER_SECRET}`);

    const { reported, settlement } = await streamFailure(client);

    expect(messageOf(reported)).toContain('[REDACTED]');
    expectNoCredential(reported);
    expectNoCredential(settlement);
  });

  it('reports an echoed credential as [REDACTED] on the opencode-go wire', async () => {
    vi.stubGlobal(
      'fetch',
      serve(() =>
        jsonResponse(
          JSON.stringify({ error: { message: `echoed ${KEY}` } }),
          401,
        ),
      ),
    );

    const client = factoryClient(
      { id: 'go', type: 'opencode-go', key: KEY, headers: {} },
      { createOpenAIModelClient },
    );

    const { reported, settlement } = await streamFailure(client);

    expect(messageOf(reported)).toContain('[REDACTED]');
    expect(surfaces(reported)).not.toContain(KEY);
    expectNoCredential(settlement);
  });

  it('reports no credential on the anthropic-messages wire', async () => {
    const harness = buildHarness({
      respond: () => new Response(`echoed ${KEY}`, { status: 401 }),
    });

    const client = factoryClient(
      {
        id: 'messages',
        type: 'anthropic-messages',
        key: KEY,
        baseUrl: 'https://endpoint.example.test',
        headers: {},
      },
      {
        createOpenAIModelClient,
        createAnthropicModelClient: (config) =>
          createAnthropicModelClient(config, harness.dependencies),
      },
    );

    const { reported, settlement } = await streamFailure(client);

    expectNoCredential(reported);
    expectNoCredential(settlement);
    expect(harness.requests).toHaveLength(1);
  });

  it('reports no credential on the openai-codex wire', async () => {
    vi.stubGlobal(
      'fetch',
      serve(() => new Response(`echoed ${KEY}`, { status: 401 })),
    );

    const client = factoryClient(
      {
        id: 'codex',
        type: 'openai-codex',
        key: KEY,
        accountId: 'account-id',
        headers: {},
      },
      { createOpenAIModelClient },
    );

    const { reported, settlement } = await streamFailure(client);

    expectNoCredential(reported);
    expectNoCredential(settlement);
  });

  it("reports a failure's own class unchanged when it carries a credential", async () => {
    const client = completionsClient(`${KEY} is not allowed`);

    const { reported } = await streamFailure(client);

    expect(reported).toMatchObject({ code: 'auth', statusCode: 401 });
    expectNoCredential(reported);
  });

  it('reports a rejected structured generation redacted on the Chat Completions wire', async () => {
    const client = completionsClient(`echoed ${KEY}`);

    if (client.generateObject === undefined) {
      throw new TypeError(
        'expected the Chat Completions client to generate objects',
      );
    }

    const failure = await client
      .generateObject({
        chat: CHAT,
        messages,
        schema: jsonSchema<{ title: string }>({
          type: 'object',
          properties: { title: { type: 'string' } },
          required: ['title'],
        }),
      })
      .catch((error: unknown) => error);

    expect(messageOf(failure)).toContain('[REDACTED]');
    expect(failure).toMatchObject({ code: 'auth' });
    expectNoCredential(failure);
  });

  it('leaves a failure without a credential unchanged', async () => {
    const client = completionsClient('Invalid API key.');

    const { reported } = await streamFailure(client);

    expect(messageOf(reported)).toBe('Invalid API key.');
  });

  it('logs only the redacted failure when the caller supplies no handler', async () => {
    const loggerError = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const provider: ProviderConfig = {
      id: 'responses',
      type: 'openai-responses',
      key: KEY,
      baseUrl: 'https://endpoint.example.test/v1',
      headers: {},
    };

    const client = factoryClient(provider, {
      createOpenAIModelClient: (config) =>
        createOpenAIModelClient({
          ...config,
          fetch: serve(() =>
            jsonResponse(
              JSON.stringify({ error: { message: `echoed ${KEY}` } }),
              401,
            ),
          ),
        }),
    });

    await client.streamText({ chat: CHAT, messages }).text.then(
      () => undefined,
      () => undefined,
    );

    expect(consoleError).not.toHaveBeenCalled();
    expect(loggerError).toHaveBeenCalledTimes(1);
    const printed = printedLog(loggerError.mock.calls);
    expect(printed).toContain('[REDACTED]');
    expect(printed).not.toContain(KEY);

    // A failure the Responses wire forwards as a plain object has no `message`
    // to interpolate: the log must render the redacted envelope's fields
    // instead of collapsing it to `[object Object]`.
    loggerError.mockClear();

    const structuredClient = factoryClient(provider, {
      createOpenAIModelClient: (config) =>
        createOpenAIModelClient({
          ...config,
          fetch: serve(() =>
            partialErrorStream({
              type: 'response.failed',
              sequence_number: 2,
              response: {
                error: {
                  code: 'server_error',
                  message: `Upstream echoed ${KEY}`,
                },
                incomplete_details: { reason: 'error' },
              },
            }),
          ),
        }),
    });

    await structuredClient.streamText({ chat: CHAT, messages }).text.then(
      () => undefined,
      () => undefined,
    );

    expect(consoleError).not.toHaveBeenCalled();
    expect(loggerError).toHaveBeenCalledTimes(1);
    expect(printedLog(loggerError.mock.calls)).not.toContain(KEY);
  });

  it('keeps a client without structured generation untouched', () => {
    const client = factoryClient(
      {
        id: 'codex',
        type: 'openai-codex',
        key: KEY,
        accountId: 'account-id',
        headers: {},
      },
      { createOpenAIModelClient },
    );

    expect('generateObject' in client).toBe(false);
    expect(client.model).toBe(model.id);
  });

  it('passes every failure through untouched when no credential is configured', async () => {
    const client = factoryClient(
      completionsProvider,
      completionsDependencies(),
      [],
    );

    const { reported } = await streamFailure(client);

    expect(messageOf(reported)).toContain(KEY);
  });

  it('generates a structured title through the wrapper with its schema untouched', async () => {
    const client = factoryClient(completionsProvider, {
      createOpenAIModelClient,
      createOpenAICompletionsModelClient: (config) =>
        createOpenAICompletionsModelClient({
          ...config,
          fetch: serve(
            () =>
              new Response(
                JSON.stringify({
                  id: 'chatcmpl-1',
                  object: 'chat.completion',
                  created: 0,
                  model: 'test-model',
                  choices: [
                    {
                      index: 0,
                      finish_reason: 'tool_calls',
                      message: {
                        role: 'assistant',
                        tool_calls: [
                          {
                            id: 'call-1',
                            type: 'function',
                            function: {
                              name: 'title',
                              arguments: JSON.stringify({ title: 'Hello' }),
                            },
                          },
                        ],
                      },
                    },
                  ],
                }),
                {
                  status: 200,
                  headers: { 'content-type': 'application/json' },
                },
              ),
          ),
        }),
    });

    if (client.generateObject === undefined) {
      throw new TypeError(
        'expected the Chat Completions client to generate objects',
      );
    }

    const generated = await client.generateObject({
      chat: { id: 'chat-test', lane: 'title' },
      messages,
      schema: z.object({ title: z.string() }),
      schemaName: 'title',
    });

    expect(generated).toEqual({ title: 'Hello' });
  });
});
