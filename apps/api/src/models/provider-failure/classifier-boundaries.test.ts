import { describe, expect, it } from 'vitest';

import { classifyAnthropic } from './classify-anthropic';
import { classifyCompletions } from './classify-completions';
import { classifyResponses } from './classify-responses';
import { FAILURE_CLASSES } from './provider-failure';

const now = Date.UTC(2026, 0, 1);

type SdkErrorFields = {
  statusCode?: unknown;
  responseBody?: unknown;
  response?: unknown;
  responseHeaders?: unknown;
  code?: unknown;
  lastError?: unknown;
};

function sdkError(fields: SdkErrorFields = {}) {
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
});
