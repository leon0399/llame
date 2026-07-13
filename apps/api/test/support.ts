/**
 * Shared e2e test helpers. The session-cookie format, the AI SDK SSE event
 * shape, and the fake streaming model client are protocol facts each spec used
 * to restate — keep them in one place so a change (cookie name, stream event
 * schema, fake behavior) can't silently miss a copy.
 */

import type request from 'supertest';
import type { LanguageModelUsage, ModelMessage, streamText } from 'ai';

import { TITLE_SYSTEM_PROMPT } from './../src/titles/title';
import {
  MissingModelCredentialError,
  type ModelClient,
  type ModelStreamInput,
} from './../src/models/model-client';
import type { TokenPrice } from './../src/models/model-catalog';
import { ModelNotAvailableError } from './../src/models/models.service';

/** Extracts the llame session cookie pair from a response, or '' when absent. */
export const cookieOf = (res: request.Response): string => {
  const set = (res.headers['set-cookie'] as unknown as string[]) ?? [];
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
      .map((data): unknown => JSON.parse(data) as unknown)
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
        typeof event === 'object' &&
        event !== null &&
        (event as { type?: unknown }).type === 'text-delta',
    )
    .map((event) => event.delta)
    .join('');
}

export type FakeTurn = {
  messages: ModelMessage[];
  abortSignal?: AbortSignal;
  aborted: boolean;
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
  shouldFinish = true;
  delayMs = 0;
  onFinishCalls = 0;

  streamText(input: ModelStreamInput): ReturnType<typeof streamText> {
    if (input.system === TITLE_SYSTEM_PROMPT) {
      this.titleTurns.push(input.messages);
      return {
        text: Promise.resolve(this.titleResponse),
      } as unknown as ReturnType<typeof streamText>;
    }

    const response =
      this.responses[this.turns.length] ?? this.responses[0] ?? '';
    const turn: FakeTurn = {
      messages: input.messages,
      abortSignal: input.abortSignal,
      aborted: false,
    };
    this.turns.push(turn);

    input.abortSignal?.addEventListener('abort', () => {
      turn.aborted = true;
    });

    // Resolves when generation (incl. onFinish/onError side effects) is done —
    // consumeStream must not return early, or the worker unregisters aborts
    // and stops heartbeating while the fake is still 'streaming'.
    let resolveGeneration!: () => void;
    const generationDone = new Promise<void>((resolve) => {
      resolveGeneration = resolve;
    });
    const stream = new ReadableStream({
      start: async (controller) => {
        try {
          await this.generate(controller, input, turn, response);
        } finally {
          resolveGeneration();
        }
      },
    });

    const toResponse = () => {
      const sse = stream.pipeThrough(
        new TransformStream({
          transform(part, controller) {
            controller.enqueue(`data: ${JSON.stringify(part)}\n\n`);
          },
          flush(controller) {
            controller.enqueue('data: [DONE]\n\n');
          },
        }),
      );
      return new Response(sse.pipeThrough(new TextEncoderStream()), {
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
          'x-vercel-ai-ui-message-stream': 'v1',
        },
      });
    };

    return {
      // Lazy: only created when read, so tests that never await .text don't
      // trip unhandled-rejection noise on aborted turns.
      get text() {
        return generationDone.then(() => {
          if (turn.aborted) {
            throw new Error('aborted');
          }
          return response;
        });
      },
      textStream: new ReadableStream({
        start(controller) {
          controller.enqueue(response);
          controller.close();
        },
      }) as never,
      fullStream: new ReadableStream() as never,
      consumeStream: async () => {
        await generationDone;
      },
      toUIMessageStreamResponse: toResponse,
    } as unknown as ReturnType<typeof streamText>;
  }

  private async generate(
    controller: ReadableStreamDefaultController,
    input: ModelStreamInput,
    turn: FakeTurn,
    response: string,
  ): Promise<void> {
    controller.enqueue({
      type: 'start',
      messageId: `fake-${this.turns.length}`,
    });
    controller.enqueue({ type: 'text-start', id: 'text-1' });

    if (this.delayMs > 0) {
      // Event-driven abort fidelity (#73): the delay races the 'abort'
      // EVENT, mirroring how the real AI SDK interrupts an in-flight
      // request — not a post-hoc `.aborted` poll.
      const abortedDuringDelay = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          input.abortSignal?.removeEventListener('abort', onAbort);
          resolve(false);
        }, this.delayMs);
        const onAbort = () => {
          clearTimeout(timer);
          resolve(true);
        };
        if (input.abortSignal?.aborted) {
          onAbort();
          return;
        }
        input.abortSignal?.addEventListener('abort', onAbort, { once: true });
      });
      if (abortedDuringDelay) {
        turn.aborted = true;
        const error = new Error('aborted');
        await input.onError?.({ error });
        controller.error(error);
        return;
      }
    }

    if (input.abortSignal?.aborted) {
      turn.aborted = true;
      const error = new Error('aborted');
      await input.onError?.({ error });
      controller.error(error);
      return;
    }

    input.onTextDelta?.(response);
    controller.enqueue({
      type: 'text-delta',
      id: 'text-1',
      delta: response,
    });
    controller.enqueue({ type: 'text-end', id: 'text-1' });

    if (input.abortSignal?.aborted) {
      turn.aborted = true;
      const error = new Error('aborted');
      await input.onError?.({ error });
      controller.error(error);
      return;
    }

    if (this.shouldFinish) {
      this.onFinishCalls += 1;
      await input.onFinish?.({
        text: response,
        usage: this.usage,
        finishReason: 'stop',
      });
      controller.enqueue({ type: 'finish' });
    }

    controller.close();
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
      provider: 'openai',
      providerModelId: 'test-provider-model',
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
      ...(client.pricing !== undefined ? { pricing: client.pricing } : {}),
      ...(client.compactionThresholdTokens !== undefined
        ? { compactionThresholdTokens: client.compactionThresholdTokens }
        : {}),
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
