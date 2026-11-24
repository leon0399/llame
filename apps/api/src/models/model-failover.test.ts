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
    candidateEffort?: string;
  } = {},
) {
  const role: ModelRoleConfig = {
    name: 'chat',
    candidates: [
      { modelId: 'primary' },
      {
        modelId: 'paid',
        ...(options.candidateEffort !== undefined && {
          effort: options.candidateEffort,
        }),
      },
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
  toolCallStarted?: boolean,
) {
  return new ProviderFailure('provider failed', {
    code,
    ...(resetsAt !== undefined && { resetsAt }),
    ...(toolCallStarted && { toolCallStarted: true }),
  });
}

const at = Date.now();

const switched = (
  overrides: Parameters<typeof config>[0] = {},
  error = failure('overloaded'),
  quotaRequest?: { resumeAt: 'request'; waitCount: number; generation: number },
) =>
  failoverTarget({
    config: config(overrides),
    selector: '@chat',
    currentModelId: 'primary',
    origin: 'agent',
    failure: error,
    quotaRequest,
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

  it('switches when the quota wait cap is exceeded', () => {
    const policy = {
      agent: { quota: { switchAfterSeconds: 864_000 } },
    } satisfies FailoverMatrix;

    expect(
      switched(
        { failover: policy },
        failure('quota_exhausted', at + 9 * 86_400_000),
      ),
    ).toEqual({ toModelId: 'fallback' });
  });

  it('switches when the quota wait count is exhausted', () => {
    const policy = {
      agent: { quota: { switchAfterSeconds: 7200 } },
    } satisfies FailoverMatrix;

    expect(
      switched(
        { failover: policy },
        failure('quota_exhausted', at + 3_600_000),
        { resumeAt: 'request', waitCount: 4, generation: 4 },
      ),
    ).toEqual({ toModelId: 'fallback' });
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

  it('waits when the quota reset exactly meets the configured threshold', () => {
    expect(
      switched(
        { failover: { agent: { quota: { switchAfterSeconds: 7200 } } } },
        failure('quota_exhausted', at + 7_200_000),
      ),
    ).toBeUndefined();
  });

  it('keeps a started tool call on quota wait only after the cut', () => {
    const policy = {
      failover: { agent: { quota: { switchAfterSeconds: 7200 } } },
    };

    const error = failure('quota_exhausted', at + 3_600_000, true);

    expect(
      failoverTarget({
        config: config(policy),
        selector: '@chat',
        currentModelId: 'primary',
        origin: 'agent',
        failure: error,
        afterCut: true,
        now: at,
      }),
    ).toBeUndefined();
    expect(
      failoverTarget({
        config: config(policy),
        selector: '@chat',
        currentModelId: 'primary',
        origin: 'agent',
        failure: error,
        now: at,
      }),
    ).toEqual({ toModelId: 'fallback' });
  });

  it('uses a rate-limit reset as quota evidence', () => {
    expect(
      switched(
        { failover: { agent: { quota: 'on' } } },
        failure('rate_limited', at + 3_600_000),
      ),
    ).toEqual({ toModelId: 'fallback' });
    expect(
      switched(
        { failover: { agent: { quota: 'on' } } },
        failure('rate_limited'),
      ),
    ).toBeUndefined();
  });

  it('carries the selected fallback candidate effort into the decision', () => {
    expect(
      switched({
        failover: { agent: { availability: 'on' } },
        allowPaidFallback: true,
        candidateEffort: 'high',
      }),
    ).toEqual({ toModelId: 'paid', candidateEffort: 'high' });
  });

  it('skips a paid candidate after a free candidate when paid fallback is off', () => {
    const settings = config({
      failover: { agent: { availability: 'on' } },
    });

    expect(
      failoverTarget({
        config: {
          ...settings,
          models: [model('primary', 'free'), ...baseModels.slice(1)],
        },
        selector: '@chat',
        currentModelId: 'primary',
        origin: 'agent',
        failure: failure('overloaded'),
        now: at,
      }),
    ).toEqual({ toModelId: 'fallback' });
  });

  it('switches immediately when the quota cell is on', () => {
    expect(
      switched(
        { failover: { agent: { quota: 'on' } } },
        failure('quota_exhausted', at + 5 * 86_400_000),
      ),
    ).toEqual({ toModelId: 'fallback' });
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

  it('does not switch an owner Run when its role cell is off', () => {
    expect(
      failoverTarget({
        config: config({
          failover: { owner: { availability: 'on' } },
          roleFailover: { owner: { availability: 'off' } },
        }),
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

    const roleConfig = settings.modelRoles[0];

    if (roleConfig === undefined) throw new Error('Expected chat role config');

    expect(policyCell(settings, roleConfig, 'agent', 'availability')).toBe(
      'off',
    );
    expect(policyCell(settings, roleConfig, 'agent', 'access')).toBe('on');
  });

  it('reads the current config when each failure decision runs', async () => {
    const instanceConfig = { config: config() };
    const decide = createFailoverDecision(instanceConfig);

    const input = {
      selector: '@chat',
      modelId: 'primary',
      origin: 'agent' as const,
      failure: failure('overloaded'),
    };

    await expect(decide(input)).resolves.toBeUndefined();

    instanceConfig.config = config({
      failover: { agent: { availability: 'on' } },
    });

    await expect(decide(input)).resolves.toEqual({ toModelId: 'fallback' });
  });
});
