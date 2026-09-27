import { describe, expect, it, vi } from 'vitest';

import { admitPermission } from './admit';
import { compileToolPermissionMap } from './compile-permissions';
import { type ToolContext } from '../types';
import { type PermissionDecision } from './types';

const policy = compileToolPermissionMap(
  { echo: { allow: true } },
  'process-policy',
);

function context(permissionMode?: 'default' | 'bypass'): ToolContext {
  return {
    userId: 'owner',
    chatId: 'chat',
    tenantDb: { runAs: () => Promise.reject(new Error('unused')) },
    permissionPolicy: policy,
    ...(permissionMode !== undefined && { permissionMode }),
  };
}

describe('admitPermission', () => {
  it('delegates exactly to policy evaluation in default mode', () => {
    const evaluate = vi.fn<(compiled: typeof policy) => PermissionDecision>(
      () => ({
        policyId: policy.id,
        decision: 'reject',
        reason: 'no_allow',
        reference: null,
      }),
    );

    expect(admitPermission(context('default'), evaluate)).toEqual({
      policyId: policy.id,
      decision: 'reject',
      reason: 'no_allow',
      reference: null,
    });
    expect(evaluate).toHaveBeenCalledWith(policy);
  });

  it('returns a process-attributed bypass allow without evaluating the policy', () => {
    const evaluate = vi.fn<(compiled: typeof policy) => PermissionDecision>();

    expect(admitPermission(context('bypass'), evaluate)).toEqual({
      policyId: 'process-policy',
      decision: 'allow',
      reason: 'permission_mode_bypass',
      reference: null,
    });
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('keeps absent policy fail-closed for callers that require a decision', () => {
    const evaluate = vi.fn<(compiled: typeof policy) => PermissionDecision>();
    const noPolicy: ToolContext = {
      userId: 'owner',
      chatId: 'chat',
      tenantDb: { runAs: () => Promise.reject(new Error('unused')) },
    };

    expect(admitPermission(noPolicy, evaluate)).toBeUndefined();
    expect(evaluate).not.toHaveBeenCalled();
  });
});
