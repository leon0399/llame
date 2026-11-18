import { isString } from '@workspace/runtime-safety';
import type { LanguageModelV3CallOptions } from '@ai-sdk/provider';
import { MockLanguageModelV3 } from 'ai/test';

import { ModelStreamIdleError } from './stream-idle-watchdog';

import {
  ProviderFailure,
  type FailureInput,
} from './provider-failure/provider-failure';
import {
  classifiedFailure,
  withProviderFailures,
} from './provider-failure-middleware';

function options(signal?: AbortSignal) {
  return {
    provider: 'test-provider',
    classify: vi.fn(
      ({ error }: FailureInput) =>
        new ProviderFailure(error instanceof Error ? error.message : 'bad', {
          code: 'rate_limited',
          resetsAt: 1_900_000_000_000,
          statusCode: 429,
        }),
    ),
    sanitize: vi.fn(() => new Error('bounded provider failure')),
    ...(signal !== undefined && { abortSignal: signal }),
  };
}

describe('withProviderFailures', () => {
  it('bounds error parts and does not retain raw error graphs', async () => {
    const raw = Object.assign(new Error('body secret'), {
      body: { token: 'credential secret' },
      headers: { authorization: 'credential secret' },
    });

    const middlewareOptions = options();

    const model = new MockLanguageModelV3({
      doStream: () =>
        Promise.resolve({
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({ type: 'error', error: raw });
              controller.close();
            },
          }),
          response: { headers: { 'x-request-id': 'request-1' } },
        }),
    });

    const wrapped = withProviderFailures(model, middlewareOptions);

    const result = await wrapped.doStream({
      prompt: [],
    } satisfies LanguageModelV3CallOptions);

    const reader = result.stream.getReader();
    const part = await reader.read();

    expect(part.value?.type).toBe('error');

    if (part.value?.type !== 'error') throw new Error('expected error part');
    expect(part.value.error).toMatchObject({
      name: 'ProviderFailure',
      code: 'rate_limited',
      resetsAt: 1_900_000_000_000,
      statusCode: 429,
      message: 'bounded provider failure',
    });
    expect(Object.getOwnPropertyNames(part.value.error)).not.toContain('cause');
    expect(JSON.stringify(part.value.error)).not.toContain('secret');
    expect(middlewareOptions.classify).toHaveBeenCalledWith(
      expect.objectContaining({ error: raw, provider: 'test-provider' }),
    );
  });

  it('isolates per-send response headers when classifying stream failures', async () => {
    const middlewareOptions = options();

    const wrapped = withProviderFailures(
      new MockLanguageModelV3({
        doStream: ({ headers }) => {
          const requestId = headers?.['x-request-id'];

          return Promise.resolve({
            stream: new ReadableStream({
              start(controller) {
                controller.enqueue({
                  type: 'error',
                  error: new Error('failed'),
                });
                controller.close();
              },
            }),
            response: {
              headers: {
                ...(isString(requestId) && { 'x-request-id': requestId }),
              },
            },
          });
        },
      }),
      middlewareOptions,
    );

    const results = await Promise.all(
      ['request-a', 'request-b'].map((id) =>
        wrapped.doStream({ prompt: [], headers: { 'x-request-id': id } }),
      ),
    );

    await Promise.all(
      results.map((result) => result.stream.getReader().read()),
    );
    expect(
      middlewareOptions.classify.mock.calls.map(([input]) => input.headers),
    ).toEqual([
      { 'x-request-id': 'request-a' },
      { 'x-request-id': 'request-b' },
    ]);
  });

  it('preserves abort reason identity and does not classify it', async () => {
    const reason = new Error('caller abort');
    const controller = new AbortController();
    controller.abort(reason);
    const middlewareOptions = options(controller.signal);

    const wrapped = withProviderFailures(
      new MockLanguageModelV3({
        doStream: () =>
          Promise.resolve({
            stream: new ReadableStream({
              start(streamController) {
                streamController.enqueue({ type: 'error', error: reason });
                streamController.close();
              },
            }),
          }),
      }),
      middlewareOptions,
    );

    const result = await wrapped.doStream({
      prompt: [],
      abortSignal: controller.signal,
    });

    const part = await result.stream.getReader().read();

    expect(part.value).toEqual({ type: 'error', error: reason });

    if (part.value?.type !== 'error') throw new Error('expected error part');
    expect(part.value.error).toBe(reason);
    expect(middlewareOptions.classify).not.toHaveBeenCalled();
  });

  it('preserves watchdog failures by identity', () => {
    const middlewareOptions = options();
    const error = new ModelStreamIdleError();

    expect(classifiedFailure(error, middlewareOptions)).toBe(error);
    expect(middlewareOptions.classify).not.toHaveBeenCalled();
  });
  it('classifies raw errors before sanitizing and preserves final SDK retry errors', () => {
    const raw = Object.assign(new Error('raw failure'), { body: 'secret' });
    const middlewareOptions = options();
    const classified = classifiedFailure(raw, middlewareOptions);

    expect(middlewareOptions.classify).toHaveBeenCalledWith(
      expect.objectContaining({ error: raw }),
    );
    expect(middlewareOptions.sanitize).toHaveBeenCalledWith(raw);
    expect(classified).toBeInstanceOf(ProviderFailure);
    expect(classified).toMatchObject({ message: 'bounded provider failure' });
  });
  it('classifies rejected stream reads as an error frame at the consumer boundary', async () => {
    const raw = new Error('reader rejected');
    const middlewareOptions = options();

    const wrapped = withProviderFailures(
      new MockLanguageModelV3({
        doStream: () =>
          Promise.resolve({
            stream: new ReadableStream({
              start(controller) {
                controller.error(raw);
              },
            }),
          }),
      }),
      middlewareOptions,
    );

    const result = await wrapped.doStream({ prompt: [] });
    const frame = await result.stream.getReader().read();

    expect(frame.value?.type).toBe('error');

    if (frame.value?.type !== 'error') throw new Error('expected error frame');
    expect(frame.value.error).toMatchObject({
      message: 'bounded provider failure',
    });
    expect(middlewareOptions.classify).toHaveBeenCalledWith(
      expect.objectContaining({ error: raw }),
    );
  });

  it('forwards cancellation to the provider stream reader', async () => {
    const reason = new Error('consumer stopped');
    const canceled = Promise.withResolvers<unknown>();
    const middlewareOptions = options();

    const wrapped = withProviderFailures(
      new MockLanguageModelV3({
        doStream: () =>
          Promise.resolve({
            stream: new ReadableStream({
              cancel(cancelReason) {
                canceled.resolve(cancelReason);
              },
            }),
          }),
      }),
      middlewareOptions,
    );

    const result = await wrapped.doStream({ prompt: [] });

    await result.stream.cancel(reason);
    expect(await canceled.promise).toBe(reason);
    expect(middlewareOptions.classify).not.toHaveBeenCalled();
  });

  it('uses the per-send abort signal instead of the configured fallback signal', async () => {
    const configuredReason = new Error('configured abort');
    const sendReason = new Error('send abort');
    const configured = new AbortController();
    const perSend = new AbortController();
    configured.abort(configuredReason);
    perSend.abort(sendReason);
    const middlewareOptions = options(configured.signal);

    const wrapped = withProviderFailures(
      new MockLanguageModelV3({
        doStream: () =>
          Promise.resolve({
            stream: new ReadableStream({
              start(controller) {
                controller.enqueue({ type: 'error', error: sendReason });
                controller.close();
              },
            }),
          }),
      }),
      middlewareOptions,
    );

    const result = await wrapped.doStream({
      prompt: [],
      abortSignal: perSend.signal,
    });

    const frame = await result.stream.getReader().read();

    expect(frame.value).toEqual({ type: 'error', error: sendReason });
    expect(middlewareOptions.classify).not.toHaveBeenCalled();
  });
});
