import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
} from '@ai-sdk/provider';
import { InvalidResponseDataError } from '@ai-sdk/provider';
import {
  InvalidArgumentError,
  JSONParseError,
  TypeValidationError,
  wrapLanguageModel,
  type streamText,
} from 'ai';
import { setTimeout as delay } from 'node:timers/promises';

import type { ModelStreamInput } from './model-client';
import {
  classifiedFailure,
  type ProviderFailureMiddlewareOptions,
} from './provider-failure-middleware';
import {
  ProviderFailure,
  type FailureClass,
} from './provider-failure/provider-failure';

const MAX_SENDS = 11;
const STREAM_WINDOW_MS = 300_000;

export type RequestRecoveryOptions = ProviderFailureMiddlewareOptions & {
  firstTokenTimeoutSeconds?: number;
  onRetry?: ModelStreamInput['onRetry'];
  bufferWholeSend?: boolean;
  requestRetriesUsed?: number;
  /** The previous step's started-call failure; the first send waits its delay. */
  pendingFailure?: ProviderFailure;
};

type RecoveryTiming = Partial<RecoveryClock>;

type RecoveryClock = {
  now: () => number;
  random: () => number;
  delay: (milliseconds: number, signal: AbortSignal) => Promise<void>;
};

type FailedSend = { failure: ProviderFailure; canRetry: boolean };

type Send = {
  result: LanguageModelV3StreamResult;
  window: SendWindow;
  firstDeadline: number;
  receivedAt: number;
};

function retryable(failure: ProviderFailure, now: number): boolean {
  if (failure.resetsAt !== undefined && failure.resetsAt - now > 60_000)
    return false;

  if (failure.code === 'quota_exhausted') return failure.resetsAt !== undefined;

  if (failure.code === 'rate_limited' && (failure.hintMs ?? 0) > 60_000)
    return false;

  return (
    failure.code === 'overloaded' ||
    failure.code === 'server_error' ||
    failure.code === 'unreachable' ||
    failure.code === 'rate_limited' ||
    failure.code === 'first_token_timeout' ||
    failure.code === 'stream_broken'
  );
}

function retryDelay(
  failure: ProviderFailure,
  retry: number,
  clock: RecoveryClock,
): number {
  const jitter = Math.floor(
    clock.random() * Math.min(8000, 500 * 2 ** (retry - 1)),
  );

  const reset =
    failure.resetsAt === undefined
      ? 0
      : Math.max(0, failure.resetsAt - clock.now());

  const hint = (failure.hintMs ?? 0) <= 60_000 ? (failure.hintMs ?? 0) : 0;

  return Math.max(jitter, reset, hint);
}

function firstContent(part: LanguageModelV3StreamPart): boolean {
  switch (part.type) {
    case 'text-delta':
    case 'reasoning-delta':
      return part.delta.length > 0;
    case 'tool-input-start':
    case 'tool-call':
    case 'file':
    case 'source':
    case 'finish':
      return true;
    default:
      return false;
  }
}

/** One send's abort and timer; cancellation also settles an uncooperative read. */
class SendWindow {
  private readonly controller = new AbortController();
  readonly signal: AbortSignal;

  constructor(requestSignal: AbortSignal) {
    this.signal = AbortSignal.any([requestSignal, this.controller.signal]);
  }

  abort(reason?: unknown): void {
    this.controller.abort(reason);
  }

  async wait<T>(
    pending: PromiseLike<T>,
    milliseconds: number,
    code: FailureClass,
  ): Promise<T> {
    const expired = Promise.withResolvers<never>();
    const abort = () => expired.reject(this.signal.reason);
    this.signal.addEventListener('abort', abort, { once: true });

    let remaining = Math.max(0, milliseconds);
    let timer: ReturnType<typeof setTimeout> | undefined;

    const arm = () => {
      const interval = Math.min(remaining, 2_147_483_647);
      timer = setTimeout(() => {
        remaining -= interval;

        if (remaining > 0) arm();
        else
          this.abort(
            new ProviderFailure(
              code === 'first_token_timeout'
                ? 'The provider produced no content before its deadline.'
                : 'The provider stream stopped producing parts.',
              { code },
            ),
          );
      }, interval);
    };

    arm();

    try {
      this.signal.throwIfAborted();

      return await Promise.race([pending, expired.promise]);
    } finally {
      clearTimeout(timer);
      this.signal.removeEventListener('abort', abort);
    }
  }
}

/** Parts from one send; content tracking is independent of whole-send buffering. */
class SendOutput {
  readonly held: Array<LanguageModelV3StreamPart> = [];
  content = false;
  completeTool = false;
  finished = false;

  constructor(readonly wholeSend: boolean) {}

  *accept(
    part: LanguageModelV3StreamPart,
  ): Generator<LanguageModelV3StreamPart> {
    // Responses emits a synthetic unknown finish when its wire closes early.
    if (
      part.type === 'finish' &&
      part.finishReason.unified === 'other' &&
      part.finishReason.raw === undefined
    )
      throw new ProviderFailure(
        'The provider stream ended without a finish part.',
        { code: 'stream_broken' },
      );

    this.completeTool ||= part.type === 'tool-call';
    this.finished ||= part.type === 'finish';

    if (this.wholeSend || !this.content) this.held.push(part);
    else yield part;

    if (!this.content && firstContent(part)) {
      this.content = true;

      if (!this.wholeSend) {
        yield* this.held;
        this.held.length = 0;
      }
    }
  }
}

class StreamRecovery {
  private readonly cancelled = new AbortController();
  readonly signal: AbortSignal;
  private sends = 0;

  constructor(
    private readonly model: LanguageModelV3,
    private readonly params: LanguageModelV3CallOptions,
    private readonly options: RequestRecoveryOptions,
    private readonly clock: RecoveryClock,
  ) {
    const upstream = params.abortSignal ?? options.abortSignal;
    this.signal = upstream
      ? AbortSignal.any([upstream, this.cancelled.signal])
      : this.cancelled.signal;
  }

  restoreRetries(retries: number): void {
    this.sends = retries;
  }

  cancel(reason: unknown): void {
    this.cancelled.abort(reason);
  }

  private classify(error: unknown, send?: Send): ProviderFailure {
    this.signal.throwIfAborted();

    if (InvalidArgumentError.isInstance(error)) throw error;

    const failure = classifiedFailure(
      error,
      this.options,
      send?.result.response?.headers,
      send?.receivedAt ?? this.clock.now(),
    );

    if (!(failure instanceof ProviderFailure)) throw failure;

    return failure;
  }

  async retry(failure: ProviderFailure): Promise<void> {
    this.signal.throwIfAborted();

    if (this.sends >= MAX_SENDS || !retryable(failure, this.clock.now()))
      throw failure;
    const delayMs = retryDelay(failure, this.sends, this.clock);
    await this.options.onRetry?.({
      code: failure.code,
      retry: this.sends,
      delayMs,
    });
    this.signal.throwIfAborted();
    await this.clock.delay(delayMs, this.signal);
  }

  private async startSend(): Promise<Send> {
    this.signal.throwIfAborted();
    this.sends += 1;
    const window = new SendWindow(this.signal);

    const firstMilliseconds =
      (this.options.firstTokenTimeoutSeconds ?? 300) * 1000;

    const firstDeadline = this.clock.now() + firstMilliseconds;

    try {
      const result = await window.wait(
        this.model.doStream({ ...this.params, abortSignal: window.signal }),
        firstMilliseconds,
        'first_token_timeout',
      );

      return { result, window, firstDeadline, receivedAt: this.clock.now() };
    } catch (error) {
      window.abort(error);
      throw error;
    }
  }

  async open(): Promise<Send> {
    for (;;) {
      try {
        return await this.startSend();
      } catch (error) {
        await this.retry(this.classify(error));
      }
    }
  }

  private streamFailure(
    error: unknown,
    send: Send,
    content: boolean,
  ): ProviderFailure {
    const failure = this.classify(error, send);

    // The Completions adapter's missing-finish error has no offending data.
    if (
      failure.code === 'unknown' &&
      InvalidResponseDataError.isInstance(error) &&
      error.data === undefined
    )
      return new ProviderFailure(failure.message, { code: 'stream_broken' });

    if (
      !content ||
      !(error instanceof Error) ||
      error instanceof ProviderFailure ||
      JSONParseError.isInstance(error) ||
      TypeValidationError.isInstance(error)
    )
      return failure;

    if (
      failure.statusCode !== undefined &&
      [301, 302, 303, 307, 308].includes(failure.statusCode)
    )
      return failure;

    return failure.code === 'unknown' || failure.code === 'unreachable'
      ? new ProviderFailure(failure.message, { code: 'stream_broken' })
      : failure;
  }
  private supersededFailure(failure: ProviderFailure): ProviderFailure {
    return new ProviderFailure(failure.message, {
      code: failure.code,
      ...(failure.resetsAt !== undefined && { resetsAt: failure.resetsAt }),
      ...(failure.hintMs !== undefined && { hintMs: failure.hintMs }),
      ...(failure.statusCode !== undefined && {
        statusCode: failure.statusCode,
      }),
      ...(failure.toolCallStarted !== undefined && {
        toolCallStarted: failure.toolCallStarted,
      }),
      ...(failure.sends !== undefined && { sends: failure.sends }),
      superseded: {
        retry: this.sends,
        delayMs: retryDelay(failure, this.sends, this.clock),
      },
    });
  }

  private failedSend(
    error: unknown,
    send: Send,
    output: SendOutput,
  ): FailedSend {
    const classified = this.streamFailure(error, send, output.content);

    const failure = output.completeTool
      ? new ProviderFailure(classified.message, {
          code: classified.code,
          ...(classified.resetsAt !== undefined && {
            resetsAt: classified.resetsAt,
          }),
          ...(classified.hintMs !== undefined && { hintMs: classified.hintMs }),
          ...(classified.statusCode !== undefined && {
            statusCode: classified.statusCode,
          }),
          toolCallStarted: true,
          sends: this.sends,
        })
      : classified;

    const liveRetry =
      output.content &&
      !output.wholeSend &&
      !output.completeTool &&
      this.sends < MAX_SENDS &&
      retryable(failure, this.clock.now());

    return {
      failure: liveRetry ? this.supersededFailure(failure) : failure,
      canRetry: !output.completeTool && (!output.content || output.wholeSend),
    };
  }

  private async *read(
    send: Send,
  ): AsyncGenerator<LanguageModelV3StreamPart, FailedSend | undefined> {
    const reader = send.result.stream.getReader();
    const output = new SendOutput(this.options.bufferWholeSend ?? false);

    try {
      while (!output.finished) {
        this.signal.throwIfAborted();

        const milliseconds = output.content
          ? STREAM_WINDOW_MS
          : send.firstDeadline - this.clock.now();

        const item = await send.window.wait(
          reader.read(),
          milliseconds,
          output.content ? 'stream_broken' : 'first_token_timeout',
        );

        if (item.done)
          throw new ProviderFailure(
            'The provider stream ended without a finish part.',
            { code: 'stream_broken' },
          );

        if (item.value.type === 'error') throw item.value.error;
        yield* output.accept(item.value);
      }

      if (output.wholeSend) yield* output.held;

      return undefined;
    } catch (error) {
      return this.failedSend(error, send, output);
    } finally {
      send.window.abort();
      void reader.cancel().catch(() => undefined);
    }
  }

  async *parts(initial: Send): AsyncGenerator<LanguageModelV3StreamPart> {
    let send = initial;

    for (;;) {
      const failed = yield* this.read(send);

      if (failed === undefined) return;

      if (!failed.canRetry) throw failed.failure;
      await this.retry(failed.failure);
      send = await this.open();
    }
  }
}

function recoveredStream(
  recovery: StreamRecovery,
  initial: Send,
): ReadableStream<LanguageModelV3StreamPart> {
  const parts = recovery.parts(initial);
  let cancelled = false;
  let started = false;

  return new ReadableStream<LanguageModelV3StreamPart>(
    {
      async pull(controller) {
        started = true;

        try {
          const next = await parts.next();

          if (cancelled) return;

          if (next.done) controller.close();
          else controller.enqueue(next.value);
        } catch (error) {
          if (cancelled) return;
          controller.enqueue({ type: 'error', error });
          controller.close();
        }
      },
      async cancel(reason) {
        cancelled = true;
        recovery.cancel(reason);

        if (!started) await initial.result.stream.cancel(reason);
        await parts.return(undefined);
      },
    },
    { highWaterMark: 0 },
  );
}

async function generate(
  model: LanguageModelV3,
  params: LanguageModelV3CallOptions,
  options: RequestRecoveryOptions,
  clock: RecoveryClock,
) {
  const requestSignal =
    params.abortSignal ?? options.abortSignal ?? new AbortController().signal;

  const firstMilliseconds = (options.firstTokenTimeoutSeconds ?? 300) * 1000;

  for (let send = 1; ; send += 1) {
    requestSignal.throwIfAborted();
    const window = new SendWindow(requestSignal);

    try {
      return await window.wait(
        model.doGenerate({ ...params, abortSignal: window.signal }),
        firstMilliseconds,
        'first_token_timeout',
      );
    } catch (error) {
      requestSignal.throwIfAborted();

      if (InvalidArgumentError.isInstance(error)) throw error;
      const failure = classifiedFailure(error, options, undefined, clock.now());

      if (
        !(failure instanceof ProviderFailure) ||
        send >= MAX_SENDS ||
        !retryable(failure, clock.now())
      )
        throw failure;
      const delayMs = retryDelay(failure, send, clock);
      await options.onRetry?.({ code: failure.code, retry: send, delayMs });
      requestSignal.throwIfAborted();
      await clock.delay(delayMs, requestSignal);
    } finally {
      window.abort();
    }
  }
}

export function withRequestRecovery(
  model: LanguageModelV3,
  options: RequestRecoveryOptions,
  timing: RecoveryTiming = {},
): LanguageModelV3 {
  const clock: RecoveryClock = {
    now: timing.now ?? Date.now,
    random: timing.random ?? Math.random,
    delay:
      timing.delay ??
      ((milliseconds, signal) => delay(milliseconds, undefined, { signal })),
  };

  let requestRetriesUsed = options.requestRetriesUsed ?? 0;
  let pendingFailure = options.pendingFailure;

  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: 'v3',
      wrapStream: async ({ model: raw, params }) => {
        const recovery = new StreamRecovery(raw, params, options, clock);
        recovery.restoreRetries(requestRetriesUsed);
        requestRetriesUsed = 0;

        if (pendingFailure !== undefined) {
          const failure = pendingFailure;
          pendingFailure = undefined;
          await recovery.retry(failure);
        }

        const initial = await recovery.open();

        return {
          ...initial.result,
          stream: recoveredStream(recovery, initial),
        };
      },
      wrapGenerate: ({ model: raw, params }) =>
        generate(raw, params, options, clock),
    },
  });
}

export function applyRequestRecovery(
  streamOptions: Parameters<typeof streamText>[0] & { model: LanguageModelV3 },
  input: ModelStreamInput,
  options: RequestRecoveryOptions,
): void {
  streamOptions.model = withRequestRecovery(streamOptions.model, {
    ...options,
    abortSignal: input.abortSignal,
    onRetry: input.onRetry,
    requestRetriesUsed: input.requestRetriesUsed,
    pendingFailure: input.pendingFailure,
    bufferWholeSend:
      options.bufferWholeSend ??
      (!input.onTextDelta && !input.onReasoningDelta),
  });
}
