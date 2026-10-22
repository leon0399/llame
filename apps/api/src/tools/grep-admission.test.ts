import { describe, expect, it } from 'vitest';

import {
  createGrepReadAdmission,
  evaluateGrepPermission,
  grepScopeStrings,
  projectGrepScope,
} from './grep-admission';
import { compileToolPermissionMap } from './permissions/compile-permissions';
import { type ToolPermissionMap } from './permissions/types';
import { type DerivedDecision } from './web-read/admission';
import { type ToolContext } from './types';
import { createWorkspaceRootCell } from './workspace-path';

const SPACE = '0d1b4f9e-1111-4e9a-8a0f-0123456789ab';

function contextWith(
  map: ToolPermissionMap,
  root?: string,
  onDerivedDecision?: (decision: DerivedDecision) => void,
): ToolContext {
  return {
    userId: 'user-A',
    chatId: 'chat-1',
    tenantDb: {
      runAs: () => Promise.reject(new Error('tenant DB is not used')),
    },
    permissionPolicy: compileToolPermissionMap(map, 'test-policy'),
    workspaceRoot:
      root === undefined ? undefined : createWorkspaceRootCell(root),
    onDerivedDecision,
  };
}

describe('projectGrepScope', () => {
  it('cuts a host scope at the first glob segment and keeps the separator', () => {
    expect(projectGrepScope('/home/u/repo/src/**/*.ts', undefined)).toEqual({
      submitted: '/home/u/repo/src/**/*.ts',
      prefix: '/home/u/repo/src/',
    });
  });

  it('resolves parent segments lexically before the cut', () => {
    expect(
      projectGrepScope('/home/u/repo/../../../etc/**', undefined).prefix,
    ).toBe('/etc/');
  });

  it('resolves a relative scope from the Workspace root', () => {
    expect(projectGrepScope('src/**', '/home/u/repo').prefix).toBe(
      '/home/u/repo/src/',
    );
  });

  it('maps a bare absolute scope into a Machine Workspace', () => {
    expect(
      projectGrepScope('/home/me/shop/src/**', 'machine://devl/home/me/shop')
        .prefix,
    ).toBe('machine://devl/home/me/shop/src/');
  });

  it('keeps a Knowledge prefix on its logical identity', () => {
    expect(
      projectGrepScope(`kb://${SPACE}/notes/**/*.md`, undefined).prefix,
    ).toBe(`kb://${SPACE}/notes/`);
  });

  it('projects a bare Knowledge scope to its own text', () => {
    expect(projectGrepScope('kb://', '/home/u/repo').prefix).toBe('kb://');
  });

  it('does not treat a percent-encoded asterisk as a glob', () => {
    // The canonical Knowledge identity decodes it, as a read of that path does.
    expect(projectGrepScope(`kb://${SPACE}/a%2Ab/`, undefined).prefix).toBe(
      `kb://${SPACE}/a*b/`,
    );
  });

  it('keeps a logical scope with no path part whole', () => {
    expect(projectGrepScope('skill://pdf', undefined)).toEqual({
      submitted: 'skill://pdf',
      prefix: 'skill://pdf',
    });
    expect(projectGrepScope('skill://p/x', undefined).prefix).toBe(
      'skill://p/x',
    );
  });

  it('keeps a glob in a logical authority out of the path cut', () => {
    expect(projectGrepScope('skill://pd*/x', undefined).prefix).toBe(
      'skill://pd*/x',
    );
  });

  it('keeps a colon in a host scope as path text', () => {
    expect(projectGrepScope('/repo/v:1/**', undefined).prefix).toBe(
      '/repo/v:1/',
    );
  });
});

describe('grepScopeStrings', () => {
  it('defaults an omitted scopes to the Workspace root', () => {
    expect(grepScopeStrings({ patterns: ['x'] }, '/home/u/repo')).toEqual([
      '/home/u/repo/',
    ]);
  });

  it('is undefined without scopes and without a Workspace', () => {
    expect(grepScopeStrings({ patterns: ['x'] }, undefined)).toBeUndefined();
  });

  it('falls back to the Workspace root when a scope entry is not text', () => {
    expect(grepScopeStrings({ scopes: ['/a', 1] }, '/home/u/repo')).toEqual([
      '/home/u/repo/',
    ]);
  });
});

describe('evaluateGrepPermission', () => {
  it('matches a scopes clause on the literal prefix, never the glob', () => {
    const context = contextWith({
      grep: { allow: [{ field: 'scopes', literal: '/home/u/repo/src/' }] },
    });
    const decision = evaluateGrepPermission(
      { patterns: ['x'], scopes: ['/home/u/repo/src/**/*.ts'] },
      context,
    );
    expect(decision?.decision).toBe('allow');
  });

  it('refuses the whole call on the first rejected scope', () => {
    const context = contextWith({
      grep: {
        allow: true,
        reject: [{ field: 'scopes', literal: '/etc/' }],
      },
    });
    const decision = evaluateGrepPermission(
      { patterns: ['x'], scopes: ['/home/u/repo/**', '/etc/**'] },
      context,
    );
    expect(decision).toMatchObject({
      decision: 'reject',
      reason: 'explicit_reject',
    });
  });

  it('lets an all-fields reject see the pattern', () => {
    const context = contextWith({
      grep: { allow: true, reject: [{ allFields: true, regex: 'BEGIN RSA' }] },
    });
    expect(
      evaluateGrepPermission(
        { patterns: ['BEGIN RSA'], scopes: ['/home/u/repo/**'] },
        context,
      )?.decision,
    ).toBe('reject');
  });

  it('lets an all-fields reject see the glob suffix', () => {
    const context = contextWith({
      grep: { allow: true, reject: [{ allFields: true, literal: '.env' }] },
    });
    expect(
      evaluateGrepPermission(
        { patterns: ['x'], scopes: ['/repo/**/.env'] },
        context,
      )?.decision,
    ).toBe('reject');
  });

  it('evaluates an omitted scopes as the Workspace root', () => {
    const context = contextWith(
      {
        grep: {
          allow: true,
          reject: [{ field: 'scopes', literal: '/home/u/repo/' }],
        },
      },
      '/home/u/repo',
    );
    expect(evaluateGrepPermission({ patterns: ['x'] }, context)?.decision).toBe(
      'reject',
    );
  });

  it('allows a call with no scopes and no Workspace through the grep group', () => {
    const context = contextWith({ grep: { allow: true } });
    expect(evaluateGrepPermission({ patterns: ['x'] }, context)?.decision).toBe(
      'allow',
    );
  });

  it('decides an empty scope list once, against the submitted arguments', () => {
    const context = contextWith({ grep: { allow: true } });
    expect(
      evaluateGrepPermission({ patterns: ['x'], scopes: [] }, context)
        ?.decision,
    ).toBe('allow');
  });

  it('reports the clause of the first surviving reject across scopes', () => {
    // The earlier clause matches only the second scope's projected prefix,
    // which no submitted text spells; only the aggregate prefix list carries
    // it while the first scope is evaluated.
    const context = contextWith({
      grep: {
        allow: true,
        reject: [
          { allFields: true, literal: '/repo/b/' },
          { allFields: true, literal: '/repo/a/' },
        ],
      },
    });
    const decision = evaluateGrepPermission(
      {
        patterns: ['x'],
        scopes: ['/repo/a/**', '/repo/x/../b/**'],
      },
      context,
    );

    expect(decision).toMatchObject({
      decision: 'reject',
      reference: { groupId: 'grep', list: 'reject', clauseIndex: 0 },
    });
  });

  it('rejects when no grep group exists', () => {
    const context = contextWith({ read: { allow: true } });
    expect(
      evaluateGrepPermission(
        { patterns: ['x'], scopes: ['/home/u/repo/**'] },
        context,
      ),
    ).toMatchObject({ decision: 'reject', reason: 'no_allow' });
  });
});

describe('createGrepReadAdmission', () => {
  it('hides a file the read group rejects and records one counted decision', () => {
    const derived: Array<DerivedDecision> = [];
    const context = contextWith(
      {
        grep: { allow: true },
        read: { allow: true, reject: [{ field: 'path', regex: '\\.env$' }] },
      },
      undefined,
      (decision) => derived.push(decision),
    );
    const admission = createGrepReadAdmission(context);
    expect(admission.admit('/home/u/repo/src/index.ts')).toBe(true);
    expect(admission.admit('/home/u/repo/.env')).toBe(false);
    expect(admission.admit('/home/u/repo/api/.env')).toBe(false);
    expect(admission.refused).toBe(2);
    admission.recordRefusals();
    expect(derived).toHaveLength(1);
    expect(derived[0]).toMatchObject({
      kind: 'grep-file',
      url: '',
      count: 2,
      decision: { decision: 'reject', reason: 'explicit_reject' },
    });
  });

  it('counts a refused file once however often the call meets it', () => {
    const admission = createGrepReadAdmission(
      contextWith({
        read: { allow: true, reject: [{ field: 'path', regex: '\\.env$' }] },
      }),
    );
    expect(admission.admit('/home/u/repo/.env')).toBe(false);
    expect(admission.admit('/home/u/repo/.env')).toBe(false);
    expect(admission.refused).toBe(1);
  });

  it('admits nothing without a read group', () => {
    const admission = createGrepReadAdmission(
      contextWith({ grep: { allow: true } }),
    );
    expect(admission.admit(`kb://${SPACE}/notes/a.md`)).toBe(false);
  });

  it('judges a hit as the read of its canonical locator', () => {
    const admission = createGrepReadAdmission(
      contextWith({
        grep: { allow: true },
        read: {
          allow: true,
          reject: [{ field: 'path', literal: `kb://${SPACE}/notes/a.md` }],
        },
      }),
    );
    expect(admission.admit(`kb://${SPACE}/notes/%61.md`)).toBe(false);
    expect(admission.refused).toBe(1);
  });

  it('records nothing when no file was refused', () => {
    const derived: Array<DerivedDecision> = [];
    const admission = createGrepReadAdmission(
      contextWith({ read: { allow: true } }, undefined, (decision) =>
        derived.push(decision),
      ),
    );
    expect(admission.admit('/home/u/a.md')).toBe(true);
    admission.recordRefusals();
    expect(derived).toHaveLength(0);
  });
});
