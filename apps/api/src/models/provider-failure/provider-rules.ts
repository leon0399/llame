import { isRecord, isString } from '@workspace/runtime-safety';

import type { FailureClass } from './provider-failure';
import type { FailureContext } from './classifier-utils';
import {
  codexResetAt,
  codexWindowExhausted,
  goResetAt,
  openRouterBudget,
} from './reset-signals';

type RuleResult = { code: FailureClass; resetsAt?: number };

export function isOpenAIProvider(provider: string): boolean {
  return (
    provider === 'openai' ||
    provider === 'openai-responses' ||
    provider === 'openai-completions'
  );
}

export function isAnthropicProvider(provider: string): boolean {
  return provider === 'anthropic' || provider === 'anthropic-messages';
}

function openRouterRule(
  context: FailureContext,
  key: string | undefined,
): RuleResult | undefined {
  if (key === 'openrouter_in_flight_budget') return { code: 'rate_limited' };

  if (key === 'openrouter_credits' || key === 'openrouter_key_limit')
    return { code: 'billing' };

  if (key === '429') return { code: 'rate_limited' };

  const genericClass = codeRule(key);

  if (genericClass && genericClass !== 'rate_limited') return undefined;

  const budget = openRouterBudget(context);

  if (budget) {
    return {
      code: budget.class,
      ...(budget.resetsAt !== undefined && { resetsAt: budget.resetsAt }),
    };
  }

  if (key === '402') return { code: 'billing' };

  return undefined;
}

function codexRule(
  context: FailureContext,
  key: string | undefined,
): RuleResult | undefined {
  if (key === 'usage_limit_reached')
    return { code: 'quota_exhausted', resetsAt: codexResetAt(context) };

  if (!key && context.statusCode === 429 && codexWindowExhausted(context))
    return { code: 'quota_exhausted', resetsAt: codexResetAt(context) };

  return undefined;
}

function goRule(
  context: FailureContext,
  key: string | undefined,
): RuleResult | undefined {
  if (key === 'gousagelimiterror') {
    const metadata = isRecord(context.error.metadata)
      ? context.error.metadata
      : undefined;

    if (isString(metadata?.limitName) && metadata.limitName.trim() !== '')
      return { code: 'quota_exhausted', resetsAt: goResetAt(context) };
  }

  if (key === 'monthlylimiterror' && context.statusCode === 401)
    return { code: 'auth' };

  return undefined;
}

function anthropicRule(key: string | undefined): RuleResult | undefined {
  if (key === 'rate_limit_error') return { code: 'rate_limited' };

  if (key !== 'enforced_spend_limit_reached' && key !== 'api_error')
    return undefined;

  return { code: key === 'api_error' ? 'server_error' : 'quota_exhausted' };
}

function openAiRule(key: string | undefined): RuleResult | undefined {
  return key?.endsWith('_spend_limit_exceeded') ||
    key === 'organization_usage_limit_exceeded'
    ? { code: 'quota_exhausted' }
    : undefined;
}

/** Rules whose meaning is owned by a provider, applied irrespective of wire. */
export function providerRule(
  provider: string,
  context: FailureContext,
  signal: string | undefined,
): RuleResult | undefined {
  const key = signal?.toLowerCase();
  const providerType = provider.toLowerCase();

  if (providerType === 'openrouter') return openRouterRule(context, key);

  if (providerType === 'openai-codex')
    return codexRule(context, key) ?? openAiRule(key);

  if (providerType === 'opencode-go') return goRule(context, key);

  if (isAnthropicProvider(providerType)) return anthropicRule(key);

  if (isOpenAIProvider(providerType)) return openAiRule(key);

  return undefined;
}

const CODE_CLASS = {
  insufficient_quota: 'billing',
  credit_balance_exhausted: 'billing',
  usage_not_included: 'billing',
  rate_limit_exceeded: 'rate_limited',
  slow_down: 'rate_limited',
  overloaded_error: 'overloaded',

  model_not_found: 'model_not_found',
  context_length_exceeded: 'context_overflow',
  context_window_exceeded: 'context_overflow',
  max_context_length_exceeded: 'context_overflow',
  request_too_large: 'context_overflow',
  content_filter: 'content_policy',
  content_policy_violation: 'content_policy',
  safety_violation: 'content_policy',
  invalid_request_error: 'invalid_request',
} satisfies Record<string, FailureClass>;

function isFailureCode(key: string): key is keyof typeof CODE_CLASS {
  return Object.hasOwn(CODE_CLASS, key);
}

export function codeRule(signal: string | undefined): FailureClass | undefined {
  if (!signal) return undefined;
  const key = signal.toLowerCase();

  if (!isFailureCode(key)) return undefined;

  return CODE_CLASS[key];
}

export function statusRule(
  status: number | undefined,
): FailureClass | undefined {
  if (status === 402) return 'billing';

  if (status === 401 || status === 403) return 'auth';

  if (status === 404) return 'model_not_found';

  if (status === 408 || status === 500 || status === 502 || status === 504)
    return 'server_error';

  if (status === 503 || status === 529) return 'overloaded';

  if (status === 413) return 'context_overflow';

  if (status === 429) return 'rate_limited';

  if (status === 400 || status === 422) return 'invalid_request';

  return undefined;
}

export function messageRule(context: FailureContext): FailureClass | undefined {
  const message = isString(context.error.message)
    ? context.error.message
    : context.message;

  if (
    context.inStreamType === 'invalid_request_error' &&
    /^prompt is too long\b/i.test(message)
  )
    return 'context_overflow';

  return undefined;
}

export function defaultCodeRule(
  signal: string | undefined,
): FailureClass | undefined {
  if (!signal) return undefined;
  const normalized = signal.toLowerCase();

  if (
    /^context_(?:length|window)_/.test(normalized) ||
    /context.*(?:length|window).*exceed/.test(normalized)
  )
    return 'context_overflow';

  if (
    /content.*(?:policy|filter)|(?:policy|filter).*violation/.test(normalized)
  )
    return 'content_policy';

  return codeRule(normalized);
}
