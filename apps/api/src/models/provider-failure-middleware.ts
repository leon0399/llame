import { NoOutputGeneratedError } from 'ai';
import type {
  ModelFailure,
  ModelFailureSanitizer,
  ModelStreamInput,
  ModelStreamResult,
} from './model-client';
import type {
  LanguageModelV3,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
} from '@ai-sdk/provider';
import { wrapLanguageModel } from 'ai';
import { STREAM_PROMISE_CHANNELS } from './model-client-failures';

import { ModelStreamIdleError } from './stream-idle-watchdog';
import {
  ProviderFailure,
  type FailureInput,
} from './provider-failure/provider-failure';

export type ProviderFailureMiddlewareOptions = {
  provider: string;
  classify: (input: FailureInput) => ProviderFailure;
  sanitize?: (failure: ModelFailure) => Error;
  abortSignal?: AbortSignal;
};

/** Promise channels may reject before the SDK delivers its terminal callback. */
export function promiseFailureOverrides(
  sanitize: ModelFailureSanitizer | undefined,
) {
  return Object.fromEntries(
    STREAM_PROMISE_CHANNELS.filter((channel) => channel !== 'text').map(
      (channel) => [
        channel,
        (target: ModelStreamResult) => ({
          value: Promise.resolve<unknown>(target[channel]).catch(
            (error: unknown) => {
              throw sanitize?.(error) ?? error;
            },
          ),
        }),
      ],
    ),
  );
}

/** Preserve the actual failed send when the SDK rejects text with no output. */
export function captureRequestFailure(
  request: Pick<ModelStreamInput, 'onError'>,
  sanitize: ModelFailureSanitizer | undefined,
): ModelFailureSanitizer {
  let failure: { error: ModelFailure } | undefined;
  const onError = request.onError;

  request.onError = (event) => {
    const error = sanitize?.(event.error) ?? event.error;
    failure ??= { error };

    return onError?.({ error });
  };

  return (error) =>
    failure && NoOutputGeneratedError.isInstance(error)
      ? failure.error
      : (sanitize?.(error) ?? error);
}

function responseHeaders(
  headers: NonNullable<LanguageModelV3StreamResult['response']>['headers'],
): Readonly<Record<string, string>> | undefined {
  if (headers === undefined) return undefined;

  if (headers instanceof Headers) return Object.fromEntries(headers.entries());

  return headers;
}

function isAbortOrIdle(
  error: unknown,
  abortSignal: AbortSignal | undefined,
): boolean {
  return (
    error instanceof ModelStreamIdleError ||
    (abortSignal !== undefined && error === abortSignal.reason)
  );
}

/** Classify before sanitizing; return no provider-owned error graph. */
export function classifiedFailure(
  error: ModelFailure,
  options: ProviderFailureMiddlewareOptions,
  headers?: Readonly<Record<string, string>>,
  now?: number,
): ModelFailure {
  if (
    error instanceof ProviderFailure ||
    isAbortOrIdle(error, options.abortSignal)
  ) {
    return error;
  }

  const classified = options.classify({
    error,
    provider: options.provider,
    ...(headers !== undefined && { headers }),
    ...(now !== undefined && { now }),
  });

  const bounded = options.sanitize?.(error);

  if (bounded instanceof ProviderFailure) return bounded;

  return new ProviderFailure(bounded?.message ?? classified.message, {
    code: classified.code,
    ...(classified.resetsAt !== undefined && { resetsAt: classified.resetsAt }),
    ...(classified.hintMs !== undefined && { hintMs: classified.hintMs }),
    ...(classified.statusCode !== undefined && {
      statusCode: classified.statusCode,
    }),
  });
}

function transformedStream(
  result: LanguageModelV3StreamResult,
  options: ProviderFailureMiddlewareOptions,
  receiptAt: number,
): ReadableStream<LanguageModelV3StreamPart> {
  const reader = result.stream.getReader();
  const headers = responseHeaders(result.response?.headers);

  const classify = (error: unknown) =>
    classifiedFailure(error, options, headers, receiptAt);

  let cancelled = false;

  return new ReadableStream<LanguageModelV3StreamPart>({
    async pull(controller) {
      try {
        const next = await reader.read();

        if (cancelled) return;

        if (next.done) {
          controller.close();

          return;
        }

        const part = next.value;

        controller.enqueue(
          part.type === 'error'
            ? { ...part, error: classify(part.error) }
            : part,
        );
      } catch (error) {
        if (cancelled) return;
        controller.enqueue({
          type: 'error',
          error: classify(error),
        });
        controller.close();
      }
    },
    cancel(reason) {
      cancelled = true;

      return reader.cancel(reason);
    },
  });
}

/** Classifies stream error parts without intercepting the SDK's retryable call. */
export function withProviderFailures(
  model: LanguageModelV3,
  options: ProviderFailureMiddlewareOptions,
): LanguageModelV3 {
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: 'v3',
      wrapStream: async ({ doStream, params }) => {
        // Rejections deliberately remain raw: the SDK owns its retry loop.
        const result = await doStream();
        const receiptAt = Date.now();

        return {
          ...result,
          stream: transformedStream(
            result,
            {
              ...options,
              abortSignal: params.abortSignal ?? options.abortSignal,
            },
            receiptAt,
          ),
        };
      },
    },
  });
}
