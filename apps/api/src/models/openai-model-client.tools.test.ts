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

import { createOpenAIModelClient } from './openai-model-client';

const tools = {
  echo: tool({
    inputSchema: z.object({ value: z.string() }).strict(),
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

function buildClient(model: MockLanguageModelV3, nativeOpenAI = false) {
  const provider = vi.fn<OpenAIProvider>();
  provider.mockReturnValue(model);
  provider.chat = vi.fn<OpenAIProvider['chat']>(() => model);

  return createOpenAIModelClient(
    {
      providerModelId: 'gpt-test',
      modelId: 'system:openai:gpt-test',
      contextWindowTokens: 128_000,
      nativeOpenAI,
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
          knowledgeSpaceId: z.string().uuid().optional(),
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
    const client = buildClient(model, true);
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

    expect(onTextDelta).toHaveBeenCalledWith('done');
    expect(onReasoningDelta).toHaveBeenCalledWith('think');
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
