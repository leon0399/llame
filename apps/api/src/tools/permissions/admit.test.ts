import { describe, expect, it, vi } from 'vitest';

import {
  admitPermission,
  decidePermission,
  type EvaluateCall,
  OWNER_ROUTE,
} from './admit';
import { compileToolPermissionMap } from './compile-permissions';
import { type ToolContext } from '../types';
import { type PermissionDecision } from './types';

const policy = compileToolPermissionMap(
  { echo: { allow: [{ field: 'text', literal: 'allowed' }] } },
  'process-policy',
);

const BYPASS_ALLOW: PermissionDecision = {
  policyId: 'process-policy',
  decision: 'allow',
  reason: 'permission_mode_bypass',
  reference: null,
};

const NO_ALLOW: PermissionDecision = {
  policyId: 'process-policy',
  decision: 'reject',
  reason: 'no_allow',
  reference: null,
};

const echo = (evaluate: EvaluateCall) =>
  evaluate({ toolId: 'echo', args: { text: 'refused' } });

function context(permissionMode?: 'default' | 'bypass'): ToolContext {
  return {
    userId: 'owner',
    chatId: 'chat',
    tenantDb: { runAs: () => Promise.reject(new Error('unused')) },
    permissionPolicy: policy,
    ...(permissionMode !== undefined && { permissionMode }),
  };
}

describe('decidePermission', () => {
  it.each(['default', OWNER_ROUTE] as const)(
    'evaluates the policy under %s',
    (mode) => {
      expect(decidePermission(policy, mode, echo)).toEqual(NO_ALLOW);
      expect(
        decidePermission(policy, mode, (evaluate) =>
          evaluate({ toolId: 'echo', args: { text: 'allowed' } }),
        ),
      ).toMatchObject({ decision: 'allow', reason: 'matched_allow' });
    },
  );

  it('returns a process-attributed bypass allow without evaluating the policy', () => {
    const decide = vi.fn<(evaluate: EvaluateCall) => PermissionDecision>();

    expect(decidePermission(policy, 'bypass', decide)).toEqual(BYPASS_ALLOW);
    expect(decide).not.toHaveBeenCalled();
  });
});

describe('admitPermission', () => {
  it.each([
    ['default', NO_ALLOW],
    [undefined, NO_ALLOW],
    ['bypass', BYPASS_ALLOW],
  ] as const)('decides a call in mode %s', (mode, expected) => {
    expect(admitPermission(context(mode), echo)).toEqual(expected);
  });

  it('keeps absent policy fail-closed for callers that require a decision', () => {
    const decide = vi.fn<(evaluate: EvaluateCall) => PermissionDecision>();
    const noPolicy: ToolContext = {
      userId: 'owner',
      chatId: 'chat',
      tenantDb: { runAs: () => Promise.reject(new Error('unused')) },
    };

    expect(admitPermission(noPolicy, decide)).toBeUndefined();
    expect(decide).not.toHaveBeenCalled();
  });
});
