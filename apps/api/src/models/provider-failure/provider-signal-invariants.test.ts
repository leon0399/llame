import { describe, expect, it } from 'vitest';

import { classifyAnthropic } from './classify-anthropic';
import { classifyCompletions } from './classify-completions';
import { classifyResponses } from './classify-responses';
import type { FailureInput } from './provider-failure';

const wires = [
  classifyResponses,
  classifyCompletions,
  classifyAnthropic,
] as const;

const now = Date.UTC(2026, 0, 1);

type Classifier = (input: FailureInput) => {
  code: string;
  resetsAt?: number;
  hintMs?: number;
};

function apiError(
  statusCode: number,
  responseBody: FailureInput['error'],
  responseHeaders: Record<string, string> = {},
) {
  return Object.assign(new Error('wire failure'), {
    statusCode,
    responseBody,
    responseHeaders,
  });
}

function classify(classifier: Classifier, fixture: Omit<FailureInput, 'now'>) {
  return classifier({ ...fixture, now });
}

describe('provider-owned budget and reset signals', () => {
  it('requires an exhausted Codex bucket and chooses the latest exhausted-window reset', () => {
    for (const classifier of wires) {
      const failure = classify(classifier, {
        provider: 'openai-codex',
        error: apiError(
          429,
          {},
          {
            'x-codex-primary-used-percent': '100',
            'x-codex-primary-reset-at': '1767500000',
            'x-codex-secondary-used-percent': '101',
            'x-codex-secondary-reset-at': '1767600000',
          },
        ),
      });

      expect(failure.code).toBe('quota_exhausted');
      expect(failure.resetsAt).toBe(1_767_600_000_000);

      const unspent = classify(classifier, {
        provider: 'openai-codex',
        error: apiError(
          429,
          {},
          {
            'x-codex-primary-used-percent': '99.99',
            'x-codex-primary-reset-at': '1767700000',
            'x-codex-secondary-used-percent': 'not-a-number',
            'x-codex-secondary-reset-at': '1767800000',
          },
        ),
      });

      expect(unspent.code).toBe('rate_limited');
      expect(unspent.resetsAt).toBeUndefined();
    }
  });

  it('treats only the Go usage-limit signal with a nonblank metadata limit name as quota', () => {
    for (const classifier of wires) {
      const fixtures = [
        {
          error: apiError(429, {
            error: {
              type: 'GoUsageLimitError',
              metadata: { limitName: 'weekly' },
            },
          }),
          expected: 'quota_exhausted',
        },
        {
          error: apiError(429, {
            error: {
              type: 'GoUsageLimitError',
              limitName: 'weekly',
            },
          }),
          expected: 'rate_limited',
        },
        {
          error: apiError(429, {
            error: {
              type: 'OtherGatewayError',
              metadata: { limitName: 'weekly' },
            },
          }),
          expected: 'rate_limited',
        },
        {
          error: apiError(429, {
            error: {
              type: 'GoUsageLimitError',
              metadata: { limitName: '   ' },
            },
          }),
          expected: 'rate_limited',
        },
      ] as const;

      for (const fixture of fixtures) {
        expect(
          classify(classifier, {
            provider: 'opencode-go',
            error: fixture.error,
          }).code,
        ).toBe(fixture.expected);
      }
    }
  });

  it('keeps OpenRouter budget reset and lifetime classifications distinct from numeric 429', () => {
    for (const classifier of wires) {
      const reset = classify(classifier, {
        provider: 'openrouter',
        error: apiError(403, {
          error: {
            code: 'permission_error',
            limit_source: 'workspace',
            resets_at: '2026-01-05T00:00:00Z',
          },
        }),
      });

      expect(reset.code).toBe('quota_exhausted');
      expect(reset.resetsAt).toBe(Date.UTC(2026, 0, 5));

      const lifetime = classify(classifier, {
        provider: 'openrouter',
        error: apiError(403, {
          error: {
            code: 'permission_error',
            metadata: { limit_source: 'key', resets_at: null },
          },
        }),
      });

      expect(lifetime.code).toBe('billing');
      expect(lifetime.resetsAt).toBeUndefined();

      const numericThrottle = classify(classifier, {
        provider: 'openrouter',
        error: apiError(429, {
          error: {
            code: 429,
            metadata: {
              limit_source: 'workspace',
              resets_at: '2026-01-05T00:00:00Z',
            },
          },
        }),
      });

      expect(numericThrottle.code).toBe('rate_limited');
      expect(numericThrottle.resetsAt).toBeUndefined();
    }
  });

  it('keeps provider identities explicit across wire profiles', () => {
    for (const classifier of wires) {
      expect(
        classify(classifier, {
          provider: 'openai-responses',
          error: apiError(429, {
            error: { code: 'organization_usage_limit_exceeded' },
          }),
        }).code,
      ).toBe('quota_exhausted');
      expect(
        classify(classifier, {
          provider: 'openai-completions',
          error: apiError(429, {
            error: { code: 'model_rate_limit_exceeded' },
          }),
        }).code,
      ).toBe('rate_limited');
      expect(
        classify(classifier, {
          provider: 'custom-openai-profile',
          error: apiError(429, {
            error: { code: 'organization_usage_limit_exceeded' },
          }),
        }).code,
      ).toBe('rate_limited');
    }
  });

  it('parses Retry-After milliseconds, seconds, and dates with case-insensitive precedence', () => {
    const goLimit = {
      type: 'GoUsageLimitError',
      metadata: { limitName: 'weekly' },
    };

    const cases = [
      {
        headers: { 'RETRY-AFTER-MS': '1250', 'Retry-After': '60' },
        expected: 1250,
      },
      { headers: { 'Retry-After': '2.5' }, expected: 2500 },
      {
        headers: { 'Retry-After': new Date(now + 5000).toUTCString() },
        expected: 5000,
      },
      {
        headers: { 'Retry-After': 'Thu, 01 Jan 1970 00:00:00 GMT' },
        expected: 0,
      },
      {
        headers: { 'retry-after-ms': 'bad', 'retry-after': '3' },
        expected: 3000,
      },
      {
        headers: { 'retry-after-ms': '-1', 'retry-after': 'bad' },
        expected: undefined,
      },
      { headers: { 'retry-after': '-2.5' }, expected: undefined },
    ] as const;

    for (const classifier of wires) {
      for (const testCase of cases) {
        const failure = classify(classifier, {
          provider: 'opencode-go',
          error: apiError(429, { error: goLimit }, testCase.headers),
        });

        expect(failure.code).toBe('quota_exhausted');
        expect(failure.resetsAt).toBe(
          testCase.expected === undefined ? undefined : now + testCase.expected,
        );
        expect(failure.hintMs).toBe(testCase.expected);
      }
    }
  });

  it('does not turn malformed or negative Retry-After values into timing metadata', () => {
    for (const classifier of wires) {
      const failure = classify(classifier, {
        provider: 'openai',
        error: apiError(
          429,
          {},
          { 'RETRY-AFTER-MS': '-1', 'Retry-After': 'not a date' },
        ),
      });

      expect(failure.code).toBe('rate_limited');
      expect(failure.resetsAt).toBeUndefined();
      expect(failure.hintMs).toBeUndefined();
    }
  });
  it('prefers a valid direct Codex reset over bucket resets and ignores non-finite signals', () => {
    for (const classifier of wires) {
      const direct = classify(classifier, {
        provider: 'openai-codex',
        error: apiError(
          429,
          { resets_at: '1767900000' },
          {
            'x-codex-primary-used-percent': '100',
            'x-codex-primary-reset-at': '1767500000',
            'x-codex-secondary-used-percent': '100',
            'x-codex-secondary-reset-at': '1767600000',
          },
        ),
      });

      expect(direct.code).toBe('quota_exhausted');
      expect(direct.resetsAt).toBe(1_767_900_000_000);

      const latestBucket = classify(classifier, {
        provider: 'openai-codex',
        error: apiError(
          429,
          {},
          {
            'x-codex-primary-used-percent': '100',
            'x-codex-primary-reset-at': '1767800000',
            'x-codex-secondary-used-percent': '100',
            'x-codex-secondary-reset-at': '1767700000',
          },
        ),
      });

      expect(latestBucket.code).toBe('quota_exhausted');
      expect(latestBucket.resetsAt).toBe(1_767_800_000_000);

      const invalid = classify(classifier, {
        provider: 'openai-codex',
        error: apiError(
          429,
          {},
          {
            'x-codex-primary-used-percent': 'Infinity',
            'x-codex-primary-reset-at': '1767700000',
            'x-codex-secondary-used-percent': 'NaN',
            'x-codex-secondary-reset-at': '1767800000',
          },
        ),
      });

      expect(invalid.code).toBe('rate_limited');
      expect(invalid.resetsAt).toBeUndefined();
    }
  });

  it('uses exact case-insensitive exhausted Anthropic and OpenAI window names', () => {
    const anthropic = classify(classifyAnthropic, {
      provider: 'anthropic',
      error: apiError(
        429,
        {},
        {
          'ANTHROPIC-RATELIMIT-REQUESTS-REMAINING': '0',
          'ANTHROPIC-RATELIMIT-REQUESTS-RESET': '2026-01-04T00:00:00Z',
          'ANTHROPIC-RATELIMIT-TOKENS-REMAINING': '0',
          'ANTHROPIC-RATELIMIT-TOKENS-RESET': '2026-01-05T00:00:00Z',
          'anthropic-ratelimit-space-remaining': ' ',
          'anthropic-ratelimit-space-reset': '2026-01-09T00:00:00Z',
          'anthropic-ratelimit-used-remaining': '1',
          'anthropic-ratelimit-used-reset': '2026-01-10T00:00:00Z',
          'prefix-anthropic-ratelimit-decoy-remaining': '0',
          'anthropic-ratelimit-decoy-reset': '2026-01-06T00:00:00Z',
          'anthropic-ratelimit-suffix-remaining-extra': '0',
          'anthropic-ratelimit-suffix-reset': '2026-01-07T00:00:00Z',
          'anthropic-ratelimit-bad-remaining': 'Infinity',
          'anthropic-ratelimit-bad-reset': '2026-01-08T00:00:00Z',
        },
      ),
    });

    expect(anthropic.code).toBe('rate_limited');
    expect(anthropic.resetsAt).toBe(Date.UTC(2026, 0, 5));

    const openai = classify(classifyResponses, {
      provider: 'openai',
      error: apiError(
        429,
        {},
        {
          'X-RATELIMIT-REMAINING-REQUESTS': '0',
          'X-RATELIMIT-RESET-REQUESTS': '3s',
          'x-ratelimit-remaining-tokens': '0',
          'x-ratelimit-reset-tokens': '5s',
          'x-ratelimit-remaining-space': ' ',
          'x-ratelimit-reset-space': '11s',
          'x-ratelimit-remaining-used': '1',
          'x-ratelimit-reset-used': '12s',
          'prefix-x-ratelimit-remaining-decoy': '0',
          'x-ratelimit-reset-decoy': '8s',
          'x-ratelimit-remaining-suffix-extra': '0',
          'x-ratelimit-reset-suffix': '9s',
          'x-ratelimit-remaining-invalid': 'NaN',
          'x-ratelimit-reset-invalid': '10s',
        },
      ),
    });

    expect(openai.code).toBe('rate_limited');
    expect(openai.resetsAt).toBe(now + 5000);
  });

  it('requires OpenRouter budget metadata and distinguishes absent from malformed reset contracts', () => {
    for (const classifier of wires) {
      const noBudget = classify(classifier, {
        provider: 'openrouter',
        error: apiError(403, {
          error: { metadata: { resets_at: '2026-01-05T00:00:00Z' } },
        }),
      });

      expect(noBudget.code).toBe('auth');
      expect(noBudget.resetsAt).toBeUndefined();

      const blankSource = classify(classifier, {
        provider: 'openrouter',
        error: apiError(403, {
          error: {
            metadata: {
              limit_source: '   ',
              resets_at: '2026-01-05T00:00:00Z',
            },
          },
        }),
      });

      expect(blankSource.code).toBe('auth');
      expect(blankSource.resetsAt).toBeUndefined();

      const malformedReset = classify(classifier, {
        provider: 'openrouter',
        error: apiError(403, {
          error: {
            metadata: {
              limit_source: 'workspace',
              resets_at: 'not-a-date',
            },
          },
        }),
      });

      expect(malformedReset.code).toBe('quota_exhausted');
      expect(malformedReset.resetsAt).toBeUndefined();
    }
  });
  it('keeps authoritative reset instants within the supported date range', () => {
    const maximum = 8_640_000_000_000_000;

    for (const [duration, expected] of [
      [`${(maximum - now) / 1000}s`, maximum],
      ['10000000000000s', undefined],
    ] as const) {
      const failure = classify(classifyResponses, {
        provider: 'openai',
        error: apiError(
          429,
          {},
          {
            'x-ratelimit-remaining-requests': '0',
            'x-ratelimit-reset-requests': duration,
          },
        ),
      });

      expect(failure.code).toBe('rate_limited');
      expect(failure.resetsAt).toBe(expected);
    }
  });
  it('classifies an exhausted primary Codex window without a body usage code', () => {
    const failure = classify(classifyResponses, {
      provider: 'openai-codex',
      error: apiError(
        429,
        {},
        {
          'x-codex-primary-used-percent': '100',
          'x-codex-primary-reset-at': String((now + 60_000) / 1000),
        },
      ),
    });

    expect(failure.code).toBe('quota_exhausted');
    expect(failure.resetsAt).toBe(now + 60_000);
  });
});
