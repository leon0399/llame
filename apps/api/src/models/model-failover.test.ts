import { describe, expect, it } from 'vitest';

import { BUILT_IN_DEFAULTS } from '../instance-config/llame-config';
import type {
  FailoverMatrix,
  ModelRoleConfig,
} from '../instance-config/model-roles-config';
import type { SystemModelCatalogEntry } from './model-catalog';
import { ProviderFailure } from './provider-failure/provider-failure';
import {
  createFailoverDecision,
  failoverTarget,
  policyCell,
} from './model-failover';

const model = (id: string, billing: 'subscription' | 'usage' | 'free') =>
  ({
    id,
    source: 'system',
    provider: 'p',
    providerModelId: id,
    name: id,
    billing,
    contextWindowTokens: 1000,
    input: ['text'],
    pricingUsdPer1M: { input: 1, output: 1 },
    systemPromptTemplate: 'prompt',
    systemPromptSource: 'project_default',
    referencesSkills: false,
  }) satisfies SystemModelCatalogEntry;

const baseModels = [
  model('primary', 'subscription'),
  model('paid', 'usage'),
  model('fallback', 'free'),
];

function config(
  options: {
    failover?: FailoverMatrix;
    roleFailover?: FailoverMatrix;
    allowPaidFallback?: boolean;
  } = {},
) {
  const role: ModelRoleConfig = {
    name: 'chat',
    candidates: [
      { modelId: 'primary' },
      { modelId: 'paid' },
      { modelId: 'fallback' },
    ],
    ...(options.allowPaidFallback !== undefined && {
      allowPaidFallback: options.allowPaidFallback,
    }),
    ...(options.roleFailover !== undefined && {
      failover: options.roleFailover,
    }),
  };

  return {
    ...BUILT_IN_DEFAULTS,
    models: baseModels,
    modelRoles: [role],
    failover: options.failover ?? {},
  };
}

function failure(
  code: ConstructorParameters<typeof ProviderFailure>[1]['code'],
  resetsAt?: number,
) {
  return new ProviderFailure('provider failed', {
    code,
    ...(resetsAt !== undefined && { resetsAt }),
  });
}

const at = 1_000_000;

const switched = (
  overrides: Parameters<typeof config>[0] = {},
  error = failure('overloaded'),
) =>
  failoverTarget({
    config: config(overrides),
    selector: '@chat',
    currentModelId: 'primary',
    origin: 'agent',
    failure: error,
    now: at,
  });

describe('model failover policy', () => {
  it('does not switch for a context overflow', () => {
    expect(
      switched(
        { failover: { agent: { availability: 'on' } } },
        failure('context_overflow'),
      ),
    ).toBeUndefined();
  });

  it('never switches under the default policy', () => {
    expect(switched()).toBeUndefined();
  });

  it('waits for a near quota reset', () => {
    const policy = {
      agent: { quota: { switchAfterSeconds: 7200 } },
    } satisfies FailoverMatrix;

    expect(
      switched(
        { failover: policy },
        failure('quota_exhausted', at + 3_600_000),
      ),
    ).toBeUndefined();
  });

  it('switches when a quota reset is beyond the wait cap', () => {
    const policy = {
      agent: { quota: { switchAfterSeconds: 7200 } },
    } satisfies FailoverMatrix;

    expect(
      switched(
        { failover: policy },
        failure('quota_exhausted', at + 9 * 86_400_000),
      ),
    ).toEqual({
      toModelId: 'fallback',
    });
  });

  it('switches for a far quota reset', () => {
    const policy = {
      agent: { quota: { switchAfterSeconds: 3600 } },
    } satisfies FailoverMatrix;

    expect(
      switched(
        { failover: policy },
        failure('quota_exhausted', at + 5 * 86_400_000),
      ),
    ).toEqual({
      toModelId: 'fallback',
    });
  });

  it('switches immediately when the quota cell is on', () => {
    expect(
      switched(
        { failover: { agent: { quota: 'on' } } },
        failure('quota_exhausted', at + 5 * 86_400_000),
      ),
    ).toEqual({ toModelId: 'fallback' });
  });

  it('does not switch a compaction Run', () => {
    expect(
      failoverTarget({
        config: config({ failover: { agent: { availability: 'on' } } }),
        selector: '@chat',
        currentModelId: 'primary',
        origin: 'agent',
        failure: failure('overloaded'),
        now: at,
        kind: 'compaction',
      }),
    ).toBeUndefined();
  });

  it('fails over an agent Run when its cell is on', () => {
    expect(switched({ failover: { agent: { availability: 'on' } } })).toEqual({
      toModelId: 'fallback',
    });
  });

  it('does not switch an exact model selector', () => {
    expect(
      failoverTarget({
        config: config({ failover: { agent: { availability: 'on' } } }),
        selector: 'primary',
        currentModelId: 'primary',
        origin: 'agent',
        failure: failure('overloaded'),
        now: at,
      }),
    ).toBeUndefined();
  });

  it('switches when a quota failure has no known reset', () => {
    const policy = {
      agent: { quota: { switchAfterSeconds: 3600 } },
    } satisfies FailoverMatrix;

    expect(switched({ failover: policy }, failure('quota_exhausted'))).toEqual({
      toModelId: 'fallback',
    });
  });

  it('skips a gated paid candidate', () => {
    expect(switched({ failover: { agent: { availability: 'on' } } })).toEqual({
      toModelId: 'fallback',
    });
  });

  it('returns none when every candidate failed', () => {
    expect(
      failoverTarget({
        config: config({ failover: { agent: { availability: 'on' } } }),
        selector: '@chat',
        currentModelId: 'fallback',
        origin: 'agent',
        failure: failure('overloaded'),
        now: at,
      }),
    ).toBeUndefined();
  });

  it('does not switch an owner Run when its cell is off', () => {
    expect(
      failoverTarget({
        config: config({ failover: { owner: { availability: 'off' } } }),
        selector: '@chat',
        currentModelId: 'primary',
        origin: 'owner',
        failure: failure('overloaded'),
        now: at,
      }),
    ).toBeUndefined();
  });

  it('merges a role cell over the default one without replacing other cells', () => {
    const defaults = {
      agent: { availability: 'on', access: 'on' },
    } satisfies FailoverMatrix;

    const role = { agent: { availability: 'off' } } satisfies FailoverMatrix;
    const settings = config({ failover: defaults, roleFailover: role });

    expect(policyCell(settings, 'chat', 'agent', 'availability')).toBe('off');
    expect(policyCell(settings, 'chat', 'agent', 'access')).toBe('on');
  });

  it('reads the current config when each failure decision runs', async () => {
    const instanceConfig = { config: config() };
    const decide = createFailoverDecision(instanceConfig);

    const input = {
      selector: '@chat',
      modelId: 'primary',
      origin: 'agent' as const,
      kind: 'turn' as const,
      failure: failure('overloaded'),
    };

    await expect(decide(input)).resolves.toBeUndefined();

    instanceConfig.config = config({
      failover: { agent: { availability: 'on' } },
    });

    await expect(decide(input)).resolves.toEqual({ toModelId: 'fallback' });
  });
});
