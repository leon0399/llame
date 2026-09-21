/**
 * `createAnthropicModelClient` — construction, credentials, and the composed
 * request options (anthropic-provider 3.2, 3.3, 3.5, 3.6). Every fixture is
 * the exact body the pinned `@ai-sdk/anthropic` adapter POSTed (see the
 * shared test fixture).
 */
import {
  simulateReadableStream,
  streamText,
  type OnFinishEvent,
  type TextStreamPart,
  type ToolSet,
} from 'ai';

import {
  buildClient,
  buildHarness,
  firstRequest,
  messageEnvelope,
  messages,
  textBlock,
} from '../testing/anthropic-model-client-fixtures';
import { ANTHROPIC_DEFAULT_BASE_URL } from './anthropic-model-client';
import type { ChatIdentity } from './model-client';
import { KEYLESS_PLACEHOLDER_API_KEY } from './openai-model-client';

const hello = messageEnvelope(textBlock(0, 'hello'));

/**
 * The Chat identity every input carries (design D3). It is a fact the client
 * receives: nothing in this suite asserts that a client reads it.
 */
const CHAT: ChatIdentity = { id: 'chat-test', lane: 'main' };

const FINISH_USAGE = {
  inputTokens: 0,
  inputTokenDetails: {
    noCacheTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  },
  outputTokens: 0,
  outputTokenDetails: { textTokens: 0, reasoningTokens: 0 },
  totalTokens: 0,
};

const FINISH_EVENT = {
  stepNumber: 0,
  model: { provider: 'test', modelId: 'test' },
  functionId: undefined,
  metadata: undefined,
  experimental_context: undefined,
  content: [],
  text: '',
  reasoning: [],
  reasoningText: undefined,
  files: [],
  sources: [],
  toolCalls: [],
  staticToolCalls: [],
  dynamicToolCalls: [],
  toolResults: [],
  staticToolResults: [],
  dynamicToolResults: [],
  finishReason: 'stop',
  rawFinishReason: undefined,
  usage: FINISH_USAGE,
  warnings: undefined,
  request: {},
  response: {
    id: 'test',
    timestamp: new Date(0),
    modelId: 'test',
    messages: [],
  },
  providerMetadata: undefined,
  steps: [],
  totalUsage: FINISH_USAGE,
} satisfies OnFinishEvent<ToolSet>;

describe('createAnthropicModelClient — construction (anthropic-provider 3.2, 3.3)', () => {
  it('uses the explicit Anthropic endpoint and sends the credential as x-api-key', async () => {
    const harness = buildHarness({ streamEvents: hello });
    const client = buildClient(harness);

    await expect(
      client.streamText({ chat: CHAT, messages }).text,
    ).resolves.toBe('hello');

    expect(client).toMatchObject({
      model: 'system:anthropic:claude-opus-4-8',
      provider: 'anthropic-messages',
      contextWindowTokens: 200_000,
    });
    expect(harness.settings[0]).toEqual({
      apiKey: 'sk-test',
      baseURL: ANTHROPIC_DEFAULT_BASE_URL,
    });
    expect(firstRequest(harness).url).toBe(
      'https://api.anthropic.com/v1/messages',
    );
    expect(firstRequest(harness).headers.get('x-api-key')).toBe('sk-test');
  });

  it('targets a configured gateway base URL unchanged', async () => {
    const harness = buildHarness({ streamEvents: hello });
    const client = buildClient(harness, {
      baseUrl: 'https://api.z.ai/api/anthropic',
    });

    await expect(
      client.streamText({ chat: CHAT, messages }).text,
    ).resolves.toBe('hello');

    expect(firstRequest(harness).url).toBe(
      'https://api.z.ai/api/anthropic/messages',
    );
  });

  it('ignores an ambient ANTHROPIC_BASE_URL: the configured destination wins', async () => {
    const harness = buildHarness({ streamEvents: hello });
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://ambient.example.test');
    try {
      const client = buildClient(harness, {
        baseUrl: 'https://api.z.ai/api/anthropic',
      });
      await expect(
        client.streamText({ chat: CHAT, messages }).text,
      ).resolves.toBe('hello');
    } finally {
      vi.unstubAllEnvs();
    }

    expect(firstRequest(harness).url).toBe(
      'https://api.z.ai/api/anthropic/messages',
    );
  });

  it("carries the configured product token on the request's user-agent (design D6)", async () => {
    const harness = buildHarness({ streamEvents: hello });
    const client = buildClient(harness, {
      userAgent: 'llame/9.9.9-canary',
    });

    await expect(
      client.streamText({ chat: CHAT, messages }).text,
    ).resolves.toBe('hello');

    // The per-call header, on the serialized request the real adapter POSTed:
    // llame's token leads, and the SDK's own tokens follow it.
    expect(firstRequest(harness).headers.get('user-agent')).toMatch(
      /^llame\/9\.9\.9-canary( |$)/,
    );
  });

  it('passes the keyless placeholder instead of omitting the api key', async () => {
    const harness = buildHarness({ streamEvents: hello });
    const client = buildClient(harness, { credential: undefined });

    await expect(
      client.streamText({ chat: CHAT, messages }).text,
    ).resolves.toBe('hello');

    expect(harness.settings[0]).toEqual({
      apiKey: KEYLESS_PLACEHOLDER_API_KEY,
      baseURL: ANTHROPIC_DEFAULT_BASE_URL,
    });
  });

  it('carries the entry pricing and compaction threshold on the client', () => {
    const harness = buildHarness();
    const client = buildClient(harness, {
      pricing: { inputUsdPer1M: 3, outputUsdPer1M: 15 },
      compactionThresholdTokens: 64_000,
    });

    // Both ride the built client because a consumer reads them there: cost
    // telemetry prices a turn from `client.pricing`, and compaction sizes its
    // trigger from `client.compactionThresholdTokens`.
    expect(client.pricing).toStrictEqual({
      inputUsdPer1M: 3,
      outputUsdPer1M: 15,
    });
    expect(client.compactionThresholdTokens).toBe(64_000);
  });

  it('omits the pricing and compaction keys the entry did not declare', () => {
    const harness = buildHarness();
    const client = buildClient(harness);

    // Omitted, not present-as-undefined: the client's own shape mirrors the
    // entry's configuration, so an undeclared price or override leaves no key
    // behind.
    expect(client).not.toHaveProperty('pricing');
    expect(client).not.toHaveProperty('compactionThresholdTokens');
  });
});

describe('createAnthropicModelClient — effort and thinking defaults (3.5)', () => {
  it('carries a declared effort verbatim with the adaptive default and the drop instruction', async () => {
    const harness = buildHarness({ streamEvents: hello });
    const client = buildClient(harness);

    await expect(
      client.streamText({ chat: CHAT, messages, effort: 'high' }).text,
    ).resolves.toBe('hello');

    const { body } = firstRequest(harness);
    expect(body['output_config']).toEqual({ effort: 'high' });
    expect(body['thinking']).toEqual({
      type: 'adaptive',
      display: 'summarized',
      block_binding: { prefix_mismatch_behavior: 'drop_block' },
    });
    // The default lifetime travels top-level; no llame-authored content block
    // carries a cache marker.
    expect(body['cache_control']).toEqual({ type: 'ephemeral' });
    expect(JSON.stringify(body['messages'])).not.toContain('cache_control');
    expect(body['max_tokens']).toBe(128_000);
    expect(firstRequest(harness).headers.get('anthropic-beta')).toBe(
      'thinking-binding-controls-2026-08-01',
    );
  });

  it('lets the declared effort outrank an operator effort key', async () => {
    const harness = buildHarness({ streamEvents: hello });
    const client = buildClient(harness, {
      providerOptions: { effort: 'low' },
    });

    await expect(
      client.streamText({ chat: CHAT, messages, effort: 'xhigh' }).text,
    ).resolves.toBe('hello');

    expect(firstRequest(harness).body['output_config']).toEqual({
      effort: 'xhigh',
    });
  });

  it('forwards an operator effort when no vocabulary is declared, with no thinking configuration', async () => {
    const harness = buildHarness({ streamEvents: hello });
    const client = buildClient(harness, {
      reasoningDeclared: false,
      providerOptions: { effort: 'medium' },
    });

    await expect(
      client.streamText({ chat: CHAT, messages }).text,
    ).resolves.toBe('hello');

    const { body } = firstRequest(harness);
    expect(body['output_config']).toEqual({ effort: 'medium' });
    expect(body).not.toHaveProperty('thinking');
    expect(firstRequest(harness).headers.get('anthropic-beta')).toBeNull();
  });

  it('sends no thinking configuration and no effort by default on an entry without reasoning', async () => {
    const harness = buildHarness({ streamEvents: hello });
    const client = buildClient(harness, { reasoningDeclared: false });

    await expect(
      client.streamText({ chat: CHAT, messages }).text,
    ).resolves.toBe('hello');

    const { body } = firstRequest(harness);
    expect(body).not.toHaveProperty('thinking');
    expect(body).not.toHaveProperty('output_config');
    expect(body['cache_control']).toEqual({ type: 'ephemeral' });
  });

  it('removes the display default with {"thinking": {"display": null}} and keeps adaptive thinking and the binding', async () => {
    const harness = buildHarness({ streamEvents: hello });
    const client = buildClient(harness, {
      providerOptions: { thinking: { display: null } },
    });

    await expect(
      client.streamText({ chat: CHAT, messages }).text,
    ).resolves.toBe('hello');

    expect(firstRequest(harness).body['thinking']).toEqual({
      type: 'adaptive',
      block_binding: { prefix_mismatch_behavior: 'drop_block' },
    });
    expect(firstRequest(harness).headers.get('anthropic-beta')).toBe(
      'thinking-binding-controls-2026-08-01',
    );
  });

  it('carries a manual-budget override with the effort still set and no drop instruction', async () => {
    const harness = buildHarness({ streamEvents: hello });
    const client = buildClient(harness, {
      // An id off the adapter's own table: its `max_tokens` default is the
      // 128k `claude-` branch, and the manual budget is added to it silently
      // (D17's recorded transformation).
      providerModelId: 'claude-mythos-9',
      modelId: 'system:anthropic:claude-mythos-9',
      providerOptions: { thinking: { type: 'enabled', budgetTokens: 4096 } },
    });

    await expect(
      client.streamText({ chat: CHAT, messages, effort: 'high' }).text,
    ).resolves.toBe('hello');

    const { body } = firstRequest(harness);
    expect(body['thinking']).toEqual({ type: 'enabled', budget_tokens: 4096 });
    expect(body['output_config']).toEqual({ effort: 'high' });
    // The adapter cannot carry the binding on the manual shape (its union
    // strips it silently), so llame claims no drop behavior there.
    expect(firstRequest(harness).headers.get('anthropic-beta')).toBeNull();
    expect(body['max_tokens']).toBe(128_000 + 4096);
  });

  it('carries a disabled override with no drop instruction', async () => {
    const harness = buildHarness({ streamEvents: hello });
    const client = buildClient(harness, {
      providerOptions: { thinking: { type: 'disabled' } },
    });

    await expect(
      client.streamText({ chat: CHAT, messages, effort: 'high' }).text,
    ).resolves.toBe('hello');

    expect(firstRequest(harness).body['thinking']).toEqual({
      type: 'disabled',
    });
    expect(firstRequest(harness).headers.get('anthropic-beta')).toBeNull();
  });

  it('strips an operator block binding with or without a thinking type', async () => {
    const bindings = [
      { type: 'adaptive', blockBinding: { prefixMismatchBehavior: 'error' } },
      { blockBinding: { prefixMismatchBehavior: 'error' } },
      { blockBinding: null },
    ];
    for (const thinking of bindings) {
      const harness = buildHarness({ streamEvents: hello });
      const client = buildClient(harness, { providerOptions: { thinking } });

      await expect(
        client.streamText({ chat: CHAT, messages }).text,
      ).resolves.toBe('hello');

      // llame's own drop instruction survives on the adaptive shape; the
      // operator value never does.
      expect(firstRequest(harness).body['thinking']).toEqual({
        type: 'adaptive',
        display: 'summarized',
        block_binding: { prefix_mismatch_behavior: 'drop_block' },
      });
    }
  });

  it('replays signed thinking when an operator tries to disable sendReasoning', async () => {
    const replayMessages = [
      { role: 'user' as const, content: 'Start.' },
      {
        role: 'assistant' as const,
        content: [
          {
            type: 'reasoning' as const,
            text: 'prior thought',
            providerOptions: {
              anthropic: { signature: 'SIG_PREVIOUS' },
            },
          },
          { type: 'text' as const, text: 'Prior answer.' },
        ],
      },
      { role: 'user' as const, content: 'Continue.' },
    ];

    for (const sendReasoning of [false, null]) {
      const harness = buildHarness({ streamEvents: hello });
      const client = buildClient(harness, {
        providerOptions: { sendReasoning },
      });

      await expect(
        client.streamText({ chat: CHAT, messages: replayMessages }).text,
      ).resolves.toBe('hello');

      expect(firstRequest(harness).body['messages']).toEqual([
        {
          role: 'user',
          content: [{ type: 'text', text: 'Start.' }],
        },
        {
          role: 'assistant',
          content: [
            {
              type: 'thinking',
              thinking: 'prior thought',
              signature: 'SIG_PREVIOUS',
            },
            { type: 'text', text: 'Prior answer.' },
          ],
        },
        {
          role: 'user',
          content: [{ type: 'text', text: 'Continue.' }],
        },
      ]);
    }
  });

  it('sends no instruction-only thinking object when a stripped binding leaves nothing', async () => {
    const harness = buildHarness({ streamEvents: hello });
    const client = buildClient(harness, {
      reasoningDeclared: false,
      providerOptions: {
        thinking: { blockBinding: { prefixMismatchBehavior: 'error' } },
      },
    });

    await expect(
      client.streamText({ chat: CHAT, messages }).text,
    ).resolves.toBe('hello');

    // Not an empty object: the adapter's thinking union admits no such shape.
    expect(firstRequest(harness).body).not.toHaveProperty('thinking');
  });

  it('forwards an unrecognized option key without failing or retargeting', async () => {
    const harness = buildHarness({ streamEvents: hello });
    const client = buildClient(harness, {
      providerOptions: { future_option: { nested: [1, 2, 3] } },
    });

    await expect(
      client.streamText({ chat: CHAT, messages }).text,
    ).resolves.toBe('hello');

    // The adapter drops the unknown key under its own ceiling; the request
    // keeps the entry's model, the defaults, and the endpoint.
    const { body } = firstRequest(harness);
    expect(body['model']).toBe('claude-opus-4-8');
    expect(body['thinking']).toEqual({
      type: 'adaptive',
      display: 'summarized',
      block_binding: { prefix_mismatch_behavior: 'drop_block' },
    });
    expect(firstRequest(harness).url).toBe(
      'https://api.anthropic.com/v1/messages',
    );
  });
});

describe('createAnthropicModelClient — cache control default (3.6)', () => {
  it('omits the top-level cache control when the operator removes it with null', async () => {
    const harness = buildHarness({ streamEvents: hello });
    const client = buildClient(harness, {
      providerOptions: { cacheControl: null },
    });

    await expect(
      client.streamText({ chat: CHAT, messages }).text,
    ).resolves.toBe('hello');

    expect(firstRequest(harness).body).not.toHaveProperty('cache_control');
  });

  it('replaces the default with the operator longer lifetime', async () => {
    const harness = buildHarness({ streamEvents: hello });
    const client = buildClient(harness, {
      providerOptions: { cacheControl: { type: 'ephemeral', ttl: '1h' } },
    });

    await expect(
      client.streamText({ chat: CHAT, messages }).text,
    ).resolves.toBe('hello');

    expect(firstRequest(harness).body['cache_control']).toEqual({
      type: 'ephemeral',
      ttl: '1h',
    });
  });

  it('completes against a gateway that ignores the option, with no cache tokens reported', async () => {
    const harness = buildHarness({ streamEvents: hello });
    const client = buildClient(harness);

    await expect(
      client.streamText({ chat: CHAT, messages }).text,
    ).resolves.toBe('hello');

    // The envelope reports no cache_creation/cache_read usage: an endpoint
    // that ignores the option completes without cache reads and without a
    // failure.
    expect(firstRequest(harness).body['cache_control']).toEqual({
      type: 'ephemeral',
    });
  });
});

describe('createAnthropicModelClient — output limits (D17)', () => {
  it('forwards the catalog output limit as the streaming maxOutputTokens setting', async () => {
    const harness = buildHarness({ streamEvents: hello });
    const client = buildClient(harness, { maxOutputTokens: 2048 });

    await expect(
      client.streamText({ chat: CHAT, messages }).text,
    ).resolves.toBe('hello');

    expect(firstRequest(harness).body['max_tokens']).toBe(2048);
  });

  it('applies the adapter table for a recognized id, an unrecognized claude- id, and a non-claude- id', async () => {
    const cases = [
      { providerModelId: 'claude-opus-4-8', maxTokens: 128_000 },
      { providerModelId: 'claude-mythos-9', maxTokens: 128_000 },
      { providerModelId: 'glm-5', maxTokens: 4096 },
    ];
    for (const { providerModelId, maxTokens } of cases) {
      const harness = buildHarness({ streamEvents: hello });
      const client = buildClient(harness, {
        providerModelId,
        reasoningDeclared: false,
      });

      await expect(
        client.streamText({ chat: CHAT, messages }).text,
      ).resolves.toBe('hello');
      expect(firstRequest(harness).body['max_tokens']).toBe(maxTokens);
    }
  });

  it('lets the adapter lower a declared limit above a recognized ceiling', async () => {
    const harness = buildHarness({ streamEvents: hello });
    const client = buildClient(harness, {
      providerModelId: 'claude-sonnet-4-5',
      reasoningDeclared: false,
      maxOutputTokens: 200_000,
    });

    await expect(
      client.streamText({ chat: CHAT, messages }).text,
    ).resolves.toBe('hello');

    expect(firstRequest(harness).body['max_tokens']).toBe(64_000);
  });
});

describe('createAnthropicModelClient — reasoning channel settlement (D18)', () => {
  type Terminal = (
    options: Parameters<typeof streamText>[0],
  ) => void | Promise<void>;

  function buildRacingClient(terminal: Terminal, settlementFails = false) {
    const harness = buildHarness();
    const stream = vi.mocked(vi.fn<typeof streamText>(), { partial: true });
    stream.mockImplementation((options) => ({
      fullStream: simulateReadableStream<TextStreamPart<ToolSet>>({
        chunks: [
          {
            type: 'reasoning-start',
            id: '0',
            providerMetadata: { anthropic: { signature: null } },
          },
          { type: 'reasoning-delta', id: '0', text: 'deep thought' },
          {
            type: 'reasoning-end',
            id: '0',
            providerMetadata: { anthropic: { signature: 'SIG123' } },
          },
        ],
        chunkDelayInMs: 0,
      }),
      consumeStream: async () => {
        await terminal(options);
        if (settlementFails) throw new Error('stream settlement failed');
      },
    }));
    return buildClient({
      ...harness,
      dependencies: { ...harness.dependencies, streamText: stream },
    });
  }

  const runTimeout = new Error('run-timeout');
  const terminalPaths: Array<{
    path: string;
    terminal: Terminal;
    settlementFails?: boolean;
    abortSignal?: AbortSignal;
    callbackFailure?: Error;
    rejection?: string;
    expected: { callback: string; deliveries: number; message?: string };
  }> = [
    {
      path: "the adapter's finish callback",
      terminal: async (options) => {
        await options.onFinish?.(FINISH_EVENT);
      },
      expected: { callback: 'onFinish', deliveries: 3 },
    },
    {
      path: 'the abort settlement',
      terminal: async (options) => {
        await options.onAbort?.({ steps: [] });
      },
      abortSignal: AbortSignal.abort(runTimeout),
      expected: { callback: 'onError', deliveries: 3, message: 'run-timeout' },
    },
    {
      path: 'a failed stream settlement',
      terminal: (options) => {
        void options.onError?.({ error: new Error('upstream failed') });
      },
      settlementFails: true,
      rejection: 'Anthropic request failed.',
      expected: {
        callback: 'onError',
        deliveries: 3,
        message: 'Anthropic request failed.',
      },
    },
    {
      path: 'a failed terminal persistence callback',
      terminal: (options) => {
        void options.onError?.({ error: new Error('upstream failed') });
      },
      settlementFails: true,
      callbackFailure: new Error('terminal persistence failed'),
      rejection: 'terminal persistence failed',
      expected: {
        callback: 'onError',
        deliveries: 3,
        message: 'Anthropic request failed.',
      },
    },
  ];

  it.each(terminalPaths)(
    'runs $path only after the reasoning channel has landed',
    async ({
      terminal,
      settlementFails,
      abortSignal,
      callbackFailure,
      rejection,
      expected,
    }) => {
      const client = buildRacingClient(terminal, settlementFails === true);
      let deliveries = 0;
      const observed: Array<{
        callback: string;
        deliveries: number;
        message?: string;
      }> = [];

      const result = client.streamText({
        chat: CHAT,
        messages,
        ...(abortSignal !== undefined && { abortSignal }),
        onReasoningDelta: () => {
          deliveries += 1;
        },
        onFinish: () => {
          observed.push({ callback: 'onFinish', deliveries });
        },
        onError: ({ error }) => {
          observed.push({
            callback: 'onError',
            deliveries,
            ...(error instanceof Error && { message: error.message }),
          });
          if (callbackFailure !== undefined) throw callbackFailure;
        },
      });
      const settlement = result.consumeStream();

      if (rejection !== undefined) {
        await expect(settlement).rejects.toThrow(rejection);
      } else {
        await settlement;
      }
      expect(observed).toEqual([expected]);
    },
  );
});
