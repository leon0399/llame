import {
  simulateReadableStream,
  streamText,
  type LanguageModelUsage,
} from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import type { LanguageModelV3StreamPart } from '@ai-sdk/provider';

import type { ModelClient, ModelStreamInput } from './model-client';
import { wrapStreamTextResult } from './stream-text-result-proxy';

/** Default for `resolveCompletion`/`rejectCompletion` before the completion Promise executor below replaces them. */
function noop(): void {}

export const ZERO_USAGE: LanguageModelUsage = {
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

/** The canned event sequence for a completed fake response. */
function fakeResponseChunks(
  response: string,
): Array<LanguageModelV3StreamPart> {
  const chunks: Array<LanguageModelV3StreamPart> = [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: 'fake-response' },
  ];
  if (response.length > 0) {
    chunks.push({ type: 'text-delta', id: 'fake-response', delta: response });
  }
  chunks.push(
    { type: 'text-end', id: 'fake-response' },
    {
      type: 'finish',
      finishReason: { unified: 'stop', raw: undefined },
      usage: {
        inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 0, text: 0, reasoning: 0 },
      },
    },
  );
  return chunks;
}

/** Forwards only the tool options the caller actually supplied. */
function resolveToolOptions(
  input: ModelStreamInput,
): Pick<Parameters<typeof streamText>[0], 'tools' | 'toolChoice'> {
  const toolOptions: Pick<
    Parameters<typeof streamText>[0],
    'tools' | 'toolChoice'
  > = {};
  if (input.tools) {
    toolOptions.tools = input.tools;
    if (input.toolChoice !== undefined) {
      toolOptions.toolChoice = input.toolChoice;
    }
  }
  return toolOptions;
}

interface FakeStreamOutcome {
  handlers: Pick<
    Parameters<typeof streamText>[0],
    'onChunk' | 'onError' | 'onFinish'
  >;
  /** Resolves once `input.onError`/`input.onFinish` has settled. */
  completion: Promise<void>;
}

/** Wires `input`'s callbacks and a completion signal settled once they run. */
function createFakeStreamOutcome(input: ModelStreamInput): FakeStreamOutcome {
  let resolveCompletion: () => void = noop;
  let rejectCompletion: (reason?: unknown) => void = noop;
  const completion = new Promise<void>((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });

  return {
    completion,
    handlers: {
      onChunk: ({ chunk }) => {
        if (chunk.type === 'text-delta') {
          input.onTextDelta?.(chunk.text);
        } else if (chunk.type === 'reasoning-delta') {
          input.onReasoningDelta?.(chunk.text);
        }
      },
      onError: async (event) => {
        try {
          await input.onError?.(event);
          resolveCompletion();
        } catch (error) {
          rejectCompletion(error);
        }
      },
      onFinish: async (event) => {
        try {
          await input.onFinish?.({
            text: event.text,
            usage: ZERO_USAGE,
            finishReason: event.finishReason,
          });
          resolveCompletion();
        } catch (error) {
          rejectCompletion(error);
        }
      },
    },
  };
}

/**
 * Creates a fake model client that cycles through preset text responses.
 *
 * @param responses - The text responses returned by successive `streamText` calls
 * @returns A model client that streams the provided responses in order
 */
export function createFakeModelClient(
  responses: Array<string>,
  contextWindowTokens = 128_000,
): ModelClient {
  let responseIndex = 0;

  return {
    model: 'fake-model',
    provider: 'fake',
    contextWindowTokens,
    streamText(input: ModelStreamInput) {
      const response =
        responses.length === 0
          ? ''
          : responses[responseIndex++ % responses.length];
      const { handlers, completion } = createFakeStreamOutcome(input);

      const result = streamText({
        model: new MockLanguageModelV3({
          provider: 'fake',
          modelId: 'fake-model',
          doStream: () =>
            Promise.resolve({
              stream: simulateReadableStream({
                chunks: fakeResponseChunks(response),
              }),
            }),
        }),
        messages: input.messages,
        system: input.system,
        abortSignal: input.abortSignal,
        ...resolveToolOptions(input),
        ...handlers,
      });

      return wrapStreamTextResult(result, {
        text: (target) => ({
          value: Promise.all([target.text, completion]).then(([text]) => text),
        }),
      });
    },
  };
}
