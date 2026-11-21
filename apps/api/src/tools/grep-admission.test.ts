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
    configuredCredentials: [],
    userId: 'user-A',
    chatId: 'chat-1',
    tenantDb: {
      runAs: () => Promise.reject(new Error('tenant DB is not used')),
    },
    permissionPolicy: compileToolPermissionMap(map, 'test-policy'),
    localMachine: 'host-a',
    defaultMachine: 'host-a',
    workspaceRoot:
      root === undefined ? undefined : createWorkspaceRootCell(root),
    onDerivedDecision,
  };
}

const HOST = { localMachine: 'host-a', defaultMachine: 'host-a' } as const;

describe('projectGrepScope', () => {
  it('cuts a host scope at the first glob segment and keeps the separator', () => {
    expect(projectGrepScope('/home/u/repo/src/**/*.ts', HOST)).toEqual({
      submitted: '/home/u/repo/src/**/*.ts',
      prefix: 'machine://host-a/home/u/repo/src/',
      projectedPath: '/home/u/repo/src/',
    });
  });

  it('resolves parent segments lexically before the cut', () => {
    expect(projectGrepScope('/home/u/repo/../../../etc/**', HOST).prefix).toBe(
      'machine://host-a/etc/',
    );
  });

  it('resolves a relative scope from the Workspace root', () => {
    expect(
      projectGrepScope('src/**', { ...HOST, workspaceRoot: '/home/u/repo' })
        .prefix,
    ).toBe('machine://host-a/home/u/repo/src/');
  });

  it('maps a bare absolute scope into a Machine Workspace', () => {
    expect(
      projectGrepScope('/home/me/shop/src/**', {
        workspaceRoot: 'machine://devl/home/me/shop',
        defaultMachine: 'host-a',
      }).prefix,
    ).toBe('machine://devl/home/me/shop/src/');
  });

  it('keeps a Knowledge prefix on its logical identity', () => {
    expect(projectGrepScope(`kb://${SPACE}/notes/**/*.md`, HOST).prefix).toBe(
      `kb://${SPACE}/notes/`,
    );
  });

  it('projects a bare Knowledge scope to its own text', () => {
    expect(
      projectGrepScope('kb://', { ...HOST, workspaceRoot: '/home/u/repo' })
        .prefix,
    ).toBe('kb://');
  });

  it('does not treat a percent-encoded asterisk as a glob', () => {
    // The canonical Knowledge identity decodes it, as a read of that path does.
    expect(projectGrepScope(`kb://${SPACE}/a%2Ab/`, HOST).prefix).toBe(
      `kb://${SPACE}/a*b/`,
    );
  });

  it('keeps a logical scope with no path part whole', () => {
    expect(projectGrepScope('skill://pdf', HOST)).toEqual({
      submitted: 'skill://pdf',
      prefix: 'skill://pdf',
    });
    expect(projectGrepScope('skill://p/x', HOST).prefix).toBe('skill://p/x');
  });

  it('keeps a glob in a logical authority out of the path cut', () => {
    expect(projectGrepScope('skill://pd*/x', HOST).prefix).toBe(
      'skill://pd*/x',
    );
  });

  it('normalizes a decoded file alias before the glob cut', () => {
    expect(
      projectGrepScope('file:///srv/public/../secrets/**', HOST).prefix,
    ).toBe('machine://host-a/srv/secrets/');
  });

  it('keeps a colon in a host scope as path text', () => {
    expect(projectGrepScope('/repo/v:1/**', HOST).prefix).toBe(
      'machine://host-a/repo/v:1/',
    );
  });

  it('decodes the literal spellings in a host prefix', () => {
    expect(projectGrepScope('/home/u/repo/a%2Ab/**', HOST).prefix).toBe(
      'machine://host-a/home/u/repo/a*b/',
    );
    expect(projectGrepScope('/home/u/repo/app/%5Bid%5D/', HOST).prefix).toBe(
      'machine://host-a/home/u/repo/app/[id]/',
    );
    expect(projectGrepScope('/w/%25%3F%7B%7D', HOST).prefix).toBe(
      'machine://host-a/w/%25%3F{}',
    );
  });

  it('does not decode a file alias a second time', () => {
    expect(projectGrepScope('file:///tmp/a%252A', HOST).prefix).toBe(
      'machine://host-a/tmp/a%252A',
    );
    expect(projectGrepScope('file:///tmp/100%2525', HOST).prefix).toBe(
      'machine://host-a/tmp/100%2525',
    );
  });

  it('decodes another percent sequence in a host prefix as written', () => {
    // `%41` is not one of the seven spellings: it stays literal text, which
    // the locator grammar then encodes once, so a decode gives `%41` back.
    expect(projectGrepScope('/home/u/repo/100%41', HOST).prefix).toBe(
      'machine://host-a/home/u/repo/100%2541',
    );
  });

  it('decodes only the model text of a relative scope under a root', () => {
    expect(
      projectGrepScope('src/%2A/**', { ...HOST, workspaceRoot: '/w/a%2Ab' })
        .prefix,
    ).toBe('machine://host-a/w/a%252Ab/src/*/');
    expect(
      projectGrepScope('../a%5Bb%5D', { ...HOST, workspaceRoot: '/w/root' })
        .prefix,
    ).toBe('machine://host-a/w/a[b]');
    expect(
      projectGrepScope('sub/a%5Bb%5D', { ...HOST, workspaceRoot: '/w/p%25q' })
        .prefix,
    ).toBe('machine://host-a/w/p%2525q/sub/a[b]');
    expect(
      projectGrepScope('%2A/x/**', { ...HOST, workspaceRoot: '/' }).prefix,
    ).toBe('machine://host-a/*/x/');
  });

  it('decodes a whole absolute scope but not one that names the root', () => {
    expect(
      projectGrepScope('/w/a%2Ab/src/**', {
        ...HOST,
        workspaceRoot: '/w/a%2Ab',
      }).prefix,
    ).toBe('machine://host-a/w/a*b/src/');
    expect(
      projectGrepScope('/w/a%2Ab/', { ...HOST, workspaceRoot: '/w/a%2Ab' })
        .prefix,
    ).toBe('machine://host-a/w/a%252Ab/');
    expect(
      projectGrepScope('/elsewhere/x%2A/**', {
        ...HOST,
        workspaceRoot: '/w/a%2Ab',
      }).prefix,
    ).toBe('machine://host-a/elsewhere/x*/');
  });

  it('decodes a spelled percent once', () => {
    expect(projectGrepScope('/home/u/repo/a%252A', HOST).prefix).toBe(
      'machine://host-a/home/u/repo/a%252A',
    );
  });

  it('keeps a machine:// prefix on its canonical spelling', () => {
    expect(
      projectGrepScope('machine://build/srv/a/../b/**', {
        localMachine: 'host-a',
      }),
    ).toEqual({
      submitted: 'machine://build/srv/a/../b/**',
      prefix: 'machine://build/srv/b/',
      projectedPath: '/srv/b/',
    });
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

  it('refuses a bare-path reject on a Machine scope', () => {
    const context = contextWith({
      grep: {
        allow: true,
        reject: [{ field: 'scopes', regex: '^/etc/' }],
      },
    });

    expect(
      evaluateGrepPermission(
        { patterns: ['x'], scopes: ['machine://host-a/etc/**'] },
        context,
      ),
    ).toMatchObject({ decision: 'reject', reason: 'explicit_reject' });
    expect(
      evaluateGrepPermission({ patterns: ['x'], scopes: ['/etc/**'] }, context),
    ).toMatchObject({ decision: 'reject', reason: 'explicit_reject' });
  });

  it('admits a bare scope on the Machine an allow names', () => {
    const allowed = contextWith({
      grep: {
        allow: [{ field: 'scopes', regex: '^machine://host-a/srv/' }],
      },
    });

    expect(
      evaluateGrepPermission({ patterns: ['x'], scopes: ['/srv/**'] }, allowed)
        ?.decision,
    ).toBe('allow');

    const otherMachine = contextWith({
      grep: {
        allow: [{ field: 'scopes', regex: '^machine://gpu/srv/' }],
      },
    });

    expect(
      evaluateGrepPermission(
        { patterns: ['x'], scopes: ['/srv/**'] },
        otherMachine,
      ),
    ).toMatchObject({ decision: 'reject', reason: 'no_allow' });
  });

  it('lets an all-fields reject see a projected path', () => {
    const context = contextWith({
      grep: { allow: true, reject: [{ allFields: true, regex: '^/etc/' }] },
    });

    expect(
      evaluateGrepPermission(
        { patterns: ['x'], scopes: ['machine://host-a/etc/**'] },
        context,
      ),
    ).toMatchObject({ decision: 'reject', reason: 'explicit_reject' });
  });

  it('refuses an encoded bracket against a reject of the decoded path', () => {
    const context = contextWith({
      grep: {
        allow: true,
        reject: [{ field: 'scopes', literal: '/home/u/repo/app/[id]' }],
      },
    });

    expect(
      evaluateGrepPermission(
        { patterns: ['x'], scopes: ['/home/u/repo/app/%5Bid%5D'] },
        context,
      )?.decision,
    ).toBe('reject');
  });

  it('matches a Machine reject on the decoded path', () => {
    const context = contextWith({
      grep: {
        allow: true,
        reject: [{ field: 'scopes', literal: 'machine://build/srv/100A' }],
      },
    });

    expect(
      evaluateGrepPermission(
        { patterns: ['x'], scopes: ['machine://build/srv/100%41'] },
        context,
      )?.decision,
    ).toBe('reject');
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

  it('judges directory locators without a refused-file record', () => {
    const derived: Array<DerivedDecision> = [];

    const admission = createGrepReadAdmission(
      contextWith(
        {
          read: {
            allow: true,
            reject: [{ field: 'path', literal: '/home/u/repo/secrets' }],
          },
        },
        undefined,
        (decision) => derived.push(decision),
      ),
    );

    let admitted = 0;

    for (let index = 0; index < 12; index += 1) {
      const locator =
        index < 2
          ? `/home/u/repo/secrets${String(index)}`
          : `/home/u/repo/dir${String(index)}`;

      if (admission.allows(locator) && admission.allows(`${locator}/`))
        admitted += 1;
    }

    expect(admitted).toBe(10);
    expect(admission.refused).toBe(0);
    admission.recordRefusals();
    expect(derived).toHaveLength(0);
  });

  it('refuses a hit under a field reject spelled as a bare path', () => {
    const admission = createGrepReadAdmission(
      contextWith({
        grep: { allow: true },
        read: {
          allow: [{ field: 'path', regex: '^machine://host-a/' }],
          reject: [{ field: 'path', regex: String.raw`^\/home\/u\/\.ssh\/` }],
        },
      }),
    );

    expect(admission.admit('machine://host-a/home/u/.ssh/id_rsa')).toBe(false);
    expect(admission.refused).toBe(1);
  });

  it('refuses a hit under an all-fields reject spelled as a bare path', () => {
    const admission = createGrepReadAdmission(
      contextWith({
        grep: { allow: true },
        read: {
          allow: [{ field: 'path', regex: '^machine://host-a/' }],
          reject: [{ allFields: true, regex: '^/home/u/\\.ssh/' }],
        },
      }),
    );

    expect(admission.admit('machine://host-a/home/u/.ssh/id_rsa')).toBe(false);
    expect(admission.refused).toBe(1);
  });

  it('judges a directory both as written and with a final separator', () => {
    const admission = createGrepReadAdmission(
      contextWith({
        read: {
          allow: true,
          reject: [{ field: 'path', literal: '/home/u/.ssh/' }],
        },
      }),
    );

    expect(admission.allows('/home/u/.ssh')).toBe(true);
    expect(admission.allows('/home/u/.ssh/')).toBe(false);
  });

  it('evaluates no directory against the read group in bypass mode', () => {
    const context: ToolContext = {
      ...contextWith({ read: {} }),
      permissionMode: 'bypass',
    };

    const admission = createGrepReadAdmission(context);
    expect(admission.allows('/home/u/repo/node_modules')).toBe(true);
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
