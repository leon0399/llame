import { describe, expect, it } from 'vitest';

import { compileToolPermissionMap } from '../permissions/compile-permissions';
import { evaluatePermission } from '../permissions/evaluator';
import { nativeFileProjection } from '../permissions/locator-projection';
import {
  type CompiledPolicy,
  type PermissionDecision,
  type ToolPermissionMap,
} from '../permissions/types';
import { type ToolContext } from '../types';
import {
  createAddressAdmission,
  createDerivedAdmission,
  type DerivedDecision,
  type DerivedLocatorKind,
} from './admission';

const POLICY_ID = 'test-policy';
const DOCS_URL = 'https://docs.example.test/guides/pipelines.html';
const OTHER_URL = 'https://evil.example.test/pipelines.html';

function policy(map: ToolPermissionMap): CompiledPolicy {
  return compileToolPermissionMap(map, POLICY_ID);
}

/** A context with the policy under test and, when a test records them, the
 *  trusted sink the run loop binds. */
function contextOf(
  compiled: CompiledPolicy | undefined,
  onDerivedDecision?: (decision: DerivedDecision) => void,
): ToolContext {
  return {
    userId: 'owner',
    chatId: 'chat',
    permissionPolicy: compiled,
    onDerivedDecision,
    tenantDb: {
      runAs: () => Promise.reject(new Error('no database in this test')),
    },
  };
}

/** What the evaluator returns for a submitted locator after raw-reject
 *  precedence and the same `read` projection used by the call. */
function submittedDecision(
  compiled: CompiledPolicy,
  url: string,
): PermissionDecision {
  const options = { toolId: 'read', args: { path: url } };
  const submitted = evaluatePermission(compiled, options);
  if (submitted.decision === 'reject' && submitted.reason !== 'no_allow') {
    return submitted;
  }
  return evaluatePermission(compiled, {
    ...options,
    projectFieldValue: nativeFileProjection('read'),
  });
}

describe('createDerivedAdmission', () => {
  it('decides a derived locator exactly as the same text submitted as the call', () => {
    const compiled = policy({
      read: {
        allow: [
          { field: 'path', regex: String.raw`^https://docs\.example\.test/` },
        ],
      },
    });
    const admit = createDerivedAdmission(contextOf(compiled));

    const admitted = admit('hop', DOCS_URL);
    const refused = admit('alternate', OTHER_URL);

    expect(admitted).toStrictEqual(submittedDecision(compiled, DOCS_URL));
    expect(refused).toStrictEqual(submittedDecision(compiled, OTHER_URL));
    expect(admitted).toMatchObject({
      policyId: POLICY_ID,
      decision: 'allow',
      reason: 'matched_allow',
    });
    expect(refused).toMatchObject({
      policyId: POLICY_ID,
      decision: 'reject',
      reason: 'no_allow',
    });
  });

  it('applies the read group’s rejects to a derived locator', () => {
    const compiled = policy({
      read: {
        allow: true,
        reject: [{ field: 'path', regex: String.raw`^http://` }],
      },
    });
    const admit = createDerivedAdmission(contextOf(compiled));

    expect(admit('suffix', OTHER_URL)).toMatchObject({
      decision: 'allow',
      reason: 'matched_allow',
    });
    expect(admit('suffix', 'http://docs.example.test/')).toMatchObject({
      decision: 'reject',
      reason: 'explicit_reject',
    });
  });

  it('refuses a derived locator rejected before selector projection', () => {
    const compiled = policy({
      read: {
        allow: true,
        reject: [
          {
            field: 'path',
            regex: String.raw`^https?://files\.example/private`,
          },
        ],
      },
    });

    const decision = createDerivedAdmission(contextOf(compiled))(
      'hop',
      'https://files.example/private/..:1',
    );

    expect(decision).toMatchObject({
      decision: 'reject',
      reason: 'explicit_reject',
    });
  });

  it('uses the projected allow when raw locator text has no allow match', () => {
    const compiled = policy({
      read: {
        allow: [
          { field: 'path', regex: String.raw`^https://docs\.example\.test/` },
        ],
      },
    });

    expect(
      createDerivedAdmission(contextOf(compiled))(
        'hop',
        'https://DOCS.example.test/private/..:1',
      ),
    ).toMatchObject({
      decision: 'allow',
      reason: 'matched_allow',
    });
  });

  it('rejects a locator no clause admits and reports the refusal', () => {
    const compiled = policy({ read: { allow: true, reject: true } });
    const seen: Array<DerivedDecision> = [];
    const admit = createDerivedAdmission(
      contextOf(compiled, (decision) => seen.push(decision)),
    );

    const decision = admit('llms-txt', 'https://docs.example.test/llms.txt');

    expect(decision).toMatchObject({
      decision: 'reject',
      reason: 'explicit_reject',
      reference: { groupId: 'read', list: 'reject', clauseIndex: null },
    });
    expect(seen).toStrictEqual([
      { kind: 'llms-txt', url: 'https://docs.example.test/llms.txt', decision },
    ]);
  });

  it('fails closed, as a rejection, when the context carries no policy', () => {
    const seen: Array<DerivedDecision> = [];
    const admit = createDerivedAdmission(
      contextOf(undefined, (decision) => seen.push(decision)),
    );

    const decision = admit('hop', DOCS_URL);

    expect(decision).toMatchObject({
      decision: 'reject',
      reason: 'no_allow',
      reference: null,
    });
    expect(seen).toStrictEqual([{ kind: 'hop', url: DOCS_URL, decision }]);
  });

  it('reports every decision it makes, and works without a sink', () => {
    const compiled = policy({
      read: {
        allow: [
          { field: 'path', regex: String.raw`^https://docs\.example\.test/` },
        ],
      },
    });
    const seen: Array<DerivedDecision> = [];
    const admit = createDerivedAdmission(
      contextOf(compiled, (decision) => seen.push(decision)),
    );

    const kinds: ReadonlyArray<DerivedLocatorKind> = [
      'hop',
      'alternate',
      'suffix',
      'llms-txt',
    ];
    for (const kind of kinds) admit(kind, DOCS_URL);

    expect(seen.map((entry) => [entry.kind, entry.url])).toStrictEqual(
      kinds.map((kind) => [kind, DOCS_URL]),
    );
    expect(seen.every((entry) => entry.decision.decision === 'allow')).toBe(
      true,
    );
    expect(() =>
      createDerivedAdmission(contextOf(compiled))('hop', DOCS_URL),
    ).not.toThrow();
  });

  it('carries no decision from one locator to the next', () => {
    const compiled = policy({
      read: {
        allow: [
          { field: 'path', regex: String.raw`^https://docs\.example\.test/` },
        ],
      },
    });
    const admit = createDerivedAdmission(contextOf(compiled));

    // A refused locator does not close the group, an admitted one does not open
    // it: each locator is decided on its own text, every time.
    expect(admit('hop', OTHER_URL).decision).toBe('reject');
    expect(admit('hop', DOCS_URL).decision).toBe('allow');
    expect(admit('hop', OTHER_URL).decision).toBe('reject');
    expect(admit('hop', DOCS_URL).decision).toBe('allow');
  });
});

describe('createAddressAdmission', () => {
  it('refuses explicit rejects but admits allow and no-allow decisions', () => {
    const explicitReject = policy({
      read: {
        allow: true,
        reject: [{ field: 'path', regex: String.raw`^https://10\.` }],
      },
    });
    const allow = policy({ read: { allow: true } });
    const noAllow = policy({
      read: {
        allow: [
          { field: 'path', regex: String.raw`^https://docs\.example\.com/` },
        ],
      },
    });
    const seen: Array<DerivedDecision> = [];

    expect(
      createAddressAdmission(
        contextOf(explicitReject, (decision) => seen.push(decision)),
      )('10.0.0.5', 'https://10.0.0.5/private'),
    ).toBe(false);
    expect(
      createAddressAdmission(
        contextOf(allow, (decision) => seen.push(decision)),
      )('93.184.216.34', 'https://93.184.216.34/guide'),
    ).toBe(true);
    expect(
      createAddressAdmission(
        contextOf(noAllow, (decision) => seen.push(decision)),
      )('93.184.216.34', 'https://93.184.216.34/guide'),
    ).toBe(true);
    expect(seen).toStrictEqual([
      {
        kind: 'address',
        url: 'https://10.0.0.5/private',
        decision: {
          policyId: POLICY_ID,
          decision: 'reject',
          reason: 'explicit_reject',
          reference: { groupId: 'read', list: 'reject', clauseIndex: 0 },
        },
      },
    ]);
  });

  it('refuses an address locator rejected before selector projection', () => {
    const compiled = policy({
      read: {
        allow: true,
        reject: [
          {
            field: 'path',
            regex: String.raw`^https?://10\.67\.88\.60/private`,
          },
        ],
      },
    });
    const seen: Array<DerivedDecision> = [];
    const admit = createAddressAdmission(
      contextOf(compiled, (decision) => seen.push(decision)),
    );

    expect(admit('10.67.88.60', 'https://10.67.88.60/private/..:1')).toBe(
      false,
    );
    expect(seen).toMatchObject([
      {
        kind: 'address',
        url: 'https://10.67.88.60/private/..:1',
        decision: {
          decision: 'reject',
          reason: 'explicit_reject',
          reference: { groupId: 'read', list: 'reject', clauseIndex: 0 },
        },
      },
    ]);
  });

  it('refuses when permission inspection exceeds its input limit', () => {
    const seen: Array<DerivedDecision> = [];
    const admit = createAddressAdmission(
      // A clause is required: a group with none decides without inspecting.
      contextOf(
        policy({
          read: {
            allow: true,
            reject: [{ field: 'path', literal: 'never-present' }],
          },
        }),
        (decision) => seen.push(decision),
      ),
    );
    const locator = `https://93.184.216.34/?${'x'.repeat(1024 * 1024 + 1)}`;

    expect(admit('93.184.216.34', locator)).toBe(false);
    expect(seen).toMatchObject([
      {
        kind: 'address',
        decision: { decision: 'reject', reason: 'input_limit' },
      },
    ]);
  });

  it('admits a resolved address under a domain-only allowlist', () => {
    const compiled = policy({
      read: {
        allow: [
          { field: 'path', regex: String.raw`^https://docs\.example\.com/` },
        ],
      },
    });

    expect(
      createAddressAdmission(contextOf(compiled))(
        '93.184.216.34',
        'https://93.184.216.34/guide',
      ),
    ).toBe(true);
  });

  it('refuses without a compiled policy and does not report an unattributable refusal', () => {
    const seen: Array<DerivedDecision> = [];
    const admit = createAddressAdmission(
      contextOf(undefined, (decision) => seen.push(decision)),
    );

    expect(admit('93.184.216.34', 'https://93.184.216.34/guide')).toBe(false);
    expect(seen).toStrictEqual([]);
  });

  it('reports only refusals once per address and decision reference', () => {
    const compiled = policy({
      read: {
        allow: true,
        reject: [{ field: 'path', regex: String.raw`^https://10\.0\.0\.` }],
      },
    });
    const seen: Array<DerivedDecision> = [];
    const admit = createAddressAdmission(
      contextOf(compiled, (decision) => seen.push(decision)),
    );

    expect(admit('93.184.216.34', 'https://93.184.216.34/guide')).toBe(true);
    expect(admit('10.0.0.5', 'https://10.0.0.5/first')).toBe(false);
    expect(admit('10.0.0.5', 'https://10.0.0.5/second')).toBe(false);
    expect(admit('10.0.0.6', 'https://10.0.0.6/third')).toBe(false);

    expect(seen).toHaveLength(2);
    expect(seen).toStrictEqual([
      {
        kind: 'address',
        url: 'https://10.0.0.5/first',
        decision: {
          policyId: POLICY_ID,
          decision: 'reject',
          reason: 'explicit_reject',
          reference: { groupId: 'read', list: 'reject', clauseIndex: 0 },
        },
      },
      {
        kind: 'address',
        url: 'https://10.0.0.6/third',
        decision: {
          policyId: POLICY_ID,
          decision: 'reject',
          reason: 'explicit_reject',
          reference: { groupId: 'read', list: 'reject', clauseIndex: 0 },
        },
      },
    ]);
  });
});
