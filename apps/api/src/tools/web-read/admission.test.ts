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

/** What the evaluator returns for the same locator submitted as the call's own
 *  `path`, through the same projection the call used. */
function submittedDecision(
  compiled: CompiledPolicy,
  url: string,
): PermissionDecision {
  return evaluatePermission(compiled, {
    toolId: 'read',
    args: { path: url },
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
