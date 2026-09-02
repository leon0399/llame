import { tool, type ModelMessage } from 'ai';
import { z } from 'zod';

import { ScriptedModelsService } from './scripted-model-client';

const messages = [
  { role: 'user', content: 'Hello' },
] satisfies Array<ModelMessage>;

const sourceResult = {
  status: 'success' as const,
  results: [
    {
      kind: 'content' as const,
      chatId: '0b6f5499-dde4-43cf-89fe-037998a0fe64',
      messageSeq: 2,
      offset: 0,
      limit: 2,
    },
  ],
};

function recallTools() {
  return {
    search_conversations: tool({
      inputSchema: z.object({ query: z.string(), limit: z.number() }),
      execute: () => sourceResult,
    }),
    conversation_read: tool({
      inputSchema: z.object({
        chatId: z.string(),
        messageSeq: z.number(),
        offset: z.number().optional(),
        limit: z.number(),
      }),
      execute: () => ({ status: 'success' as const, nextOffset: 2 }),
    }),
  };
}

describe('ScriptedModelsService', () => {
  it('streams a complete answer, forwards deltas, and records the requested effort', async () => {
    const service = new ScriptedModelsService();
    service.register('complete', { kind: 'complete', text: 'hello' });
    const client = service.createClient('complete');
    const textDeltas: Array<string> = [];
    const finishes: Array<unknown> = [];

    await expect(
      client.streamText({
        messages,
        effort: 'high',
        onTextDelta: (text) => textDeltas.push(text),
        onFinish: (event) => {
          finishes.push(event);
        },
      }).text,
    ).resolves.toBe('hello');

    expect(textDeltas).toEqual(['hello']);
    expect(finishes).toHaveLength(1);
    expect(service.createClientCalls).toEqual([{ modelId: 'complete' }]);
    expect(service.streamCalls).toEqual([
      { modelId: 'complete', effort: 'high' },
    ]);
  });

  it.each([
    ['uses the default text', {}, 'ok', ['ok']],
    ['allows an empty completion', { text: '' }, '', []],
  ] as const)('%s', async (_name, options, expected, deltas) => {
    const service = new ScriptedModelsService();
    service.register('complete', { kind: 'complete', ...options });
    const observedDeltas: Array<string> = [];
    const finishes: Array<unknown> = [];

    await expect(
      service.createClient('complete').streamText({
        messages,
        onTextDelta: (text) => observedDeltas.push(text),
        onFinish: (event) => {
          finishes.push(event);
        },
      }).text,
    ).resolves.toBe(expected);
    expect(observedDeltas).toEqual(deltas);
    expect(finishes).toEqual([
      expect.objectContaining({ text: expected, finishReason: 'stop' }),
    ]);
  });

  it('completes after a configured delay when it is not aborted', async () => {
    vi.useFakeTimers();
    try {
      const service = new ScriptedModelsService();
      service.register('delayed', {
        kind: 'complete',
        text: 'later',
        delayMs: 1000,
      });
      const finishes: Array<unknown> = [];
      const result = service.createClient('delayed').streamText({
        messages,
        onFinish: (event) => {
          finishes.push(event);
        },
      });

      await vi.advanceTimersByTimeAsync(999);
      expect(finishes).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1);
      await expect(result.text).resolves.toBe('later');
      expect(finishes).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects a stream whose signal was already aborted', async () => {
    const service = new ScriptedModelsService();
    service.register('hang', { kind: 'hang' });
    const abort = new AbortController();
    abort.abort('already cancelled');

    await expect(
      service.createClient('hang').streamText({
        messages,
        abortSignal: abort.signal,
      }).text,
    ).rejects.toThrow(/Aborted|cancelled/iu);
  });

  it.each([
    ['missing behavior', 'missing', undefined],
    ['infrastructure failure', 'infra', { kind: 'infra-throw' as const }],
  ] as const)('fails closed for %s', (name, modelId, behavior) => {
    const service = new ScriptedModelsService();
    if (behavior !== undefined) service.register(modelId, behavior);

    expect(() => service.createClient(modelId)).toThrow(
      name === 'missing behavior'
        ? /no behavior registered/
        : /simulated infra failure/,
    );
  });

  it('uses a custom infrastructure failure and records the attempted model', () => {
    const service = new ScriptedModelsService();
    service.register('infra', {
      kind: 'infra-throw',
      message: 'fixture exploded',
    });

    expect(() => service.createClient('infra')).toThrow('fixture exploded');
    expect(service.createClientCalls).toEqual([{ modelId: 'infra' }]);
  });

  it('uses the configured provider-error message and exposes title/reasoning selections', async () => {
    const service = new ScriptedModelsService();
    service.register('provider-error', {
      kind: 'provider-error',
      message: 'provider unavailable',
    });
    service.registerReasoning('reasoning-model', {
      effortLevels: [{ value: 'low' }, { value: 'high' }],
      defaultEffort: 'low',
      cacheInvalidatedByEffortChange: false,
    });

    const error = vi.fn();
    await expect(
      service.createClient('provider-error').streamText({
        messages,
        onError: error,
      }).text,
    ).rejects.toThrow('No output generated');
    expect(error).toHaveBeenCalled();

    const selection = service.validateModelSelection('reasoning-model');
    expect(selection.reasoning).toEqual({
      effortLevels: [{ value: 'low' }, { value: 'high' }],
      defaultEffort: 'low',
      cacheInvalidatedByEffortChange: false,
    });
    expect(service.resolveEffortSelection(selection, undefined)).toBe('low');
    expect(service.resolveEffortSelection(selection, 'high')).toBe('high');
    expect(service.resolveTitleModelConfig()).toMatchObject({
      id: 'system:openai:gpt-5.4-nano',
      providerModelId: 'gpt-5.4-nano',
    });
  });

  it('executes a conversation-recall script through search, read, continuation, and final answer', async () => {
    const service = new ScriptedModelsService();
    service.register('recall', {
      kind: 'conversation-recall',
      query: 'needle',
      continueRead: true,
      finalText: 'source read',
    });
    const client = service.createClient('recall');

    await expect(
      client.streamText({
        messages,
        tools: recallTools(),
        maxSteps: 5,
      }).text,
    ).resolves.toBe('source read');
    expect(service.streamCalls).toEqual([
      { modelId: 'recall', effort: undefined },
    ]);
  });

  it('uses the default recall answer after one read', async () => {
    const service = new ScriptedModelsService();
    service.register('recall-default', {
      kind: 'conversation-recall',
      query: 'needle',
    });

    await expect(
      service.createClient('recall-default').streamText({
        messages,
        tools: recallTools(),
        maxSteps: 3,
      }).text,
    ).resolves.toBe('The source was read.');
  });

  it('finishes after an empty search result without requesting a read', async () => {
    const service = new ScriptedModelsService();
    service.register('empty-recall', {
      kind: 'conversation-recall',
      query: 'missing',
      finalText: 'nothing found',
    });
    const tools = recallTools();
    tools.search_conversations.execute = () => ({
      status: 'success' as const,
      results: [],
    });

    await expect(
      service.createClient('empty-recall').streamText({
        messages,
        tools,
      }).text,
    ).resolves.toBe('nothing found');
    expect(service.streamCalls).toHaveLength(1);
  });

  it('aborts a hanging stream and cancels a delayed completion', async () => {
    vi.useFakeTimers();
    try {
      const service = new ScriptedModelsService();
      service.register('hang', { kind: 'hang' });
      const abort = new AbortController();
      const hanging = service.createClient('hang').streamText({
        messages,
        abortSignal: abort.signal,
      }).text;
      abort.abort('cancelled');
      await expect(hanging).rejects.toThrow(/Aborted|cancelled/iu);

      service.register('delayed', {
        kind: 'complete',
        text: 'later',
        delayMs: 1000,
      });
      const delayedAbort = new AbortController();
      const delayed = service.createClient('delayed').streamText({
        messages,
        abortSignal: delayedAbort.signal,
      }).text;
      delayedAbort.abort();
      await expect(delayed).rejects.toThrow(/Aborted|cancelled/iu);
      await vi.runAllTimersAsync();
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns final text when a recall prompt contains invalid prior tool output', async () => {
    const service = new ScriptedModelsService();
    service.register('invalid-recall', {
      kind: 'conversation-recall',
      query: 'needle',
      finalText: 'closed',
    });
    const priorMessages: Array<ModelMessage> = [
      ...messages,
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'search-call',
            toolName: 'search_conversations',
            input: '{}',
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'search-call',
            toolName: 'search_conversations',
            output: { type: 'text', value: 'not-json' },
          },
        ],
      },
    ];

    await expect(
      service.createClient('invalid-recall').streamText({
        messages: priorMessages,
        tools: recallTools(),
      }).text,
    ).resolves.toBe('closed');
  });
});
