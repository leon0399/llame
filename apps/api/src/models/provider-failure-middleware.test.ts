import { NoOutputGeneratedError } from 'ai';

import {
  ProviderFailure,
  type FailureInput,
} from './provider-failure/provider-failure';
import {
  captureRequestFailure,
  classifiedFailure,
  type ProviderFailureMiddlewareOptions,
} from './provider-failure-middleware';

function options(signal?: AbortSignal): ProviderFailureMiddlewareOptions {
  return {
    provider: 'test-provider',
    classify: vi.fn(
      ({ error }: FailureInput) =>
        new ProviderFailure(error instanceof Error ? error.message : 'bad', {
          code: 'server_error',
        }),
    ),
    sanitize: vi.fn(() => new Error('bounded provider failure')),
    ...(signal !== undefined && { abortSignal: signal }),
  };
}

describe('provider failure helpers', () => {
  it('classifies before sanitizing and retains only bounded failure details', () => {
    const middlewareOptions = options();

    const raw = Object.assign(new Error('response secret'), {
      body: { token: 'credential secret' },
    });

    const failure = classifiedFailure(raw, middlewareOptions);

    expect(failure).toMatchObject({
      message: 'bounded provider failure',
      code: 'server_error',
    });
    expect(Object.getOwnPropertyNames(failure)).not.toContain('cause');
    expect(JSON.stringify(failure)).not.toContain('secret');
    expect(middlewareOptions.classify).toHaveBeenCalledWith(
      expect.objectContaining({ error: raw, provider: 'test-provider' }),
    );
  });

  it('preserves abort reason identity without classifying it', () => {
    const controller = new AbortController();
    const reason = new Error('owner abort');
    controller.abort(reason);
    const middlewareOptions = options(controller.signal);

    expect(classifiedFailure(reason, middlewareOptions)).toBe(reason);
    expect(middlewareOptions.classify).not.toHaveBeenCalled();
  });

  it('captures the provider failure when the SDK rejects with no output', () => {
    const failure = new ProviderFailure('bounded provider failure', {
      code: 'rate_limited',
    });

    const onError = vi.fn();

    const request = {
      onError,
    };

    const sanitize = captureRequestFailure(request, () => failure);

    request.onError?.({ error: new Error('raw') });

    expect(sanitize(new NoOutputGeneratedError())).toBe(failure);
    expect(onError).toHaveBeenCalledWith({ error: failure });
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
