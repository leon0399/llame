import { Logger } from '@nestjs/common';
import type { StreamTextOnErrorCallback } from 'ai';

import type {
  ModelClient,
  ModelObjectInput,
  ModelStreamInput,
  ModelStreamResult,
} from './model-client';
import { redactModelFailure } from './model-failure-redaction';
import { wrapStreamTextResult } from './stream-text-result-proxy';

const logger = new Logger('ModelClientFailures');

/**
 * Every promise channel a `StreamTextResult` exposes (AI SDK 6): reading one
 * settles the request, and each rejects with the failure the request raised.
 * The stream channels (`fullStream`, `textStream`, …) report a failure as
 * their own error part instead, so only these need wrapping.
 */
const PROMISE_CHANNELS = [
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
] as const;

type ConsumeOptions = Parameters<ModelStreamResult['consumeStream']>[0];

/**
 * The redacted form of one failure, logging the substitution when the original
 * object could not be rewritten in place (never the values it carried).
 */
function redactedFailure(
  error: unknown,
  credentials: ReadonlyArray<string>,
): Error | string | undefined {
  const redacted = redactModelFailure(error, credentials);
  if (redacted !== undefined && redacted !== error) {
    logger.warn(
      'A model failure could not be rewritten in place; reporting a redacted replacement.',
    );
  }
  return redacted;
}

function isRedactedRejection<T>(
  promise: PromiseLike<T>,
  credentials: ReadonlyArray<string>,
): Promise<T> {
  return Promise.resolve(promise).catch((error: unknown) => {
    const redacted = redactedFailure(error, credentials);
    throw redacted === undefined ? error : redacted;
  });
}

/**
 * The result's promise channels, each rejecting with the redacted failure
 * instead of the raw one. Built per request and read lazily by
 * {@link wrapStreamTextResult}, so nothing consumes the stream early.
 */
function redactedChannels(credentials: ReadonlyArray<string>) {
  const overrides = Object.fromEntries(
    PROMISE_CHANNELS.map(
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
          ),
        }),
      ],
    ),
  );
  overrides.consumeStream = (target: ModelStreamResult) => ({
    value: (options?: ConsumeOptions) =>
      isRedactedRejection(target.consumeStream(options), credentials),
  });
  return overrides;
}

/**
 * The request's `onError`, which the wrapper always installs
 * (`provider-api-selection`, "Provider failures never carry a configured
 * credential"): it redacts the failure and forwards it to the caller's own
 * handler, or — when the caller supplied none — logs the redacted failure
 * through Nest instead of letting the AI SDK's default handler print the raw
 * object.
 */
function redactingOnError(
  caller: StreamTextOnErrorCallback | undefined,
  credentials: ReadonlyArray<string>,
): StreamTextOnErrorCallback {
  return ({ error }) => {
    const redacted = redactedFailure(error, credentials);
    const failure = redacted === undefined ? error : redacted;
    if (caller !== undefined) return caller({ error: failure });
    if (failure instanceof Error) {
      logger.error(`A model request failed: ${failure.message}`, failure.stack);
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
  return new Proxy(client, {
    get(target, property, receiver) {
      if (property === 'streamText') {
        return (input: ModelStreamInput): ModelStreamResult =>
          wrapStreamTextResult(
            target.streamText({
              ...input,
              onError: redactingOnError(input.onError, credentials),
            }),
            redactedChannels(credentials),
          );
      }
      if (property === 'generateObject') {
        if (target.generateObject === undefined) return undefined;
        return <OBJECT>(input: ModelObjectInput<OBJECT>) =>
          Promise.resolve(target.generateObject?.(input)).catch(
            (error: unknown) => {
              const redacted = redactedFailure(error, credentials);
              throw redacted === undefined ? error : redacted;
            },
          );
      }
      // eslint-disable-next-line anti-slop/no-reflect-get, typescript/no-unsafe-return -- pass-through read of an untouched client member; the trap has no per-property type, and the receiver-correct rationale is owned by wrapStreamTextResult.
      return Reflect.get(target, property, receiver);
    },
  });
}
