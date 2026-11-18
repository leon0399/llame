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
});
