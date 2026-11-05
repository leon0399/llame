/**
 * The failure-value redaction design D3 defines: an error or a structured
 * failure object is rewritten in place so its identity and classification are
 * untouched, a graph that refuses the rewrite is rebuilt with every alias and
 * cycle preserved, and a string failure value (an abort reason) is redacted.
 */
import { APICallError } from '@ai-sdk/provider';
import { RetryError } from 'ai';
import { PROTECTED_VALUE_REDACTION_MARKER } from '@workspace/runtime-safety';

import { redactModelFailure } from './model-failure-redaction';
import { ModelStreamIdleError } from './stream-idle-watchdog';

/** A value that exists only inside the stubbed upstream's text. */
const CANARY = 'CONFIGURED-CREDENTIAL-7f3a';
const credentials = [CANARY];

function apiError(message: string): APICallError {
  return new APICallError({
    message,
    url: 'https://endpoint.example.test/v1',
    requestBodyValues: { model: 'test-model' },
    statusCode: 401,
  });
}

function surfaces(error: unknown): string {
  return error instanceof Error
    ? `${error.message}\n${error.stack ?? ''}`
    : String(error);
}

function asError(error: unknown): Error {
  if (!(error instanceof Error)) {
    throw new TypeError('expected an error');
  }
  return error;
}

describe('redactModelFailure', () => {
  it('redacts a string failure value that carries a credential', () => {
    const redacted = redactModelFailure(`failed: ${CANARY}`, credentials);

    expect(redacted).toBe(`failed: ${PROTECTED_VALUE_REDACTION_MARKER}`);
  });

  it('passes an abort reason through untouched', () => {
    expect(redactModelFailure('run-timeout', credentials)).toBe('run-timeout');
  });

  it('passes a value outside a failure graph through untouched', () => {
    expect(redactModelFailure(undefined, credentials)).toBeUndefined();
    expect(redactModelFailure(42, credentials)).toBeUndefined();
    expect(
      redactModelFailure(new Uint8Array([1, 2, 3]), credentials),
    ).toBeUndefined();
  });

  it('returns a failure without a credential as the same object', () => {
    const error = apiError('Upstream rejected the request.');

    expect(redactModelFailure(error, credentials)).toBe(error);
    expect(error.message).toBe('Upstream rejected the request.');
  });

  it('rewrites the failure in place, keeping its identity, name, and code', () => {
    const error = Object.assign(new Error(`Upstream echoed ${CANARY}`), {
      code: 'model_stream_idle',
      statusCode: 429,
    });

    const redacted = redactModelFailure(error, credentials);

    expect(redacted).toBe(error);
    expect(error.message).toBe(
      `Upstream echoed ${PROTECTED_VALUE_REDACTION_MARKER}`,
    );
    expect(surfaces(error)).not.toContain(CANARY);
    expect(error.name).toBe('Error');
    expect(error).toMatchObject({ code: 'model_stream_idle', statusCode: 429 });
  });

  it("keeps the run's idle-failure class and code intact", () => {
    const error = new ModelStreamIdleError();
    // A synthetic double: no shipped wire puts a credential in this message,
    // and the run classifies it by `instanceof` and `code`.
    error.message = `${error.message} ${CANARY}`;

    const redacted = redactModelFailure(error, credentials);

    expect(redacted).toBe(error);
    expect(error).toBeInstanceOf(ModelStreamIdleError);
    expect(error).toMatchObject({ code: 'model_stream_idle' });
    expect(surfaces(error)).not.toContain(CANARY);
  });

  it('keeps a name and code that carry text of their own', () => {
    const error = apiError('body');
    Object.defineProperty(error, 'code', {
      value: CANARY,
      writable: true,
      configurable: true,
      enumerable: true,
    });

    redactModelFailure(error, credentials);

    expect(error).toMatchObject({ code: CANARY });
  });

  it('keeps the AI SDK class marker and the class of the failure it redacts', () => {
    const error = apiError(`Upstream echoed ${CANARY}`);
    const before = redactModelFailure(error, credentials);

    expect(before).toBe(error);
    expect(APICallError.isInstance(error)).toBe(true);
    expect(
      Object.getOwnPropertyDescriptor(
        error,
        Symbol.for('vercel.ai.error.AI_APICallError'),
      )?.value,
    ).toBe(true);
  });

  it('redacts the rest of the message-bearing graph in place', () => {
    const error = new APICallError({
      message: `Upstream echoed ${CANARY}`,
      url: 'https://endpoint.example.test/v1',
      requestBodyValues: { model: 'test-model' },
      statusCode: 401,
      responseHeaders: { 'x-echo': CANARY },
      responseBody: `{"error":{"message":"${CANARY}"}}`,
      data: { error: { message: `nested ${CANARY}` } },
    });

    const redacted = redactModelFailure(error, credentials);

    expect(redacted).toBe(error);
    expect(error.responseHeaders).toMatchObject({
      'x-echo': PROTECTED_VALUE_REDACTION_MARKER,
    });
    expect(error.responseBody).toBe(
      `{"error":{"message":"${PROTECTED_VALUE_REDACTION_MARKER}"}}`,
    );
    expect(error.data).toEqual({
      error: { message: `nested ${PROTECTED_VALUE_REDACTION_MARKER}` },
    });
    expect(error.requestBodyValues).toEqual({ model: 'test-model' });
    expect(JSON.stringify(error.data)).not.toContain(CANARY);
  });

  it('redacts a structured failure object the Responses wire forwards', () => {
    const failure = {
      type: 'error',
      sequence_number: 3,
      message: `Upstream echoed ${CANARY}`,
    };

    const redacted = redactModelFailure(failure, credentials);

    expect(redacted).toBe(failure);
    expect(failure).toEqual({
      type: 'error',
      sequence_number: 3,
      message: `Upstream echoed ${PROTECTED_VALUE_REDACTION_MARKER}`,
    });
  });

  it('redacts a structured response.failed failure and keeps its classification', () => {
    const failure = {
      type: 'response.failed',
      sequence_number: 7,
      response: {
        error: { code: 'server_error', message: `echoed ${CANARY}` },
        incomplete_details: { reason: 'error' },
      },
    };

    const redacted = redactModelFailure(failure, credentials);

    expect(redacted).toBe(failure);
    expect(failure.type).toBe('response.failed');
    expect(failure.response).toEqual({
      error: {
        code: 'server_error',
        message: `echoed ${PROTECTED_VALUE_REDACTION_MARKER}`,
      },
      incomplete_details: { reason: 'error' },
    });
    expect(JSON.stringify(failure)).not.toContain(CANARY);
  });

  it('keeps an array of plain-object failures redacted and in place', () => {
    const failures = [{ message: `one ${CANARY}` }, { message: 'two' }];

    expect(redactModelFailure(failures, credentials)).toBe(failures);
    expect(failures[0]?.message).toBe(
      `one ${PROTECTED_VALUE_REDACTION_MARKER}`,
    );
    expect(failures[1]?.message).toBe('two');
  });

  it('redacts a credential in cause, lastError, and errors[]', () => {
    const lastError = apiError(`rate limit for ${CANARY}`);
    const retried = new RetryError({
      message: `Failed after 2 attempts. ${CANARY}`,
      reason: 'maxRetriesExceeded',
      errors: [apiError(`first attempt ${CANARY}`), lastError],
    });

    const redacted = redactModelFailure(retried, credentials);

    expect(redacted).toBe(retried);
    expect(RetryError.isInstance(retried)).toBe(true);
    expect(retried.lastError).toBe(lastError);
    expect(surfaces(retried.lastError)).toContain(
      PROTECTED_VALUE_REDACTION_MARKER,
    );
    for (const error of retried.errors) {
      expect(surfaces(error)).not.toContain(CANARY);
    }
    expect(surfaces(retried)).not.toContain(CANARY);
  });

  it('redacts a credential under a symbol-keyed own property', () => {
    const error = new Error('plain');
    const key = Symbol('tenant-note');
    Object.defineProperty(error, key, {
      value: `echo ${CANARY}`,
      writable: true,
      configurable: true,
      enumerable: true,
    });

    redactModelFailure(error, credentials);

    expect(Object.getOwnPropertyDescriptor(error, key)?.value).toBe(
      `echo ${PROTECTED_VALUE_REDACTION_MARKER}`,
    );
  });

  it('reports a frozen error through a redacted replacement that still classifies', () => {
    const frozen = Object.freeze(apiError(`Upstream echoed ${CANARY}`));

    const redacted = redactModelFailure(frozen, credentials);

    expect(redacted).not.toBe(frozen);
    const error = asError(redacted);
    expect(error).toBeInstanceOf(APICallError);
    expect(APICallError.isInstance(error)).toBe(true);
    expect(error.message).toContain(PROTECTED_VALUE_REDACTION_MARKER);
    expect(surfaces(error)).not.toContain(CANARY);
    expect(error).toMatchObject({
      statusCode: 401,
      name: 'AI_APICallError',
    });
    expect(
      Object.getOwnPropertyDescriptor(
        error,
        Symbol.for('vercel.ai.error.AI_APICallError'),
      )?.value,
    ).toBe(true);
  });

  it('reports an error whose message cannot be redefined through a replacement', () => {
    const error = new Error('hidden');
    Object.defineProperty(error, 'message', {
      value: `Upstream echoed ${CANARY}`,
      writable: false,
      configurable: false,
      enumerable: false,
    });

    const redacted = redactModelFailure(error, credentials);

    expect(redacted).not.toBe(error);
    const replacement = asError(redacted);
    expect(replacement).toBeInstanceOf(Error);
    expect(replacement.message).toContain(PROTECTED_VALUE_REDACTION_MARKER);
    expect(surfaces(replacement)).not.toContain(CANARY);
  });

  it('never leaks a frozen child through its alias (RetryError.lastError)', () => {
    const frozenLast = Object.freeze(apiError(`limit ${CANARY}`));
    const retried = new RetryError({
      message: 'Failed after 2 attempts',
      reason: 'maxRetriesExceeded',
      errors: [apiError('first attempt'), frozenLast],
    });

    const redacted = asError(redactModelFailure(retried, credentials));
    if (!RetryError.isInstance(redacted)) {
      throw new TypeError('expected the retry wrapper to survive');
    }

    expect(redacted).not.toBe(retried);
    expect(surfaces(redacted.errors.at(-1))).not.toContain(CANARY);
    expect(redacted.lastError).toBe(redacted.errors.at(-1));
    expect(surfaces(redacted.lastError)).toContain(
      PROTECTED_VALUE_REDACTION_MARKER,
    );
  });

  it('replaces every reference to the same frozen child (AggregateError)', () => {
    const frozen = Object.freeze(apiError(`echoed ${CANARY}`));
    const aggregate = new AggregateError([frozen, frozen], 'both failed');

    const redacted = asError(redactModelFailure(aggregate, credentials));
    if (!(redacted instanceof AggregateError)) {
      throw new TypeError('expected the aggregate error to survive');
    }

    expect(redacted).not.toBe(aggregate);
    expect(redacted.errors[0]).toBe(redacted.errors[1]);
    expect(surfaces(redacted.errors[0])).not.toContain(CANARY);
    expect(surfaces(redacted.errors[0])).toContain(
      PROTECTED_VALUE_REDACTION_MARKER,
    );
  });

  it('rebuilds a cycle that contains frozen nodes without keeping an original', () => {
    const first = new Error(`first ${CANARY}`);
    const second = new Error(`second ${CANARY}`);
    first.cause = second;
    second.cause = first;
    Object.freeze(first);
    Object.freeze(second);

    const redacted = asError(redactModelFailure(first, credentials));
    const cause = asError(redacted.cause);

    expect(redacted).not.toBe(first);
    expect(cause).not.toBe(second);
    expect(cause.cause).toBe(redacted);
    expect(surfaces(redacted)).not.toContain(CANARY);
    expect(surfaces(cause)).not.toContain(CANARY);
  });

  it('does not throw when an accessor cannot be read', () => {
    const error = new Error(`Upstream echoed ${CANARY}`);
    Object.defineProperty(error, 'unreadable', {
      get() {
        throw new Error('the getter rejects');
      },
      enumerable: true,
      configurable: false,
    });

    const redacted = asError(redactModelFailure(error, credentials));

    expect(redacted).not.toBe(error);
    expect('unreadable' in redacted).toBe(false);
    expect(redacted.message).toContain(PROTECTED_VALUE_REDACTION_MARKER);
    expect(surfaces(redacted)).not.toContain(CANARY);
  });

  it('materializes an accessor that returns a credential-bearing graph', () => {
    const error = new Error('plain');
    Object.defineProperty(error, 'details', {
      get: () => ({ message: `echoed ${CANARY}` }),
      enumerable: true,
      configurable: false,
    });

    const redacted = asError(redactModelFailure(error, credentials));
    const descriptor = Object.getOwnPropertyDescriptor(redacted, 'details');
    const details: unknown = descriptor?.value;

    expect(details).toEqual({
      message: `echoed ${PROTECTED_VALUE_REDACTION_MARKER}`,
    });
    expect(JSON.stringify(details)).not.toContain(CANARY);
  });

  it('does not loop on a cause cycle', () => {
    const error = new Error(`Upstream echoed ${CANARY}`);
    error.cause = error;

    const redacted = redactModelFailure(error, credentials);

    expect(redacted).toBe(error);
    expect(error.cause).toBe(error);
    expect(surfaces(error)).not.toContain(CANARY);
  });

  it('passes every value through when no credential is configured', () => {
    const error = apiError(`Upstream echoed ${CANARY}`);

    expect(redactModelFailure(error, [])).toBe(error);
    expect(error.message).toContain(CANARY);
  });
});
