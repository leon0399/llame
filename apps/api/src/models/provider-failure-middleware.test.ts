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

    const raw = new Error('raw');

    const onError = vi.fn();

    const request = {
      onError,
    };

    const sanitize = captureRequestFailure(request, (error) =>
      error === raw ? failure : error,
    );

    request.onError?.({ error: raw });

    expect(sanitize(new NoOutputGeneratedError())).toBe(failure);
    expect(onError).toHaveBeenCalledWith({ error: failure });
  });

  it('reports every failed send before the error handler with the sanitized error', () => {
    const failure = new ProviderFailure('bounded provider failure', {
      code: 'server_error',
    });

    const onSendFailed = vi.fn();
    const onError = vi.fn();

    const request = { onError, onSendFailed };

    captureRequestFailure(request, () => failure);

    request.onError?.({ error: new Error('raw') });
    request.onError?.({ error: new Error('again') });

    expect(onSendFailed).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onSendFailed).toHaveBeenNthCalledWith(1, failure);
    expect(onSendFailed).toHaveBeenNthCalledWith(2, failure);
    expect(onSendFailed.mock.invocationCallOrder[0]).toBeLessThan(
      onError.mock.invocationCallOrder[0] ?? Infinity,
    );
    expect(onSendFailed.mock.invocationCallOrder[1]).toBeLessThan(
      onError.mock.invocationCallOrder[1] ?? Infinity,
    );
  });
});
