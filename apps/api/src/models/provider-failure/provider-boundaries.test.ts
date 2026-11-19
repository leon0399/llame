import { describe, expect, it } from 'vitest';

import { classifyAnthropic } from './classify-anthropic';
import { classifyResponses } from './classify-responses';
import type { FailureInput } from './provider-failure';

const now = Date.UTC(2026, 0, 1);

function sdkError(fields: FailureInput['error'] = {}) {
  return Object.assign(new Error('request failed'), fields);
}

describe('provider classification boundaries', () => {
  it.each([
    { statusCode: 399, code: 'ECONNRESET', expected: 'unreachable' },
    { statusCode: 400, code: 'ECONNRESET', expected: 'invalid_request' },
    { statusCode: 503, code: 'ECONNRESET', expected: 'overloaded' },
  ] as const)(
    'uses HTTP failure precedence over transport code: $statusCode',
    ({ statusCode, code, expected }) => {
      expect(
        classifyResponses({
          provider: 'other',
          now,
          error: sdkError({ statusCode, code }),
        }).code,
      ).toBe(expected);
    },
  );

  it.each([
    { error: sdkError({ code: 'econnreset' }), expected: 'unreachable' },
    {
      error: sdkError({ cause: { code: 'ETIMEDOUT' } }),
      expected: 'unreachable',
    },
    {
      error: sdkError({
        name: 'AI_APICallError',
        cause: { name: 'TypeError', message: 'fetch failed' },
      }),
      expected: 'unreachable',
    },
    {
      error: sdkError({
        name: 'AI_APICallError',
        cause: { name: 'TypeError', message: 'other fetch failure' },
      }),
      expected: 'unknown',
    },
    {
      error: sdkError({
        name: 'TypeError',
        cause: { message: 'fetch failed' },
      }),
      expected: 'unknown',
    },
  ] as const)(
    'recognizes only supported transport evidence',
    ({ error, expected }) => {
      expect(classifyResponses({ provider: 'other', now, error }).code).toBe(
        expected,
      );
    },
  );

  it.each([
    {
      provider: 'openrouter',
      body: { code: 'openrouter_in_flight_budget' },
      expected: 'rate_limited',
    },
    {
      provider: 'openrouter',
      body: { code: 'openrouter_credits' },
      expected: 'billing',
    },
    {
      provider: 'openrouter',
      body: { code: 'openrouter_key_limit' },
      expected: 'billing',
    },
    { provider: 'openrouter', body: { code: '402' }, expected: 'billing' },
    { provider: 'openrouter', body: { code: '429' }, expected: 'rate_limited' },
    {
      provider: 'openai',
      body: { code: 'insufficient_quota' },
      expected: 'billing',
    },
    {
      provider: 'openai',
      body: { code: 'rate_limit_exceeded' },
      expected: 'rate_limited',
    },
    {
      provider: 'anthropic',
      body: { type: 'rate_limit_error' },
      expected: 'rate_limited',
    },
    {
      provider: 'anthropic',
      body: { type: 'enforced_spend_limit_reached' },
      expected: 'quota_exhausted',
    },
    {
      provider: 'anthropic',
      body: { type: 'api_error' },
      expected: 'server_error',
    },
    {
      provider: 'openai-codex',
      body: { code: 'usage_limit_reached' },
      expected: 'quota_exhausted',
    },
    {
      provider: 'opencode-go',
      body: { type: 'monthlylimiterror' },
      statusCode: 401,
      expected: 'auth',
    },
    {
      provider: 'opencode-go',
      body: { type: 'gousagelimiterror', metadata: { limitName: 'daily' } },
      expected: 'quota_exhausted',
    },
  ] as const)(
    'applies provider-owned rule for $provider/$body',
    ({ provider, body, statusCode, expected }) => {
      const failure = classifyResponses({
        provider,
        now,
        error: sdkError({ statusCode, responseBody: { error: body } }),
      });

      expect(failure.code).toBe(expected);
    },
  );

  it.each([
    {
      provider: 'openrouter',
      signal: { code: 'unknown' },
      statusCode: 429,
      expected: 'rate_limited',
    },
    {
      provider: 'openrouter',
      signal: { code: 'unknown' },
      statusCode: 402,
      expected: 'billing',
    },
    {
      provider: 'openrouter',
      signal: { code: 'rate_limit_exceeded' },
      statusCode: 402,
      expected: 'rate_limited',
    },
    {
      provider: 'openai-codex',
      signal: { code: 'organization_usage_limit_exceeded' },
      statusCode: 429,
      expected: 'quota_exhausted',
    },
    {
      provider: 'openai',
      signal: { code: 'project_spend_limit_exceeded' },
      statusCode: 400,
      expected: 'quota_exhausted',
    },
  ] as const)(
    'resolves provider/body/status precedence for $provider',
    ({ provider, signal, statusCode, expected }) => {
      expect(
        classifyResponses({
          provider,
          now,
          error: sdkError({ statusCode, responseBody: { error: signal } }),
        }).code,
      ).toBe(expected);
    },
  );

  it.each([
    { signal: 'context_length_exceeded', expected: 'context_overflow' },
    { signal: 'context_window_limit_reached', expected: 'context_overflow' },
    { signal: 'prompt_context_length_exceeded', expected: 'context_overflow' },
    { signal: 'content_policy_violation', expected: 'content_policy' },
    { signal: 'safety_violation', expected: 'content_policy' },
    { signal: 'not_context_length_or_policy', expected: 'unknown' },
  ] as const)(
    'maps recognized general signal $signal',
    ({ signal, expected }) => {
      expect(
        classifyResponses({ provider: 'other', now, error: { code: signal } })
          .code,
      ).toBe(expected);
    },
  );

  it.each([
    { statusCode: 402, expected: 'billing' },
    { statusCode: 401, expected: 'auth' },
    { statusCode: 403, expected: 'auth' },
    { statusCode: 404, expected: 'model_not_found' },
    { statusCode: 408, expected: 'server_error' },
    { statusCode: 500, expected: 'server_error' },
    { statusCode: 502, expected: 'server_error' },
    { statusCode: 504, expected: 'server_error' },
    { statusCode: 503, expected: 'overloaded' },
    { statusCode: 529, expected: 'overloaded' },
    { statusCode: 413, expected: 'context_overflow' },
    { statusCode: 429, expected: 'rate_limited' },
    { statusCode: 400, expected: 'invalid_request' },
    { statusCode: 422, expected: 'invalid_request' },
    { statusCode: 418, expected: 'unknown' },
  ] as const)('maps HTTP status $statusCode', ({ statusCode, expected }) => {
    expect(
      classifyResponses({
        provider: 'other',
        now,
        error: sdkError({ statusCode }),
      }).code,
    ).toBe(expected);
  });

  it.each([
    {
      error: {
        type: 'invalid_request_error',
        message: 'Prompt is too long for this model',
      },
      expected: 'context_overflow',
    },
    {
      error: { type: 'invalid_request_error', message: 'prompt is too long.' },
      expected: 'context_overflow',
    },
    {
      error: { type: 'invalid_request_error', message: 'request is too long' },
      expected: 'invalid_request',
    },
    {
      error: { type: 'other_error', message: 'prompt is too long' },
      expected: 'unknown',
    },
  ] as const)(
    'uses Anthropic prompt message boundary',
    ({ error, expected }) => {
      expect(
        classifyAnthropic({ provider: 'anthropic', now, error }).code,
      ).toBe(expected);
    },
  );

  it('uses an Anthropic message prompt rule but not on non-Anthropic wire', () => {
    const error = {
      type: 'invalid_request_error',
      message: 'prompt is too long for this model',
    };

    expect(classifyAnthropic({ provider: 'other', now, error }).code).toBe(
      'context_overflow',
    );
    expect(classifyResponses({ provider: 'other', now, error }).code).toBe(
      'invalid_request',
    );
  });

  it.each([
    {
      error: sdkError({
        statusCode: 302,
        responseBody: { error: { code: 'rate_limit_exceeded' } },
      }),
    },
    {
      error: sdkError({
        name: 'JSONParseError',
        statusCode: 429,
        responseBody: { error: { code: 'rate_limit_exceeded' } },
      }),
    },
    {
      error: sdkError({
        name: 'TypeValidationError',
        statusCode: 429,
        responseBody: { error: { code: 'rate_limit_exceeded' } },
      }),
    },
  ])(
    'does not classify unreadable response as a provider failure',
    ({ error }) => {
      expect(classifyResponses({ provider: 'openai', now, error }).code).toBe(
        'unknown',
      );
    },
  );

  it('uses Codex exhaustion only for a 429 with a fully used window', () => {
    const exhausted = classifyResponses({
      provider: 'openai-codex',
      now,
      error: sdkError({
        statusCode: 429,
        responseHeaders: { 'x-codex-primary-used-percent': '100' },
      }),
    });

    const partial = classifyResponses({
      provider: 'openai-codex',
      now,
      error: sdkError({
        statusCode: 429,
        responseHeaders: { 'x-codex-primary-used-percent': '99.9' },
      }),
    });

    const malformed = classifyResponses({
      provider: 'openai-codex',
      now,
      error: sdkError({
        statusCode: 429,
        responseHeaders: { 'x-codex-primary-used-percent': 'NaN' },
      }),
    });

    expect(exhausted.code).toBe('quota_exhausted');
    expect(partial.code).toBe('rate_limited');
    expect(malformed.code).toBe('rate_limited');
  });

  it('uses the latest reset from exhausted Codex windows and honors a valid direct reset', () => {
    const windows = classifyResponses({
      provider: 'openai-codex',
      now,
      error: sdkError({
        statusCode: 429,
        responseHeaders: {
          'x-codex-primary-used-percent': '100',
          'x-codex-primary-reset-at': '1767225601',
          'x-codex-secondary-used-percent': '100',
          'x-codex-secondary-reset-at': '1767225603',
        },
      }),
    });

    const direct = classifyResponses({
      provider: 'openai-codex',
      now,
      error: { code: 'usage_limit_reached', resets_at: '1767225605' },
    });

    expect(windows.resetsAt).toBe(now + 3000);
    expect(direct.resetsAt).toBe(now + 5000);
  });

  it('uses only exhausted Codex windows for resets and ignores malformed window resets', () => {
    const failure = classifyResponses({
      provider: 'openai-codex',
      now,
      error: sdkError({
        statusCode: 429,
        responseHeaders: {
          'x-codex-primary-used-percent': '100',
          'x-codex-primary-reset-at': '1767225602',
          'x-codex-secondary-used-percent': '20',
          'x-codex-secondary-reset-at': '1767225610',
        },
      }),
    });

    const malformed = classifyResponses({
      provider: 'openai-codex',
      now,
      error: sdkError({
        statusCode: 429,
        responseHeaders: {
          'x-codex-primary-used-percent': '100',
          'x-codex-primary-reset-at': 'not-a-number',
        },
      }),
    });

    expect(failure.resetsAt).toBe(now + 2000);
    expect(malformed.code).toBe('quota_exhausted');
    expect(malformed.resetsAt).toBeUndefined();
  });

  it.each([
    {
      error: {
        code: 'unrecognized_budget_signal',
        limit_source: 'account',
        resets_at: '2026-01-01T00:00:04.000Z',
      },
      expected: now + 4000,
    },
    {
      error: {
        code: 'unrecognized_budget_signal',
        metadata: {
          limit_source: 'account',
          resets_at: '2026-01-01T00:00:06.000Z',
        },
      },
      expected: now + 6000,
    },
  ] as const)(
    'reads OpenRouter budget reset from accepted body fields',
    ({ error, expected }) => {
      expect(
        classifyResponses({ provider: 'openrouter', now, error }).resetsAt,
      ).toBe(expected);
    },
  );

  it.each([
    {
      error: {
        code: 'unrecognized_budget_signal',
        metadata: { limit_source: 'account' },
      },
      expected: 'billing',
    },
    {
      error: {
        code: 'unrecognized_budget_signal',
        metadata: { limit_source: 'account', resets_at: 'bad-date' },
      },
      expected: 'quota_exhausted',
    },
    {
      error: {
        code: 'unrecognized_budget_signal',
        metadata: { limit_source: '  ', resets_at: '2026-01-01T00:00:06.000Z' },
      },
      expected: 'unknown',
    },
  ] as const)(
    'guards OpenRouter budget promotion with source and reset boundary',
    ({ error, expected }) => {
      expect(
        classifyResponses({ provider: 'openrouter', now, error }).code,
      ).toBe(expected);
    },
  );

  it('treats recognized OpenRouter budget source metadata as quota evidence', () => {
    const failure = classifyResponses({
      provider: 'openrouter',
      now,
      error: {
        code: 'unrecognized_budget_signal',
        metadata: {
          limit_source: 'account',
          resets_at: '2026-01-01T00:00:06.000Z',
        },
      },
    });

    expect(failure.code).toBe('quota_exhausted');
    expect(failure.resetsAt).toBe(now + 6000);
  });

  it('requires a named Go usage limit and limits monthly auth rule to 401', () => {
    const unnamed = classifyResponses({
      provider: 'opencode-go',
      now,
      error: { type: 'gousagelimiterror', metadata: { limitName: '  ' } },
    });

    const named = classifyResponses({
      provider: 'opencode-go',
      now,
      error: { type: 'gousagelimiterror', metadata: { limitName: 'daily' } },
    });

    const wrongStatus = classifyResponses({
      provider: 'opencode-go',
      now,
      error: sdkError({
        statusCode: 400,
        responseBody: { error: { type: 'monthlylimiterror' } },
      }),
    });

    expect(unnamed.code).toBe('unknown');
    expect(named.code).toBe('quota_exhausted');
    expect(wrongStatus.code).toBe('invalid_request');
  });

  it('uses retry-after duration for Go reset and exposes the retry hint', () => {
    const failure = classifyResponses({
      provider: 'opencode-go',
      now,
      error: sdkError({
        statusCode: 429,
        responseBody: {
          error: {
            type: 'gousagelimiterror',
            metadata: { limitName: 'daily' },
          },
        },
        responseHeaders: { 'retry-after': '3' },
      }),
    });

    expect(failure.code).toBe('quota_exhausted');
    expect(failure.resetsAt).toBe(now + 3000);
    expect(failure.hintMs).toBe(3000);
  });

  it('selects reset headers only for throttle classes', () => {
    const failure = classifyResponses({
      provider: 'openai',
      now,
      error: sdkError({
        statusCode: 429,
        responseBody: { error: { code: 'insufficient_quota' } },
        responseHeaders: {
          'x-ratelimit-remaining-requests': '0',
          'x-ratelimit-reset-requests': '2s',
          'retry-after': '5',
        },
      }),
    });

    expect(failure.code).toBe('billing');
    expect(failure.resetsAt).toBeUndefined();
    expect(failure.hintMs).toBe(5000);
  });

  it('uses latest exhausted Anthropic window reset, requiring zero remaining', () => {
    const failure = classifyAnthropic({
      provider: 'anthropic',
      now,
      error: { type: 'rate_limit_error' },
      headers: {
        'anthropic-ratelimit-requests-remaining': '0',
        'anthropic-ratelimit-requests-reset': '2026-01-01T00:00:02.000Z',
        'anthropic-ratelimit-tokens-remaining': '0',
        'anthropic-ratelimit-tokens-reset': '2026-01-01T00:00:04.000Z',
        'anthropic-ratelimit-input-tokens-remaining': '1',
        'anthropic-ratelimit-input-tokens-reset': '2026-01-01T00:00:09.000Z',
      },
    });

    expect(failure.resetsAt).toBe(now + 4000);
  });

  it.each([
    { remaining: '', reset: '2026-01-01T00:00:02.000Z' },
    { remaining: 'NaN', reset: '2026-01-01T00:00:02.000Z' },
    { remaining: '0.1', reset: '2026-01-01T00:00:02.000Z' },
    { remaining: '0', reset: 'not-a-date' },
  ] as const)(
    'ignores invalid Anthropic remaining/reset pair',
    ({ remaining, reset }) => {
      const failure = classifyAnthropic({
        provider: 'anthropic',
        now,
        error: { type: 'rate_limit_error' },
        headers: {
          'anthropic-ratelimit-requests-remaining': remaining,
          'anthropic-ratelimit-requests-reset': reset,
        },
      });

      expect(failure.code).toBe('rate_limited');
      expect(failure.resetsAt).toBeUndefined();
    },
  );

  it('uses the latest zero-remaining OpenAI reset and interprets reset as a duration', () => {
    const failure = classifyResponses({
      provider: 'openai',
      now,
      error: sdkError({
        statusCode: 429,
        responseHeaders: {
          'x-ratelimit-remaining-requests': '0',
          'x-ratelimit-reset-requests': '2s',
          'x-ratelimit-remaining-tokens': '0',
          'x-ratelimit-reset-tokens': '4s',
          'x-ratelimit-remaining-images': '1',
          'x-ratelimit-reset-images': '9s',
        },
      }),
    });

    expect(failure.resetsAt).toBe(now + 4000);
  });

  it.each([
    { remaining: '', reset: '2s' },
    { remaining: 'NaN', reset: '2s' },
    { remaining: '0.1', reset: '2s' },
    { remaining: '0', reset: 'not-a-duration' },
  ] as const)(
    'ignores invalid OpenAI remaining/reset pair',
    ({ remaining, reset }) => {
      const failure = classifyResponses({
        provider: 'openai',
        now,
        error: sdkError({
          statusCode: 429,
          responseHeaders: {
            'x-ratelimit-remaining-requests': remaining,
            'x-ratelimit-reset-requests': reset,
          },
        }),
      });

      expect(failure.code).toBe('rate_limited');
      expect(failure.resetsAt).toBeUndefined();
    },
  );

  it('rejects overflowing fallback reset instants while preserving retry hint', () => {
    const failure = classifyResponses({
      provider: 'other',
      now: 8_640_000_000_000_000,
      error: sdkError({
        statusCode: 429,
        responseHeaders: { 'retry-after': '1' },
      }),
    });

    expect(failure.code).toBe('rate_limited');
    expect(failure.resetsAt).toBeUndefined();
    expect(failure.hintMs).toBe(1000);
  });

  it('does not attach provider resets for classes without reset semantics', () => {
    const failure = classifyResponses({
      provider: 'anthropic',
      now,
      error: sdkError({
        statusCode: 503,
        responseHeaders: {
          'anthropic-ratelimit-requests-remaining': '0',
          'anthropic-ratelimit-requests-reset': '2026-01-01T00:00:04.000Z',
        },
      }),
    });

    expect(failure.code).toBe('overloaded');
    expect(failure.resetsAt).toBeUndefined();
  });
});
