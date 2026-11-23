import type { LlameConfig } from '../instance-config/llame-config';

import type { FailoverCell } from '../instance-config/model-roles-config';
import type {
  ProviderFailure,
  FailureClass,
} from './provider-failure/provider-failure';
import { parseModelSelector } from './model-selector';

type Origin = 'owner' | 'agent';

type FailureGroup = 'availability' | 'access' | 'quota';

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
  roleName: string | undefined,
  origin: Origin,
  group: FailureGroup,
): FailoverCell | undefined {
  const role =
    roleName === undefined
      ? undefined
      : config.modelRoles.find((item) => item.name === roleName);

  return (
    role?.failover?.[origin]?.[group] ??
    config.failover[origin]?.[group] ??
    'off'
  );
}

function shouldWaitForQuota(
  cell: FailoverCell,
  failure: ProviderFailure,
  config: LlameConfig,
  now: number,
): boolean {
  if (cell === 'on' || cell === 'off' || failure.resetsAt === undefined) {
    return false;
  }

  const remaining = (failure.resetsAt - now) / 1000;

  return (
    remaining > 60 &&
    remaining <= cell.switchAfterSeconds &&
    remaining <= config.runs.quotaWaitMaxSeconds
  );
}

function nextAllowedCandidate(
  config: LlameConfig,
  role: NonNullable<LlameConfig['modelRoles'][number]>,
  currentModelId: string,
): { toModelId: string; candidateEffort?: string } | undefined {
  const currentIndex = role.candidates.findIndex(
    (candidate) => candidate.modelId === currentModelId,
  );

  if (currentIndex < 0) return undefined;

  const current = config.models.find((model) => model.id === currentModelId);

  const paidGate =
    (current?.billing === 'subscription' || current?.billing === 'free') &&
    role.allowPaidFallback !== true;

  for (
    let index = currentIndex + 1;
    index < role.candidates.length;
    index += 1
  ) {
    const candidate = role.candidates[index];

    if (candidate === undefined) return undefined;

    const model = config.models.find((item) => item.id === candidate.modelId);

    if (model === undefined) return undefined;

    if (paidGate && model.billing === 'usage') continue;

    return {
      toModelId: candidate.modelId,
      ...(candidate.effort !== undefined && {
        candidateEffort: candidate.effort,
      }),
    };
  }

  return undefined;
}

export function failoverTarget(input: {
  config: LlameConfig;
  selector: string;
  currentModelId: string;
  origin: Origin;
  failure: ProviderFailure;
  now: number;
  kind?: 'turn' | 'compaction';
}): { toModelId: string; candidateEffort?: string } | undefined {
  if (input.kind === 'compaction') return undefined;

  const parsed = parseModelSelector(input.selector);

  if (parsed.kind !== 'role') return undefined;

  const role = input.config.modelRoles.find(
    (item) => item.name === parsed.roleName,
  );

  if (role === undefined) return undefined;

  const group = failureGroup(input.failure);

  if (group === undefined) return undefined;

  const cell = policyCell(input.config, role.name, input.origin, group);

  if (cell === undefined || cell === 'off') return undefined;

  if (
    group === 'quota' &&
    shouldWaitForQuota(cell, input.failure, input.config, input.now)
  ) {
    return undefined;
  }

  return nextAllowedCandidate(input.config, role, input.currentModelId);
}

/** Reads config inside each call so policy changes are observed at failure time. */
export function createFailoverDecision(instanceConfigService: {
  readonly config: LlameConfig;
}) {
  return (input: {
    selector: string;
    modelId: string;
    origin: Origin;
    kind: 'turn' | 'compaction';
    failure: ProviderFailure;
  }): Promise<{ toModelId: string; candidateEffort?: string } | undefined> =>
    Promise.resolve(
      failoverTarget({
        config: instanceConfigService.config,
        selector: input.selector,
        currentModelId: input.modelId,
        origin: input.origin,
        failure: input.failure,
        kind: input.kind,
        now: Date.now(),
      }),
    );
}
