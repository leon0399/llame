/**
 * The fake streaming model client: a `ModelClient` double that drives the
 * real AI SDK `streamText` through a scripted, abort- and delay-aware
 * `MockLanguageModelV3`, plus the `ModelSelectionValidator` double
 * (`FakeModelsService`) HTTP-boundary suites inject alongside it. Split out
 * of `support.ts` (which re-exports these names) so each file stays under
 * the size trip-wire on its own.
 */

import type {
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
} from '@ai-sdk/provider';
import {
  streamText as sdkStreamText,
  type LanguageModelUsage,
  type ModelMessage,
} from 'ai';
import { MockLanguageModelV3 } from 'ai/test';

import { TITLE_SYSTEM_PROMPT } from '../titles/title';
import {
  MissingModelCredentialError,
  type ModelClient,
  type ModelStreamInput,
} from '../models/model-client';
import type { ModelReasoning, TokenPrice } from '../models/model-catalog';
import {
  ModelNotAvailableError,
  resolveEffortSelection,
  type ModelSelectionValidator,
} from '../models/models.service';
import { wrapStreamTextResult } from '../models/stream-text-result-proxy';

/** Default "nothing to unblock yet" value for the fake stream's abort race. */
const NOOP = () => undefined;

export type FakeTurn = {
  messages: Array<ModelMessage>;
  abortSignal?: AbortSignal;
  aborted: boolean;
};

function toProviderUsage(usage: LanguageModelUsage): LanguageModelV3Usage {
  return {
    inputTokens: {
      total: usage.inputTokens,
      noCache: usage.inputTokenDetails.noCacheTokens,
      cacheRead: usage.inputTokenDetails.cacheReadTokens,
      cacheWrite: usage.inputTokenDetails.cacheWriteTokens,
    },
    outputTokens: {
      total: usage.outputTokens,
      text: usage.outputTokenDetails.textTokens,
      reasoning: usage.outputTokenDetails.reasoningTokens,
    },
  };
}

const PROVIDER_ZERO_USAGE: LanguageModelV3Usage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
};

/** The canned event sequence for a completed title-generation turn. */
function titleResponseChunks(title: string): Array<LanguageModelV3StreamPart> {
  return [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: 'title' },
    { type: 'text-delta', id: 'title', delta: title },
    { type: 'text-end', id: 'title' },
    {
      type: 'finish',
      finishReason: { unified: 'stop', raw: undefined },
      usage: PROVIDER_ZERO_USAGE,
    },
  ];
}

/** The canned event sequence for a completed chat-answer turn. */
function answerResponseChunks(
  response: string,
  usage: LanguageModelV3Usage,
): Array<LanguageModelV3StreamPart> {
  const chunks: Array<LanguageModelV3StreamPart> = [
    { type: 'stream-start', warnings: [] },
    { type: 'text-start', id: 'answer' },
  ];
  if (response.length > 0) {
    chunks.push({ type: 'text-delta', id: 'answer', delta: response });
  }
  chunks.push(
    { type: 'text-end', id: 'answer' },
    {
      type: 'finish',
      finishReason: { unified: 'stop', raw: undefined },
      usage,
    },
  );
  return chunks;
}

interface CancelableDelay {
  promise: Promise<void>;
  cancel: () => void;
}

/** A `setTimeout`-backed delay that `cancel()` can resolve (and clear) early. */
function cancelableDelay(ms: number): CancelableDelay {
  let timer: ReturnType<typeof setTimeout>;
  let resolveDelay: () => void = NOOP;
  const promise = new Promise<void>((resolve) => {
    resolveDelay = resolve;
    timer = setTimeout(resolve, ms);
  });
  return {
    promise,
    cancel: () => {
      clearTimeout(timer);
      resolveDelay();
    },
  };
}

interface AnswerStreamOptions {
  abortSignal: AbortSignal | undefined;
  turn: FakeTurn;
  delayMs: number;
  response: string;
  usage: LanguageModelV3Usage;
}

/**
 * The abort- and delay-aware stream backing a canned chat-answer turn: waits
 * out `delayMs` (if set), then emits `answerResponseChunks`, unless
 * `abortSignal` fires first.
 */
function createAnswerStream(
  options: AnswerStreamOptions,
): ReadableStream<LanguageModelV3StreamPart> {
  const { abortSignal, turn, delayMs, response, usage } = options;
  return new ReadableStream<LanguageModelV3StreamPart>({
    async start(controller) {
      let delay: CancelableDelay | undefined;
      const onAbort = () => {
        turn.aborted = true;
        delay?.cancel();
        controller.error(new DOMException('Aborted', 'AbortError'));
      };
      if (abortSignal?.aborted) {
        onAbort();
        return;
      }
      abortSignal?.addEventListener('abort', onAbort, { once: true });

      try {
        if (delayMs > 0) {
          delay = cancelableDelay(delayMs);
          await delay.promise;
        }
        if (abortSignal?.aborted) {
          return;
        }
        for (const chunk of answerResponseChunks(response, usage)) {
          controller.enqueue(chunk);
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      } finally {
        abortSignal?.removeEventListener('abort', onAbort);
      }
    },
  });
}

/**
 * The abort-aware stream backing a canned title-generation turn: resolves
 * `titleResponse` and emits `titleResponseChunks`, unless `abortSignal` fires
 * first.
 */
function createTitleStream(
  abortSignal: AbortSignal | undefined,
  titleResponse: string | Promise<string>,
): ReadableStream<LanguageModelV3StreamPart> {
  return new ReadableStream<LanguageModelV3StreamPart>({
    start(controller) {
      const onAbort = () => {
        controller.error(new DOMException('Aborted', 'AbortError'));
      };
      if (abortSignal?.aborted) {
        onAbort();
        return;
      }
      abortSignal?.addEventListener('abort', onAbort, { once: true });

      void Promise.resolve(titleResponse)
        .then((title) => {
          if (abortSignal?.aborted) {
            return;
          }
          for (const chunk of titleResponseChunks(title)) {
            controller.enqueue(chunk);
          }
          controller.close();
        })
        .catch((error: unknown) => {
          if (!abortSignal?.aborted) {
            controller.error(error);
          }
        })
        .finally(() => {
          abortSignal?.removeEventListener('abort', onAbort);
        });
    },
  });
}

export interface AbortSettlement {
  /** Bind directly to `streamText`'s `onAbort` handler. */
  onAbort: () => void;
  /** Await after the SDK result settles; rethrows a failed abort-time `onError`. */
  wait: () => Promise<void>;
}

/**
 * Tracks the async settlement of the `onError` call `streamText` fires when
 * `abortSignal` triggers, so callers can await it (and surface its rejection)
 * after the stream itself has settled. Also used by `scripted-model-client.ts`
 * (`worker-harness.ts`'s scripted double), which shares this exact idiom.
 */
export function trackAbortSettlement(input: ModelStreamInput): AbortSettlement {
  let settlement = Promise.resolve();
  let settlementError: { error: unknown } | undefined;
  return {
    onAbort: () => {
      settlement = Promise.resolve(
        input.onError?.({
          error: input.abortSignal?.reason ?? new Error('aborted'),
        }),
      ).catch((error: unknown) => {
        settlementError = { error };
      });
    },
    wait: async () => {
      await settlement;
      if (settlementError) {
        throw settlementError.error;
      }
    },
  };
}

/** Forwards only the tool options the caller actually supplied. */
function resolveToolOptions(
  input: ModelStreamInput,
): Pick<ModelStreamInput, 'tools' | 'toolChoice'> {
  const toolOptions: Pick<ModelStreamInput, 'tools' | 'toolChoice'> = {};
  if (input.tools) {
    toolOptions.tools = input.tools;
    if (input.toolChoice !== undefined) {
      toolOptions.toolChoice = input.toolChoice;
    }
  }
  return toolOptions;
}

/** The `streamText` event handlers backing a canned chat-answer turn. */
function answerStreamHandlers(
  input: ModelStreamInput,
  settlement: AbortSettlement,
  onFinishCall: () => void,
): Pick<
  Parameters<typeof sdkStreamText>[0],
  'onChunk' | 'onError' | 'onAbort' | 'onFinish'
> {
  return {
    onChunk: ({ chunk }) => {
      if (chunk.type === 'text-delta') {
        input.onTextDelta?.(chunk.text);
      } else if (chunk.type === 'reasoning-delta') {
        input.onReasoningDelta?.(chunk.text, chunk.id);
      }
    },
    onError: (event) => {
      if (!input.abortSignal?.aborted) {
        return input.onError?.(event);
      }
    },
    onAbort: settlement.onAbort,
    onFinish: async ({ text, usage: actualUsage, finishReason }) => {
      onFinishCall();
      await input.onFinish?.({
        text,
        usage: actualUsage,
        finishReason,
      });
    },
  };
}

/** Makes `result`'s `consumeStream`/`text` also await the abort settlement. */
export function awaitSettlementAfter(
  result: ReturnType<typeof sdkStreamText>,
  settlement: AbortSettlement,
): ReturnType<typeof sdkStreamText> {
  return wrapStreamTextResult(result, {
    consumeStream: (target) => ({
      value: async (...args: Parameters<typeof target.consumeStream>) => {
        await target.consumeStream(...args);
        await settlement.wait();
      },
    }),
    text: (target) => ({
      value: (async () => {
        try {
          return await target.text;
        } finally {
          await settlement.wait();
        }
      })(),
    }),
  });
}

export class FakeStreamingModelClient {
  readonly turns: Array<FakeTurn> = [];
  // Title-generation calls (#78) are tracked separately: they are async post-turn
  // work, so counting them in `turns` would make every chat-turn assertion racy.
  readonly titleTurns: Array<Array<ModelMessage>> = [];
  titleResponse: string | Promise<string> = 'Generated Title';
  readonly model = 'system:openai:gpt-5.4-mini';
  readonly provider = 'openai';
  readonly contextWindowTokens = 128_000;
  // Mirrors the formerly-hardcoded gpt-5.4-mini catalog pricing so cost
  // assertions built against this fake keep exercising the real cost
  // calculation path (providers-and-models-as-code, #167).
  pricing: TokenPrice | undefined = {
    inputUsdPer1M: 0.75,
    cachedInputUsdPer1M: 0.075,
    outputUsdPer1M: 4.5,
  };
  // Per-model compaction override (#167): unset by default (falls back to
  // contextWindowTokens x ratio); a spec that wants cheap/aggressive
  // compaction sets this directly instead of the removed
  // COMPACTION_TOKEN_THRESHOLD env var.
  compactionThresholdTokens: number | undefined;
  responses: Array<string> = ['fake assistant'];
  usage: LanguageModelUsage = {
    inputTokens: 3,
    inputTokenDetails: {
      noCacheTokens: 1,
      cacheReadTokens: 2,
      cacheWriteTokens: 0,
    },
    cachedInputTokens: 2,
    outputTokens: 5,
    outputTokenDetails: { textTokens: 4, reasoningTokens: 1 },
    totalTokens: 8,
    reasoningTokens: 1,
  };
  delayMs = 0;
  onFinishCalls = 0;

  streamText(input: ModelStreamInput): ReturnType<typeof sdkStreamText> {
    if (input.system === TITLE_SYSTEM_PROMPT) {
      return this.streamTitleText(input);
    }
    return this.streamAnswerText(input);
  }

  private streamTitleText(
    input: ModelStreamInput,
  ): ReturnType<typeof sdkStreamText> {
    this.titleTurns.push(input.messages);
    const titleResponse = this.titleResponse;
    return sdkStreamText({
      model: new MockLanguageModelV3({
        provider: 'fake',
        modelId: this.model,
        doStream: ({ abortSignal }) =>
          Promise.resolve({
            stream: createTitleStream(abortSignal, titleResponse),
          }),
      }),
      messages: input.messages,
      system: input.system,
      abortSignal: input.abortSignal,
    });
  }

  private streamAnswerText(
    input: ModelStreamInput,
  ): ReturnType<typeof sdkStreamText> {
    const response =
      this.responses[this.turns.length] ?? this.responses[0] ?? '';
    const delayMs = this.delayMs;
    const usage = this.usage;
    const turn: FakeTurn = {
      messages: input.messages,
      abortSignal: input.abortSignal,
      aborted: false,
    };
    this.turns.push(turn);
    const settlement = trackAbortSettlement(input);
    const model = new MockLanguageModelV3({
      provider: 'fake',
      modelId: this.model,
      doStream: ({ abortSignal }) =>
        Promise.resolve({
          stream: createAnswerStream({
            abortSignal,
            turn,
            delayMs,
            response,
            usage: toProviderUsage(usage),
          }),
        }),
    });
    const result = sdkStreamText({
      model,
      messages: input.messages,
      system: input.system,
      abortSignal: input.abortSignal,
      ...resolveToolOptions(input),
      ...answerStreamHandlers(input, settlement, () => {
        this.onFinishCalls += 1;
      }),
    });

    return awaitSettlementAfter(result, settlement);
  }
}

/**
 * `implements ModelSelectionValidator` is load-bearing, not decoration: this
 * double is injected by Nest override, which is not structurally typechecked,
 * so a method added to the narrow contract would otherwise surface as a 500 in
 * the HTTP-boundary suites instead of a compile error here.
 */
export class FakeModelsService implements ModelSelectionValidator {
  credential: string | null = 'sk-test';
  readonly client = new FakeStreamingModelClient();
  readonly createClientCalls: Array<unknown> = [];

  resolveModelCredential(userId: string): string {
    if (!this.credential) {
      throw new MissingModelCredentialError(userId);
    }

    return this.credential;
  }

  /** Per-model reasoning vocabulary an HTTP-boundary test declares before sending. */
  private readonly reasoning = new Map<string, ModelReasoning>();

  registerReasoning(modelId: string, reasoning: ModelReasoning): void {
    this.reasoning.set(modelId, reasoning);
  }

  validateModelSelection(modelId: string) {
    if (!this.isAvailable(modelId)) {
      throw new ModelNotAvailableError(modelId);
    }
    const reasoning = this.reasoning.get(modelId);
    return {
      id: modelId,
      source: 'system' as const,
      contextWindowTokens: 128_000,
      provider: 'openai',
      providerModelId: 'test-provider-model',
      systemPromptTemplate: `Test prompt for ${modelId}`,
      systemPromptSource: 'project_default' as const,
      ...(reasoning !== undefined && { reasoning }),
    };
  }

  /**
   * Delegates to the production resolver rather than restating its rules, so
   * the HTTP-boundary suites cannot pass while the real API rejects or accepts
   * a different set of levels.
   */
  resolveEffortSelection(
    model: Parameters<typeof resolveEffortSelection>[0],
    requested: string | undefined,
  ): string | undefined {
    return resolveEffortSelection(model, requested);
  }

  resolveTitleModelConfig() {
    return {
      id: 'system:openai:gpt-5.4-nano',
      source: 'system',
      provider: 'openai',
      providerModelId: 'gpt-5.4-nano',
    };
  }

  createClient(modelId: string): ModelClient {
    this.createClientCalls.push({ modelId });
    const client = this.client;

    return {
      get model() {
        return modelId;
      },
      provider: client.provider,
      contextWindowTokens: client.contextWindowTokens,
      ...(client.pricing !== undefined && { pricing: client.pricing }),
      ...(client.compactionThresholdTokens !== undefined && {
        compactionThresholdTokens: client.compactionThresholdTokens,
      }),
      streamText: (input) => client.streamText(input),
    } satisfies ModelClient;
  }

  private isAvailable(modelId: string): boolean {
    return [
      'system:openai:gpt-5.5',
      'system:openai:gpt-5.4',
      'system:openai:gpt-5.4-mini',
      'system:openai:gpt-5.4-nano',
      'system:openai:gpt-4o',
      'system:openai:gpt-4o-mini',
    ].includes(modelId);
  }
}
