/**
 * The failure-value redaction design D3 defines: an error is rewritten in
 * place so its identity and classification are untouched, a failure that
 * refuses the rewrite is replaced on the same prototype, and a string failure
 * value (an abort reason) is redacted in place.
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

describe('redactModelFailure', () => {
  it('redacts a string failure value that carries a credential', () => {
    const redacted = redactModelFailure(`failed: ${CANARY}`, credentials);

    expect(redacted).toBe(`failed: ${PROTECTED_VALUE_REDACTION_MARKER}`);
  });

  it('passes an abort reason through untouched', () => {
    expect(redactModelFailure('run-timeout', credentials)).toBe('run-timeout');
  });

  it('passes a value that is neither an error nor a string through untouched', () => {
    expect(redactModelFailure(undefined, credentials)).toBeUndefined();
    expect(redactModelFailure(42, credentials)).toBeUndefined();
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
    if (!(redacted instanceof Error)) {
      throw new TypeError('expected an error replacement');
    }
    expect(redacted).toBeInstanceOf(APICallError);
    expect(APICallError.isInstance(redacted)).toBe(true);
    expect(redacted.message).toContain(PROTECTED_VALUE_REDACTION_MARKER);
    expect(surfaces(redacted)).not.toContain(CANARY);
    expect(redacted).toMatchObject({
      statusCode: 401,
      name: 'AI_APICallError',
    });
    expect(
      Object.getOwnPropertyDescriptor(
        redacted,
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
    if (!(redacted instanceof Error)) {
      throw new TypeError('expected an error replacement');
    }
    expect(redacted).toBeInstanceOf(Error);
    expect(redacted.message).toContain(PROTECTED_VALUE_REDACTION_MARKER);
    expect(surfaces(redacted)).not.toContain(CANARY);
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
