import { describe, expect, it, vi } from 'vitest';

import {
  admitPermission,
  decidePermission,
  type EvaluateCall,
  evaluateCanonicalWithRejectTexts,
  evaluatesPermission,
  OWNER_ROUTE,
} from './admit';
import { compileToolPermissionMap } from './compile-permissions';
import { evaluatePermission } from './evaluator';
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

function context(
  permissionMode?: 'default' | 'bypass' | 'read-only',
): ToolContext {
  return {
    configuredCredentials: [],
    userId: 'owner',
    chatId: 'chat',
    tenantDb: { runAs: () => Promise.reject(new Error('unused')) },
    permissionPolicy: policy,
    ...(permissionMode !== undefined && { permissionMode }),
  };
}

describe('decidePermission', () => {
  it.each(['default', 'read-only', OWNER_ROUTE] as const)(
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
    ['read-only', NO_ALLOW],
  ] as const)('decides a call in mode %s', (mode, expected) => {
    expect(admitPermission(context(mode), echo)).toEqual(expected);
  });

  it('keeps absent policy fail-closed for callers that require a decision', () => {
    const decide = vi.fn<(evaluate: EvaluateCall) => PermissionDecision>();

    const noPolicy: ToolContext = {
      configuredCredentials: [],
      userId: 'owner',
      chatId: 'chat',
      tenantDb: { runAs: () => Promise.reject(new Error('unused')) },
    };

    expect(admitPermission(noPolicy, decide)).toBeUndefined();
    expect(decide).not.toHaveBeenCalled();
  });
});

describe('evaluatesPermission', () => {
  it.each([
    ['default', true],
    ['read-only', true],
    ['bypass', false],
    [undefined, true],
  ] as const)('evaluates %s as %s', (mode, expected) => {
    expect(evaluatesPermission(context(mode))).toBe(expected);
  });
});

describe('evaluateCanonicalWithRejectTexts', () => {
  const canonicalAllow = compileToolPermissionMap(
    { read: { allow: [{ field: 'path', regex: '^machine://devl/srv(/|$)' }] } },
    'process-policy',
  );

  const projectedAllow = compileToolPermissionMap(
    { read: { allow: [{ field: 'path', regex: String.raw`^\/srv\/` }] } },
    'process-policy',
  );

  const projectedReject = compileToolPermissionMap(
    {
      read: {
        allow: true,
        reject: [{ field: 'path', regex: String.raw`^\/etc\/` }],
      },
    },
    'process-policy',
  );

  const evaluateWith =
    (map: typeof canonicalAllow): EvaluateCall =>
    (options) =>
      evaluatePermission(map, options);

  const canonical = {
    toolId: 'read',
    args: { path: 'machine://devl/srv/a.ts' },
  };

  it('admits through the canonical locator alone', () => {
    expect(
      evaluateCanonicalWithRejectTexts(evaluateWith(canonicalAllow), {
        canonical,
        rejectTexts: [{ toolId: 'read', args: { path: '/srv/a.ts' } }],
      }),
    ).toMatchObject({ decision: 'allow', reason: 'matched_allow' });
  });

  it('refuses when a reject matches the projected path', () => {
    const decision = evaluateCanonicalWithRejectTexts(
      evaluateWith(projectedReject),
      {
        canonical: {
          toolId: 'read',
          args: { path: 'machine://devl/etc/passwd' },
        },
        rejectTexts: [{ toolId: 'read', args: { path: '/etc/passwd' } }],
      },
    );

    expect(decision).toEqual({
      policyId: 'process-policy',
      decision: 'reject',
      reason: 'explicit_reject',
      reference: { groupId: 'read', list: 'reject', clauseIndex: 0 },
    });
  });

  it('never admits through an allow that only matches a non-canonical text', () => {
    const decision = evaluateCanonicalWithRejectTexts(
      evaluateWith(projectedAllow),
      {
        canonical,
        rejectTexts: [{ toolId: 'read', args: { path: '/srv/a.ts' } }],
      },
    );

    expect(decision).toMatchObject({ decision: 'reject', reason: 'no_allow' });
  });

  it('keeps a canonical reject even when every other text would allow', () => {
    const decision = evaluateCanonicalWithRejectTexts(
      evaluateWith(projectedAllow),
      {
        canonical: { toolId: 'read', args: { path: 'machine://devl/etc/x' } },
        rejectTexts: [{ toolId: 'read', args: { path: '/srv/a.ts' } }],
      },
    );

    expect(decision).toMatchObject({ decision: 'reject', reason: 'no_allow' });
  });
});
