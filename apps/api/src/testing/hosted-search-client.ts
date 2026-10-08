/**
 * A `ModelClient` double for hosted web search tests that runs the real AI SDK
 * `streamText` over a scripted provider stream, so a test observes the same
 * `text`, `sources`, `onError`, and abort behavior a production client has
 * without any vendor call. It records each `ModelStreamInput` it receives.
 */

import type {
  LanguageModelV3,
  LanguageModelV3FinishReason,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  LanguageModelV3Usage,
} from '@ai-sdk/provider';
import { streamText } from 'ai';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';

import type { ModelClient, ModelStreamInput } from '../models/model-client';

const USAGE = {
  inputTokens: {
    total: 1,
    noCache: 1,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
} satisfies LanguageModelV3Usage;
const STOP = {
  unified: 'stop',
  raw: undefined,
} satisfies LanguageModelV3FinishReason;

export type SourcePart = Extract<
  LanguageModelV3StreamPart,
  { readonly type: 'source' }
>;
type UrlSourcePart = Extract<SourcePart, { readonly sourceType: 'url' }>;
export type HostedStreamScript = LanguageModelV3['doStream'];

/** A URL source part, as a provider adapter emits for a cited or retrieved page. */
export function urlSourcePart(
  url: string,
  fields: Partial<Pick<UrlSourcePart, 'title' | 'providerMetadata'>> = {},
): UrlSourcePart {
  return { type: 'source', sourceType: 'url', id: url, url, ...fields };
}

/**
 * One provider step: the sources, then the answer text when any, then the
 * stream's own `failure` when given (an error event after the stream started).
 */
export function answerStream(
  text: string,
  sources: ReadonlyArray<SourcePart> = [],
  failure?: Error,
): LanguageModelV3StreamResult {
  const chunks: Array<LanguageModelV3StreamPart> = [
    { type: 'stream-start', warnings: [] },
    ...sources,
    ...(text.length > 0
      ? [
          { type: 'text-start' as const, id: 'answer' },
          { type: 'text-delta' as const, id: 'answer', delta: text },
          { type: 'text-end' as const, id: 'answer' },
        ]
      : []),
    ...(failure === undefined
      ? []
      : [{ type: 'error' as const, error: failure }]),
    { type: 'finish', finishReason: STOP, usage: USAGE },
  ];
  return { stream: simulateReadableStream({ chunks }) };
}

/**
 * A client whose provider answers by `script`. Retries are off, so a scripted
 * provider failure surfaces once, as the llame clients' own single attempt does.
 */
export function scriptedModelClient(
  script: HostedStreamScript,
  inputs: Array<ModelStreamInput> = [],
): ModelClient {
  return {
    model: 'hosted-test-model',
    provider: 'hosted-test',
    contextWindowTokens: 100_000,
    streamText(input) {
      inputs.push(input);
      return streamText({
        model: new MockLanguageModelV3({ doStream: script }),
        system: input.system,
        messages: input.messages,
        tools: input.tools,
        toolChoice: input.toolChoice,
        abortSignal: input.abortSignal,
        onError: input.onError,
        maxRetries: 0,
      });
    },
  };
}
