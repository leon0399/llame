import { Logger } from '@nestjs/common';
import { isRecord, isString } from '@workspace/runtime-safety';
import {
  APICallError,
  NoOutputGeneratedError,
  type StreamTextOnErrorCallback,
} from 'ai';

import type {
  ModelFailure,
  ModelFailureSanitizer,
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
 * The stream channels expose failures as error frames or rejected reads, so
 * both kinds of channel need redaction. The `satisfies` turns a renamed
 * promise channel into a compile error, so it cannot silently lose redaction.
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

type ReportedFailure = { readonly error: unknown };

type FailureState = { failure?: ReportedFailure };

type FailureMemo = WeakMap<object, object>;

type FailureStates = WeakMap<ModelStreamResult, FailureState>;

type FailureContext = {
  readonly credentials: ReadonlyArray<string>;
  readonly memo: FailureMemo;
  readonly states: FailureStates;
};

type ChannelOverride = { readonly value: unknown };

type ChannelOverrides = Partial<
  Record<PropertyKey, (target: ModelStreamResult) => ChannelOverride>
>;

/**
 * The redacted form of one failure, memoized and logged when the original
 * could not be rewritten in place (never the values it carried). `undefined`
 * means the value is not part of a failure graph and is forwarded as it is.
 */
function redactedFailure(
  error: unknown,
  context: FailureContext,
): object | string | undefined {
  if (!isFailureGraph(error)) {
    return redactModelFailure(error, context.credentials);
  }

  const memoized = context.memo.get(error);

  if (memoized !== undefined) return memoized;

  const redacted = redactModelFailure(error, context.credentials) ?? error;

  context.memo.set(error, redacted);

  if (redacted !== error) {
    logger.warn(
      'A model failure could not be rewritten in place; reporting a redacted replacement.',
    );
  }

  return redacted;
}

function normalizedFailure(
  error: ModelFailure,
  context: FailureContext,
): ModelFailure {
  return redactedFailure(error, context) ?? error;
}

function isRedactedRejection<T>(
  promise: PromiseLike<T> | undefined,
  context: FailureContext,
  state: FailureState = {},
): Promise<T | undefined> {
  return Promise.resolve(promise).catch((error: unknown) => {
    if (
      state.failure !== undefined &&
      NoOutputGeneratedError.isInstance(error)
    ) {
      throw state.failure.error;
    }

    throw redactedFailure(error, context) ?? error;
  });
}

/**
 * Redacts error frames and rejected reads only when the stream is consumed.
 * Reader creation, pulling, and cancellation remain delegated to the source.
 */
function normalizedStream(
  stream: ReadableStream<unknown>,
  normalize: ModelFailureSanitizer,
): ReadableStream<unknown> {
  let reader: ReadableStreamDefaultReader<unknown> | undefined;

  return new ReadableStream(
    {
      async pull(controller) {
        try {
          reader ??= stream.getReader();
          const item = await reader.read();

          if (item.done) {
            controller.close();

            return;
          }

          if (
            isRecord(item.value) &&
            item.value.type === 'error' &&
            Object.hasOwn(item.value, 'error')
          ) {
            controller.enqueue({
              ...item.value,
              error: normalize(item.value.error),
            });

            return;
          }

          controller.enqueue(item.value);
        } catch (error: unknown) {
          controller.error(normalize(error));
        }
      },
      cancel(reason: unknown) {
        return reader?.cancel(reason) ?? stream.cancel(reason);
      },
    },
    { highWaterMark: 0 },
  );
}

function normalizeStreamFailure(
  error: unknown,
  state: FailureState,
  context: FailureContext,
): ModelFailure {
  return state.failure &&
    (NoOutputGeneratedError.isInstance(error) || APICallError.isInstance(error))
    ? state.failure.error
    : (redactedFailure(error, context) ?? error);
}

function resultState(
  target: ModelStreamResult,
  context: FailureContext,
): FailureState {
  return context.states.get(target) ?? {};
}

function promiseChannels(context: FailureContext): ChannelOverrides {
  return Object.fromEntries(
    STREAM_PROMISE_CHANNELS.map((channel) => [
      channel,
      (target: ModelStreamResult): ChannelOverride => ({
        // SAFETY: this tuple contains every SDK promise channel; its value is
        // promise-like although the indexed union type does not preserve that.
        value: isRedactedRejection(
          target[channel] as PromiseLike<unknown>,
          context,
          resultState(target, context),
        ),
      }),
    ]),
  );
}

function streamChannels(
  overrides: ChannelOverrides,
  context: FailureContext,
): void {
  for (const channel of [
    'fullStream',
    'textStream',
    'partialOutputStream',
    'experimental_partialOutputStream',
    'elementStream',
  ] as const) {
    overrides[channel] = (target) => ({
      // SAFETY: these five SDK properties are readable streams, not promises.
      value: normalizedStream(
        target[channel] as ReadableStream<unknown>,
        (error) =>
          normalizeStreamFailure(error, resultState(target, context), context),
      ),
    });
  }
}

function consumeChannel(
  overrides: ChannelOverrides,
  context: FailureContext,
): void {
  overrides.consumeStream = (target) => ({
    value: (options?: ConsumeOptions) =>
      isRedactedRejection(
        target.consumeStream(options),
        context,
        resultState(target, context),
      ),
  });
}

function redactedChannels(context: FailureContext): ChannelOverrides {
  const overrides = promiseChannels(context);
  streamChannels(overrides, context);
  consumeChannel(overrides, context);

  return overrides;
}

/** Reports a sanitized request failure to its callback or to Nest's logger. */
function reportFailure(
  failure: ModelFailure,
  caller: StreamTextOnErrorCallback | undefined,
) {
  if (caller !== undefined) {
    return caller({ error: failure });
  } else if (failure instanceof Error) {
    logger.error(`A model request failed: ${failure.message}`, failure.stack);
  } else if (failure !== undefined && !isString(failure)) {
    // Preserve structured Responses error envelopes in Nest's extra argument.
    logger.error('A model request failed', failure);
  } else {
    logger.error(`A model request failed: ${String(failure)}`);
  }
}

/**
 * The request's `onError` sanitizes the failure and preserves SDK behavior for
 * caller-supplied callbacks and caller-initiated aborts.
 */
function redactingOnError(
  caller: StreamTextOnErrorCallback | undefined,
  abortSignal: AbortSignal | undefined,
  context: FailureContext,
  state: FailureState,
): StreamTextOnErrorCallback {
  return ({ error }) => {
    if (
      caller === undefined &&
      abortSignal?.aborted === true &&
      error === abortSignal.reason
    ) {
      return;
    }

    const failure = normalizedFailure(error, context);

    if (state.failure === undefined) state.failure = { error: failure };

    return reportFailure(failure, caller);
  };
}

function streamTextWithRedaction(
  target: ModelClient,
  input: ModelStreamInput,
  context: FailureContext,
  channels: ChannelOverrides,
): ModelStreamResult {
  const state: FailureState = {};
  let result: ModelStreamResult;

  try {
    result = target.streamText({
      ...input,
      onError: redactingOnError(
        input.onError,
        input.abortSignal,
        context,
        state,
      ),
    });
  } catch (error: unknown) {
    if (
      input.abortSignal?.aborted === true &&
      error === input.abortSignal.reason
    ) {
      throw error;
    }

    if (state.failure !== undefined) throw state.failure.error;
    throw normalizedFailure(error, context);
  }

  context.states.set(result, state);

  return wrapStreamTextResult(result, channels);
}

function generateObjectWithRedaction<OBJECT>(
  target: ModelClient,
  generateObject: NonNullable<ModelClient['generateObject']>,
  input: ModelObjectInput<OBJECT>,
  context: FailureContext,
): Promise<OBJECT> {
  return (async () => {
    try {
      // SAFETY: the captured method promises OBJECT; Function.call erases its generic result.
      // eslint-disable-next-line typescript/no-unsafe-type-assertion -- restore the declared result after receiver-preserving invocation.
      return await (generateObject.call(target, input) as Promise<OBJECT>);
    } catch (error: unknown) {
      if (
        input.abortSignal?.aborted === true &&
        error === input.abortSignal.reason
      ) {
        throw error;
      }

      throw normalizedFailure(error, context);
    }
  })();
}

/**
 * Wraps a provider client so its `streamText` and `generateObject` failures do
 * not carry configured credentials. The result proxy preserves metadata and
 * untouched members, while a shared failure context memoizes redactions and
 * captures the first typed stream failure for later SDK rejection channels.
 */
export function withRedactedFailures(
  client: ModelClient,
  credentials: ReadonlyArray<string>,
): ModelClient {
  const context: FailureContext = {
    credentials,
    memo: new WeakMap(),
    states: new WeakMap(),
  };

  const channels = redactedChannels(context);

  return new Proxy(client, {
    get(target, property, receiver) {
      if (property === 'streamText') {
        return (input: ModelStreamInput) =>
          streamTextWithRedaction(target, input, context, channels);
      }

      if (property === 'generateObject') {
        // eslint-disable-next-line typescript/unbound-method -- invoked with target as `this` in generateObjectWithRedaction.
        const generateObject = target.generateObject;

        if (generateObject === undefined) return undefined;

        return <OBJECT>(input: ModelObjectInput<OBJECT>) =>
          generateObjectWithRedaction(target, generateObject, input, context);
      }

      // eslint-disable-next-line anti-slop/no-reflect-get, typescript/no-unsafe-return -- pass-through read of an untouched client member; the trap has no per-property type, and the receiver-correct rationale is owned by wrapStreamTextResult.
      return Reflect.get(target, property, receiver);
    },
  });
}
