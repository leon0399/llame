import type { LlameConfig } from '../instance-config/llame-config';

import type {
  FailoverCell,
  FailureGroup,
  ModelRoleConfig,
} from '../instance-config/model-roles-config';
import type { RunOrigin } from '../db/schema';
import { quotaWaitForFailure } from '../runs/quota-wait';
import type { QuotaRequestState } from '../runs/quota-wake-projection';
import { nextCandidateInRole } from './model-selection';
import type {
  ProviderFailure,
  FailureClass,
} from './provider-failure/provider-failure';
import { parseModelSelector } from './model-selector';

const FAILURE_GROUPS: Partial<Record<FailureClass, FailureGroup>> = {
  overloaded: 'availability',
  server_error: 'availability',
  unreachable: 'availability',
  first_token_timeout: 'availability',
  stream_broken: 'availability',
  auth: 'access',
  billing: 'access',
  model_not_found: 'access',
  quota_exhausted: 'quota',
};

export function failureGroup(
  failure: ProviderFailure,
): FailureGroup | undefined {
  if (failure.code === 'rate_limited') {
    return failure.resetsAt === undefined ? undefined : 'quota';
  }

  return FAILURE_GROUPS[failure.code];
}

export function policyCell(
  config: LlameConfig,
  role: ModelRoleConfig | undefined,
  origin: RunOrigin,
  group: FailureGroup,
): FailoverCell {
  return (
    role?.failover?.[origin]?.[group] ??
    config.failover[origin]?.[group] ??
    'off'
  );
}

function shouldWaitForQuota(input: {
  cell: FailoverCell;
  failure: ProviderFailure;
  config: LlameConfig;
  quotaRequest: QuotaRequestState | undefined;
  afterCut: boolean;
  now: number;
}): boolean {
  const { cell, failure, config, quotaRequest, afterCut, now } = input;

  if (cell === 'on' || cell === 'off' || failure.resetsAt === undefined) {
    return false;
  }

  return (
    (failure.resetsAt - now) / 1000 <= cell.switchAfterSeconds &&
    quotaWaitForFailure(
      failure,
      config.runs.quotaWaitMaxSeconds,
      quotaRequest,
      { afterCut },
    ) !== undefined
  );
}

function nextAllowedCandidate(
  config: LlameConfig,
  role: ModelRoleConfig,
  selector: string,
  currentModelId: string,
): { toModelId: string; candidateEffort?: string } | undefined {
  const current = config.models.find((model) => model.id === currentModelId);

  const catalog = {
    roleCandidates: () => role.candidates,
    model: (id: string) => config.models.find((model) => model.id === id),
  };

  let next = nextCandidateInRole(catalog, selector, currentModelId);

  while (
    next !== undefined &&
    skipsPaidCandidate(current, next.model.billing, role.allowPaidFallback)
  ) {
    next = nextCandidateInRole(catalog, selector, next.modelId);
  }

  return next === undefined
    ? undefined
    : {
        toModelId: next.modelId,
        ...(next.candidateEffort !== undefined && {
          candidateEffort: next.candidateEffort,
        }),
      };
}

export function skipsPaidCandidate(
  from: { billing?: 'subscription' | 'usage' | 'free' } | undefined,
  candidateBilling: 'subscription' | 'usage' | 'free' | undefined,
  allowPaidFallback: boolean | undefined,
): boolean {
  return (
    candidateBilling === 'usage' &&
    (from?.billing === 'subscription' || from?.billing === 'free') &&
    allowPaidFallback !== true
  );
}

function roleFailoverTarget(
  input: {
    config: LlameConfig;
    selector: string;
    currentModelId: string;
    origin: RunOrigin;
    failure: ProviderFailure;
    quotaRequest?: QuotaRequestState;
    afterCut?: boolean;
    now: number;
  },
  role: ModelRoleConfig,
): { toModelId: string; candidateEffort?: string } | undefined {
  const group = failureGroup(input.failure);

  if (group === undefined) return undefined;

  const cell = policyCell(input.config, role, input.origin, group);

  if (cell === 'off') return undefined;

  if (
    group === 'quota' &&
    shouldWaitForQuota({
      cell,
      failure: input.failure,
      config: input.config,
      quotaRequest: input.quotaRequest,
      afterCut: input.afterCut === true,
      now: input.now,
    })
  ) {
    return undefined;
  }

  return nextAllowedCandidate(
    input.config,
    role,
    input.selector,
    input.currentModelId,
  );
}

export function failoverTarget(input: {
  config: LlameConfig;
  selector: string;
  currentModelId: string;
  origin: RunOrigin;
  failure: ProviderFailure;
  quotaRequest?: QuotaRequestState;
  afterCut?: boolean;
  now: number;
}): { toModelId: string; candidateEffort?: string } | undefined {
  const parsed = parseModelSelector(input.selector);

  if (parsed.kind !== 'role') return undefined;

  const role = input.config.modelRoles.find(
    (item) => item.name === parsed.roleName,
  );

  return role === undefined ? undefined : roleFailoverTarget(input, role);
}

/** Reads config inside each call so policy changes are observed at failure time. */
export function createFailoverDecision(instanceConfigService: {
  readonly config: LlameConfig;
}) {
  return (input: {
    selector: string;
    modelId: string;
    origin: RunOrigin;
    failure: ProviderFailure;
    quotaRequest?: QuotaRequestState;
    afterCut?: boolean;
  }): Promise<{ toModelId: string; candidateEffort?: string } | undefined> =>
    Promise.resolve(
      failoverTarget({
        ...input,
        config: instanceConfigService.config,
        currentModelId: input.modelId,
        now: Date.now(),
      }),
    );
}
