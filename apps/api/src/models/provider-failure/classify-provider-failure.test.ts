import { describe, expect, it } from 'vitest';

import { classifyAnthropic } from './classify-anthropic';
import { classifyCompletions } from './classify-completions';
import { classifyResponses } from './classify-responses';
import {
  FAILURE_CLASSES,
  ProviderFailure,
  type FailureInput,
} from './provider-failure';

const wires = [
  ['responses', classifyResponses],
  ['completions', classifyCompletions],
  ['anthropic', classifyAnthropic],
] as const;

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

type ClassifierFixture = Omit<FailureInput, 'now'> & { now?: number };

function classify(
  classifier: (input: FailureInput) => ProviderFailure,
  fixture: ClassifierFixture,
) {
  return classifier({
    ...fixture,
    now: fixture.now ?? Date.UTC(2026, 0, 1),
  });
}

describe('wire provider failure classifiers', () => {
  it.each(
    (
      [
        [
          'Responses unknown HTTP status',
          classifyResponses,
          'openai',
          apiError(418, { error: { code: 'unrecognized' } }),
          'unknown',
        ],
        [
          'Bare 402 billing',
          classifyCompletions,
          'openai',
          apiError(402, {}),
          'billing',
        ],
        [
          'Bare 429 throttle',
          classifyCompletions,
          'openai',
          apiError(429, {}),
          'rate_limited',
        ],
        [
          'OpenAI Responses provider profile retains spend classification',
          classifyResponses,
          'openai-responses',
          apiError(429, { error: { code: 'project_spend_limit_exceeded' } }),
          'quota_exhausted',
        ],
        [
          'OpenAI Completions provider profile retains spend classification',
          classifyCompletions,
          'openai-completions',
          apiError(429, { error: { code: 'project_spend_limit_exceeded' } }),
          'quota_exhausted',
        ],
        [
          'Anthropic Messages provider profile retains spend classification',
          classifyAnthropic,
          'anthropic-messages',
          apiError(429, {
            error: {
              type: 'rate_limit_error',
              details: { error_code: 'enforced_spend_limit_reached' },
            },
          }),
          'quota_exhausted',
        ],
        [
          'Codex project spend limit keeps provider quota classification',
          classifyResponses,
          'openai-codex',
          apiError(429, {
            error: { code: 'project_spend_limit_exceeded' },
          }),
          'quota_exhausted',
        ],
        [
          'OpenAI spend limit',
          classifyResponses,
          'openai',
          apiError(429, { error: { code: 'project_spend_limit_exceeded' } }),
          'quota_exhausted',
        ],
        [
          'OpenAI organization usage limit',
          classifyCompletions,
          'openai',
          apiError(429, {
            error: { code: 'organization_usage_limit_exceeded' },
          }),
          'quota_exhausted',
        ],
        [
          'Rate limit body code',
          classifyResponses,
          'openai',
          apiError(429, { error: { code: 'rate_limit_exceeded' } }),
          'rate_limited',
        ],
        [
          'Slow down body code',
          classifyCompletions,
          'gateway',
          apiError(400, { error: { code: 'slow_down' } }),
          'rate_limited',
        ],
        [
          'OpenAI overloaded body type',
          classifyResponses,
          'openai',
          apiError(500, { error: { type: 'overloaded_error' } }),
          'overloaded',
        ],
        [
          'HTTP 503 overloaded',
          classifyCompletions,
          'openai',
          apiError(503, {}),
          'overloaded',
        ],
        [
          'HTTP 408 server error',
          classifyResponses,
          'openai',
          apiError(408, {}),
          'server_error',
        ],
        [
          'HTTP 500 server error',
          classifyResponses,
          'openai',
          apiError(500, {}),
          'server_error',
        ],
        [
          'HTTP 504 server error',
          classifyResponses,
          'openai',
          apiError(504, {}),
          'server_error',
        ],
        [
          'Anthropic API error',
          classifyAnthropic,
          'anthropic',
          apiError(500, { error: { type: 'api_error' } }),
          'server_error',
        ],
        [
          'HTTP 413 request too large',
          classifyCompletions,
          'openai',
          apiError(413, {}),
          'context_overflow',
        ],
        [
          'Anthropic context type 413',
          classifyAnthropic,
          'anthropic',
          apiError(413, { error: { type: 'invalid_request_error' } }),
          'invalid_request',
        ],
        [
          'A usage code wins over synthetic status',
          classifyResponses,
          'openai',
          apiError(500, { error: { code: 'usage_not_included' } }),
          'billing',
        ],
        [
          'Responses prepaid credits',
          classifyResponses,
          'openai',
          apiError(429, { error: { code: 'insufficient_quota' } }),
          'billing',
        ],
        [
          'Responses model not found',
          classifyResponses,
          'openai',
          apiError(404, {}),
          'model_not_found',
        ],
        [
          'Responses auth',
          classifyResponses,
          'openai',
          apiError(401, {}),
          'auth',
        ],
        [
          'Responses overloaded',
          classifyResponses,
          'openai',
          apiError(529, {}),
          'overloaded',
        ],
        [
          'Responses server error',
          classifyResponses,
          'openai',
          apiError(502, {}),
          'server_error',
        ],
        [
          'Responses context length',
          classifyResponses,
          'openai',
          apiError(400, { error: { code: 'context_length_exceeded' } }),
          'context_overflow',
        ],
        [
          'Responses policy',
          classifyResponses,
          'openai',
          apiError(400, { error: { code: 'content_policy_violation' } }),
          'content_policy',
        ],
        [
          'Responses invalid request',
          classifyResponses,
          'openai',
          apiError(422, {}),
          'invalid_request',
        ],
        [
          'OpenRouter in-flight budget beats 402',
          classifyResponses,
          'openrouter',
          apiError(402, { error: { code: 'openrouter_in_flight_budget' } }),
          'rate_limited',
        ],
        [
          'OpenRouter credits',
          classifyResponses,
          'openrouter',
          apiError(403, { error: { code: 'openrouter_credits' } }),
          'billing',
        ],
        [
          'OpenRouter key limit',
          classifyResponses,
          'openrouter',
          apiError(403, { error: { code: 'openrouter_key_limit' } }),
          'billing',
        ],
        [
          'OpenRouter reset budget',
          classifyResponses,
          'openrouter',
          apiError(403, {
            error: {
              code: 403,
              metadata: {
                limit_source: 'openrouter_workspace_budget',
                resets_at: '2026-01-04T00:00:00Z',
              },
            },
          }),
          'quota_exhausted',
        ],
        [
          'OpenRouter lifetime budget',
          classifyResponses,
          'openrouter',
          apiError(403, {
            error: {
              metadata: {
                limit_source: 'openrouter_key_budget',
                resets_at: null,
              },
            },
          }),
          'billing',
        ],
        [
          'Anthropic overloaded',
          classifyAnthropic,
          'anthropic',
          apiError(529, { type: 'error', error: { type: 'overloaded_error' } }),
          'overloaded',
        ],
        [
          'Anthropic spend cap',
          classifyAnthropic,
          'anthropic',
          apiError(429, {
            error: {
              type: 'rate_limit_error',
              details: { error_code: 'enforced_spend_limit_reached' },
            },
          }),
          'quota_exhausted',
        ],
        [
          'Anthropic prompt too long outranks synthetic SDK status',
          classifyAnthropic,
          'anthropic',
          apiError(500, {
            error: {
              type: 'invalid_request_error',
              message: 'prompt is too long for this model',
            },
          }),
          'context_overflow',
        ],
        [
          'Go usage error on Responses',
          classifyResponses,
          'opencode-go',
          apiError(429, {
            error: {
              type: 'GoUsageLimitError',
              metadata: { limitName: 'weekly' },
            },
          }),
          'quota_exhausted',
        ],
        [
          'Go usage error on Completions',
          classifyCompletions,
          'opencode-go',
          apiError(429, {
            error: {
              type: 'gOuSaGeLiMiTeRrOr',
              metadata: { limitName: 'weekly' },
            },
          }),
          'quota_exhausted',
        ],
        [
          'Go usage error on Anthropic',
          classifyAnthropic,
          'opencode-go',
          apiError(429, {
            error: {
              type: 'GoUsageLimitError',
              metadata: { limitName: 'weekly' },
            },
          }),
          'quota_exhausted',
        ],
        [
          'Go monthly limit auth',
          classifyCompletions,
          'opencode-go',
          apiError(401, { error: { type: 'MonthlyLimitError' } }),
          'auth',
        ],
        [
          'Go error without limit name falls back to throttle',
          classifyCompletions,
          'opencode-go',
          apiError(429, { error: { type: 'GoUsageLimitError' } }),
          'rate_limited',
        ],
      ] as const
    ).map(([name, classifier, provider, error, expected]) => ({
      name,
      classifier,
      provider,
      error,
      headers: undefined,
      expected,
    })),
  )('$name', ({ classifier, provider, error, headers, expected }) => {
    expect(classifier({ provider, error, headers }).code).toBe(expected);
  });

  it('does not take a reset from a lower-precedence throttle signal on billing', () => {
    const failure = classifyResponses({
      provider: 'openai-responses',
      now: Date.UTC(2026, 0, 1),
      error: apiError(
        429,
        {
          error: {
            code: 'usage_not_included',
            type: 'rate_limit_error',
          },
        },
        {
          'x-ratelimit-remaining-requests': '0',
          'x-ratelimit-reset-requests': '1s',
        },
      ),
    });

    expect(failure.code).toBe('billing');
    expect(failure.resetsAt).toBeUndefined();
  });

  it('keeps the failure class closed and supports safe Error metadata only', () => {
    const failure = classifyResponses({
      error: Object.assign(new Error('response failed'), {
        statusCode: 418,
        responseBody: '{"error":{"code":"unknown-provider-code"}}',
        responseHeaders: { 'x-secret': 'header-secret' },
        cause: new Error('cause-secret'),
      }),
      provider: 'openai',
    });

    expect(failure).toBeInstanceOf(ProviderFailure);
    expect(failure.name).toBe('ProviderFailure');
    expect(FAILURE_CLASSES).toContain(failure.code);
    expect(failure.message).toBe('response failed');
    expect(failure.statusCode).toBe(418);
    expect(failure).not.toHaveProperty('responseBody');
    expect(failure).not.toHaveProperty('responseHeaders');
    expect(failure).not.toHaveProperty('cause');
  });

  it('reads a nested response error', () => {
    const nested = classifyResponses({
      provider: 'openai',
      error: Object.assign(new Error('nested'), {
        response: {
          status: 429,
          error: { code: 'rate_limit_exceeded', message: 'inner' },
          headers: {},
        },
      }),
    });

    expect(nested.code).toBe('rate_limited');
  });

  it('uses status before genuine transport and leaves arbitrary failures unknown', () => {
    expect(
      classifyResponses({
        provider: 'openai',
        error: Object.assign(new Error('socket'), { code: 'ECONNRESET' }),
      }).code,
    ).toBe('unreachable');
    expect(
      classifyResponses({
        provider: 'openai',
        error: Object.assign(new Error('not transport'), {
          code: 'CUSTOM_FAILURE',
        }),
      }).code,
    ).toBe('unknown');
  });
  it('rejects prototype names as provider and transport codes', () => {
    for (const code of ['constructor', '__proto__', 'toString']) {
      const bodyCode = Object.fromEntries([['code', code]]);

      const caused = Object.assign(new Error('not transport'), {
        cause: { code },
      });

      const bodyFailure = classifyResponses({
        provider: 'openai',
        error: Object.assign(new Error('unknown provider code'), {
          statusCode: 418,
          responseBody: { error: bodyCode },
        }),
      });

      expect(bodyFailure.code).toBe('unknown');
      expect(
        classifyResponses({ provider: 'openai', error: caused }).code,
      ).toBe('unknown');
    }
  });

  it('classifies an AI SDK API call with fetch failure as unreachable', () => {
    const error = Object.assign(new Error('request failed'), {
      name: 'AI_APICallError',
      cause: Object.assign(new TypeError('fetch failed'), {
        name: 'TypeError',
      }),
    });

    expect(classifyResponses({ provider: 'openai', error }).code).toBe(
      'unreachable',
    );
  });

  it('classifies the SDK response.failed body and direct late failure chunk', () => {
    const bodyFailure = classifyResponses({
      provider: 'openai',
      error: apiError(
        500,
        JSON.stringify({
          type: 'response.failed',
          response: { error: { code: 'usage_not_included' } },
        }),
      ),
    });

    expect(bodyFailure.code).toBe('billing');

    const lateFailure = classifyResponses({
      provider: 'openai',
      error: {
        type: 'response.failed',
        statusCode: 500,
        response: {
          error: { code: 'usage_not_included' },
        },
      },
    });

    expect(lateFailure.code).toBe('billing');
  });

  it('keeps fixed redirect failures unknown over recognized body codes', () => {
    const failure = classifyResponses({
      provider: 'openai-codex',
      error: apiError(302, {
        error: { code: 'usage_limit_reached' },
      }),
    });

    expect(failure.code).toBe('unknown');
  });

  it('rejects array payloads instead of reading them as error records', () => {
    const error = Object.assign([], {
      code: 'usage_not_included',
      statusCode: 500,
    });

    expect(classifyResponses({ provider: 'openai', error }).code).toBe(
      'unknown',
    );
  });

  it('prefers retry-after-ms and keeps a bare 429 retry delay as a hint', () => {
    const failure = classifyCompletions({
      provider: 'openai',
      error: apiError(
        429,
        {},
        { 'retry-after': '60', 'retry-after-ms': '1250' },
      ),
      now: 1000,
    });

    expect(failure.code).toBe('rate_limited');
    expect(failure.hintMs).toBe(1250);
    expect(failure.resetsAt).toBeUndefined();
  });

  it('keeps Retry-After on a throttle as a hint, not a reset', () => {
    const failure = classifyCompletions({
      provider: 'openai',
      error: apiError(
        429,
        { error: { code: 'rate_limit_exceeded' } },
        { 'retry-after': '300' },
      ),
      now: 1000,
    });

    expect(failure.code).toBe('rate_limited');
    expect(failure.hintMs).toBe(300_000);
    expect(failure.resetsAt).toBeUndefined();
  });

  it('does not infer an OpenRouter budget reset from Retry-After', () => {
    const failure = classifyResponses({
      provider: 'openrouter',
      error: apiError(
        403,
        {
          error: {
            metadata: {
              limit_source: 'openrouter_workspace_budget',
              resets_at: 'not-a-valid-reset',
            },
          },
        },
        { 'retry-after': '60' },
      ),
      now: Date.UTC(2026, 0, 1),
    });

    expect(failure.code).toBe('quota_exhausted');
    expect(failure.resetsAt).toBeUndefined();
    expect(failure.hintMs).toBe(60_000);
  });

  it('classifies direct SDK error envelopes on every wire', () => {
    for (const [, classifier] of wires) {
      const go = classify(classifier, {
        provider: 'opencode-go',
        error: {
          type: 'GoUsageLimitError',
          metadata: { limitName: 'weekly' },
          message: 'Go limit',
        },
        headers: { 'retry-after': '30' },
      });

      expect(go.code).toBe('quota_exhausted');
      expect(go.message).toBe('Go limit');
      expect(go.resetsAt).toBe(Date.UTC(2026, 0, 1) + 30_000);

      const codex = classify(classifier, {
        provider: 'openai-codex',
        error: {
          code: 'usage_limit_reached',
          resets_at: 1_768_000_000,
          message: 'Codex limit',
        },
      });

      expect(codex.code).toBe('quota_exhausted');
      expect(codex.resetsAt).toBe(1_768_000_000_000);

      const router = classify(classifier, {
        provider: 'openrouter',
        error: {
          code: 403,
          type: 'permission_error',
          error: {
            metadata: {
              limit_source: 'openrouter_workspace_budget',
              resets_at: '2026-01-05T00:00:00Z',
            },
          },
        },
      });

      expect(router.code).toBe('quota_exhausted');
      expect(router.resetsAt).toBe(Date.UTC(2026, 0, 5));
    }
  });

  it('keeps provider rules tied to exact provider identities', () => {
    const failure = classifyResponses({
      provider: 'custom-openrouter-profile',
      error: apiError(403, { error: { code: 'openrouter_credits' } }),
    });

    expect(failure.code).toBe('auth');
  });

  it.each(['JSONParseError', 'TypeValidationError'])(
    'keeps %s failures unknown',
    (name) => {
      const error = Object.assign(new Error('unreadable response'), {
        name,
        statusCode: 400,
      });

      expect(classifyResponses({ provider: 'openai', error }).code).toBe(
        'unknown',
      );
    },
  );

  it('ignores malformed timing fields and keeps a valid expired provider instant', () => {
    const now = Date.UTC(2026, 0, 1);

    const codex = classifyResponses({
      provider: 'openai-codex',
      now,
      error: apiError(
        429,
        { error: { code: 'usage_limit_reached', resets_at: 'bad' } },
        {
          'x-codex-primary-used-percent': '100',
          'x-codex-primary-reset-at': 'NaN',
          'x-codex-secondary-used-percent': '99',
          'x-codex-secondary-reset-at': '1768000000',
        },
      ),
    });

    expect(codex.code).toBe('quota_exhausted');
    expect(codex.resetsAt).toBeUndefined();

    const expired = classifyResponses({
      provider: 'openrouter',
      now,
      error: apiError(403, {
        error: {
          metadata: { limit_source: 'workspace', resets_at: 'not-a-date' },
        },
      }),
    });

    expect(expired.code).toBe('quota_exhausted');
    expect(expired.resetsAt).toBeUndefined();

    const expiredInstant = classifyResponses({
      provider: 'openrouter',
      now,
      error: apiError(403, {
        error: {
          metadata: {
            limit_source: 'workspace',
            resets_at: '2025-12-31T12:00:00Z',
          },
        },
      }),
    });

    expect(expiredInstant.code).toBe('quota_exhausted');
    expect(expiredInstant.resetsAt).toBe(Date.UTC(2025, 11, 31, 12));

    const invalidCodexInstant = classifyResponses({
      provider: 'openai-codex',
      error: apiError(429, {
        error: {
          code: 'usage_limit_reached',
          resets_at: 8_650_000_000_000,
        },
      }),
    });

    expect(invalidCodexInstant.code).toBe('quota_exhausted');
    expect(invalidCodexInstant.resetsAt).toBeUndefined();
  });

  it('classifies an exhausted Codex header window without a body code', () => {
    const failure = classifyResponses({
      provider: 'openai-codex',
      error: apiError(
        429,
        {},
        {
          'x-codex-primary-used-percent': '100',
          'x-codex-primary-reset-at': '1767500000',
        },
      ),
    });

    expect(failure.code).toBe('quota_exhausted');
    expect(failure.resetsAt).toBe(1_767_500_000_000);
  });

  it('uses Codex latest exhausted window and ignores reset for unspent windows', () => {
    const now = Date.UTC(2026, 0, 1);

    const headers = {
      'x-codex-primary-used-percent': '100',
      'x-codex-primary-reset-at': '1767400000',
      'x-codex-secondary-used-percent': '100',
      'x-codex-secondary-reset-at': '1767500000',
    };

    const both = classifyResponses({
      provider: 'openai-codex',
      now,
      error: apiError(429, { error: { code: 'usage_limit_reached' } }, headers),
    });

    expect(both.resetsAt).toBe(1_767_500_000_000);

    const unspent = classifyResponses({
      provider: 'openai-codex',
      now,
      error: apiError(
        429,
        { error: { code: 'usage_limit_reached' } },
        {
          'x-codex-primary-used-percent': '100',
          'x-codex-secondary-used-percent': '99',
          'x-codex-secondary-reset-at': '1767500000',
        },
      ),
    });

    expect(unspent.resetsAt).toBeUndefined();
  });

  it('uses only Anthropic exhausted-bucket resets, and never a spend-tier reset', () => {
    const now = Date.UTC(2026, 0, 1);

    const spent = classifyAnthropic({
      provider: 'anthropic',
      now,
      error: apiError(
        429,
        { error: { type: 'rate_limit_error' } },
        {
          'anthropic-ratelimit-input-tokens-remaining': '10',
          'anthropic-ratelimit-input-tokens-reset': '2026-01-02T00:00:00Z',
          'anthropic-ratelimit-output-tokens-remaining': '0',
          'anthropic-ratelimit-output-tokens-reset': '2026-01-03T00:00:00Z',
          'retry-after': '100',
        },
      ),
    });

    expect(spent.resetsAt).toBe(Date.UTC(2026, 0, 3));

    const spendTier = classifyAnthropic({
      provider: 'anthropic',
      now,
      error: apiError(
        429,
        { error: { details: { error_code: 'enforced_spend_limit_reached' } } },
        {
          'anthropic-ratelimit-requests-remaining': '0',
          'anthropic-ratelimit-requests-reset': '2026-01-03T00:00:00Z',
          'retry-after': '300',
        },
      ),
    });

    expect(spendTier.code).toBe('quota_exhausted');
    expect(spendTier.resetsAt).toBeUndefined();
  });

  it('uses OpenAI exhausted bucket durations and OpenRouter ISO resets', () => {
    const now = Date.UTC(2026, 0, 1);

    const openai = classifyResponses({
      provider: 'openai',
      now,
      error: apiError(
        429,
        { error: { code: 'rate_limit_exceeded' } },
        {
          'x-ratelimit-remaining-requests': '0',
          'x-ratelimit-reset-requests': '1s',
          'x-ratelimit-remaining-tokens': '10',
          'x-ratelimit-reset-tokens': '6m0s',
        },
      ),
    });

    expect(openai.resetsAt).toBe(now + 1000);

    const router = classifyCompletions({
      provider: 'openrouter',
      now,
      error: apiError(403, {
        error: {
          metadata: {
            limit_source: 'guardrail',
            resets_at: '2026-01-05T00:00:00Z',
          },
        },
      }),
    });

    expect(router.code).toBe('quota_exhausted');
    expect(router.resetsAt).toBe(Date.UTC(2026, 0, 5));
  });

  it('applies Codex, Go, and OpenRouter provider rules on every wire', () => {
    for (const [, classifier] of wires) {
      expect(
        classify(classifier, {
          provider: 'openai-codex',
          error: apiError(500, {
            error: { code: 'usage_limit_reached', resets_at: 1_768_000_000 },
          }),
        }).code,
      ).toBe('quota_exhausted');
      expect(
        classify(classifier, {
          provider: 'opencode-go',
          error: apiError(
            429,
            {
              error: {
                type: 'GoUsageLimitError',
                metadata: { limitName: 'weekly' },
              },
            },
            { 'retry-after': '30' },
          ),
        }).resetsAt,
      ).toBe(Date.UTC(2026, 0, 1) + 30_000);
      expect(
        classify(classifier, {
          provider: 'openrouter',
          error: apiError(403, {
            error: {
              code: 403,
              type: 'permission_error',
              metadata: {
                limit_source: 'openrouter_workspace_budget',
                resets_at: '2026-01-05T00:00:00Z',
              },
            },
          }),
        }).code,
      ).toBe('quota_exhausted');
    }
  });
});
