import type { ModelMessage, streamText } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import type { createOpenAI } from '@ai-sdk/openai';

import { ProviderFailure } from './provider-failure/provider-failure';
import {
  CODEX_RESPONSES_BASE_URL,
  createOpenAICodexModelClient,
} from './openai-codex-model-client';
import type { ChatIdentity } from './model-client';
import { createAssistantPartCollector } from '../runs/assistant-transcript';

const messages = [
  { role: 'user', content: 'Use the configured transport.' },
] satisfies Array<ModelMessage>;

/**
 * The Chat identity every input carries (design D3). It is a fact the client
 * receives: nothing in this suite asserts that a client reads it.
 */
const CHAT: ChatIdentity = { id: 'chat-test', lane: 'main' };
const SEARCH_CHAT: ChatIdentity = { id: 'c1', lane: 'search' };

/** The product token llame's boot-read identity supplies to every client. */
const USER_AGENT = 'llame/0.0.0-test';

describe('createOpenAICodexModelClient', () => {
  it('discards a broken title send before releasing the recovered text', async () => {
    let calls = 0;

    const fetchMock = vi.fn<typeof globalThis.fetch>(() => {
      calls += 1;

      const events = [
        'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"message","id":"item-1"}}\n\n',
        `data: ${JSON.stringify({ type: 'response.output_text.delta', item_id: 'item-1', delta: calls === 1 ? 'Discard this title.' : 'Recovered title' })}\n\n`,
        ...(calls === 1
          ? []
          : [
              'data: {"type":"response.completed","response":{"incomplete_details":null,"usage":{"input_tokens":1,"output_tokens":1}}}\n\n',
            ]),
      ];

      return Promise.resolve(
        new Response(events.join(''), {
          headers: { 'content-type': 'text/event-stream' },
        }),
      );
    });

    const previousFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;

    try {
      const client = createOpenAICodexModelClient({
        credential: 'access-token',
        accountId: 'account-id',
        providerModelId: 'gpt-test',
        modelId: 'system:codex:gpt-test',
        contextWindowTokens: 128_000,
        userAgent: USER_AGENT,
        requestHeaders: {},
      });

      const onRetry = vi.fn();

      await expect(
        client.streamText({ chat: CHAT, messages, onRetry }).text,
      ).resolves.toBe('Recovered title');
      expect(calls).toBe(2);
      expect(onRetry).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'stream_broken', retry: 1 }),
      );
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it.each([
    [{}, CHAT, null],
    [{ 'X-Session-Id': ['', ''] }, CHAT, CHAT.id],
    [{ 'X-Session-Id': ['', ''] }, SEARCH_CHAT, 'search:c1'],
  ] as const)(
    'sends the default or configured session header through the wrapped Responses client',
    async (requestHeaders, chat, expectedSessionId) => {
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
          userAgent: USER_AGENT,
          requestHeaders,
        });

        await expect(client.streamText({ chat, messages }).text).resolves.toBe(
          'done',
        );

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
        const [, init] = fetchMock.mock.calls[0] ?? [];
        expect(new Headers(init?.headers).get('x-session-id')).toBe(
          expectedSessionId,
        );
      } finally {
        globalThis.fetch = previousFetch;
      }
    },
  );

  it("carries the configured product token on the request's user-agent (design D6)", async () => {
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
        userAgent: 'llame/9.9.9-canary',
        requestHeaders: {},
      });

      await expect(
        client.streamText({ chat: CHAT, messages }).text,
      ).resolves.toBe('done');

      const [, init] = fetchMock.mock.calls[0] ?? [];
      const headers = new Headers(init?.headers);
      // The per-call header on the serialized request: llame's token leads,
      // while the transport's own fixed provider-level headers survive beside
      // it.
      expect(headers.get('user-agent')).toMatch(/^llame\/9\.9\.9-canary( |$)/);
      expect(headers.get('chatgpt-account-id')).toBe('account-id');
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
        userAgent: USER_AGENT,
        requestHeaders: {},
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
        client.streamText({ chat: CHAT, messages: replayedMessages }).text,
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
        userAgent: USER_AGENT,
        requestHeaders: {},
      });

      const onReasoningDelta = vi.fn();
      const collector = createAssistantPartCollector();

      await expect(
        client.streamText({
          chat: CHAT,
          messages,
          onReasoningDelta,
          onTextDelta: (text, partId, providerMetadata) =>
            collector.text(text, partId, providerMetadata),
        }).text,
      ).resolves.toBe('done');

      // `store: false` on a reasoning model requests the encrypted reasoning
      // content that this response then binds to the item's own parts.
      expect(JSON.stringify(fetchMock.mock.calls)).toContain(
        String.raw`\"include\":[\"reasoning.encrypted_content\"]`,
      );
      // Every delivery the Responses stream made for the item, once, in stream
      // order: each summary's start, its text, and the end that concludes it
      // (the item's last end carries the encryption this request asked for),
      // with the wire's `${itemId}:${summaryIndex}` id scoped to the provider
      // step that produced it.
      const itemMetadata = { openai: { itemId: 'rs_1' } };
      await vi.waitFor(() => expect(onReasoningDelta).toHaveBeenCalledTimes(6));
      expect(onReasoningDelta.mock.calls).toEqual([
        [
          '',
          '0:rs_1:0',
          { openai: { itemId: 'rs_1', reasoningEncryptedContent: null } },
        ],
        ['think', '0:rs_1:0', itemMetadata],
        ['', '0:rs_1:0', itemMetadata],
        [
          '',
          '0:rs_1:1',
          { openai: { itemId: 'rs_1', reasoningEncryptedContent: null } },
        ],
        ['more', '0:rs_1:1', itemMetadata],
        [
          '',
          '0:rs_1:1',
          { openai: { itemId: 'rs_1', reasoningEncryptedContent: 'enc-1' } },
        ],
      ]);
      // The same consumer carries the text part's id and metadata through the
      // delegation to the Responses client (design A7), so the reply stores
      // the item id the live step sent.
      expect(collector.parts()).toMatchObject([{ type: 'text', text: 'done' }]);
      expect(JSON.stringify(collector.parts())).toContain('"itemId":"item-1"');
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
        userAgent: USER_AGENT,
        requestHeaders: {},
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

      await expect(
        client.streamText({ chat: CHAT, messages }).text,
      ).resolves.toBe('done');

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
          userAgent: USER_AGENT,
          requestHeaders: {},
        },
        { createOpenAI: createOpenAIMock, streamText: streamTextMock },
      );

      client.streamText({ chat: CHAT, messages, effort: 'high' });

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
      const [streamOptions] = streamTextMock.mock.calls.at(0) ?? [];
      expect(streamOptions).toMatchObject({
        // The client wraps the wire's model in its own middlewares, so
        // identity is the adapter's own provider and model id.
        model: { provider: 'openai.responses', modelId: 'gpt-test' },
        providerOptions: {
          openai: {
            reasoningSummary: 'auto',
            reasoningEffort: 'high',
            store: false,
          },
        },
      });

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
        userAgent: USER_AGENT,
        requestHeaders: {},
      },
      { createOpenAI: createOpenAIMock, streamText: streamTextMock },
    );

    const result = client.streamText({ chat: CHAT, messages });
    await expect(result.text).rejects.toMatchObject({
      name: 'ProviderFailure',
      message: 'Codex subscription request failed.',
    });
    await expect(result.text).rejects.toBeInstanceOf(ProviderFailure);
    await expect(result.text).rejects.not.toThrow(secret);
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
          userAgent: USER_AGENT,
          requestHeaders: {},
          ...config,
        },
        { createOpenAI: createOpenAIMock, streamText: streamTextMock },
      );

      return { client, streamTextMock };
    }

    it('exposes billing on the built client only when it is configured', () => {
      expect(build({ billing: 'subscription' }).client.billing).toBe(
        'subscription',
      );
      expect(build().client).not.toHaveProperty('billing');
    });

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

      client.streamText({ chat: CHAT, messages, effort: 'high' });

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

      client.streamText({ chat: CHAT, messages });

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

      client.streamText({ chat: CHAT, messages });

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

  it('carries the declared input on the client, and no key without one', () => {
    const config = {
      credential: 'access-token',
      accountId: 'account-id',
      providerModelId: 'gpt-test',
      modelId: 'system:codex:gpt-test',
      contextWindowTokens: 128_000,
      userAgent: USER_AGENT,
      requestHeaders: {},
    };

    expect(
      createOpenAICodexModelClient({ ...config, input: ['text', 'image'] })
        .input,
    ).toEqual(['text', 'image']);
    expect(createOpenAICodexModelClient(config)).not.toHaveProperty('input');
  });
});
