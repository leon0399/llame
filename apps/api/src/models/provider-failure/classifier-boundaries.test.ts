import { describe, expect, it } from 'vitest';

import { classifyAnthropic } from './classify-anthropic';
import { classifyCompletions } from './classify-completions';
import { classifyResponses } from './classify-responses';
import {
  bodyResetAt,
  header,
  parseDurationMs,
  parseEpochSeconds,
  parseInstant,
  parseRetryAfter,
  type FailureContext,
} from './classifier-utils';
import { FAILURE_CLASSES, type FailureInput } from './provider-failure';

const now = Date.UTC(2026, 0, 1);

function sdkError(fields: FailureInput['error'] = {}) {
  return Object.assign(new Error('request failed'), fields);
}

describe('provider classifier input boundaries', () => {
  it.each([
    [
      classifyResponses,
      'openai',
      {
        response: {
          status: '429',
          body: '{"error":{"code":"rate_limit_exceeded"}}',
          headers: {
            'X-RateLimit-Remaining-Requests': '0',
            'X-RateLimit-Reset-Requests': '3s',
          },
        },
      },
      { code: 'rate_limited', resetsAt: now + 3000 },
    ],
    [
      classifyCompletions,
      'openai',
      {
        statusCode: 429,
        responseBody: '{"error":{"code":"rate_limit_exceeded"}}',
        responseHeaders: {
          'x-ratelimit-remaining-requests': '0',
          'x-ratelimit-reset-requests': '3s',
        },
      },
      { code: 'rate_limited', resetsAt: now + 3000 },
    ],
  ] as const)(
    'reads supported SDK envelope and header variants',
    (classify, provider, error, expected) => {
      const failure = classify({ provider, error, now });

      expect(failure.code).toBe(expected.code);
      expect(failure.resetsAt).toBe(expected.resetsAt);
    },
  );
  it.each([
    {
      error: {
        response: {
          status: 429,
          body: { error: { code: 'rate_limit_exceeded' } },
          headers: {
            'X-RateLimit-Remaining-Requests': '0',
            'X-RateLimit-Reset-Requests': '2s',
          },
        },
      },
      expectedReset: now + 2000,
    },
    {
      error: sdkError({
        statusCode: 429,
        responseBody: { error: { code: 'rate_limit_exceeded' } },
        responseHeaders: {
          'x-ratelimit-remaining-requests': '0',
          'x-ratelimit-reset-requests': '3s',
        },
        response: {
          headers: {
            'x-ratelimit-remaining-requests': '0',
            'x-ratelimit-reset-requests': '2s',
          },
        },
      }),
      expectedReset: now + 3000,
    },
    {
      error: {
        response: {
          status: 429,
          body: { error: { code: 'rate_limit_exceeded' } },
          headers: {
            'x-ratelimit-remaining-requests': '0',
            'x-ratelimit-reset-requests': '6m',
          },
        },
      },
      expectedReset: now + 6 * 60_000,
    },
    {
      error: {
        response: {
          status: 429,
          body: { error: { code: 'rate_limit_exceeded' } },
          headers: {
            'x-ratelimit-remaining-requests': '0',
            'x-ratelimit-reset-requests': '2',
          },
        },
      },
      expectedReset: now + 2000,
    },
  ])(
    'uses reset headers from a usable SDK envelope',
    ({ error, expectedReset }) => {
      const failure = classifyResponses({ provider: 'openai', error, now });

      expect(failure.code).toBe('rate_limited');
      expect(failure.resetsAt).toBe(expectedReset);
    },
  );

  it('uses response headers when top-level header entries are not usable', () => {
    const failure = classifyResponses({
      provider: 'openai',
      now,
      error: sdkError({
        statusCode: 429,
        responseBody: { error: { code: 'rate_limit_exceeded' } },
        responseHeaders: { 'x-ratelimit-remaining-requests': true },
        response: {
          headers: {
            'x-ratelimit-remaining-requests': '0',
            'x-ratelimit-reset-requests': '2s',
          },
        },
      }),
    });

    expect(failure.resetsAt).toBe(now + 2000);
  });

  it.each([
    sdkError({
      statusCode: 418,
      responseBody: { error: { code: 17, type: false } },
    }),
    sdkError({
      statusCode: 418,
      responseBody: '{"error":{"code":"unrecognized_provider_code"}}',
    }),
    sdkError({ statusCode: 418, responseBody: '{"error":' }),
  ])(
    'keeps unsupported or unknown body signals in the exact unknown fallback',
    (error) => {
      expect(classifyResponses({ provider: 'openai', error, now }).code).toBe(
        'unknown',
      );
    },
  );

  it('does not reinterpret a string-number provider code or a numeric code', () => {
    for (const code of [17, '429']) {
      const failure = classifyResponses({
        provider: 'openai',
        now,
        error: sdkError({ statusCode: 418, responseBody: { error: { code } } }),
      });

      expect(failure.code).toBe('unknown');
    }
  });

  it('does not promote an abort signal when it conflicts with transport metadata', () => {
    const abortOnly = classifyResponses({
      provider: 'openai',
      now,
      error: Object.assign(new Error('aborted'), { name: 'AbortError' }),
    });

    const abortWithTransportCause = classifyResponses({
      provider: 'openai',
      now,
      error: Object.assign(new Error('aborted'), {
        code: 'ABORT_ERR',
        cause: { code: 'ECONNRESET' },
      }),
    });

    const networkCodeWithAbortCause = classifyResponses({
      provider: 'openai',
      now,
      error: Object.assign(new Error('socket aborted'), {
        code: 'ECONNRESET',
        cause: { name: 'AbortError' },
      }),
    });

    expect(abortOnly.code).toBe('unknown');
    expect(abortWithTransportCause.code).toBe('unknown');
    expect(networkCodeWithAbortCause.code).toBe('unreachable');
  });

  it('selects a nested response.failed error ahead of a conflicting body error', () => {
    const failure = classifyResponses({
      provider: 'openai',
      now,
      error: sdkError({
        responseBody: {
          error: { code: 'usage_not_included' },
          type: 'response.failed',
          response: { error: { code: 'rate_limit_exceeded' } },
        },
      }),
    });

    expect(failure.code).toBe('rate_limited');
  });

  it.each([
    {
      provider: 'openai',
      error: sdkError({
        statusCode: 429,
        responseBody: { error: { code: 'new_unrecognized_provider_code' } },
      }),
      expected: 'rate_limited',
    },
    {
      provider: 'anthropic',
      error: sdkError({
        statusCode: 400,
        responseBody: { error: { type: 17 } },
      }),
      expected: 'invalid_request',
    },
    {
      provider: 'openai',
      error: sdkError({ statusCode: 'not-a-status', responseBody: null }),
      expected: 'unknown',
    },
  ] as const)(
    'keeps malformed and unrecognized signals inside the closed failure class set',
    ({ provider, error, expected }) => {
      const failure = classifyResponses({ provider, error, now });

      expect(FAILURE_CLASSES).toContain(failure.code);
      expect(failure.code).toBe(expected);
    },
  );

  it('uses a parsed Responses response.failed error over unrelated outer errors', () => {
    const failure = classifyResponses({
      provider: 'openai',
      now,
      error: sdkError({
        statusCode: 500,
        code: 'ECONNRESET',
        response: {
          status: 429,
          body: JSON.stringify({
            type: 'response.failed',
            response: { error: { code: 'rate_limit_exceeded' } },
          }),
        },
      }),
    });

    expect(failure.code).toBe('rate_limited');
    expect(failure.statusCode).toBe(500);
  });

  it('uses an SDK nested lastError response as the classification input', () => {
    const failure = classifyCompletions({
      provider: 'openai',
      now,
      error: sdkError({
        statusCode: 429,
        lastError: sdkError({
          statusCode: 429,
          responseBody: { error: { code: 'rate_limit_exceeded' } },
        }),
      }),
    });

    expect(failure.code).toBe('rate_limited');
    expect(failure.statusCode).toBe(429);
  });

  it('lets a body class outrank transport metadata but does not call an HTTP failure unreachable', () => {
    const bodyWins = classifyResponses({
      provider: 'openai',
      now,
      error: sdkError({
        statusCode: 429,
        code: 'ECONNRESET',
        responseBody: { error: { code: 'rate_limit_exceeded' } },
      }),
    });

    const statusWins = classifyResponses({
      provider: 'openai',
      now,
      error: sdkError({ statusCode: 503, code: 'ECONNRESET' }),
    });

    expect(bodyWins.code).toBe('rate_limited');
    expect(statusWins.code).toBe('overloaded');
  });

  it.each([
    {
      'anthropic-ratelimit-requests-remaining': '0',
      'anthropic-ratelimit-requests-reset': 'not-a-date',
    },
    {
      'anthropic-ratelimit-requests-remaining': '0',
      'anthropic-ratelimit-requests-reset': '999999999999999999999999999999',
    },
  ])('rejects malformed or overflowing Anthropic reset instants', (headers) => {
    const failure = classifyAnthropic({
      provider: 'anthropic',
      error: { type: 'rate_limit_error' },
      headers,
      now,
    });

    expect(failure.code).toBe('rate_limited');
    expect(failure.resetsAt).toBeUndefined();
  });

  it('does not inherit an irrelevant reset signal for a non-throttle class', () => {
    const failure = classifyResponses({
      provider: 'openai',
      now,
      error: sdkError({
        statusCode: 429,
        responseBody: { error: { code: 'usage_not_included' } },
        responseHeaders: {
          'x-ratelimit-remaining-requests': '0',
          'x-ratelimit-reset-requests': '1s',
          'retry-after': '5',
        },
      }),
    });

    expect(failure.code).toBe('billing');
    expect(failure.resetsAt).toBeUndefined();
  });
  it('normalizes response header names and numeric values before reset classification', () => {
    const failure = classifyResponses({
      provider: 'openai',
      now,
      error: sdkError({
        statusCode: 429,
        responseBody: { error: { code: 'rate_limit_exceeded' } },
        responseHeaders: {
          'X-RateLimit-Remaining-Requests': 0,
          'X-RateLimit-Reset-Requests': '250ms',
        },
      }),
    });

    expect(header({ 'Retry-After': '3' }, 'retry-after')).toBe('3');
    expect(failure.code).toBe('rate_limited');
    expect(failure.resetsAt).toBe(now + 250);
  });

  it.each([
    [{ 'retry-after-ms': '0' }, 0],
    [{ 'retry-after-ms': '-1', 'Retry-After': '2' }, 2000],
    [{ 'retry-after': '0' }, 0],
    [{ 'retry-after': '   ' }, undefined],
    [{ 'retry-after': '-0.5' }, undefined],
    [{ 'retry-after': 'not a date' }, undefined],
    [{ 'retry-after': 'Thu, 01 Jan 2026 00:00:02 GMT' }, 2000],
    [{ 'retry-after': 'Thu, 01 Jan 2025 00:00:00 GMT' }, 0],
  ] as const)(
    'parses retry hints with zero, invalid, and date boundaries: %j',
    (headers, expected) => {
      expect(parseRetryAfter(headers, now)).toBe(expected);
    },
  );

  it('keeps a bare Retry-After as a hint without inventing a quota reset', () => {
    const failure = classifyResponses({
      provider: 'custom-provider',
      now,
      error: sdkError({
        statusCode: 429,
        responseBody: { error: { code: 'rate_limit_exceeded' } },
        responseHeaders: { 'retry-after': '1.5' },
      }),
    });

    expect(failure.code).toBe('rate_limited');
    expect(failure.resetsAt).toBeUndefined();
    expect(failure.hintMs).toBe(1500);
  });

  it.each([
    ['0', 0],
    [0, 0],
    ['8640000000000', 8_640_000_000_000_000],
    ['-1', undefined],
    ['', undefined],
    ['Infinity', undefined],
    ['8640000000001', undefined],
  ] as const)(
    'parses epoch seconds at numeric boundaries: %j',
    (value, expected) => {
      expect(parseEpochSeconds(value)).toBe(expected);
    },
  );

  it.each([
    ['1970-01-01T00:00:00.000Z', 0],
    ['2026-01-01T00:00:00.000Z', now],
    ['1969-12-31T23:59:59.999Z', undefined],
    ['', undefined],
    ['not-a-date', undefined],
  ] as const)(
    'accepts only valid nonnegative reset instants: %j',
    (value, expected) => {
      expect(parseInstant(value)).toBe(expected);
    },
  );

  it.each([
    ['0', 0],
    ['1.25', 1250],
    ['250ms', 250],
    ['1.5s', 1500],
    ['1h2m3.5s250ms', 3_723_750],
    [' 6M0S ', 360_000],
    ['-1s', undefined],
    ['1.1234s', 1123.4],
    ['1.2.3s', undefined],
    ['1s trailing', undefined],
    ['1d', undefined],
    ['0s', 0],
    ['9'.repeat(400) + 'h', undefined],
  ] as const)(
    'accepts complete duration sequences and rejects malformed units: %j',
    (value, expected) => {
      if (expected === undefined)
        expect(parseDurationMs(value)).toBeUndefined();
      else expect(parseDurationMs(value)).toBeCloseTo(expected, 6);
    },
  );
  it('uses a metadata reset timestamp when the enclosing error has no reset', () => {
    const context: FailureContext = {
      message: 'Provider request failed',
      headers: {},
      error: { metadata: { resets_at: '2026-01-01T00:00:03.000Z' } },
      transportError: {},
      now,
    };

    expect(bodyResetAt(context)).toBe(now + 3000);
  });

  it('uses nested provider payloads without exposing payload messages over the transport message', () => {
    const failure = classifyResponses({
      provider: 'openai',
      now,
      error: sdkError({
        statusCode: 429,
        responseBody: {
          error: {
            code: 'rate_limit_exceeded',
            message: 'private provider payload detail',
          },
        },
      }),
    });

    expect(failure.code).toBe('rate_limited');
    expect(failure.message).toBe('request failed');
    expect(failure.message).not.toContain('private provider payload detail');
  });

  it('uses response body only when it is a record and preserves response error precedence', () => {
    const malformedBody = classifyResponses({
      provider: 'openai',
      now,
      error: sdkError({
        statusCode: 429,
        responseBody: ['error', { code: 'rate_limit_exceeded' }],
        response: {
          status: 429,
          body: { error: { code: 'usage_not_included' } },
        },
      }),
    });

    const malformedEnvelope = classifyResponses({
      provider: 'openai',
      now,
      error: {
        statusCode: 429,
        response: ['not', 'a response record'],
        responseBody: { error: { code: 'rate_limit_exceeded' } },
      },
    });

    expect(malformedBody.code).toBe('billing');
    expect(malformedEnvelope.code).toBe('rate_limited');
  });

  it('uses only recognized raw direct signals and does not let unrelated transport codes mask body errors', () => {
    const direct = classifyResponses({
      provider: 'openai',
      now,
      error: sdkError({ statusCode: 500, code: 'insufficient_quota' }),
    });

    const bodyOverRaw = classifyResponses({
      provider: 'openai',
      now,
      error: sdkError({
        statusCode: 429,
        error: { code: 'insufficient_quota' },
        responseBody: { error: { code: 'rate_limit_exceeded' } },
      }),
    });

    expect(direct.code).toBe('billing');
    expect(bodyOverRaw.code).toBe('rate_limited');
  });

  it.each([
    {
      signal: 'details.error_code',
      error: sdkError({ details: { error_code: 'insufficient_quota' } }),
      provider: 'openai',
      code: 'billing',
      resetsAt: undefined,
    },
    {
      signal: 'error_code',
      error: sdkError({ error_code: 'insufficient_quota' }),
      provider: 'openai',
      code: 'billing',
      resetsAt: undefined,
    },
    {
      signal: 'metadata',
      error: sdkError({
        metadata: {
          limit_source: 'account',
          resets_at: '2026-01-01T00:00:04.000Z',
        },
      }),
      provider: 'openrouter',
      code: 'quota_exhausted',
      resetsAt: now + 4000,
    },
    {
      signal: 'resets_at',
      error: sdkError({
        limit_source: 'account',
        resets_at: '2026-01-01T00:00:05.000Z',
      }),
      provider: 'openrouter',
      code: 'quota_exhausted',
      resetsAt: now + 5000,
    },
  ] as const)(
    'classifies a raw direct signal carried by $signal',
    ({ error, provider, code, resetsAt }) => {
      const failure = classifyResponses({ provider, error, now });

      expect(failure.code).toBe(code);
      expect(failure.resetsAt).toBe(resetsAt);
    },
  );

  it('uses a safe generic message for non-error input', () => {
    const failure = classifyResponses({
      provider: 'openai',
      now,
      error: 'unexpected scalar failure',
    });

    expect(failure.code).toBe('unknown');
    expect(failure.message).toBe('Provider request failed');
  });
});
