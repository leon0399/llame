import { describe, expect, it } from 'vitest';

import { type UnknownRecord } from '@workspace/runtime-safety';

import { evaluateCanonicalWithRejectTexts } from './admit';
import { compileToolPermissionMap } from './compile-permissions';
import { evaluatePermission } from './evaluator';
import {
  nativeFileProjection,
  projectNativeFilePath,
  withoutReadSelector,
} from './locator-projection';
import { type ToolPermissionMap } from './types';

/** The Machine this process hosts; the tests resolve bare paths on it. */
const MACHINE = 'host-a';
const CONTEXT = { defaultMachine: MACHINE, localMachine: MACHINE };

function canonical(value: string, workspaceRoot?: string): string {
  return projectNativeFilePath(value, { ...CONTEXT, workspaceRoot }).canonical;
}

function projectedPath(
  value: string,
  workspaceRoot?: string,
): string | undefined {
  return projectNativeFilePath(value, { ...CONTEXT, workspaceRoot })
    .projectedPath;
}

/**
 * One call decided as the runner decides it: the allow on the canonical
 * locator, and a reject on the submitted text or the projected Machine path.
 */
function decideNative(
  map: ToolPermissionMap,
  toolId: string,
  args: UnknownRecord,
  workspaceRoot?: string,
) {
  const policy = compileToolPermissionMap(map, 'p');
  const project = nativeFileProjection(toolId, { ...CONTEXT, workspaceRoot });

  return evaluateCanonicalWithRejectTexts(
    (options) => evaluatePermission(policy, options),
    {
      canonical: {
        toolId,
        args,
        projectFieldValue: (field, value) => project(field, value).canonical,
      },
      rejectTexts: [
        { toolId, args },
        {
          toolId,
          args,
          projectFieldValue: (field, value) =>
            project(field, value).projectedPath ??
            project(field, value).canonical,
        },
      ],
    },
  );
}

describe('projectNativeFilePath', () => {
  it('projects a valid file alias to its path on the current Machine', () => {
    expect(canonical('file:///srv/docs/guide.md')).toBe(
      'machine://host-a/srv/docs/guide.md',
    );
    expect(projectedPath('file:///srv/docs/guide.md')).toBe(
      '/srv/docs/guide.md',
    );
  });

  it('projects a file alias with percent-encoded characters', () => {
    expect(canonical('file:///etc/%70asswd')).toBe(
      'machine://host-a/etc/passwd',
    );
  });

  it('preserves dot segments in file alias projection', () => {
    expect(canonical('file:///tmp/%2e%2e/secret')).toBe(
      'machine://host-a/tmp/../secret',
    );
  });

  it('leaves an invalid file alias unchanged', () => {
    expect(canonical('file:///srv/docs/guide.md?')).toBe(
      'file:///srv/docs/guide.md?',
    );
    expect(projectedPath('file:///srv/docs/guide.md?')).toBeUndefined();
  });

  it('leaves a remote file authority unchanged', () => {
    expect(canonical('file://other.example/srv/docs/guide.md')).toBe(
      'file://other.example/srv/docs/guide.md',
    );
  });

  it('projects an alias on the current Machine, never from the Workspace root', () => {
    expect(canonical('file:/etc/%70asswd', '/work/project')).toBe(
      'machine://host-a/etc/passwd',
    );
    expect(canonical('file:///etc/passwd', '/work/project')).toBe(
      'machine://host-a/etc/passwd',
    );
  });

  it('leaves a bare path unchanged when there is no current Machine', () => {
    expect(projectNativeFilePath('/etc/passwd', {})).toEqual({
      canonical: '/etc/passwd',
    });
    expect(projectNativeFilePath('src/app.ts', {})).toEqual({
      canonical: 'src/app.ts',
    });
  });

  it('retains Knowledge selectors until read projection', () => {
    expect(canonical('kb://Space/notes/a:10-20')).toBe(
      'kb://Space/notes/a:10-20',
    );
    expect(canonical('kb://Space/notes/a:raw')).toBe('kb://Space/notes/a:raw');
    expect(canonical('kb://Space/notes/a')).toBe('kb://Space/notes/a');
    expect(canonical('kb://Space/notes/a:outline')).toBe(
      'kb://Space/notes/a:outline',
    );
    expect(canonical('kb://Space/notes/a:outline:3-9')).toBe(
      'kb://Space/notes/a:outline:3-9',
    );
    expect(
      nativeFileProjection('read')('path', 'kb://Space/notes/a:outline:3-9'),
    ).toEqual({ canonical: 'kb://Space/notes/a' });
  });

  it('retains comma read selectors in non-read projections', () => {
    expect(canonical('kb://Space/notes/a:10-20,30-40')).toBe(
      'kb://Space/notes/a:10-20,30-40',
    );
    expect(canonical('kb://Space/notes/a:raw:10-20,30-40')).toBe(
      'kb://Space/notes/a:raw:10-20,30-40',
    );
  });

  it('canonically encodes an equivalent spelling', () => {
    expect(canonical('kb://Space/a b')).toBe('kb://Space/a%20b');
    expect(canonical('kb://Space/a%20b')).toBe('kb://Space/a%20b');
    expect(canonical('kb://Space/notes/%61')).toBe('kb://Space/notes/a');
  });

  it('preserves empty Space roots and trailing separators', () => {
    expect(canonical('kb://Space')).toBe('kb://Space');
    expect(canonical('kb://Space/dir/')).toBe('kb://Space/dir/');
  });

  it('projects a skill locator to its canonical resource identity', () => {
    expect(canonical('skill://pdf')).toBe('skill://pdf');
    expect(canonical('skill://pdf:raw')).toBe('skill://pdf:raw');
    expect(canonical('skill://pdf:10-20')).toBe('skill://pdf:10-20');
    expect(canonical('skill://pdf/')).toBe('skill://pdf/');
    expect(canonical('skill://')).toBe('skill://');
    expect(canonical('skill://pdf/references/a%20b.md:5+10')).toBe(
      'skill://pdf/references/a%20b.md:5+10',
    );
    expect(
      nativeFileProjection('read')(
        'path',
        'skill://pdf/references/a%20b.md:5+10',
      ),
    ).toEqual({ canonical: 'skill://pdf/references/a%20b.md' });
  });

  it('leaves an invalid skill locator unchanged', () => {
    expect(canonical('skill://PDF')).toBe('skill://PDF');
    expect(canonical('skill://pdf/%2F')).toBe('skill://pdf/%2F');
  });

  it('projects a web locator to the text its request will use', () => {
    // The fragment the request drops is gone before matching, the pathless
    // host carries the slash its request carries, and the selector stays in
    // the spelling it was written in.
    expect(canonical('https://example.test/guide#top')).toBe(
      'https://example.test/guide',
    );
    expect(canonical('https://example.test:88')).toBe(
      'https://example.test:88/',
    );
    expect(canonical('https://example.test/guide:10-20')).toBe(
      'https://example.test/guide:10-20',
    );
    expect(canonical('https://example.test/guide:5#frag')).toBe(
      'https://example.test/guide:5',
    );
    // A spelling the parser normalizes projects to what will be requested.
    expect(canonical('https://EXAMPLE.test/x')).toBe('https://example.test/x');
    // A locator the read tool refuses outright is matched as written.
    expect(canonical('https://user:secret@example.test/x')).toBe(
      'https://user:secret@example.test/x',
    );
  });

  it('leaves an invalid locator unchanged', () => {
    expect(canonical('kb://Space/%2F')).toBe('kb://Space/%2F');
  });

  it('projects relative paths from the Workspace root on its Machine', () => {
    expect(canonical('src/app.ts', '/work/project')).toBe(
      'machine://host-a/work/project/src/app.ts',
    );
    expect(projectedPath('src/app.ts', '/work/project')).toBe(
      '/work/project/src/app.ts',
    );
    expect(canonical('../shared/data.json', '/work/project')).toBe(
      'machine://host-a/work/shared/data.json',
    );
    expect(canonical('app.ts/', '/work/project')).toBe(
      'machine://host-a/work/project/app.ts/',
    );
    expect(canonical('src/app.ts', 'machine://devl/home/me/shop')).toBe(
      'machine://devl/home/me/shop/src/app.ts',
    );
  });

  it('leaves non-filesystem schemes unchanged during Workspace projection', () => {
    expect(canonical('kb://Space/notes/a', '/work/project')).toBe(
      'kb://Space/notes/a',
    );
    expect(canonical('skill://pdf/SKILL.md', '/work/project')).toBe(
      'skill://pdf/SKILL.md',
    );
    expect(canonical('https://example.test/guide', '/work/project')).toBe(
      'https://example.test/guide',
    );
    expect(canonical('vault://notes/a.md', '/work/project')).toBe(
      'vault://notes/a.md',
    );
  });
});

describe('Machine path projection', () => {
  it('gives every Machine value a canonical locator and a projected path', () => {
    const cases = [
      ['/srv/app.ts', 'machine://host-a/srv/app.ts', '/srv/app.ts'],
      ['file:///srv/app.ts', 'machine://host-a/srv/app.ts', '/srv/app.ts'],
      ['file:/srv/app.ts', 'machine://host-a/srv/app.ts', '/srv/app.ts'],
      ['machine://devl/srv/app.ts', 'machine://devl/srv/app.ts', '/srv/app.ts'],
      [
        'machine://DEVL/srv/a%23b.ts',
        'machine://devl/srv/a%23b.ts',
        '/srv/a#b.ts',
      ],
      [
        'machine://devl/srv/../app/',
        'machine://devl/srv/../app/',
        '/srv/../app/',
      ],
    ] as const;

    for (const [value, canonicalText, path] of cases) {
      expect(projectNativeFilePath(value, CONTEXT)).toEqual({
        canonical: canonicalText,
        projectedPath: path,
      });
    }
  });

  it('keeps a selector for a mutation and drops it from a read', () => {
    expect(projectNativeFilePath('machine://devl/a.ts:5-6', CONTEXT)).toEqual({
      canonical: 'machine://devl/a.ts:5-6',
      projectedPath: '/a.ts:5-6',
    });
    expect(
      nativeFileProjection('read', CONTEXT)('path', 'machine://devl/a.ts:5-6'),
    ).toEqual({ canonical: 'machine://devl/a.ts', projectedPath: '/a.ts' });
  });

  it('keeps an installation locator out of the Machine projection', () => {
    expect(projectNativeFilePath('kb://Space/notes/a', CONTEXT)).toEqual({
      canonical: 'kb://Space/notes/a',
    });
  });

  it('projects the enter_workspace submitted path', () => {
    // The entry decision is the projection too (design D7): a bare-path entry
    // finds a canonical allow only if the entry path is projected.
    expect(
      nativeFileProjection('enter_workspace', CONTEXT)(
        'path',
        '/home/operator/projects/app',
      ),
    ).toEqual({
      canonical: 'machine://host-a/home/operator/projects/app',
      projectedPath: '/home/operator/projects/app',
    });
  });

  it('admits a bare entry path through a canonical enter_workspace allow', () => {
    const map: ToolPermissionMap = {
      enter_workspace: {
        allow: [
          {
            field: 'path',
            regex: '^machine://[^/]+/home/operator/projects/[^/]+/?$',
          },
        ],
      },
    };

    expect(
      decideNative(map, 'enter_workspace', {
        path: '/home/operator/projects/app',
      }),
    ).toMatchObject({ decision: 'allow' });

    expect(
      decideNative(
        {
          enter_workspace: {
            allow: [{ field: 'path', regex: '^/home/operator/' }],
          },
        },
        'enter_workspace',
        { path: '/home/operator/projects/app' },
      ),
    ).toMatchObject({ decision: 'reject', reason: 'no_allow' });
  });

  it('never admits one Machine through an allow written for another', () => {
    const map: ToolPermissionMap = {
      read: {
        allow: [{ field: 'path', regex: '^machine://devl/home/leo/proj(/|$)' }],
      },
    };

    expect(
      decideNative(
        map,
        'read',
        { path: '/home/leo/proj/README.md' },
        'machine://gpu/home/leo/proj',
      ),
    ).toMatchObject({ decision: 'reject', reason: 'no_allow' });
    expect(
      decideNative(map, 'read', {
        path: 'machine://devl/home/leo/proj/README.md',
      }),
    ).toMatchObject({ decision: 'allow' });
  });
});

describe('native file permission projection', () => {
  it('catches a percent-encoded file alias with a host-path reject', () => {
    const map: ToolPermissionMap = {
      read: { allow: true, reject: [{ field: 'path', regex: '^/etc/' }] },
    };

    expect(
      decideNative(map, 'read', { path: 'file:///etc/%70asswd' }),
    ).toMatchObject({
      decision: 'reject',
      reason: 'explicit_reject',
    });
  });

  it('refuses a minimal-form alias with a host-path reject in a Workspace', () => {
    const map: ToolPermissionMap = {
      read: { allow: true, reject: [{ field: 'path', regex: '^/etc/' }] },
    };

    expect(
      decideNative(
        map,
        'read',
        { path: 'file:/etc/%70asswd' },
        '/work/project',
      ),
    ).toMatchObject({ decision: 'reject', reason: 'explicit_reject' });
  });

  it('admits a file alias through a canonical Machine allow', () => {
    const map: ToolPermissionMap = {
      read: {
        allow: [{ field: 'path', regex: '^machine://[^/]+/srv/docs(?:/|$)' }],
      },
    };

    expect(
      decideNative(map, 'read', { path: 'file:///srv/docs/guide.md' }),
    ).toMatchObject({ decision: 'allow' });
  });

  it('never admits a Machine value through a bare-path allow', () => {
    const map: ToolPermissionMap = {
      read: { allow: [{ field: 'path', regex: '^/srv/docs(?:/|$)' }] },
    };

    expect(
      decideNative(map, 'read', { path: 'file:///srv/docs/guide.md' }),
    ).toMatchObject({ decision: 'reject', reason: 'no_allow' });
    expect(
      decideNative(map, 'read', { path: '/srv/docs/guide.md' }),
    ).toMatchObject({ decision: 'reject', reason: 'no_allow' });
  });

  it('rejects a file-form allow as inert against a valid alias', () => {
    const map: ToolPermissionMap = {
      read: { allow: [{ field: 'path', regex: '^file:///srv/docs/' }] },
    };

    expect(
      decideNative(map, 'read', { path: 'file:///srv/docs/guide.md' }),
    ).toMatchObject({ decision: 'reject', reason: 'no_allow' });
  });

  it('refuses a file-form reject through the submitted text', () => {
    // The projection is the alias's Machine locator, but a reject also sees
    // the text the model wrote, so a clause for another scheme still refuses
    // the call.
    const map: ToolPermissionMap = {
      read: { allow: true, reject: [{ field: 'path', regex: '^file://' }] },
    };

    expect(
      decideNative(map, 'read', { path: 'file:///srv/docs/guide.md' }),
    ).toMatchObject({ decision: 'reject', reason: 'explicit_reject' });
    // A bare path never carries the scheme, so the same clause misses it.
    expect(
      decideNative(map, 'read', { path: '/srv/docs/guide.md' }),
    ).toMatchObject({ decision: 'allow' });
  });

  it('gives no_allow for an invalid alias, not invalid_path', () => {
    const map: ToolPermissionMap = {
      read: { allow: [{ field: 'path', regex: '^/srv/docs/' }] },
    };

    expect(
      decideNative(map, 'read', { path: 'file:///srv/docs/guide.md?' }),
    ).toMatchObject({ decision: 'reject', reason: 'no_allow' });
  });

  it('keeps an invalid file alias selector-shaped tail unchanged for read', () => {
    for (const path of ['file:///srv/a?:1-5', 'file://other/srv/a:1-5']) {
      expect(nativeFileProjection('read')('path', path)).toEqual({
        canonical: path,
      });
    }
  });

  it('matches a file alias read without its selector', () => {
    const map: ToolPermissionMap = {
      read: {
        allow: [
          {
            field: 'path',
            regex: `^machine://${MACHINE}/srv/docs/guide\\.md$`,
          },
        ],
      },
    };

    expect(
      decideNative(map, 'read', { path: 'file:///srv/docs/guide.md:10-20' }),
    ).toMatchObject({ decision: 'allow' });
    expect(
      decideNative(map, 'write', { path: 'file:///srv/docs/guide.md:10-20' }),
    ).toMatchObject({ decision: 'reject', reason: 'no_allow' });
  });

  it('does not project MCP values through the file alias classifier', () => {
    const map: ToolPermissionMap = {
      mcp__docs__fetch: { allow: [{ field: 'url', regex: '^/srv/' }] },
    };

    expect(
      decideNative(map, 'mcp__docs__fetch', {
        url: 'file:///srv/docs/guide.md',
      }),
    ).toMatchObject({ decision: 'reject', reason: 'no_allow' });
  });

  it('admits a remote file authority through an allow that matches its text', () => {
    // Policy allow matches the submitted text, but native validation still catches it
    const map: ToolPermissionMap = {
      read: { allow: [{ field: 'path', regex: '^file://' }] },
    };

    expect(
      decideNative(map, 'read', {
        path: 'file://other.example/srv/docs/guide.md',
      }),
    ).toMatchObject({ decision: 'allow' });
    // The projection returned the invalid alias unchanged, submitted text matched
  });

  it('Workspace allow does not admit a file alias', () => {
    const map: ToolPermissionMap = {
      read: { allow: [{ field: 'path', regex: '^/work/project/' }] },
    };

    expect(
      decideNative(
        map,
        'read',
        { path: 'file:/etc/%70asswd' },
        '/work/project',
      ),
    ).toMatchObject({ decision: 'reject', reason: 'no_allow' });
  });

  it('matches projected relative paths rather than their submitted spelling', () => {
    const map: ToolPermissionMap = {
      read: {
        allow: true,
        reject: [
          {
            field: 'path',
            regex: '^/home/operator/\\.ssh(?:/|$)',
          },
        ],
      },
    };

    expect(
      decideNative(
        map,
        'read',
        { path: '../../.ssh/id_ed25519' },
        '/home/operator/project/subdirectory',
      ),
    ).toMatchObject({ decision: 'reject', reason: 'explicit_reject' });
  });

  it('rejects a selector-bearing Workspace-relative path after projection', () => {
    const map: ToolPermissionMap = {
      read: {
        allow: true,
        reject: [{ field: 'path', regex: '^/work/project/src/secret$' }],
      },
    };

    expect(
      decideNative(map, 'read', { path: 'src/secret:raw' }, '/work/project'),
    ).toMatchObject({ decision: 'reject', reason: 'explicit_reject' });
  });

  it('admits a selector spelling through an anchored canonical allow', () => {
    // Admission is text-only, so a literal file named `/tmp/file:1-2` is the
    // same address the suffix names: the clause cannot tell them apart.
    const map: ToolPermissionMap = {
      read: {
        allow: [{ field: 'path', regex: `^machine://${MACHINE}/tmp/file$` }],
      },
    };

    expect(decideNative(map, 'read', { path: '/tmp/file:1-2' })).toMatchObject({
      decision: 'allow',
    });
    expect(decideNative(map, 'read', { path: '/tmp/file:L1-2' })).toMatchObject(
      {
        decision: 'allow',
      },
    );
    expect(decideNative(map, 'read', { path: '/tmp/file:12:5' })).toMatchObject(
      {
        decision: 'allow',
      },
    );
    expect(decideNative(map, 'read', { path: '/tmp/file:raw' })).toMatchObject({
      decision: 'allow',
    });
    // A mutation keeps the suffix, so the same clause does not admit it.
    expect(decideNative(map, 'write', { path: '/tmp/file:1-2' })).toMatchObject(
      {
        decision: 'reject',
        reason: 'no_allow',
      },
    );
  });

  it('refuses an anchored credential reject for every read selector', () => {
    const map: ToolPermissionMap = {
      read: {
        allow: true,
        reject: [{ field: 'path', regex: '^/home/u/\\.ssh/id_rsa$' }],
      },
    };

    for (const path of [
      '/home/u/.ssh/id_rsa:1-5',
      '/home/u/.ssh/id_rsa:L1-5',
      '/home/u/.ssh/id_rsa:l1-L5',
      '/home/u/.ssh/id_rsa:-L5',
      '/home/u/.ssh/id_rsa:L-5',
      '/home/u/.ssh/id_rsa:P3',
      '/home/u/.ssh/id_rsa:1:1',
      '/home/u/.ssh/id_rsa:raw',
      '/home/u/.ssh/id_rsa:outline:3-9',
      '/home/u/.ssh/id_rsa:1-5:raw',
    ]) {
      expect(decideNative(map, 'read', { path })).toMatchObject({
        decision: 'reject',
        reason: 'explicit_reject',
      });
    }
  });

  it('projects a literal reserved-unit name without its suffix', () => {
    const context = { defaultMachine: 'devl', localMachine: 'devl' };
    expect(nativeFileProjection('read', context)('/home/u/secret:P3')).toEqual({
      canonical: 'machine://devl/home/u/secret',
      projectedPath: '/home/u/secret',
    });

    const map: ToolPermissionMap = {
      read: {
        allow: true,
        reject: [{ field: 'path', regex: '^/home/u/secret([/\\\\]|$|:)' }],
      },
    };

    expect(
      decideNative(map, 'read', { path: '/home/u/secret:P3' }),
    ).toMatchObject({ decision: 'reject', reason: 'explicit_reject' });
  });

  it('keeps a literal colon outside the grammar in the matched text', () => {
    // The `:` alternative of the recommended credential rejects is
    // load-bearing: `.ssh:old` is not a selector, so it keeps its suffix.
    const map: ToolPermissionMap = {
      read: {
        allow: true,
        reject: [{ field: 'path', regex: '(^|[/\\\\])\\.ssh([/\\\\]|$|:)' }],
      },
    };

    expect(
      decideNative(map, 'read', { path: '/home/u/.ssh:old' }),
    ).toMatchObject({ decision: 'reject', reason: 'explicit_reject' });
    expect(
      decideNative(map, 'read', { path: '/home/u/.ssh-old' }),
    ).toMatchObject({ decision: 'allow' });
  });

  it('matches a web read as its canonical URL', () => {
    const map: ToolPermissionMap = {
      read: {
        allow: [{ field: 'path', regex: '^https://example\\.test/guide$' }],
      },
    };

    expect(
      decideNative(map, 'read', { path: 'https://example.test/guide:raw' }),
    ).toMatchObject({ decision: 'allow' });
    expect(
      decideNative(map, 'read', { path: 'https://example.test/guide:1-5' }),
    ).toMatchObject({ decision: 'allow' });
    expect(
      decideNative(map, 'read', { path: 'https://EXAMPLE.test/guide:raw' }),
    ).toMatchObject({ decision: 'allow' });
  });

  it('matches a web read as exactly the URL its request uses', () => {
    // Canonicalizing the URL decodes unreserved escapes, so splitting the
    // canonical text again could read a colon the model never wrote as a
    // selector. Each locator below is matched as the URL the read tool
    // requests; a reject naming that URL refuses it, and an allow for the
    // selector-free page does not admit a request for a different one.
    const cases = [
      {
        path: 'https://example.test/a:%31%32:5',
        requested: 'https://example.test/a:12',
        reject: '^https://example\\.test/a:12$',
      },
      {
        path: 'https://example.test/a:raw:%31:5',
        requested: 'https://example.test/a:raw:1',
        reject: '^https://example\\.test/a:raw:1$',
      },
      {
        path: 'https://example.test/a:outline:%31:5',
        requested: 'https://example.test/a:outline:1',
        reject: '^https://example\\.test/a:outline:1$',
      },
      {
        path: 'https://example.test/a:%4C5:raw',
        requested: 'https://example.test/a:L5',
        reject: '^https://example\\.test/a:L5$',
      },
      {
        path: 'https://example.test/a:%503:raw',
        requested: 'https://example.test/a:P3',
        reject: '^https://example\\.test/a:P3$',
      },
      {
        path: 'https://example.test/a:%72aw:5',
        requested: 'https://example.test/a:raw',
        reject: '^https://example\\.test/a:raw$',
      },
      {
        path: 'https://example.test/a:%31:raw',
        requested: 'https://example.test/a:1',
        reject: '^https://example\\.test/a:1$',
      },
    ] as const;

    const pageOnly: ToolPermissionMap = {
      read: { allow: [{ field: 'path', regex: '^https://example\\.test/a$' }] },
    };

    for (const { path, requested, reject } of cases) {
      expect(
        nativeFileProjection('read', CONTEXT)('path', path).canonical,
      ).toBe(requested);
      expect(
        decideNative(
          {
            read: { allow: true, reject: [{ field: 'path', regex: reject }] },
          },
          'read',
          { path },
        ),
      ).toMatchObject({ decision: 'reject', reason: 'explicit_reject' });
      expect(decideNative(pageOnly, 'read', { path })).toMatchObject({
        decision: 'reject',
        reason: 'no_allow',
      });
    }
  });

  it('refuses a clause written for a selector spelling on the submitted text', () => {
    // A reject also sees the submitted text, so a clause that names a
    // selector refuses every call that wrote one — on any scheme. That is the
    // fail-closed direction: a read no longer hides its written suffix.
    const clause = { field: 'path', literal: ':raw' } as const;

    const map: ToolPermissionMap = {
      read: { allow: true, reject: [clause] },
      write: { allow: true, reject: [clause] },
    };

    for (const path of [
      '/srv/app/config.json:raw',
      'file:///srv/app/config.json:raw',
      'https://example.test/guide:raw',
      'kb://Space/notes/a.md:raw',
      'skill://pdf/SKILL.md:raw',
    ]) {
      expect(decideNative(map, 'read', { path })).toMatchObject({
        decision: 'reject',
        reason: 'explicit_reject',
      });
    }

    expect(
      decideNative(map, 'write', { path: '/srv/app/config.json:raw' }),
    ).toMatchObject({ decision: 'reject', reason: 'explicit_reject' });
  });

  it('keeps valid selectors for Knowledge and skill mutations', () => {
    const cases = [
      {
        path: 'kb://Space/secret:raw',
        base: 'kb://Space/secret',
      },
      {
        path: 'skill://pkg/secret:1-5',
        base: 'skill://pkg/secret',
      },
    ] as const;

    for (const { path, base } of cases) {
      for (const toolId of ['edit', 'write'] as const) {
        const exactBase: ToolPermissionMap = {
          [toolId]: { allow: [{ field: 'path', regex: `^${base}$` }] },
        };

        expect(decideNative(exactBase, toolId, { path })).toMatchObject({
          decision: 'reject',
          reason: 'no_allow',
        });

        const suffixReject: ToolPermissionMap = {
          [toolId]: {
            allow: true,
            reject: [{ allFields: true, literal: path }],
          },
        };

        expect(decideNative(suffixReject, toolId, { path })).toMatchObject({
          decision: 'reject',
          reason: 'explicit_reject',
        });
      }
    }
  });

  it('applies the selector-free text when all-fields rejection visits path', () => {
    const rejectWith = (literal: string): ToolPermissionMap => ({
      read: { allow: true, reject: [{ allFields: true, literal }] },
    });

    // A read drops its selector before the canonical text is matched.
    expect(
      nativeFileProjection('read', CONTEXT)(
        'path',
        '/srv/private/notes.md:1-5',
      ),
    ).toEqual({
      canonical: 'machine://host-a/srv/private/notes.md',
      projectedPath: '/srv/private/notes.md',
    });
    expect(
      decideNative(rejectWith('/srv/private/notes.md'), 'read', {
        path: '/srv/private/notes.md:1-5',
      }),
    ).toMatchObject({ decision: 'reject', reason: 'explicit_reject' });
  });

  it('matches a literal and an encoded skill spelling as one resource', () => {
    // The projection is the canonical identity, so a policy written in that
    // canonical spelling matches an encoded submission of the same resource.
    const map: ToolPermissionMap = {
      read: {
        allow: [{ field: 'path', literal: 'skill://pdf/references/a%20b.md' }],
      },
    };

    expect(
      decideNative(map, 'read', {
        path: 'skill://pdf/references/a%20b.md:raw',
      }),
    ).toMatchObject({ decision: 'allow' });
    expect(
      decideNative(map, 'read', { path: 'skill://pdf/references/a%20b.md' }),
    ).toMatchObject({ decision: 'allow' });
    expect(
      decideNative(map, 'read', { path: 'skill://pdf/references/a b.md' }),
    ).toMatchObject({ decision: 'allow' });
  });

  it('rejects a built-in credential path through a skill locator', () => {
    const map: ToolPermissionMap = {
      read: {
        allow: true,
        reject: [{ field: 'path', regex: '^skill://[^/]+/(?:\\.|%2[eE])' }],
      },
    };

    expect(
      decideNative(map, 'read', { path: 'skill://pdf/.env' }),
    ).toMatchObject({ decision: 'reject' });
    expect(
      decideNative(map, 'read', { path: 'skill://pdf/%2eenv:raw' }),
    ).toMatchObject({ decision: 'reject' });
    expect(
      decideNative(map, 'read', { path: 'skill://pdf/references/guide.md' }),
    ).toMatchObject({ decision: 'allow' });
  });

  it('matches equivalent Knowledge spellings through the canonical identity', () => {
    const map: ToolPermissionMap = {
      read: { allow: [{ field: 'path', literal: 'kb://Space/notes/a' }] },
    };

    expect(
      decideNative(map, 'read', { path: 'kb://Space/notes/%61' }),
    ).toMatchObject({ decision: 'allow' });
  });

  it('applies the same projection when all-fields rejection visits path', () => {
    const map: ToolPermissionMap = {
      write: {
        allow: true,
        reject: [{ allFields: true, literal: 'kb://Space/notes/a' }],
      },
    };

    expect(
      decideNative(map, 'write', { path: 'kb://Space/notes/%61', other: 'x' }),
    ).toMatchObject({ decision: 'reject', reason: 'explicit_reject' });
  });

  it('does not project MCP values', () => {
    const map: ToolPermissionMap = {
      mcp__docs__fetch: {
        allow: [{ field: 'url', literal: 'kb://Space/notes/a' }],
      },
    };

    expect(
      decideNative(map, 'mcp__docs__fetch', { url: 'kb://Space/notes/%61' }),
    ).toMatchObject({ decision: 'reject', reason: 'no_allow' });
  });

  it('does not let a fragment satisfy an allow the request would not', () => {
    // A fragment is free text the request never sends. Matched as submitted,
    // `#/docs/` would satisfy an allow written for a documentation path while
    // the request went elsewhere; the projection cuts it first.
    const map: ToolPermissionMap = {
      read: { allow: [{ field: 'path', regex: '/docs/' }] },
    };

    expect(
      decideNative(map, 'read', { path: 'https://evil.test/x#/docs/' }),
    ).toMatchObject({ decision: 'reject', reason: 'no_allow' });
    expect(
      decideNative(map, 'read', { path: 'https://example.test/docs/a#top' }),
    ).toMatchObject({ decision: 'allow' });
  });

  it('does not let a line anchor escape a web reject', () => {
    // The fragment is cut before matching, so a GitHub line anchor names the
    // same resource the reject refuses; the read never leaves the process.
    const map: ToolPermissionMap = {
      read: {
        allow: true,
        reject: [
          {
            field: 'path',
            regex: '^https://github\\.com/o/r/blob/main/secret\\.ts$',
          },
        ],
      },
    };

    expect(
      decideNative(map, 'read', {
        path: 'https://github.com/o/r/blob/main/secret.ts#L10-L20',
      }),
    ).toMatchObject({ decision: 'reject', reason: 'explicit_reject' });
  });

  it('rejects a pathless host against a clause written with its slash', () => {
    // `https://example.test:88` is requested as `https://example.test:88/`,
    // so that is the text a reject clause is matched against.
    const map: ToolPermissionMap = {
      read: {
        allow: true,
        reject: [{ field: 'path', regex: '^https://example\\.test:88/' }],
      },
    };

    expect(
      decideNative(map, 'read', { path: 'https://example.test:88' }),
    ).toMatchObject({ decision: 'reject', reason: 'explicit_reject' });
    expect(
      decideNative(map, 'read', { path: 'https://example.test:88/page:10' }),
    ).toMatchObject({ decision: 'reject', reason: 'explicit_reject' });
  });

  it('rejects an encoded unreserved path without decoding a new escape', () => {
    const map: ToolPermissionMap = {
      read: {
        allow: true,
        reject: [{ field: 'path', regex: '^https://example\\.test/private' }],
      },
    };

    expect(
      decideNative(map, 'read', {
        path: 'https://example.test/%70rivate',
      }),
    ).toMatchObject({ decision: 'reject', reason: 'explicit_reject' });
    expect(canonical('https://example.test/%%370rivate')).toBe(
      'https://example.test/%2570rivate',
    );
    expect(
      decideNative(map, 'read', {
        path: 'https://example.test/%%370rivate',
      }),
    ).toMatchObject({ decision: 'allow' });
  });

  it('leaves non-path native permission fields unchanged', () => {
    expect(
      nativeFileProjection('read')('other', 'kb://Space/notes/%61'),
    ).toEqual({ canonical: 'kb://Space/notes/%61' });
  });

  it('removes encoded selectors from valid file aliases only', () => {
    expect(withoutReadSelector('file:///srv/private/secret%3Araw')).toBe(
      'file:///srv/private/secret',
    );
    expect(withoutReadSelector('file:///srv/private/secret%3A1%2D5')).toBe(
      'file:///srv/private/secret',
    );
    expect(withoutReadSelector('file:/srv/private/secret%3Araw')).toBe(
      'file:/srv/private/secret',
    );
    expect(
      withoutReadSelector('file://localhost/srv/private/secret%3Araw'),
    ).toBe('file://localhost/srv/private/secret');
    // Every selector byte encoded, and a literal colon in a filename before it.
    expect(withoutReadSelector('file:///srv/private/secret%3A%31')).toBe(
      'file:///srv/private/secret',
    );
    expect(withoutReadSelector('file:///srv/a%3Ab/c%e2%82%ac%3A1-2')).toBe(
      'file:///srv/a%3Ab/c%e2%82%ac',
    );
  });

  it('strips valid selectors with the Knowledge and skill parsers', () => {
    expect(withoutReadSelector('kb://Space/notes/a.md:raw')).toBe(
      'kb://Space/notes/a.md',
    );
    expect(withoutReadSelector('kb://Space/notes/a:old:raw')).toBe(
      'kb://Space/notes/a:old:raw',
    );
    expect(withoutReadSelector('skill://pdf/SKILL.md:old:raw')).toBe(
      'skill://pdf/SKILL.md:old:raw',
    );
  });

  it('cuts the selector the read tool splits off', () => {
    expect(withoutReadSelector('https://example.test/guide:1-5')).toBe(
      'https://example.test/guide',
    );
  });

  it('strips a selector before a fragment and keeps the fragment', () => {
    expect(withoutReadSelector('https://example.test/guide:raw#fragment')).toBe(
      'https://example.test/guide#fragment',
    );
    expect(withoutReadSelector('https://example.test/guide:5#fragment')).toBe(
      'https://example.test/guide#fragment',
    );
  });

  it('keeps fragment-only selector-looking text unchanged', () => {
    expect(withoutReadSelector('https://example.test/#x:raw')).toBe(
      'https://example.test/#x:raw',
    );
    expect(withoutReadSelector('https://example.test/page#x:raw')).toBe(
      'https://example.test/page#x:raw',
    );
  });

  it('cuts the selector off a last segment that has a colon of its own', () => {
    // A wiki page name ends in a colon, and the read tool splits the selector
    // off exactly that text, so an anchored clause still catches the page. A
    // trailing `:N:M` pair is one selector, so `a:5:6` requests the page `a`
    // at line 5, column 6.
    for (const suffix of [':raw', ':5', ':outline']) {
      expect(
        withoutReadSelector(`https://en.wikipedia.org/wiki/Talk:Foo${suffix}`),
      ).toBe('https://en.wikipedia.org/wiki/Talk:Foo');
    }

    expect(withoutReadSelector('https://example.test/a:5:6')).toBe(
      'https://example.test/a',
    );
  });

  it('keeps a suffix the grammar does not admit', () => {
    expect(withoutReadSelector('/home/u/.ssh:old')).toBe('/home/u/.ssh:old');
  });

  it('keeps a fragment colon the web locator parser does not split at', () => {
    // A fragment is URL text: the read tool requests it whole, so the matched
    // text must keep its colon too.
    expect(withoutReadSelector('https://example.test/log#a:raw')).toBe(
      'https://example.test/log#a:raw',
    );
  });

  it('keeps the submitted spelling of everything but the selector', () => {
    expect(withoutReadSelector('https://EXAMPLE.test/G%20uide:raw')).toBe(
      'https://EXAMPLE.test/G%20uide',
    );
  });
});

describe('artifact locator permission projection', () => {
  const ARTIFACT = 'artifact://bash-3/stdout:1-50';

  it('matches an artifact locator as its text without the read selector', () => {
    expect(withoutReadSelector(ARTIFACT)).toBe('artifact://bash-3/stdout');
    expect(nativeFileProjection('read')('path', ARTIFACT)).toEqual({
      canonical: 'artifact://bash-3/stdout',
    });
    // `projectNativeFilePath` keeps the selector; only the `read` projection
    // removes it.
    expect(canonical('artifact://bash-3/stderr:1-50')).toBe(
      'artifact://bash-3/stderr:1-50',
    );
  });

  it('never substitutes a host path for an artifact locator', () => {
    expect(canonical('artifact://grep-7', '/work/project')).toBe(
      'artifact://grep-7',
    );
  });

  it('refuses a read when a reject matches the artifact locator text', () => {
    const map: ToolPermissionMap = {
      read: { reject: [{ field: 'path', regex: '^artifact://bash-' }] },
    };

    expect(decideNative(map, 'read', { path: ARTIFACT })).toMatchObject({
      decision: 'reject',
      reason: 'explicit_reject',
    });
  });

  it('allows artifact locators by their own text', () => {
    const map: ToolPermissionMap = {
      read: { allow: [{ field: 'path', regex: '^artifact://' }] },
    };

    expect(
      decideNative(map, 'read', { path: 'artifact://grep-3:21-40' }),
    ).toMatchObject({ decision: 'allow', reason: 'matched_allow' });
  });
});

describe('job locator permission projection', () => {
  it('lowers the scheme and removes the read selector', () => {
    expect(withoutReadSelector('job://bash-4/stdout:-50')).toBe(
      'job://bash-4/stdout',
    );
    expect(
      nativeFileProjection('read')('path', 'JOB://bash-4/stdout:1-5'),
    ).toEqual({ canonical: 'job://bash-4/stdout' });
    // `projectNativeFilePath` keeps the selector; only the `read` projection
    // removes it.
    expect(canonical('Job://bash-4:1-3')).toBe('job://bash-4:1-3');
  });

  it('never substitutes a host path for a job locator', () => {
    expect(canonical('JOB://bash-4', '/work/project')).toBe('job://bash-4');
    expect(canonical('job://', '/work/project')).toBe('job://');
  });

  // Scenario: An upper-case scheme does not pass a reject
  it('rejects an upper-case scheme that a reject names in lower case', () => {
    const map: ToolPermissionMap = {
      read: { reject: [{ field: 'path', regex: '^job://' }] },
    };

    expect(
      decideNative(map, 'read', { path: 'JOB://bash-4/stdout:1-5' }),
    ).toMatchObject({ decision: 'reject', reason: 'explicit_reject' });
  });

  // Scenario: A read group rejects job locators
  it('refuses a read of a record and of the list when a reject matches', () => {
    const map: ToolPermissionMap = {
      read: { allow: true, reject: [{ field: 'path', regex: '^job://' }] },
    };

    for (const path of ['job://bash-4', 'job://', 'job://bash-4/stderr:1-5']) {
      expect(decideNative(map, 'read', { path })).toMatchObject({
        decision: 'reject',
        reason: 'explicit_reject',
      });
    }
  });
});

describe('machine locator permission projection', () => {
  it('projects a Machine locator to its canonical text', () => {
    expect(canonical('MACHINE://DEVL/srv/app/README.md')).toBe(
      'machine://devl/srv/app/README.md',
    );
    expect(canonical('machine://devl/home/me/%2Essh/id')).toBe(
      'machine://devl/home/me/.ssh/id',
    );
    expect(canonical('machine://devl/srv/a%23b.md')).toBe(
      'machine://devl/srv/a%23b.md',
    );
    // `.`, `..`, and trailing separators stay as written.
    expect(canonical('machine://devl/srv/../app/')).toBe(
      'machine://devl/srv/../app/',
    );
    // A selector is preserved for a mutation and removed from a read.
    expect(canonical('machine://devl/a.ts:5-6')).toBe(
      'machine://devl/a.ts:5-6',
    );
    expect(
      nativeFileProjection('read')('path', 'machine://devl/a.ts:5-6'),
    ).toEqual({ canonical: 'machine://devl/a.ts', projectedPath: '/a.ts' });
  });

  it('leaves a listing and a malformed Machine locator as written', () => {
    for (const value of [
      'machine://',
      'machine://devl',
      'machine://devl/',
      'machine://Dev_L/srv',
      'machine://devl/srv/%ZZ',
    ]) {
      expect(canonical(value)).toBe(value);
    }
  });

  it('cannot be bypassed by an encoded spelling of a reject', () => {
    const map: ToolPermissionMap = {
      read: {
        allow: true,
        reject: [
          { field: 'path', regex: '^machine://devl/home/me/\\.ssh(?:/|$)' },
        ],
      },
    };

    expect(
      decideNative(map, 'read', {
        path: 'machine://devl/home/me/%2Essh/id_ed25519',
      }),
    ).toMatchObject({ decision: 'reject', reason: 'explicit_reject' });
    expect(
      decideNative(map, 'read', {
        path: 'MACHINE://DEVL/home/me/%2Essh/id_ed25519',
      }),
    ).toMatchObject({ decision: 'reject', reason: 'explicit_reject' });
  });

  it('does not admit a Machine path through a local root-anchored allow', () => {
    const map: ToolPermissionMap = {
      read: { allow: [{ field: 'path', regex: '^/home/me/' }] },
    };

    expect(
      decideNative(map, 'read', { path: 'machine://devl/home/me/notes.md' }),
    ).toMatchObject({ decision: 'reject', reason: 'no_allow' });
  });

  it('does not admit a mapped bare absolute path through a local allow', () => {
    const map: ToolPermissionMap = {
      read: { allow: [{ field: 'path', regex: '^/home/me/' }] },
    };

    expect(
      decideNative(
        map,
        'read',
        { path: '/home/me/notes.md' },
        'machine://devl/home/me/shop',
      ),
    ).toMatchObject({ decision: 'reject', reason: 'no_allow' });
    expect(
      decideNative(
        { read: { allow: [{ field: 'path', regex: '^machine://devl/' }] } },
        'read',
        { path: '/home/me/notes.md' },
        'machine://devl/home/me/shop',
      ),
    ).toMatchObject({ decision: 'allow' });
  });

  it('scopes a Machine allow to the Machine it names', () => {
    const map: ToolPermissionMap = {
      read: { allow: [{ field: 'path', regex: '^machine://devl/home/me/' }] },
    };

    expect(
      decideNative(map, 'read', { path: 'machine://gpu/home/me/notes.md' }),
    ).toMatchObject({ decision: 'reject', reason: 'no_allow' });
  });

  it('resolves a file alias on the Workspace Machine', () => {
    const map: ToolPermissionMap = {
      read: { allow: true, reject: [{ field: 'path', regex: '^/etc/' }] },
    };

    expect(canonical('file:/etc/%70asswd', 'machine://devl/home/me/shop')).toBe(
      'machine://devl/etc/passwd',
    );
    expect(
      decideNative(
        map,
        'read',
        { path: 'file:/etc/%70passwd' },
        'machine://devl/home/me/shop',
      ),
    ).toMatchObject({ decision: 'reject', reason: 'explicit_reject' });
  });
});

describe('media locator permission projection', () => {
  const ID = '0190f5e2-7c1a-7b3e-9d4f-2a6b8c0d1e2f';

  it('matches a media read without its selector', () => {
    const map: ToolPermissionMap = {
      read: {
        allow: true,
        reject: [{ field: 'path', regex: `^media://${ID}$` }],
      },
    };

    expect(nativeFileProjection('read')('path', `media://${ID}:raw`)).toEqual({
      canonical: `media://${ID}`,
    });
    expect(
      decideNative(map, 'read', { path: `media://${ID}:raw` }),
    ).toMatchObject({ decision: 'reject', reason: 'explicit_reject' });
  });

  it('keeps a media locator canonical, outside the Workspace root', () => {
    expect(canonical(`media://${ID}`, '/work/project')).toBe(`media://${ID}`);
    expect(canonical('media://', '/work/project')).toBe('media://');
  });

  it('admits owner media through the domain-restricted read alternative only when it lists ^media://', () => {
    const restricted: ToolPermissionMap = {
      read: {
        allow: [
          { field: 'path', regex: '^machine://' },
          { field: 'path', regex: '^kb://' },
          { field: 'path', regex: '^skill://' },
          { field: 'path', regex: '^media://' },
          { field: 'path', regex: String.raw`^https://docs\.example\.com/` },
        ],
      },
    };

    expect(
      decideNative(restricted, 'read', { path: `media://${ID}` }),
    ).toMatchObject({ decision: 'allow' });
    expect(
      decideNative(restricted, 'read', {
        path: 'https://other.example/guide',
      }),
    ).toMatchObject({ decision: 'reject', reason: 'no_allow' });

    const domainOnly: ToolPermissionMap = {
      read: {
        allow: [
          { field: 'path', regex: String.raw`^https://docs\.example\.com/` },
        ],
      },
    };

    expect(
      decideNative(domainOnly, 'read', { path: `media://${ID}` }),
    ).toMatchObject({ decision: 'reject', reason: 'no_allow' });
  });
});

describe('Project locator permission projection', () => {
  const PROJECT_ID = '0190f5e2-7c1a-7b3e-9d4f-2a6b8c0d1e2f';
  const CANONICAL = `projects://${PROJECT_ID}`;

  it('canonicalizes the scheme, root alias, and UUID', () => {
    expect(canonical('PROJECTS://')).toBe('projects://');
    expect(canonical('Projects:///')).toBe('projects://');
    expect(canonical(`PROJECTS://${PROJECT_ID.toUpperCase()}`)).toBe(CANONICAL);
    expect(canonical('PROJECTS://archived')).toBe('projects://archived');
  });

  it('keeps a native selector for a mutation and removes it from a read', () => {
    const submitted = `PROJECTS://${PROJECT_ID.toUpperCase()}:raw:1-5`;

    expect(canonical(submitted)).toBe(`${CANONICAL}:raw:1-5`);
    expect(nativeFileProjection('read')('path', submitted)).toEqual({
      canonical: CANONICAL,
    });
    expect(nativeFileProjection('write')('path', submitted)).toEqual({
      canonical: `${CANONICAL}:raw:1-5`,
    });
    expect(nativeFileProjection('edit')('path', submitted)).toEqual({
      canonical: `${CANONICAL}:raw:1-5`,
    });
  });

  it('strips every native read selector from a Project resource', () => {
    const selectors = [
      { submitted: 'raw', canonical: 'raw' },
      { submitted: '1-5', canonical: '1-5' },
      { submitted: 'outline', canonical: 'outline' },
      { submitted: 'outline:2-4', canonical: 'outline:2-4' },
      { submitted: '10-20,30-40', canonical: '10-20,30-40' },
      // The native splitter keeps the trailing-raw spelling as written.
      { submitted: '1-5:raw', canonical: '1-5:raw' },
    ];

    for (const { submitted, canonical: suffix } of selectors) {
      expect(
        nativeFileProjection('read')('path', `${CANONICAL}:${submitted}`),
      ).toEqual({ canonical: CANONICAL });
      expect(canonical(`${CANONICAL}:${submitted}`)).toBe(
        `${CANONICAL}:${suffix}`,
      );
    }

    expect(nativeFileProjection('read')('path', 'PROJECTS:///:raw')).toEqual({
      canonical: 'projects://',
    });
  });

  it('leaves an invalid Project locator as written', () => {
    for (const value of [
      'projects://name',
      `projects://${PROJECT_ID}/other`,
      `projects://${PROJECT_ID}?archived`,
      `projects://${PROJECT_ID}#top`,
      `projects://${PROJECT_ID}%2F`,
      `projects://${PROJECT_ID}:raw?x`,
      'projects://archived/',
      'projects://%61rchived',
    ]) {
      expect(canonical(value)).toBe(value);
      expect(nativeFileProjection('read')('path', value)).toEqual({
        canonical: value,
      });
    }
  });

  it('canonicalizes a valid resource and drops its refused suffix', () => {
    // The suffix is not a native selector, so it never becomes part of the
    // resource identity: a read matches the canonical resource and the reader
    // refuses the suffix as invalid_selector after admission. A mutation keeps
    // the suffix it submitted.
    for (const suffix of ['nonsense', '', 'outline:1,3']) {
      const submitted = `PROJECTS://${PROJECT_ID.toUpperCase()}:${suffix}`;

      expect(canonical(submitted)).toBe(`${CANONICAL}:${suffix}`);
      expect(nativeFileProjection('read')('path', submitted)).toEqual({
        canonical: CANONICAL,
      });
      expect(nativeFileProjection('write')('path', submitted)).toEqual({
        canonical: `${CANONICAL}:${suffix}`,
      });
    }
  });

  it('keeps the Project locator independent of the Workspace root', () => {
    for (const root of ['/work/project', 'machine://devl/home/me/shop']) {
      expect(canonical(`PROJECTS://${PROJECT_ID}`, root)).toBe(CANONICAL);
      expect(canonical('projects://', root)).toBe('projects://');
      expect(canonical('projects://archived', root)).toBe(
        'projects://archived',
      );
    }
  });

  it('rejects an upper-case spelling through the canonical resource', () => {
    const map: ToolPermissionMap = {
      read: {
        allow: true,
        reject: [{ field: 'path', regex: `^projects://${PROJECT_ID}$` }],
      },
    };

    expect(
      decideNative(map, 'read', {
        path: `PROJECTS://${PROJECT_ID.toUpperCase()}:raw:1-10`,
      }),
    ).toMatchObject({ decision: 'reject', reason: 'explicit_reject' });
  });

  it('rejects an anchored canonical clause despite a refused suffix', () => {
    const map: ToolPermissionMap = {
      read: {
        allow: true,
        reject: [{ field: 'path', regex: `^projects://${PROJECT_ID}$` }],
      },
    };

    for (const suffix of ['nonsense', '', 'outline:1,3']) {
      expect(
        decideNative(map, 'read', {
          path: `PROJECTS://${PROJECT_ID.toUpperCase()}:${suffix}`,
        }),
      ).toMatchObject({ decision: 'reject', reason: 'explicit_reject' });
    }
  });

  it('gives the root and its alias one decision', () => {
    const map: ToolPermissionMap = {
      read: {
        allow: true,
        reject: [{ field: 'path', regex: '^projects://$' }],
      },
    };

    for (const path of [
      'projects://',
      'PROJECTS://',
      'PROJECTS:///',
      'PROJECTS://:nonsense',
    ]) {
      expect(decideNative(map, 'read', { path })).toMatchObject({
        decision: 'reject',
        reason: 'explicit_reject',
      });
    }
  });

  it('admits the canonical resource through an exact allow', () => {
    const map: ToolPermissionMap = {
      read: { allow: [{ field: 'path', literal: CANONICAL }] },
    };

    expect(
      decideNative(map, 'read', {
        path: `PROJECTS://${PROJECT_ID.toUpperCase()}:1-5`,
      }),
    ).toMatchObject({ decision: 'allow' });
  });

  it('does not admit a Project locator through a local path allow', () => {
    const map: ToolPermissionMap = {
      read: { allow: [{ field: 'path', regex: '^/work/project/' }] },
    };

    expect(
      decideNative(map, 'read', { path: CANONICAL }, '/work/project'),
    ).toMatchObject({ decision: 'reject', reason: 'no_allow' });
  });
});
