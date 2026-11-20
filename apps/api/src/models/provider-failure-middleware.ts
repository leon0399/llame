import { NoOutputGeneratedError } from 'ai';
import type {
  ModelFailure,
  ModelFailureSanitizer,
  ModelStreamInput,
  ModelStreamResult,
} from './model-client';
import { STREAM_PROMISE_CHANNELS } from './model-client-failures';
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

/** Classify before sanitizing; return no provider-owned error graph. */
export function classifiedFailure(
  error: ModelFailure,
  options: ProviderFailureMiddlewareOptions,
  headers?: Readonly<Record<string, string>>,
  now?: number,
): ModelFailure {
  if (
    error instanceof ProviderFailure ||
    (options.abortSignal !== undefined && error === options.abortSignal.reason)
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
