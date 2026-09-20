/**
 * Tool-loop plumbing in `createOpenAIModelClient`. The OpenAI provider factory
 * is replaced at its provider boundary; AI SDK `streamText`, step scheduling,
 * tool validation, and repair callbacks remain real.
 */
import type { OpenAIProvider } from '@ai-sdk/openai';
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';
import {
  simulateReadableStream,
  streamText,
  tool,
  type ModelMessage,
} from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { z } from 'zod';

import { type ModelObjectInput } from './model-client';
import { createOpenAIModelClient } from './openai-model-client';
import { createAssistantPartCollector } from '../runs/assistant-transcript';

const tools = {
  echo: tool({
    inputSchema: z.strictObject({ value: z.string() }),
    execute: ({ value }) => value,
  }),
};

const messages = [
  { role: 'user', content: 'Use the available tools.' },
] satisfies Array<ModelMessage>;

const PROVIDER_USAGE = {
  inputTokens: {
    total: 0,
    noCache: 0,
    cacheRead: 0,
    cacheWrite: 0,
  },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};

function providerResponse(
  content: Array<LanguageModelV3StreamPart>,
  finishReason: 'stop' | 'tool-calls',
) {
  return {
    stream: simulateReadableStream<LanguageModelV3StreamPart>({
      chunks: [
        { type: 'stream-start', warnings: [] },
        ...content,
        {
          type: 'finish',
          finishReason: { unified: finishReason, raw: undefined },
          usage: PROVIDER_USAGE,
        },
      ],
    }),
  };
}

function textResponse(text = 'done') {
  return providerResponse(
    [
      { type: 'text-start', id: 'answer' },
      { type: 'text-delta', id: 'answer', delta: text },
      { type: 'text-end', id: 'answer' },
    ],
    'stop',
  );
}

function toolResponse(calls: Array<{ toolName: string; input: string }>) {
  return providerResponse(
    calls.map((call, index) => ({
      type: 'tool-call',
      toolCallId: `call-${index}`,
      toolName: call.toolName,
      input: call.input,
    })),
    'tool-calls',
  );
}

function scriptedModel(responses: Array<ReturnType<typeof providerResponse>>) {
  let responseIndex = 0;
  return new MockLanguageModelV3({
    provider: 'openai.test',
    modelId: 'gpt-test',
    doStream: () => {
      const response = responses[responseIndex++];
      if (!response) {
        throw new Error(`Missing provider response ${responseIndex}`);
      }
      return Promise.resolve(response);
    },
  });
}

function buildClient(model: MockLanguageModelV3) {
  const provider = vi.fn<OpenAIProvider>();
  provider.mockReturnValue(model);

  return createOpenAIModelClient(
    {
      providerModelId: 'gpt-test',
      modelId: 'system:openai:gpt-test',
      contextWindowTokens: 128_000,
    },
    { createOpenAI: () => provider, streamText },
  );
}

describe('createOpenAIModelClient — abort handling', () => {
  it.each(['consumeStream', 'text'] as const)(
    'maps abort onto ModelClient error settlement before %s settles',
    async (consumer) => {
      let providerStarted: () => void = () => undefined;
      const started = new Promise<void>((resolve) => {
        providerStarted = resolve;
      });
      let errorStarted: () => void = () => undefined;
      const errorStartedPromise = new Promise<void>((resolve) => {
        errorStarted = resolve;
      });
      let releaseError: () => void = () => undefined;
      const errorSettlement = new Promise<void>((resolve) => {
        releaseError = resolve;
      });
      const model = new MockLanguageModelV3({
        provider: 'openai.test',
        modelId: 'gpt-test',
        doStream: ({ abortSignal }) =>
          Promise.resolve({
            stream: new ReadableStream<LanguageModelV3StreamPart>({
              start(controller) {
                providerStarted();
                abortSignal?.addEventListener(
                  'abort',
                  () =>
                    controller.error(new DOMException('Aborted', 'AbortError')),
                  { once: true },
                );
              },
            }),
          }),
      });
      const client = buildClient(model);
      const abort = new AbortController();
      const onError = vi.fn(async () => {
        errorStarted();
        await errorSettlement;
      });
      const result = client.streamText({
        messages,
        abortSignal: abort.signal,
        onError,
      });
      const consumption =
        consumer === 'consumeStream'
          ? result.consumeStream()
          : result.text.then(
              () => undefined,
              () => undefined,
            );
      let consumed = false;
      void consumption.then(() => {
        consumed = true;
      });

      await started;
      abort.abort('run-timeout');
      await errorStartedPromise;
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(consumed).toBe(false);
      releaseError();
      await consumption;

      expect(onError).toHaveBeenCalledWith({ error: 'run-timeout' });
    },
  );
});

describe('createOpenAIModelClient — step-cap enforcement (prepareStep)', () => {
  it('opts every function tool out of strict schema normalization', async () => {
    const model = scriptedModel([textResponse()]);
    const client = buildClient(model);
    const optionalTools = {
      knowledge_search: tool({
        inputSchema: z.object({
          query: z.string(),
          cursor: z.string().optional(),
        }),
      }),
      mcp__web__search: tool({
        inputSchema: z.object({
          query: z.string(),
          knowledgeSpaceId: z.guid().optional(),
        }),
      }),
    };

    await expect(
      client.streamText({ messages, tools: optionalTools }).text,
    ).resolves.toBe('done');

    expect(model.doStreamCalls[0]?.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'knowledge_search', strict: false }),
        expect.objectContaining({ name: 'mcp__web__search', strict: false }),
      ]),
    );
  });

  it('preserves provider-defined tools', async () => {
    const model = scriptedModel([textResponse()]);
    const client = buildClient(model);
    const providerTools = {
      hosted_search: tool({
        type: 'provider',
        id: 'openai.hosted_search',
        args: { mode: 'brief' },
        inputSchema: z.object({}),
      }),
    };

    await expect(
      client.streamText({ messages, tools: providerTools }).text,
    ).resolves.toBe('done');

    expect(model.doStreamCalls[0]?.tools).toEqual([
      {
        type: 'provider',
        name: 'hosted_search',
        id: 'openai.hosted_search',
        args: { mode: 'brief' },
      },
    ]);
  });

  it('forwards provider-neutral toolChoice to the AI SDK request', async () => {
    const model = scriptedModel([textResponse()]);
    const client = buildClient(model);

    await expect(
      client.streamText({ messages, tools, toolChoice: 'none' }).text,
    ).resolves.toBe('done');

    expect(model.doStreamCalls[0]?.toolChoice).toEqual({ type: 'none' });
  });

  it('leaves tools active while prior tool-requesting steps are under the cap', async () => {
    const model = scriptedModel([
      toolResponse([{ toolName: 'echo', input: '{"value":"first"}' }]),
      toolResponse([{ toolName: 'echo', input: '{"value":"second"}' }]),
      textResponse(),
    ]);
    const client = buildClient(model);
    const onCapReached = vi.fn();

    await expect(
      client.streamText({
        messages,
        tools,
        maxSteps: 3,
        onCapReached,
      }).text,
    ).resolves.toBe('done');

    expect(model.doStreamCalls).toHaveLength(3);
    expect(model.doStreamCalls[2]?.tools).toHaveLength(1);
    expect(onCapReached).not.toHaveBeenCalled();
  });

  it('disables tools and fires onCapReached when maxSteps prior tool-steps have run', async () => {
    const model = scriptedModel([
      toolResponse([{ toolName: 'echo', input: '{"value":"first"}' }]),
      toolResponse([{ toolName: 'echo', input: '{"value":"second"}' }]),
      textResponse(),
    ]);
    const client = buildClient(model);
    const onCapReached = vi.fn();

    await expect(
      client.streamText({
        messages,
        tools,
        maxSteps: 2,
        onCapReached,
      }).text,
    ).resolves.toBe('done');

    expect(model.doStreamCalls).toHaveLength(3);
    expect(model.doStreamCalls[2]?.tools).toEqual([]);
    expect(onCapReached).toHaveBeenCalledTimes(1);
  });

  it('counts parallel calls within one step as one step toward the cap', async () => {
    const model = scriptedModel([
      toolResponse([
        { toolName: 'echo', input: '{"value":"first"}' },
        { toolName: 'echo', input: '{"value":"second"}' },
        { toolName: 'echo', input: '{"value":"third"}' },
      ]),
      textResponse(),
    ]);
    const client = buildClient(model);
    const onCapReached = vi.fn();

    await expect(
      client.streamText({
        messages,
        tools,
        maxSteps: 2,
        onCapReached,
      }).text,
    ).resolves.toBe('done');

    expect(model.doStreamCalls).toHaveLength(2);
    expect(model.doStreamCalls[1]?.tools).toHaveLength(1);
    expect(onCapReached).not.toHaveBeenCalled();
  });

  it('uses maxSteps + 1 as a hard backstop after the forced final step', async () => {
    const model = scriptedModel(
      Array.from({ length: 3 }, (_, index) =>
        toolResponse([{ toolName: 'echo', input: `{"value":"${index}"}` }]),
      ),
    );
    const client = buildClient(model);

    await client.streamText({ messages, tools, maxSteps: 2 }).consumeStream();

    expect(model.doStreamCalls).toHaveLength(3);
    expect(model.doStreamCalls[2]?.tools).toEqual([]);
  });

  it('forwards text and reasoning chunks to their optional callbacks', async () => {
    const model = scriptedModel([
      providerResponse(
        [
          { type: 'reasoning-start', id: 'reasoning' },
          { type: 'reasoning-delta', id: 'reasoning', delta: 'think' },
          { type: 'reasoning-end', id: 'reasoning' },
          { type: 'text-start', id: 'answer' },
          { type: 'text-delta', id: 'answer', delta: 'done' },
          { type: 'text-end', id: 'answer' },
        ],
        'stop',
      ),
    ]);
    const client = buildClient(model);
    const onTextDelta = vi.fn();
    const onReasoningDelta = vi.fn();

    await expect(
      client.streamText({
        messages,
        onTextDelta,
        onReasoningDelta,
      }).text,
    ).resolves.toBe('done');

    // Exact call lists, not `toHaveBeenCalledWith`: each chunk must reach its
    // own callback exactly once, so a chunk routed to both cannot pass. The
    // adapter part id rides along to decide persisted part boundaries — scoped
    // to the provider step, because an adapter may number its parts per
    // response and restart at zero on a later step (design D18).
    expect(onTextDelta.mock.calls).toEqual([['done']]);
    expect(onReasoningDelta.mock.calls).toEqual([
      ['think', '0:reasoning', undefined],
    ]);
  });
});

describe('createOpenAIModelClient — reasoning provider metadata', () => {
  it('delivers every part of a reasoning item with its own metadata, in order', async () => {
    // Recorded Responses shape with `store: false`: a new summary of the same
    // reasoning item ends the previous, still-open summary immediately with
    // the item id alone, and the item's completion ends its last summary with
    // the id plus the encrypted content the request asked for.
    const model = scriptedModel([
      providerResponse(
        [
          {
            type: 'reasoning-start',
            id: 'rs_1:0',
            providerMetadata: {
              openai: { itemId: 'rs_1', reasoningEncryptedContent: null },
            },
          },
          {
            type: 'reasoning-delta',
            id: 'rs_1:0',
            delta: 'think',
            providerMetadata: { openai: { itemId: 'rs_1' } },
          },
          {
            type: 'reasoning-end',
            id: 'rs_1:0',
            providerMetadata: { openai: { itemId: 'rs_1' } },
          },
          {
            type: 'reasoning-start',
            id: 'rs_1:1',
            providerMetadata: {
              openai: { itemId: 'rs_1', reasoningEncryptedContent: null },
            },
          },
          {
            type: 'reasoning-delta',
            id: 'rs_1:1',
            delta: 'more',
            providerMetadata: { openai: { itemId: 'rs_1' } },
          },
          {
            type: 'reasoning-end',
            id: 'rs_1:1',
            providerMetadata: {
              openai: { itemId: 'rs_1', reasoningEncryptedContent: 'enc-1' },
            },
          },
          { type: 'text-start', id: 'answer' },
          { type: 'text-delta', id: 'answer', delta: 'done' },
          { type: 'text-end', id: 'answer' },
        ],
        'stop',
      ),
    ]);
    const client = buildClient(model);
    const collector = createAssistantPartCollector();
    const onTextDelta = vi.fn((text: string) => collector.text(text));

    await expect(
      client.streamText({
        messages,
        onTextDelta,
        // Feeds the collector exactly as the run's callback does: every
        // delivery carries its own id and metadata, and the part a summary
        // belongs to is decided by that id, never by arrival order.
        onReasoningDelta: (text, partId, providerMetadata) =>
          collector.reasoning(text, partId, providerMetadata),
      }).text,
    ).resolves.toBe('done');

    // Reading the whole reasoning channel off `fullStream` must not swallow
    // the stream the caller consumes: the text still resolves exactly once,
    // and every part's text and metadata arrive once, in stream order, under
    // the id scoped to this provider step.
    expect(onTextDelta.mock.calls).toEqual([['done']]);
    expect(collector.parts()).toEqual([
      {
        type: 'reasoning',
        text: 'think',
        providerMetadata: { openai: { itemId: 'rs_1' } },
      },
      {
        type: 'reasoning',
        text: 'more',
        providerMetadata: {
          openai: { itemId: 'rs_1', reasoningEncryptedContent: 'enc-1' },
        },
      },
      { type: 'text', text: 'done' },
    ]);
  });

  it('keeps the withheld blocks of consecutive steps apart when the adapter restarts their ids', async () => {
    // Anthropic numbers a response's content blocks from zero, so a tool turn
    // that withholds thinking text in two consecutive steps delivers two
    // different blocks as id `0`. The signature is what a later request
    // replays, so neither block may lose it to the other.
    const model = scriptedModel([
      providerResponse(
        [
          { type: 'reasoning-start', id: '0' },
          {
            type: 'reasoning-delta',
            id: '0',
            delta: '',
            providerMetadata: { anthropic: { signature: 'SIG_STEP_1' } },
          },
          { type: 'reasoning-end', id: '0' },
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'echo',
            input: '{"value":"first"}',
          },
        ],
        'tool-calls',
      ),
      providerResponse(
        [
          { type: 'reasoning-start', id: '0' },
          {
            type: 'reasoning-delta',
            id: '0',
            delta: '',
            providerMetadata: { anthropic: { signature: 'SIG_STEP_2' } },
          },
          { type: 'reasoning-end', id: '0' },
          { type: 'text-start', id: 'answer' },
          { type: 'text-delta', id: 'answer', delta: 'done' },
          { type: 'text-end', id: 'answer' },
        ],
        'stop',
      ),
    ]);
    const client = buildClient(model);
    const collector = createAssistantPartCollector();

    await expect(
      client.streamText({
        messages,
        tools,
        onTextDelta: (text) => collector.text(text),
        onReasoningDelta: (text, partId, providerMetadata) =>
          collector.reasoning(text, partId, providerMetadata),
      }).text,
    ).resolves.toBe('done');

    // Two parts, one per block, each with its own signature, in step order,
    // ahead of the answer the last step produced.
    expect(collector.parts()).toEqual([
      {
        type: 'reasoning',
        text: '',
        providerMetadata: { anthropic: { signature: 'SIG_STEP_1' } },
      },
      {
        type: 'reasoning',
        text: '',
        providerMetadata: { anthropic: { signature: 'SIG_STEP_2' } },
      },
      { type: 'text', text: 'done' },
    ]);
  });
});

describe('createOpenAIModelClient — unavailable/hallucinated tool call refusal', () => {
  it.each([
    {
      name: 'undeclared tool',
      toolName: 'not_a_real_tool',
      input: '{"x":1}',
      expectedInput: { x: 1 },
      reason: 'not_available',
    },
    {
      name: 'schema-invalid arguments',
      toolName: 'echo',
      input: '{"bad":true}',
      expectedInput: { bad: true },
      reason: 'invalid_input',
    },
    {
      name: 'malformed JSON',
      toolName: 'not_a_real_tool',
      input: 'not valid json{{{',
      expectedInput: 'not valid json{{{',
      reason: 'not_available',
    },
  ] as const)(
    'reports $reason for $name without crashing',
    async ({ toolName, input, expectedInput, reason }) => {
      const model = scriptedModel([
        toolResponse([{ toolName, input }]),
        textResponse('fallback'),
      ]);
      const client = buildClient(model);
      const onUnavailableToolCall = vi.fn();

      await expect(
        client.streamText({
          messages,
          tools,
          maxSteps: 4,
          onUnavailableToolCall,
        }).text,
      ).resolves.toBe('fallback');

      expect(onUnavailableToolCall).toHaveBeenCalledWith({
        toolCallId: 'call-0',
        toolName,
        input: expectedInput,
        reason,
      });
      expect(model.doStreamCalls).toHaveLength(2);
    },
  );
});

describe('createOpenAIModelClient — capability surface', () => {
  it('omits optional pricing and compaction keys the operator did not configure', () => {
    const client = buildClient(scriptedModel([textResponse()]));

    expect(client).not.toHaveProperty('pricing');
    expect(client).not.toHaveProperty('compactionThresholdTokens');
    expect(client.contextWindowTokens).toBe(128_000);
  });

  it('carries optional pricing and compaction keys through when configured', () => {
    const provider = vi.fn<OpenAIProvider>();
    provider.mockReturnValue(scriptedModel([textResponse()]));
    const client = createOpenAIModelClient(
      {
        providerModelId: 'gpt-test',
        modelId: 'system:openai:gpt-test',
        contextWindowTokens: 128_000,
        pricing: { inputUsdPer1M: 1, outputUsdPer1M: 2 },
        compactionThresholdTokens: 4000,
      },
      { createOpenAI: () => provider, streamText },
    );

    expect(client.pricing).toStrictEqual({
      inputUsdPer1M: 1,
      outputUsdPer1M: 2,
    });
    expect(client.compactionThresholdTokens).toBe(4000);
  });
});

describe('createOpenAIModelClient — delta callbacks', () => {
  it('streams text deltas when only the text callback is supplied', async () => {
    const client = buildClient(scriptedModel([textResponse('answer')]));
    const onTextDelta = vi.fn();

    await client.streamText({ messages, onTextDelta }).text;

    expect(onTextDelta.mock.calls).toEqual([['answer']]);
  });
});

describe('createOpenAIModelClient — abort settlement failures', () => {
  it('rethrows an error the abort handler itself raised', async () => {
    let providerStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      providerStarted = resolve;
    });
    const model = new MockLanguageModelV3({
      provider: 'openai.test',
      modelId: 'gpt-test',
      doStream: ({ abortSignal }) =>
        Promise.resolve({
          stream: new ReadableStream<LanguageModelV3StreamPart>({
            start(controller) {
              providerStarted();
              abortSignal?.addEventListener(
                'abort',
                () =>
                  controller.error(new DOMException('Aborted', 'AbortError')),
                { once: true },
              );
            },
          }),
        }),
    });
    const client = buildClient(model);
    const abort = new AbortController();
    const handlerFailure = new Error('error handler failed');
    const result = client.streamText({
      messages,
      abortSignal: abort.signal,
      onError: () => Promise.reject(handlerFailure),
    });
    const consumption = result.consumeStream();

    await started;
    abort.abort('run-timeout');

    // The handler's own failure must surface, not the abort it was handling.
    await expect(consumption).rejects.toBe(handlerFailure);
  });
});

describe('createOpenAIModelClient — structured output', () => {
  function objectClient(model: MockLanguageModelV3) {
    const provider = vi.fn<OpenAIProvider>();
    provider.mockReturnValue(model);
    const client = createOpenAIModelClient(
      {
        providerModelId: 'gpt-test',
        modelId: 'system:openai:gpt-test',
        contextWindowTokens: 128_000,
      },
      { createOpenAI: () => provider, streamText },
    );
    return { provider, client };
  }

  /**
   * `generateObject` is optional on ModelClient. Calling it through the client
   * keeps the receiver and the generic signature intact, which `bind` erases.
   */
  function objectGenerator(model: MockLanguageModelV3) {
    const { provider, client } = objectClient(model);
    return {
      provider,
      generate: <OBJECT>(input: ModelObjectInput<OBJECT>): Promise<OBJECT> => {
        if (!client.generateObject) {
          throw new Error('the OpenAI model client must expose generateObject');
        }
        return client.generateObject(input);
      },
    };
  }

  it('runs structured generation on the Responses model as a forced tool call', async () => {
    const model = new MockLanguageModelV3({
      provider: 'openai.responses',
      modelId: 'gpt-test',
      doGenerate: () =>
        Promise.resolve({
          content: [
            {
              type: 'tool-call',
              toolCallId: 'call-0',
              toolName: 'output',
              input: '{"title":"A title"}',
            },
          ],
          finishReason: { unified: 'tool-calls', raw: undefined },
          usage: PROVIDER_USAGE,
          warnings: [],
        }),
    });
    const { provider, generate } = objectGenerator(model);

    await expect(
      generate({
        messages,
        schema: z.object({ title: z.string() }),
      }),
    ).resolves.toEqual({ title: 'A title' });

    // Title generation follows the declared wire: the Responses model, never
    // a hardcoded Chat Completions one.
    expect(provider).toHaveBeenCalledWith('gpt-test');
    expect(model.doGenerateCalls[0]?.toolChoice).toEqual({
      type: 'tool',
      toolName: 'output',
    });
  });

  it('names the default output tool when the model answers with prose', async () => {
    const { generate: generateObject } = objectGenerator(
      new MockLanguageModelV3({
        provider: 'openai.test',
        modelId: 'gpt-test',
        doGenerate: () =>
          Promise.resolve({
            content: [{ type: 'text', text: 'not a tool call' }],
            finishReason: { unified: 'stop', raw: undefined },
            usage: PROVIDER_USAGE,
            warnings: [],
          }),
      }),
    );

    await expect(
      generateObject({
        messages,
        schema: z.object({ title: z.string() }),
      }),
    ).rejects.toThrow("Model did not produce a valid 'output' tool call");
  });

  it('names the caller-supplied output tool in the same failure', async () => {
    const { generate: generateObject } = objectGenerator(
      new MockLanguageModelV3({
        provider: 'openai.test',
        modelId: 'gpt-test',
        doGenerate: () =>
          Promise.resolve({
            content: [{ type: 'text', text: 'not a tool call' }],
            finishReason: { unified: 'stop', raw: undefined },
            usage: PROVIDER_USAGE,
            warnings: [],
          }),
      }),
    );

    await expect(
      generateObject({
        messages,
        schemaName: 'chat_title',
        schema: z.object({ title: z.string() }),
      }),
    ).rejects.toThrow("Model did not produce a valid 'chat_title' tool call");
  });
});
