import { RetryError, type ModelMessage, type streamText } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import type { createOpenAI } from '@ai-sdk/openai';

import {
  CODEX_RESPONSES_BASE_URL,
  createOpenAICodexModelClient,
} from './openai-codex-model-client';

const messages = [
  { role: 'user', content: 'Use the configured transport.' },
] satisfies Array<ModelMessage>;

describe('createOpenAICodexModelClient', () => {
  it('serializes a self-contained non-stored Responses request through the real SDK', async () => {
    const fetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          [
            'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"message","id":"item-1"}}\n\n',
            'data: {"type":"response.output_text.delta","item_id":"item-1","delta":"done"}\n\n',
            'data: {"type":"response.completed","response":{"incomplete_details":null,"usage":{"input_tokens":1,"output_tokens":1}}}\n\n',
            'data: [DONE]\n\n',
          ].join(''),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      );
    const previousFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    try {
      const client = createOpenAICodexModelClient({
        credential: 'access-token',
        accountId: 'account-id',
        providerModelId: 'gpt-test',
        modelId: 'system:codex:gpt-test',
        contextWindowTokens: 128_000,
      });

      await expect(client.streamText({ messages }).text).resolves.toBe('done');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://chatgpt.com/backend-api/codex/responses',
        expect.anything(),
      );
      const serializedCall = JSON.stringify(fetchMock.mock.calls);
      expect(serializedCall).toContain(String.raw`\"model\":\"gpt-test\"`);
      expect(serializedCall).toContain(String.raw`\"stream\":true`);
      expect(serializedCall).toContain(String.raw`\"store\":false`);
      expect(serializedCall).not.toContain('item_reference');
      expect(serializedCall).not.toContain('previous_response_id');
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it('replays a persisted tool call and result with its original call id', async () => {
    const fetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          [
            'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"message","id":"item-2"}}\n\n',
            'data: {"type":"response.output_text.delta","item_id":"item-2","delta":"continued"}\n\n',
            'data: {"type":"response.completed","response":{"incomplete_details":null,"usage":{"input_tokens":1,"output_tokens":1}}}\n\n',
            'data: [DONE]\n\n',
          ].join(''),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      );
    const previousFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    try {
      const client = createOpenAICodexModelClient({
        credential: 'access-token',
        accountId: 'account-id',
        providerModelId: 'gpt-test',
        modelId: 'system:codex:gpt-test',
        contextWindowTokens: 128_000,
      });
      const replayedMessages: Array<ModelMessage> = [
        { role: 'user', content: 'Find the answer.' },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'call-persisted',
              toolName: 'lookup',
              input: { query: 'answer' },
            },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'call-persisted',
              toolName: 'lookup',
              output: { type: 'text', value: '42' },
            },
          ],
        },
        { role: 'user', content: 'Continue from that result.' },
      ];

      await expect(
        client.streamText({ messages: replayedMessages }).text,
      ).resolves.toBe('continued');

      const serializedCall = JSON.stringify(fetchMock.mock.calls);
      expect(serializedCall).toContain('function_call');
      expect(serializedCall).toContain('function_call_output');
      expect(serializedCall).toContain('call-persisted');
      expect(serializedCall).not.toContain('item_reference');
      expect(serializedCall).not.toContain('previous_response_id');
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it('carries each reasoning part and its item metadata off the non-stored stream', async () => {
    const fetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          [
            'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"reasoning","id":"rs_1","encrypted_content":null}}\n\n',
            'data: {"type":"response.reasoning_summary_part.added","item_id":"rs_1","summary_index":0}\n\n',
            'data: {"type":"response.reasoning_summary_text.delta","item_id":"rs_1","summary_index":0,"delta":"think"}\n\n',
            'data: {"type":"response.reasoning_summary_part.done","item_id":"rs_1","summary_index":0}\n\n',
            'data: {"type":"response.reasoning_summary_part.added","item_id":"rs_1","summary_index":1}\n\n',
            'data: {"type":"response.reasoning_summary_text.delta","item_id":"rs_1","summary_index":1,"delta":"more"}\n\n',
            'data: {"type":"response.reasoning_summary_part.done","item_id":"rs_1","summary_index":1}\n\n',
            'data: {"type":"response.output_item.done","output_index":0,"item":{"type":"reasoning","id":"rs_1","encrypted_content":"enc-1"}}\n\n',
            'data: {"type":"response.output_item.added","output_index":1,"item":{"type":"message","id":"item-1"}}\n\n',
            'data: {"type":"response.output_text.delta","item_id":"item-1","delta":"done"}\n\n',
            'data: {"type":"response.completed","response":{"incomplete_details":null,"usage":{"input_tokens":1,"output_tokens":1}}}\n\n',
            'data: [DONE]\n\n',
          ].join(''),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      );
    const previousFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    try {
      const client = createOpenAICodexModelClient({
        credential: 'access-token',
        accountId: 'account-id',
        providerModelId: 'gpt-5-codex',
        modelId: 'system:codex:gpt-5-codex',
        contextWindowTokens: 128_000,
      });
      const onReasoningDelta = vi.fn();

      await expect(
        client.streamText({ messages, onReasoningDelta }).text,
      ).resolves.toBe('done');

      // `store: false` on a reasoning model requests the encrypted reasoning
      // content that this response then binds to the item's own parts.
      expect(JSON.stringify(fetchMock.mock.calls)).toContain(
        String.raw`\"include\":[\"reasoning.encrypted_content\"]`,
      );
      await vi.waitFor(() =>
        expect(
          onReasoningDelta.mock.calls.filter((call) => call.length === 3),
        ).toHaveLength(2),
      );
      // The Responses wire ids every summary `${itemId}:${summaryIndex}`, so
      // each summary persists as its own part.
      expect(
        onReasoningDelta.mock.calls.filter((call) => call.length === 2),
      ).toEqual([
        ['think', 'rs_1:0'],
        ['more', 'rs_1:1'],
      ]);
      expect(
        onReasoningDelta.mock.calls.filter((call) => call.length === 3),
      ).toEqual([
        ['', 'rs_1:0', { openai: { itemId: 'rs_1' } }],
        [
          '',
          'rs_1:1',
          { openai: { itemId: 'rs_1', reasoningEncryptedContent: 'enc-1' } },
        ],
      ]);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it('composes the catalog cap and the invariants into the real request body', async () => {
    const fetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          [
            'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"message","id":"item-1"}}\n\n',
            'data: {"type":"response.output_text.delta","item_id":"item-1","delta":"done"}\n\n',
            'data: {"type":"response.completed","response":{"incomplete_details":null,"usage":{"input_tokens":1,"output_tokens":1}}}\n\n',
            'data: [DONE]\n\n',
          ].join(''),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      );
    const previousFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    try {
      const client = createOpenAICodexModelClient({
        credential: 'access-token',
        accountId: 'account-id',
        providerModelId: 'gpt-5-codex',
        modelId: 'system:codex:gpt-5-codex',
        contextWindowTokens: 128_000,
        providerOptions: {
          // The operator's raw wire field, its summary, its store, and a
          // reserved continuation key all disagree with the client's cap and
          // invariants; none of them may win.
          max_output_tokens: 1,
          reasoningSummary: 'concise',
          store: true,
          previousResponseId: 'resp_operator',
        },
        maxOutputTokens: 4321,
      });

      await expect(client.streamText({ messages }).text).resolves.toBe('done');

      expect(fetchMock).toHaveBeenCalledWith(
        `${CODEX_RESPONSES_BASE_URL}/responses`,
        expect.anything(),
      );
      const serializedCall = JSON.stringify(fetchMock.mock.calls);
      expect(serializedCall).toContain(String.raw`\"max_output_tokens\":4321`);
      expect(serializedCall).toContain(String.raw`\"store\":false`);
      expect(serializedCall).toContain(String.raw`\"summary\":\"auto\"`);
      expect(serializedCall).not.toContain(String.raw`\"max_output_tokens\":1`);
      expect(serializedCall).not.toContain(String.raw`\"summary\":\"concise\"`);
      expect(serializedCall).not.toContain('previous_response_id');
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it('uses the fixed Responses transport with private subscription headers and no remote storage', async () => {
    const providerModel = new MockLanguageModelV3({
      provider: 'openai.responses',
      modelId: 'gpt-test',
    });
    const chat = vi.fn(() => providerModel);
    const provider = Object.assign(
      vi.fn(() => providerModel),
      {
        chat,
      },
    );
    const createOpenAIMock = vi.mocked(vi.fn<typeof createOpenAI>(), {
      partial: true,
    });
    createOpenAIMock.mockReturnValue(provider);
    const streamTextMock = vi.mocked(vi.fn<typeof streamText>(), {
      partial: true,
    });
    streamTextMock.mockReturnValue({});
    const fetchMock = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(null, { status: 302 }));
    const previousFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    try {
      const client = createOpenAICodexModelClient(
        {
          credential: 'access-token',
          accountId: 'account-id',
          providerModelId: 'gpt-test',
          modelId: 'system:codex:gpt-test',
          contextWindowTokens: 128_000,
        },
        { createOpenAI: createOpenAIMock, streamText: streamTextMock },
      );

      client.streamText({ messages, effort: 'high' });

      expect(client).toMatchObject({
        model: 'system:codex:gpt-test',
        provider: 'openai-codex',
      });
      expect('generateObject' in client).toBe(false);
      expect(createOpenAIMock).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'access-token',
          baseURL: CODEX_RESPONSES_BASE_URL,
          headers: {
            'ChatGPT-Account-ID': 'account-id',
            Accept: 'text/event-stream',
            'OpenAI-Beta': 'responses=experimental',
            Originator: 'llame',
          },
        }),
      );
      expect(provider).toHaveBeenCalledWith('gpt-test');
      expect(chat).not.toHaveBeenCalled();
      expect(streamTextMock).toHaveBeenCalledWith(
        expect.objectContaining({
          model: providerModel,
          providerOptions: {
            openai: {
              reasoningSummary: 'auto',
              reasoningEffort: 'high',
              store: false,
            },
          },
        }),
      );

      const [createOptions] = createOpenAIMock.mock.calls.at(0) ?? [];
      const transportFetch = createOptions?.fetch;
      if (!transportFetch)
        throw new Error('expected a transport fetch wrapper');
      await transportFetch('https://redirect.example.test', {
        redirect: 'follow',
      });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://redirect.example.test',
        expect.objectContaining({ redirect: 'manual' }),
      );
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it('replaces an upstream authentication error before it reaches the run', async () => {
    const providerModel = new MockLanguageModelV3({
      provider: 'openai.responses',
      modelId: 'gpt-test',
    });
    const provider = Object.assign(
      vi.fn(() => providerModel),
      {
        chat: vi.fn(() => providerModel),
      },
    );
    const createOpenAIMock = vi.mocked(vi.fn<typeof createOpenAI>(), {
      partial: true,
    });
    createOpenAIMock.mockReturnValue(provider);
    const streamTextMock = vi.mocked(vi.fn<typeof streamText>(), {
      partial: true,
    });
    streamTextMock.mockReturnValue({});
    const onError = vi.fn();
    const secret = 'codex-access-token-canary';
    const client = createOpenAICodexModelClient(
      {
        credential: secret,
        accountId: 'account-id',
        providerModelId: 'gpt-test',
        modelId: 'system:codex:gpt-test',
        contextWindowTokens: 128_000,
      },
      { createOpenAI: createOpenAIMock, streamText: streamTextMock },
    );

    client.streamText({ messages, onError });
    const [options] = streamTextMock.mock.calls.at(0) ?? [];
    const upstreamError = Object.assign(
      new Error(`401 unauthorized: Bearer ${secret}`),
      { statusCode: 401 },
    );
    await options?.onError?.({ error: upstreamError });

    expect(onError).toHaveBeenCalledWith({
      error: new Error(
        'Codex subscription authentication failed. Re-login and restart llame.',
      ),
    });
    expect(JSON.stringify(onError.mock.calls)).not.toContain(secret);
  });

  it('reports a subscription limit without retaining the upstream response', async () => {
    const providerModel = new MockLanguageModelV3({
      provider: 'openai.responses',
      modelId: 'gpt-test',
    });
    const provider = Object.assign(
      vi.fn(() => providerModel),
      {
        chat: vi.fn(() => providerModel),
      },
    );
    const createOpenAIMock = vi.mocked(vi.fn<typeof createOpenAI>(), {
      partial: true,
    });
    createOpenAIMock.mockReturnValue(provider);
    const streamTextMock = vi.mocked(vi.fn<typeof streamText>(), {
      partial: true,
    });
    streamTextMock.mockReturnValue({});
    const onError = vi.fn();
    const secret = 'codex-quota-canary';
    const client = createOpenAICodexModelClient(
      {
        credential: 'access-token',
        accountId: 'account-id',
        providerModelId: 'gpt-test',
        modelId: 'system:codex:gpt-test',
        contextWindowTokens: 128_000,
      },
      { createOpenAI: createOpenAIMock, streamText: streamTextMock },
    );

    client.streamText({ messages, onError });
    const [options] = streamTextMock.mock.calls.at(0) ?? [];
    await options?.onError?.({
      error: Object.assign(new Error(`429 quota exceeded: ${secret}`), {
        statusCode: 429,
      }),
    });

    expect(onError).toHaveBeenCalledWith({
      error: new Error(
        'Codex subscription limit reached. Retry manually later.',
      ),
    });
    expect(JSON.stringify(onError.mock.calls)).not.toContain(secret);
  });

  it('sanitizes an upstream rejection from the stream result', async () => {
    const providerModel = new MockLanguageModelV3({
      provider: 'openai.responses',
      modelId: 'gpt-test',
    });
    const provider = Object.assign(
      vi.fn(() => providerModel),
      {
        chat: vi.fn(() => providerModel),
      },
    );
    const createOpenAIMock = vi.mocked(vi.fn<typeof createOpenAI>(), {
      partial: true,
    });
    createOpenAIMock.mockReturnValue(provider);
    const streamTextMock = vi.mocked(vi.fn<typeof streamText>(), {
      partial: true,
    });
    const secret = 'codex-result-error-canary';
    streamTextMock.mockReturnValue({
      text: Promise.reject(new Error(`provider failure: ${secret}`)),
    });
    const client = createOpenAICodexModelClient(
      {
        credential: 'access-token',
        accountId: 'account-id',
        providerModelId: 'gpt-test',
        modelId: 'system:codex:gpt-test',
        contextWindowTokens: 128_000,
      },
      { createOpenAI: createOpenAIMock, streamText: streamTextMock },
    );

    await expect(client.streamText({ messages }).text).rejects.toThrow(
      'Codex subscription request failed.',
    );
    await expect(client.streamText({ messages }).text).rejects.not.toThrow(
      secret,
    );
  });

  it('classifies a retry-exhausted quota error without exposing its details', async () => {
    const providerModel = new MockLanguageModelV3({
      provider: 'openai.responses',
      modelId: 'gpt-test',
    });
    const provider = Object.assign(
      vi.fn(() => providerModel),
      {
        chat: vi.fn(() => providerModel),
      },
    );
    const createOpenAIMock = vi.mocked(vi.fn<typeof createOpenAI>(), {
      partial: true,
    });
    createOpenAIMock.mockReturnValue(provider);
    const streamTextMock = vi.mocked(vi.fn<typeof streamText>(), {
      partial: true,
    });
    streamTextMock.mockReturnValue({});
    const onError = vi.fn();
    const secret = 'codex-retry-quota-canary';
    const client = createOpenAICodexModelClient(
      {
        credential: 'access-token',
        accountId: 'account-id',
        providerModelId: 'gpt-test',
        modelId: 'system:codex:gpt-test',
        contextWindowTokens: 128_000,
      },
      { createOpenAI: createOpenAIMock, streamText: streamTextMock },
    );

    client.streamText({ messages, onError });
    const [options] = streamTextMock.mock.calls.at(0) ?? [];
    await options?.onError?.({
      error: new RetryError({
        message: `retries exhausted: ${secret}`,
        reason: 'maxRetriesExceeded',
        errors: [
          Object.assign(new Error(`429 quota exceeded: ${secret}`), {
            statusCode: 429,
          }),
        ],
      }),
    });

    expect(onError).toHaveBeenCalledWith({
      error: new Error(
        'Codex subscription limit reached. Retry manually later.',
      ),
    });
    expect(JSON.stringify(onError.mock.calls)).not.toContain(secret);
  });

  describe('provider-options invariants (provider-options)', () => {
    function build(
      config: Partial<Parameters<typeof createOpenAICodexModelClient>[0]> = {},
    ) {
      const providerModel = new MockLanguageModelV3({
        provider: 'openai.responses',
        modelId: 'gpt-test',
      });
      const provider = Object.assign(
        vi.fn(() => providerModel),
        {
          chat: vi.fn(() => providerModel),
        },
      );
      const createOpenAIMock = vi.mocked(vi.fn<typeof createOpenAI>(), {
        partial: true,
      });
      createOpenAIMock.mockReturnValue(provider);
      const streamTextMock = vi.mocked(vi.fn<typeof streamText>(), {
        partial: true,
      });
      streamTextMock.mockReturnValue({});
      const client = createOpenAICodexModelClient(
        {
          credential: 'access-token',
          accountId: 'account-id',
          providerModelId: 'gpt-test',
          modelId: 'system:codex:gpt-test',
          contextWindowTokens: 128_000,
          ...config,
        },
        { createOpenAI: createOpenAIMock, streamText: streamTextMock },
      );
      return { client, streamTextMock };
    }

    // The subscription transport's invariants sit above the operator's
    // object (design D5): `store` stays false and the summary stays the
    // pinned display value, while the run's effort still overrides the
    // operator's. The reserved keys are stripped on this wire too.
    it('keeps store:false and the pinned summary over the operator object', () => {
      const { client, streamTextMock } = build({
        providerOptions: {
          store: true,
          reasoningSummary: 'concise',
          reasoningEffort: 'low',
          previousResponseId: 'resp_operator',
          allowedTools: { toolNames: ['hosted_search'], mode: 'required' },
        },
      });

      client.streamText({ messages, effort: 'high' });

      expect(streamTextMock).toHaveBeenCalledWith(
        expect.objectContaining({
          providerOptions: {
            openai: {
              reasoningSummary: 'auto',
              reasoningEffort: 'high',
              store: false,
            },
          },
        }),
      );
    });

    // A `null` removes a client default (design D5) but cannot reach an
    // invariant: both keys are re-set after the removal.
    it('cannot remove an invariant with an operator null', () => {
      const { client, streamTextMock } = build({
        providerOptions: { store: null, reasoningSummary: null },
      });

      client.streamText({ messages });

      expect(streamTextMock).toHaveBeenCalledWith(
        expect.objectContaining({
          providerOptions: {
            openai: { reasoningSummary: 'auto', store: false },
          },
        }),
      );
    });

    it('forwards the operator options and the catalog cap without the invariants losing', () => {
      const { client, streamTextMock } = build({
        providerOptions: { textVerbosity: 'low' },
        maxOutputTokens: 2048,
      });

      client.streamText({ messages });

      expect(streamTextMock).toHaveBeenCalledWith(
        expect.objectContaining({
          providerOptions: {
            openai: {
              reasoningSummary: 'auto',
              store: false,
              textVerbosity: 'low',
            },
          },
          maxOutputTokens: 2048,
        }),
      );
    });
  });
});
