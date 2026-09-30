/**
 * The stream-idle watchdog (design D4) driven through the real AI SDK
 * `streamText`, so the window it arms, resets, and clears is the one a
 * provider request actually runs under. Every case uses fake timers, because
 * the window is 300 seconds long.
 */
import type {
  LanguageModelV3,
  LanguageModelV3StreamPart,
} from '@ai-sdk/provider';
import {
  simulateReadableStream,
  streamText,
  tool,
  type ModelMessage,
  type StreamTextOnErrorCallback,
} from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { z } from 'zod';

import type { ModelStreamInput } from './model-client';
import { applyToolCallingOptions } from './openai-model-client';
import {
  applyStreamIdleWatchdog,
  ModelStreamIdleError,
  STREAM_IDLE_TIMEOUT_MS,
} from './stream-idle-watchdog';

const messages = [
  { role: 'user', content: 'Read the stream.' },
] satisfies Array<ModelMessage>;

const CHAT = { id: 'chat-idle', lane: 'main' } as const;

const USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

function textParts(text: string): Array<LanguageModelV3StreamPart> {
  return [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: 'answer' },
    { type: 'text-delta', id: 'answer', delta: text },
    { type: 'text-end', id: 'answer' },
    {
      type: 'finish',
      finishReason: { unified: 'stop', raw: undefined },
      usage: USAGE,
    },
  ];
}

/** A provider stream that yields `parts` and then never produces another. */
function stallingAfter(parts: Array<LanguageModelV3StreamPart>) {
  return new ReadableStream<LanguageModelV3StreamPart>({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
    },
  });
}

function watched(model: LanguageModelV3, input: ModelStreamInput) {
  const streamOptions = {
    model,
    messages,
    abortSignal: input.abortSignal,
    onError: input.onError,
  };
  applyStreamIdleWatchdog(streamOptions, input);
  const result = streamText(streamOptions);
  // The SDK rejects every accessor of a stream that ended without output.
  // Only `text` is read below, so the rest are drained here.
  for (const accessor of [
    result.steps,
    result.finishReason,
    result.rawFinishReason,
    result.totalUsage,
  ]) {
    void Promise.resolve(accessor).catch(() => undefined);
  }
  return result;
}

function model(
  modelId: string,
  doStream: () => Promise<{
    stream: ReadableStream<LanguageModelV3StreamPart>;
  }>,
) {
  return new MockLanguageModelV3({ provider: 'idle-test', modelId, doStream });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('applyStreamIdleWatchdog', () => {
  it('fails a request whose provider never answers, and aborts its read', async () => {
    const stalled = model(
      'stalled-headers',
      () => new Promise<never>(() => undefined),
    );
    const onError = vi.fn<StreamTextOnErrorCallback>();
    const input: ModelStreamInput = { chat: CHAT, messages, onError };

    // Attached before the clock moves, so the SDK's own no-output rejection
    // is observed here rather than surfacing as an unhandled one.
    const settled = Promise.resolve(watched(stalled, input).text).catch(
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(STREAM_IDLE_TIMEOUT_MS);

    // The provider's own read is cancelled, so nothing hangs behind the
    // failure, and the error is llame's — not the abort the link produced.
    expect(stalled.doStreamCalls[0]?.abortSignal?.aborted).toBe(true);
    expect(await settled).toBeInstanceOf(Error);
    expect(onError.mock.calls[0]?.[0].error).toBeInstanceOf(
      ModelStreamIdleError,
    );
  });

  it('reports a stall after an output part to onError, and still finishes', async () => {
    const stalled = model('stalled-parts', () =>
      Promise.resolve({
        stream: stallingAfter([
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 'answer' },
          { type: 'text-delta', id: 'answer', delta: 'partial' },
        ]),
      }),
    );
    const onError = vi.fn<StreamTextOnErrorCallback>();

    const result = watched(stalled, { chat: CHAT, messages, onError });
    await vi.advanceTimersByTimeAsync(STREAM_IDLE_TIMEOUT_MS);

    expect(onError.mock.calls[0]?.[0].error).toBeInstanceOf(
      ModelStreamIdleError,
    );
    // The result still settles terminally, and keeps what the provider did
    // send. An errored stream instead of an `error` part would leave the Run
    // non-terminal, and the job would retry it from the start.
    await expect(result.finishReason).resolves.toBe('error');
    await expect(Promise.resolve(result.text)).resolves.toBe('partial');
  });

  it('leaves a stream whose parts keep arriving alone', async () => {
    const steady = model('steady', () =>
      Promise.resolve({
        // Nine gaps of 100 s: three times the window in total, never in a row.
        stream: simulateReadableStream({
          chunks: textParts('steady'),
          initialDelayInMs: 100_000,
          chunkDelayInMs: 100_000,
        }),
      }),
    );

    const text = watched(steady, { chat: CHAT, messages }).text;
    await vi.advanceTimersByTimeAsync(900_000);

    await expect(text).resolves.toBe('steady');
  });

  it('stops watching once the run aborts', async () => {
    const abort = new AbortController();
    // The provider never answers, so the watchdog's window is the only thing
    // that could end this request: a watchdog that outlived the run's abort
    // would fail it a full window later.
    const hanging = model('aborted', () => new Promise<never>(() => undefined));
    const onError = vi.fn<StreamTextOnErrorCallback>();
    const result = watched(hanging, {
      chat: CHAT,
      messages,
      abortSignal: abort.signal,
      onError,
    });
    void Promise.resolve(result.text).catch(() => undefined);

    await vi.advanceTimersByTimeAsync(0);
    abort.abort();
    await vi.advanceTimersByTimeAsync(STREAM_IDLE_TIMEOUT_MS);

    expect(onError).not.toHaveBeenCalled();
  });

  it('does not count a long tool between two requests as provider silence', async () => {
    let request = 0;
    const scripted = model('long-tool', () => {
      request += 1;
      return Promise.resolve({
        stream: simulateReadableStream({
          chunks:
            request <= 2
              ? [
                  { type: 'stream-start', warnings: [] } as const,
                  {
                    type: 'tool-call' as const,
                    toolCallId: `call-${request}`,
                    toolName: 'wait',
                    input: '{}',
                  },
                  {
                    type: 'finish' as const,
                    finishReason: {
                      unified: 'tool-calls' as const,
                      raw: undefined,
                    },
                    usage: USAGE,
                  },
                ]
              : textParts('answered'),
        }),
      });
    });
    const slowTool = tool({
      inputSchema: z.object({}),
      execute: async () => {
        await vi.advanceTimersByTimeAsync(400_000);
        return 'tool result';
      },
    });
    const input: ModelStreamInput = {
      chat: CHAT,
      messages,
      tools: { wait: slowTool },
      maxSteps: null,
    };
    const streamOptions = { model: scripted, messages };
    applyToolCallingOptions(streamOptions, input);
    applyStreamIdleWatchdog(streamOptions, input);

    const text = streamText(streamOptions).text;
    await vi.advanceTimersByTimeAsync(1_200_000);

    await expect(text).resolves.toBe('answered');
    expect(request).toBe(3);
  });
});
