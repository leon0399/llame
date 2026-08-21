/**
 * Shared e2e test helpers. The session-cookie format, the AI SDK SSE event
 * shape, and the fake streaming model client are protocol facts each spec used
 * to restate — keep them in one place so a change (cookie name, stream event
 * schema, fake behavior) can't silently miss a copy.
 */

import { expect } from 'vitest';

import { isContextItemPart } from '../chats/context-item';
import { isTemporalPayload } from '../chats/context-item-producers';
import type request from 'supertest';
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
import type { TokenPrice } from '../models/model-catalog';
import { ModelNotAvailableError } from '../models/models.service';
import { wrapStreamTextResult } from '../models/stream-text-result-proxy';
import { isRecord } from '../unknown-record';

/**
 * Asserts a register (or any auth) response body carries `user.id` as a
 * string — the one shape assertion nearly every integration suite otherwise
 * re-derives inline right after registering a fixture user. Centralizing it
 * also gives the underlying `isRecord`/`typeof` narrowing a real type-guard
 * home (`allowInTypeGuards`), instead of a bare inline check.
 */
export function expectRegisteredUserId(
  body: unknown,
): asserts body is { user: { id: string } } {
  if (
    !isRecord(body) ||
    !isRecord(body.user) ||
    typeof body.user.id !== 'string'
  ) {
    throw new Error('Expected register response with user.id');
  }
}

/** Extracts the llame session cookie pair from a response, or '' when absent. */
export const cookieOf = (res: request.Response): string => {
  const set = res.get('Set-Cookie') ?? [];
  for (const c of set) {
    const m = /llame_session=([^;]+)/.exec(c);
    if (m) return `llame_session=${m[1]}`;
  }
  return '';
};

/**
 * Parses SSE data events into JSON values.
 *
 * @param body - The SSE payload to parse
 * @returns The parsed JSON values from each `data: ` event, excluding `[DONE]`
 */
export function parseSseEvents(body: string): unknown[] {
  // SAFETY: JSON.parse returns any; the final .map's assertion to unknown
  // forces callers to narrow before use rather than silently inheriting any.
  return (
    body
      .split('\n\n')
      // Per-line search within each frame: proper SSE frames can carry
      // `event:`/`id:` lines before `data:` (the run-event replay does),
      // not just the bare data-only frames the AI SDK stream emits.
      .map((event) =>
        event
          .trim()
          .split('\n')
          .find((line) => line.startsWith('data: ')),
      )
      .filter((line): line is string => line !== undefined)
      .map((line) => line.slice('data: '.length))
      .filter((data) => data !== '[DONE]')
      .map((data) => JSON.parse(data) as unknown)
  );
}

/**
 * Extracts streamed text content from an SSE payload.
 *
 * @returns The concatenated `delta` values from `text-delta` events.
 */
export function streamedText(body: string): string {
  return parseSseEvents(body)
    .filter(
      (event): event is { type: 'text-delta'; delta: string } =>
        isRecord(event) && event.type === 'text-delta',
    )
    .map((event) => event.delta)
    .join('');
}

export type FakeTurn = {
  messages: ModelMessage[];
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

export class FakeStreamingModelClient {
  readonly turns: FakeTurn[] = [];
  // Title-generation calls (#78) are tracked separately: they are async post-turn
  // work, so counting them in `turns` would make every chat-turn assertion racy.
  readonly titleTurns: ModelMessage[][] = [];
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
  responses: string[] = ['fake assistant'];
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
      this.titleTurns.push(input.messages);
      const titleResponse = this.titleResponse;
      return sdkStreamText({
        model: new MockLanguageModelV3({
          provider: 'fake',
          modelId: this.model,
          doStream: ({ abortSignal }) =>
            Promise.resolve({
              stream: new ReadableStream<LanguageModelV3StreamPart>({
                start(controller) {
                  const onAbort = () => {
                    controller.error(new DOMException('Aborted', 'AbortError'));
                  };
                  if (abortSignal?.aborted) {
                    onAbort();
                    return;
                  }
                  abortSignal?.addEventListener('abort', onAbort, {
                    once: true,
                  });

                  void Promise.resolve(titleResponse)
                    .then((title) => {
                      if (abortSignal?.aborted) {
                        return;
                      }
                      controller.enqueue({
                        type: 'stream-start',
                        warnings: [],
                      });
                      controller.enqueue({ type: 'text-start', id: 'title' });
                      controller.enqueue({
                        type: 'text-delta',
                        id: 'title',
                        delta: title,
                      });
                      controller.enqueue({ type: 'text-end', id: 'title' });
                      controller.enqueue({
                        type: 'finish',
                        finishReason: { unified: 'stop', raw: undefined },
                        usage: PROVIDER_ZERO_USAGE,
                      });
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
              }),
            }),
        }),
        messages: input.messages,
        system: input.system,
        abortSignal: input.abortSignal,
      });
    }

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
    let abortSettlement = Promise.resolve();
    let abortSettlementError: { error: unknown } | undefined;
    const waitForAbortSettlement = async () => {
      await abortSettlement;
      if (abortSettlementError) {
        throw abortSettlementError.error;
      }
    };
    const model = new MockLanguageModelV3({
      provider: 'fake',
      modelId: this.model,
      doStream: ({ abortSignal }) =>
        Promise.resolve({
          stream: new ReadableStream<LanguageModelV3StreamPart>({
            async start(controller) {
              let delayTimer: ReturnType<typeof setTimeout> | undefined;
              let unblock: () => void = () => undefined;
              const onAbort = () => {
                turn.aborted = true;
                if (delayTimer) {
                  clearTimeout(delayTimer);
                }
                controller.error(new DOMException('Aborted', 'AbortError'));
                unblock();
              };
              if (abortSignal?.aborted) {
                onAbort();
                return;
              }
              abortSignal?.addEventListener('abort', onAbort, { once: true });

              try {
                if (delayMs > 0) {
                  await new Promise<void>((resolve) => {
                    unblock = resolve;
                    delayTimer = setTimeout(resolve, delayMs);
                  });
                }
                if (abortSignal?.aborted) {
                  return;
                }
                controller.enqueue({ type: 'stream-start', warnings: [] });
                controller.enqueue({ type: 'text-start', id: 'answer' });
                if (response.length > 0) {
                  controller.enqueue({
                    type: 'text-delta',
                    id: 'answer',
                    delta: response,
                  });
                }
                controller.enqueue({ type: 'text-end', id: 'answer' });
                controller.enqueue({
                  type: 'finish',
                  finishReason: { unified: 'stop', raw: undefined },
                  usage: toProviderUsage(usage),
                });
                controller.close();
              } catch (error) {
                controller.error(error);
              } finally {
                abortSignal?.removeEventListener('abort', onAbort);
              }
            },
          }),
        }),
    });
    const toolOptions: Pick<ModelStreamInput, 'tools' | 'toolChoice'> = {};
    if (input.tools) {
      toolOptions.tools = input.tools;
      if (input.toolChoice !== undefined) {
        toolOptions.toolChoice = input.toolChoice;
      }
    }
    const result = sdkStreamText({
      model,
      messages: input.messages,
      system: input.system,
      abortSignal: input.abortSignal,
      ...toolOptions,
      onChunk: ({ chunk }) => {
        if (chunk.type === 'text-delta') {
          input.onTextDelta?.(chunk.text);
        } else if (chunk.type === 'reasoning-delta') {
          input.onReasoningDelta?.(chunk.text);
        }
      },
      onError: (event) => {
        if (!input.abortSignal?.aborted) {
          return input.onError?.(event);
        }
      },
      onAbort: () => {
        abortSettlement = Promise.resolve(
          input.onError?.({
            error: input.abortSignal?.reason ?? new Error('aborted'),
          }),
        ).catch((error: unknown) => {
          abortSettlementError = { error };
        });
      },
      onFinish: async ({ text, usage: actualUsage, finishReason }) => {
        this.onFinishCalls += 1;
        await input.onFinish?.({
          text,
          usage: actualUsage,
          finishReason,
        });
      },
    });

    return wrapStreamTextResult(result, {
      consumeStream: (target) => ({
        value: async (...args: Parameters<typeof target.consumeStream>) => {
          await target.consumeStream(...args);
          await waitForAbortSettlement();
        },
      }),
      text: (target) => ({
        value: (async () => {
          try {
            return await target.text;
          } finally {
            await waitForAbortSettlement();
          }
        })(),
      }),
    });
  }
}

export class FakeModelsService {
  credential: string | null = 'sk-test';
  readonly client = new FakeStreamingModelClient();
  readonly createClientCalls: unknown[] = [];

  resolveModelCredential(userId: string): string {
    if (!this.credential) {
      throw new MissingModelCredentialError(userId);
    }

    return this.credential;
  }

  validateModelSelection(modelId: string) {
    if (!this.isAvailable(modelId)) {
      throw new ModelNotAvailableError(modelId);
    }
    return {
      id: modelId,
      source: 'system',
      contextWindowTokens: 128_000,
      provider: 'openai',
      providerModelId: 'test-provider-model',
      systemPromptTemplate: `Test prompt for ${modelId}`,
      systemPromptSource: 'project_default',
    };
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

/**
 * Poll until `poll` returns a defined value or the timeout elapses. The shared
 * copy — integration/e2e suites poll for async outcomes (consumed jobs,
 * compaction rows) instead of sleeping fixed amounts.
 */
export async function waitFor<T>(
  poll: () => T | undefined | Promise<T | undefined>,
  timeoutMs: number,
  what: string,
): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await poll();
    if (value !== undefined) return value;
    if (Date.now() - started > timeoutMs) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/**
 * Every user message now carries a `temporal` row stating when its turn was
 * received. Specs that assert an exact `parts` array care about the OTHER
 * parts, and cannot pin this one: its instant is the moment the turn was
 * accepted and its zone is whatever the host resolves.
 *
 * Strip it here and assert it with `expectTemporalRow` where it is the point,
 * rather than restating a matcher for it in every spec.
 */
export function withoutTemporalRow<T>(parts: readonly T[]): T[] {
  return parts.filter(
    (part) => !(isContextItemPart(part) && part.data.producer === 'temporal'),
  );
}

/** Assert the turn carries exactly one well-formed temporal row. */
export function expectTemporalRow(
  parts: readonly unknown[],
  runId?: string,
): void {
  const rows = parts
    .filter(isContextItemPart)
    .filter((part) => part.data.producer === 'temporal');
  expect(rows).toHaveLength(1);
  expect(isTemporalPayload(rows[0].data.payload)).toBe(true);
  expect(rows[0].data.form).toBe('snapshot');
  if (runId !== undefined) expect(rows[0].data.runId).toBe(runId);
}
