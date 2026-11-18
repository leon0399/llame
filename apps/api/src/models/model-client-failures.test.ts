/**
 * The client boundary of the failure redaction (design D3): every promise
 * channel a result exposes and `consumeStream` reject with the redacted
 * failure, a frozen failure is shared by every channel as one replacement, a
 * rejected structured generation is redacted, and an abort reason is forwarded
 * to a caller handler but never logged as a failure.
 */
import { Logger } from '@nestjs/common';
import { APICallError } from '@ai-sdk/provider';
import { generateObject, jsonSchema, streamText, type ModelMessage } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { isString } from '@workspace/runtime-safety';
import type { MockInstance } from 'vitest';

import type {
  ChatIdentity,
  ModelClient,
  ModelStreamResult,
} from './model-client';
import {
  STREAM_PROMISE_CHANNELS,
  withRedactedFailures,
} from './model-client-failures';
import { wrapStreamTextResult } from './stream-text-result-proxy';

const CHAT: ChatIdentity = { id: 'chat-test', lane: 'main' };

const messages = [
  { role: 'user', content: 'Say hello.' },
] satisfies Array<ModelMessage>;

const KEY = 'CONFIGURED-KEY-CANARY-4c1d';

type ChannelOverride = (target: ModelStreamResult) => {
  readonly value: unknown;
};

function apiError(message: string): APICallError {
  return new APICallError({
    message,
    url: 'https://endpoint.example.test/v1',
    requestBodyValues: { model: 'test-model' },
    statusCode: 401,
  });
}

function failingModel(error: unknown): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doStream: () =>
      Promise.resolve({
        stream: new ReadableStream({
          start(controller) {
            controller.error(error);
          },
        }),
      }),
    // eslint-disable-next-line typescript/prefer-promise-reject-errors -- the SDK rejects with the request's failure, the abort reason string included.
    doGenerate: () => Promise.reject(error),
  });
}

/**
 * A result whose promise channels and `consumeStream` all reject with `error`
 * — the shape every channel takes when the request fails. The SDK's own
 * `consumeStream` swallows a stream error, and its promise channels create
 * rejections that a partial read would leave unhandled, so the double
 * substitutes its own rejections on exactly the channels the wrapper reads.
 */
function rejectingResult(error: unknown): ModelStreamResult {
  const reject = async () => {
    throw await error;
  };

  const channels: Array<[string, ChannelOverride]> = [
    ...STREAM_PROMISE_CHANNELS.map((channel): [string, ChannelOverride] => [
      channel,
      () => ({
        value: reject(),
      }),
    ]),
    [
      'consumeStream',
      () => ({
        value: reject,
      }),
    ],
  ];

  return wrapStreamTextResult(
    streamText({ model: failingModel(error), messages, maxRetries: 0 }),
    Object.fromEntries(channels),
  );
}

/**
 * A client whose request fails with `error`: it reports the failure to
 * `onError` the way a real client does on abort, then its result rejects each
 * channel with it; structured generation rejects through the SDK.
 */
function failingClient(error: unknown, reportError = true): ModelClient {
  return {
    model: 'test-model',
    provider: 'test',
    contextWindowTokens: 128_000,
    streamText: (input) => {
      if (reportError) void input.onError?.({ error });

      return rejectingResult(error);
    },
    generateObject: (input) =>
      generateObject({
        model: failingModel(error),
        messages: input.messages,
        schema: input.schema,
        maxRetries: 0,
      }).then((result) => result.object),
  };
}

async function rejection(
  promise: PromiseLike<unknown> | undefined,
): Promise<Error | string | undefined> {
  return Promise.resolve(promise).then(
    () => undefined,
    (error: unknown) =>
      error instanceof Error || isString(error) ? error : String(error),
  );
}

describe('withRedactedFailures', () => {
  let loggerError: MockInstance;

  beforeEach(() => {
    loggerError = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('waits for asynchronous failure persistence before stream settlement', async () => {
    const entered = Promise.withResolvers<void>();
    const persist = Promise.withResolvers<void>();
    const providerError = apiError('authentication failed');

    const client = withRedactedFailures(
      {
        ...failingClient(providerError),
        streamText: (input) =>
          streamText({
            model: new MockLanguageModelV3({
              doStream: () =>
                Promise.resolve({
                  stream: new ReadableStream({
                    start(controller) {
                      controller.enqueue({
                        type: 'error',
                        error: providerError,
                      });
                      controller.close();
                    },
                  }),
                }),
            }),
            messages: input.messages,
            onError: input.onError,
            maxRetries: 0,
          }),
      },
      [KEY],
    );

    let persisted = false;
    let settled = false;

    const result = client.streamText({
      chat: CHAT,
      messages,
      onError: async () => {
        entered.resolve();
        await persist.promise;
        persisted = true;
      },
    });

    const completion = rejection(result.text).then(() => {
      settled = true;
    });

    await entered.promise;
    await Promise.resolve();

    expect(settled).toBe(false);
    persist.resolve();
    await completion;
    expect(persisted).toBe(true);
  });

  it('preserves an owner settlement failure after reporting a provider failure', async () => {
    const providerError = apiError('authentication failed');
    const ownerError = new Error('failure persistence rejected');

    const client = withRedactedFailures(
      {
        ...failingClient(providerError),
        streamText: (input) => {
          void input.onError?.({ error: providerError });

          return rejectingResult(ownerError);
        },
      },
      [KEY],
    );

    const result = client.streamText({
      chat: CHAT,
      messages,
      onError: () => undefined,
    });

    expect(await rejection(result.text)).toBe(ownerError);
    expect(await rejection(result.consumeStream())).toBe(ownerError);
  });
  it('settles channel failures with the owner callback rejection', async () => {
    const providerError = apiError(`provider failure ${KEY}`);
    const callbackError = new Error('owner callback rejected');

    const client = withRedactedFailures(
      {
        ...failingClient(providerError),
        streamText: (input) => {
          const callback = input.onError?.({ error: providerError });

          const failure = callback
            ? Promise.resolve(callback).then(
                () => providerError,
                (error: unknown) => error,
              )
            : Promise.resolve(providerError);

          return rejectingResult(failure);
        },
      },
      [KEY],
    );

    const result = client.streamText({
      chat: CHAT,
      messages,
      onError: () => Promise.reject(callbackError),
    });

    expect(await rejection(result.text)).toBe(callbackError);
    expect(await rejection(result.consumeStream())).toBe(callbackError);
  });

  it('redacts a synchronous streamText failure before rethrowing it', () => {
    const error = apiError(`echoed ${KEY}`);

    const client = withRedactedFailures(
      {
        ...failingClient(error),
        streamText: () => {
          throw error;
        },
      },
      [KEY],
    );

    let caught: unknown;

    try {
      client.streamText({ chat: CHAT, messages });
    } catch (error: unknown) {
      caught = error;
    }

    expect(caught).toBe(error);
    expect(APICallError.isInstance(caught)).toBe(true);
    expect(caught).toMatchObject({ message: 'echoed [REDACTED]' });
  });

  it('redacts a synchronous generateObject failure before rejecting', async () => {
    const error = apiError(`echoed ${KEY}`);

    const client = withRedactedFailures(
      {
        ...failingClient(error),
        generateObject: (input) => {
          void input;
          throw error;
        },
      },
      [KEY],
    );

    const failure = await rejection(
      client.generateObject?.({
        chat: CHAT,
        messages,
        schema: jsonSchema<{ title: string }>({
          type: 'object',
          properties: { title: { type: 'string' } },
          required: ['title'],
        }),
      }),
    );

    expect(failure).toBe(error);
    expect(APICallError.isInstance(failure)).toBe(true);
    expect(failure).toMatchObject({ message: 'echoed [REDACTED]' });
  });

  it('redacts the failure every promise channel and consumeStream rejects with', async () => {
    const error = apiError(`echoed ${KEY}`);

    // No handler reports the failure here: the channel wrappers alone must
    // redact what each channel rejects with.
    const client = withRedactedFailures(failingClient(error, false), [KEY]);
    const result = client.streamText({ chat: CHAT, messages });

    const failures = [
      ...(await Promise.all(
        STREAM_PROMISE_CHANNELS.map((channel) =>
          // SAFETY: every listed channel is a promise channel on the result;
          // the union of their element types narrows to its thenable form.
          rejection(result[channel] as PromiseLike<unknown>),
        ),
      )),
      await rejection(result.consumeStream()),
    ];

    expect(failures).toHaveLength(STREAM_PROMISE_CHANNELS.length + 1);

    for (const failure of failures) {
      expect(failure).toBe(error);
      expect(APICallError.isInstance(failure)).toBe(true);
      expect(failure).toMatchObject({
        message: 'echoed [REDACTED]',
        statusCode: 401,
      });
    }
  });

  it('reports a frozen failure through one shared replacement on every channel', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    const frozen = Object.freeze(apiError(`echoed ${KEY}`));

    const client = withRedactedFailures(failingClient(frozen), [KEY]);
    const result = client.streamText({ chat: CHAT, messages });

    const rejected = [
      await rejection(result.text),
      await rejection(result.usage),
      await rejection(result.consumeStream()),
    ];

    const [first] = rejected;

    for (const failure of rejected) {
      expect(failure).toBe(first);
      expect(APICallError.isInstance(failure)).toBe(true);
      expect(failure).not.toBe(frozen);
      expect(failure).toMatchObject({ message: 'echoed [REDACTED]' });
    }

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('redacts a rejected structured generation', async () => {
    const error = apiError(`echoed ${KEY}`);
    const client = withRedactedFailures(failingClient(error), [KEY]);

    const failure = await rejection(
      client.generateObject?.({
        chat: CHAT,
        messages,
        schema: jsonSchema<{ title: string }>({
          type: 'object',
          properties: { title: { type: 'string' } },
          required: ['title'],
        }),
      }),
    );

    expect(failure).toBe(error);
    expect(APICallError.isInstance(failure)).toBe(true);
    expect(failure).toMatchObject({ message: 'echoed [REDACTED]' });
  });

  it('does not log the reason of a request the caller aborted', async () => {
    const controller = new AbortController();
    const reason = `aborted for ${KEY}`;
    controller.abort(reason);
    const client = withRedactedFailures(failingClient(reason), [KEY]);

    await rejection(
      client.streamText({
        chat: CHAT,
        messages,
        abortSignal: controller.signal,
      }).text,
    );

    expect(loggerError).not.toHaveBeenCalled();
  });

  it('forwards a redacted abort reason to the caller handler', async () => {
    const controller = new AbortController();
    const reason = `aborted for ${KEY}`;
    controller.abort(reason);
    const client = withRedactedFailures(failingClient(reason), [KEY]);
    const reported: Array<unknown> = [];

    await rejection(
      client.streamText({
        chat: CHAT,
        messages,
        abortSignal: controller.signal,
        onError: ({ error }) => {
          reported.push(error);
        },
      }).text,
    );

    expect(reported).toEqual(['aborted for [REDACTED]']);
  });
  it('redacts fullStream error frames and rejected reads at consumption', async () => {
    const error = apiError(`stream failed ${KEY}`);
    const rawReadError = apiError(`read failed ${KEY}`);

    const client = withRedactedFailures(
      {
        ...failingClient(error, false),
        streamText: () => {
          const result = rejectingResult(error);

          const fullStream = new ReadableStream({
            start(controller) {
              controller.enqueue({ type: 'error', error });
              controller.close();
            },
          });

          const textStream = new ReadableStream({
            start(controller) {
              controller.error(rawReadError);
            },
          });

          return wrapStreamTextResult(result, {
            fullStream: () => ({ value: fullStream }),
            textStream: () => ({ value: textStream }),
          });
        },
      },
      [KEY],
    );

    const result = client.streamText({ chat: CHAT, messages });

    const frame = await result.fullStream.getReader().read();
    expect(frame.value).toMatchObject({
      type: 'error',
      error: { message: 'stream failed [REDACTED]' },
    });
    const readFailure = await rejection(result.textStream.getReader().read());
    expect(readFailure).toBe(rawReadError);
    expect(readFailure).toMatchObject({ message: 'read failed [REDACTED]' });
  });

  it('forwards actual fullStream cancellation to its source reader', async () => {
    const cancelReason = new Error('stop reading');
    const canceled = Promise.withResolvers<unknown>();

    const source = new ReadableStream({
      cancel(reason) {
        canceled.resolve(reason);
      },
    });

    const client = withRedactedFailures(
      {
        ...failingClient(new Error('unused'), false),
        streamText: () =>
          wrapStreamTextResult(rejectingResult(new Error('unused')), {
            fullStream: () => ({ value: source }),
          }),
      },
      [KEY],
    );

    await client
      .streamText({ chat: CHAT, messages })
      .fullStream.cancel(cancelReason);
    expect(await canceled.promise).toBe(cancelReason);
  });

  it('does not replace an unrelated owner channel error with captured SDK failure', async () => {
    const captured = apiError(`provider failed ${KEY}`);
    const ownerError = new Error('owner channel failed');

    const client = withRedactedFailures(
      {
        ...failingClient(captured),
        streamText: (input) => {
          void input.onError?.({ error: captured });
          const result = rejectingResult(captured);

          return wrapStreamTextResult(result, {
            text: () => ({ value: Promise.reject(ownerError) }),
          });
        },
      },
      [KEY],
    );

    const result = client.streamText({ chat: CHAT, messages });
    expect(await rejection(result.text)).toBe(ownerError);
  });

  it('does not eagerly access promise channels when wrapping a result', () => {
    const error = apiError(`lazy ${KEY}`);
    const result = rejectingResult(error);
    let accessed = 0;

    const lazy = wrapStreamTextResult(result, {
      text: (target) => {
        accessed += 1;

        return { value: target.text };
      },
    });

    const client = withRedactedFailures(
      { ...failingClient(error, false), streamText: () => lazy },
      [KEY],
    );

    client.streamText({ chat: CHAT, messages });
    expect(accessed).toBe(0);
  });

  it('leaves every failure untouched when no credential is configured', async () => {
    const error = apiError(`echoed ${KEY}`);
    const client = withRedactedFailures(failingClient(error), []);
    const result = client.streamText({ chat: CHAT, messages });

    const failure = await rejection(result.text);

    expect(failure).toBe(error);
    expect(error.message).toContain(KEY);
  });
});
