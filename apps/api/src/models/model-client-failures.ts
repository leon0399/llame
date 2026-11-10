import { Logger } from '@nestjs/common';
import { isString } from '@workspace/runtime-safety';
import type { StreamTextOnErrorCallback } from 'ai';

import type {
  ModelClient,
  ModelObjectInput,
  ModelStreamInput,
  ModelStreamResult,
} from './model-client';
import { isFailureGraph, redactModelFailure } from './model-failure-redaction';
import { wrapStreamTextResult } from './stream-text-result-proxy';

const logger = new Logger('ModelClientFailures');

/**
 * Every promise channel a `StreamTextResult` exposes (AI SDK 6): reading one
 * settles the request, and each rejects with the failure the request raised.
 * The stream channels (`fullStream`, `textStream`, …) report a failure as
 * their own error part instead, so only these need wrapping. The `satisfies`
 * turns a channel renamed in the SDK into a compile error, so a rename can
 * never silently stop being redacted.
 */
export const STREAM_PROMISE_CHANNELS = [
  'content',
  'text',
  'reasoning',
  'reasoningText',
  'files',
  'sources',
  'toolCalls',
  'staticToolCalls',
  'dynamicToolCalls',
  'staticToolResults',
  'dynamicToolResults',
  'toolResults',
  'finishReason',
  'rawFinishReason',
  'usage',
  'totalUsage',
  'warnings',
  'steps',
  'request',
  'response',
  'providerMetadata',
  'output',
] as const satisfies ReadonlyArray<keyof ModelStreamResult>;

type ConsumeOptions = Parameters<ModelStreamResult['consumeStream']>[0];

/**
 * Redacted failures already produced for this client: the SDK rejects several
 * channels with the same error instance, and a frozen one can only be
 * reported through a replacement, which every channel must share.
 */
type FailureMemo = WeakMap<object, object>;

/**
 * The redacted form of one failure, memoized and logged when the original
 * could not be rewritten in place (never the values it carried). `undefined`
 * means the value is not part of a failure graph and is forwarded as it is.
 */
function redactedFailure(
  error: unknown,
  credentials: ReadonlyArray<string>,
  memo: FailureMemo,
): object | string | undefined {
  if (!isFailureGraph(error)) return redactModelFailure(error, credentials);
  const memoized = memo.get(error);

  if (memoized !== undefined) return memoized;
  const redacted = redactModelFailure(error, credentials) ?? error;
  memo.set(error, redacted);

  if (redacted !== error) {
    logger.warn(
      'A model failure could not be rewritten in place; reporting a redacted replacement.',
    );
  }

  return redacted;
}

function isRedactedRejection<T>(
  promise: PromiseLike<T> | undefined,
  credentials: ReadonlyArray<string>,
  memo: FailureMemo,
): Promise<T | undefined> {
  return Promise.resolve(promise).catch((error: unknown) => {
    const redacted = redactedFailure(error, credentials, memo);
    throw redacted === undefined ? error : redacted;
  });
}

/**
 * The result's promise channels, each rejecting with the redacted failure
 * instead of the raw one. Built once per wrapped client; `wrapStreamTextResult`
 * supplies each result's own target lazily, so nothing consumes the stream
 * early and no channel is created per request.
 */
function redactedChannels(
  credentials: ReadonlyArray<string>,
  memo: FailureMemo,
) {
  const overrides = Object.fromEntries(
    STREAM_PROMISE_CHANNELS.map(
      (
        channel,
      ): [
        string,
        (target: ModelStreamResult) => { readonly value: unknown },
      ] => [
        channel,
        (target) => ({
          // SAFETY: every promise channel is a thenable; its element type is
          // not narrowed or reshaped here, only its rejection is replaced.
          value: isRedactedRejection(
            target[channel] as PromiseLike<unknown>,
            credentials,
            memo,
          ),
        }),
      ],
    ),
  );

  overrides.consumeStream = (target: ModelStreamResult) => ({
    value: (options?: ConsumeOptions) =>
      isRedactedRejection(target.consumeStream(options), credentials, memo),
  });

  return overrides;
}

/**
 * The request's `onError`, which the wrapper always installs
 * (`provider-api-selection`, "Provider failures never carry a configured
 * credential"): it redacts the failure and forwards it to the caller's own
 * handler, or — when the caller supplied none — logs the redacted failure
 * through Nest instead of letting the AI SDK's default handler print the raw
 * object. A request the caller aborted is not a failure: its own reason is
 * not logged, exactly as the SDK's default handler never logged it.
 */
function redactingOnError(
  caller: StreamTextOnErrorCallback | undefined,
  credentials: ReadonlyArray<string>,
  abortSignal: AbortSignal | undefined,
  memo: FailureMemo,
): StreamTextOnErrorCallback {
  return ({ error }) => {
    if (
      caller === undefined &&
      abortSignal?.aborted === true &&
      error === abortSignal.reason
    ) {
      return;
    }

    const redacted = redactedFailure(error, credentials, memo);
    const failure = redacted === undefined ? error : redacted;

    if (caller !== undefined) return caller({ error: failure });

    if (failure instanceof Error) {
      logger.error(`A model request failed: ${failure.message}`, failure.stack);

      return;
    }

    if (redacted !== undefined && !isString(redacted)) {
      // A structured failure has no `message` to interpolate: `String` would
      // collapse a Responses `error`/`response.failed` envelope to
      // `[object Object]`. Nest inspects an extra argument, so the redacted
      // `message`, `code`, and the fields around them stay readable.
      logger.error('A model request failed', redacted);

      return;
    }

    logger.error(`A model request failed: ${String(failure)}`);
  };
}

/**
 * Wraps the client a provider entry builds so no failure it produces carries a
 * configured credential (`provider-api-selection`, "Provider failures never
 * carry a configured credential"; design D3). Only `streamText` and
 * `generateObject` are intercepted — each client's own `onError` sanitizer
 * runs first and is unchanged — so `'generateObject' in client` and every
 * metadata field still read through.
 *
 * The failure value keeps its identity wherever it can be rewritten in place;
 * when it cannot, a replacement on the same prototype is forwarded and the
 * substitution is logged without values. An empty credential set leaves every
 * failure value as it is.
 */
export function withRedactedFailures(
  client: ModelClient,
  credentials: ReadonlyArray<string>,
): ModelClient {
  const memo: FailureMemo = new WeakMap();
  const channels = redactedChannels(credentials, memo);

  return new Proxy(client, {
    get(target, property, receiver) {
      if (property === 'streamText') {
        return (input: ModelStreamInput): ModelStreamResult =>
          wrapStreamTextResult(
            target.streamText({
              ...input,
              onError: redactingOnError(
                input.onError,
                credentials,
                input.abortSignal,
                memo,
              ),
            }),
            channels,
          );
      }

      if (property === 'generateObject') {
        if (target.generateObject === undefined) return undefined;

        return <OBJECT>(input: ModelObjectInput<OBJECT>) =>
          isRedactedRejection(
            target.generateObject?.(input),
            credentials,
            memo,
          );
      }

      // eslint-disable-next-line anti-slop/no-reflect-get, typescript/no-unsafe-return -- pass-through read of an untouched client member; the trap has no per-property type, and the receiver-correct rationale is owned by wrapStreamTextResult.
      return Reflect.get(target, property, receiver);
    },
  });
}
