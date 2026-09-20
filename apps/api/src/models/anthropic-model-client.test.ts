/**
 * `createAnthropicModelClient` — construction, credentials, and the composed
 * request options (anthropic-provider 3.2, 3.3, 3.5, 3.6). Every fixture is
 * the exact body the pinned `@ai-sdk/anthropic` adapter POSTed (see
 * `anthropic-model-client.fixtures.ts`).
 */
import {
  buildClient,
  buildHarness,
  firstRequest,
  messageEnvelope,
  messages,
  textBlock,
} from './anthropic-model-client.fixtures';
import { ANTHROPIC_DEFAULT_BASE_URL } from './anthropic-model-client';
import { KEYLESS_PLACEHOLDER_API_KEY } from './openai-model-client';

const hello = messageEnvelope(textBlock(0, 'hello'));

describe('createAnthropicModelClient — construction (anthropic-provider 3.2, 3.3)', () => {
  it('uses the explicit Anthropic endpoint and sends the credential as x-api-key', async () => {
    const harness = buildHarness({ streamEvents: hello });
    const client = buildClient(harness);

    await expect(client.streamText({ messages }).text).resolves.toBe('hello');

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

    await expect(client.streamText({ messages }).text).resolves.toBe('hello');

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
      await expect(client.streamText({ messages }).text).resolves.toBe('hello');
    } finally {
      vi.unstubAllEnvs();
    }

    expect(firstRequest(harness).url).toBe(
      'https://api.z.ai/api/anthropic/messages',
    );
  });

  it('passes the keyless placeholder instead of omitting the api key', async () => {
    const harness = buildHarness({ streamEvents: hello });
    const client = buildClient(harness, { credential: undefined });

    await expect(client.streamText({ messages }).text).resolves.toBe('hello');

    expect(harness.settings[0]).toEqual({
      apiKey: KEYLESS_PLACEHOLDER_API_KEY,
      baseURL: ANTHROPIC_DEFAULT_BASE_URL,
    });
  });
});

describe('createAnthropicModelClient — effort and thinking defaults (3.5)', () => {
  it('carries a declared effort verbatim with the adaptive default and the drop instruction', async () => {
    const harness = buildHarness({ streamEvents: hello });
    const client = buildClient(harness);

    await expect(
      client.streamText({ messages, effort: 'high' }).text,
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
      client.streamText({ messages, effort: 'xhigh' }).text,
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

    await expect(client.streamText({ messages }).text).resolves.toBe('hello');

    const { body } = firstRequest(harness);
    expect(body['output_config']).toEqual({ effort: 'medium' });
    expect(body).not.toHaveProperty('thinking');
    expect(firstRequest(harness).headers.get('anthropic-beta')).toBeNull();
  });

  it('sends no thinking configuration and no effort by default on an entry without reasoning', async () => {
    const harness = buildHarness({ streamEvents: hello });
    const client = buildClient(harness, { reasoningDeclared: false });

    await expect(client.streamText({ messages }).text).resolves.toBe('hello');

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

    await expect(client.streamText({ messages }).text).resolves.toBe('hello');

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
      client.streamText({ messages, effort: 'high' }).text,
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
      client.streamText({ messages, effort: 'high' }).text,
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

      await expect(client.streamText({ messages }).text).resolves.toBe('hello');

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
        client.streamText({ messages: replayMessages }).text,
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

    await expect(client.streamText({ messages }).text).resolves.toBe('hello');

    // Not an empty object: the adapter's thinking union admits no such shape.
    expect(firstRequest(harness).body).not.toHaveProperty('thinking');
  });

  it('forwards an unrecognized option key without failing or retargeting', async () => {
    const harness = buildHarness({ streamEvents: hello });
    const client = buildClient(harness, {
      providerOptions: { future_option: { nested: [1, 2, 3] } },
    });

    await expect(client.streamText({ messages }).text).resolves.toBe('hello');

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

    await expect(client.streamText({ messages }).text).resolves.toBe('hello');

    expect(firstRequest(harness).body).not.toHaveProperty('cache_control');
  });

  it('replaces the default with the operator longer lifetime', async () => {
    const harness = buildHarness({ streamEvents: hello });
    const client = buildClient(harness, {
      providerOptions: { cacheControl: { type: 'ephemeral', ttl: '1h' } },
    });

    await expect(client.streamText({ messages }).text).resolves.toBe('hello');

    expect(firstRequest(harness).body['cache_control']).toEqual({
      type: 'ephemeral',
      ttl: '1h',
    });
  });

  it('completes against a gateway that ignores the option, with no cache tokens reported', async () => {
    const harness = buildHarness({ streamEvents: hello });
    const client = buildClient(harness);

    await expect(client.streamText({ messages }).text).resolves.toBe('hello');

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

    await expect(client.streamText({ messages }).text).resolves.toBe('hello');

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

      await expect(client.streamText({ messages }).text).resolves.toBe('hello');
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

    await expect(client.streamText({ messages }).text).resolves.toBe('hello');

    expect(firstRequest(harness).body['max_tokens']).toBe(64_000);
  });
});
