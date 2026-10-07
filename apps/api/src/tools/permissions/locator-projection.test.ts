import { describe, expect, it } from 'vitest';

import { type UnknownRecord } from '@workspace/runtime-safety';

import { compileToolPermissionMap } from './compile-permissions';
import { evaluatePermission } from './evaluator';
import {
  nativeFileProjection,
  projectNativeFilePath,
  withoutReadSelector,
} from './locator-projection';
import { type ToolPermissionMap } from './types';

function decideNative(
  map: ToolPermissionMap,
  toolId: string,
  args: UnknownRecord,
  workspaceRoot?: string,
) {
  return evaluatePermission(compileToolPermissionMap(map, 'p'), {
    toolId,
    args,
    projectFieldValue: nativeFileProjection(toolId, workspaceRoot),
  });
}

describe('projectNativeFilePath', () => {
  it('projects a valid file alias to its decoded host path', () => {
    expect(projectNativeFilePath('file:///srv/docs/guide.md')).toBe(
      '/srv/docs/guide.md',
    );
  });

  it('projects a file alias with percent-encoded characters', () => {
    expect(projectNativeFilePath('file:///etc/%70asswd')).toBe('/etc/passwd');
  });

  it('preserves dot segments in file alias projection', () => {
    expect(projectNativeFilePath('file:///tmp/%2e%2e/secret')).toBe(
      '/tmp/../secret',
    );
  });

  it('leaves an invalid file alias unchanged', () => {
    expect(projectNativeFilePath('file:///srv/docs/guide.md?')).toBe(
      'file:///srv/docs/guide.md?',
    );
  });

  it('leaves a remote file authority unchanged', () => {
    expect(
      projectNativeFilePath('file://other.example/srv/docs/guide.md'),
    ).toBe('file://other.example/srv/docs/guide.md');
  });

  it('projects a minimal-form alias before Workspace resolution', () => {
    expect(projectNativeFilePath('file:/etc/%70asswd', '/work/project')).toBe(
      '/etc/passwd',
    );
  });

  it('does not project a file alias from the Workspace root', () => {
    expect(projectNativeFilePath('file:///etc/passwd', '/work/project')).toBe(
      '/etc/passwd',
    );
  });

  it('retains Knowledge selectors until read projection', () => {
    expect(projectNativeFilePath('kb://Space/notes/a:10-20')).toBe(
      'kb://Space/notes/a:10-20',
    );
    expect(projectNativeFilePath('kb://Space/notes/a:raw')).toBe(
      'kb://Space/notes/a:raw',
    );
    expect(projectNativeFilePath('kb://Space/notes/a')).toBe(
      'kb://Space/notes/a',
    );
    expect(projectNativeFilePath('kb://Space/notes/a:outline')).toBe(
      'kb://Space/notes/a:outline',
    );
    expect(projectNativeFilePath('kb://Space/notes/a:outline:3-9')).toBe(
      'kb://Space/notes/a:outline:3-9',
    );
    expect(
      nativeFileProjection('read')('path', 'kb://Space/notes/a:outline:3-9'),
    ).toBe('kb://Space/notes/a');
  });

  it('retains comma read selectors in non-read projections', () => {
    expect(projectNativeFilePath('kb://Space/notes/a:10-20,30-40')).toBe(
      'kb://Space/notes/a:10-20,30-40',
    );
    expect(projectNativeFilePath('kb://Space/notes/a:raw:10-20,30-40')).toBe(
      'kb://Space/notes/a:raw:10-20,30-40',
    );
  });

  it('canonically encodes an equivalent spelling', () => {
    expect(projectNativeFilePath('kb://Space/a b')).toBe('kb://Space/a%20b');
    expect(projectNativeFilePath('kb://Space/a%20b')).toBe('kb://Space/a%20b');
    expect(projectNativeFilePath('kb://Space/notes/%61')).toBe(
      'kb://Space/notes/a',
    );
  });

  it('preserves empty Space roots and trailing separators', () => {
    expect(projectNativeFilePath('kb://Space')).toBe('kb://Space');
    expect(projectNativeFilePath('kb://Space/dir/')).toBe('kb://Space/dir/');
  });

  it('projects a skill locator to its canonical resource identity', () => {
    expect(projectNativeFilePath('skill://pdf')).toBe('skill://pdf');
    expect(projectNativeFilePath('skill://pdf:raw')).toBe('skill://pdf:raw');
    expect(projectNativeFilePath('skill://pdf:10-20')).toBe(
      'skill://pdf:10-20',
    );
    expect(projectNativeFilePath('skill://pdf/')).toBe('skill://pdf/');
    expect(projectNativeFilePath('skill://')).toBe('skill://');
    expect(projectNativeFilePath('skill://pdf/references/a%20b.md:5+10')).toBe(
      'skill://pdf/references/a%20b.md:5+10',
    );
    expect(
      nativeFileProjection('read')(
        'path',
        'skill://pdf/references/a%20b.md:5+10',
      ),
    ).toBe('skill://pdf/references/a%20b.md');
  });

  it('leaves an invalid skill locator unchanged', () => {
    expect(projectNativeFilePath('skill://PDF')).toBe('skill://PDF');
    expect(projectNativeFilePath('skill://pdf/%2F')).toBe('skill://pdf/%2F');
  });

  it('projects a web locator to the text its request will use', () => {
    // The fragment the request drops is gone before matching, the pathless
    // host carries the slash its request carries, and the selector stays in
    // the spelling it was written in.
    expect(projectNativeFilePath('https://example.test/guide#top')).toBe(
      'https://example.test/guide',
    );
    expect(projectNativeFilePath('https://example.test:88')).toBe(
      'https://example.test:88/',
    );
    expect(projectNativeFilePath('https://example.test/guide:10-20')).toBe(
      'https://example.test/guide:10-20',
    );
    expect(projectNativeFilePath('https://example.test/guide:5#frag')).toBe(
      'https://example.test/guide:5',
    );
    // A spelling the parser normalizes projects to what will be requested.
    expect(projectNativeFilePath('https://EXAMPLE.test/x')).toBe(
      'https://example.test/x',
    );
    // A locator the read tool refuses outright is matched as written.
    expect(projectNativeFilePath('https://user:secret@example.test/x')).toBe(
      'https://user:secret@example.test/x',
    );
  });

  it('leaves an invalid locator unchanged', () => {
    expect(projectNativeFilePath('kb://Space/%2F')).toBe('kb://Space/%2F');
  });

  it('projects relative host paths from the Workspace root', () => {
    expect(projectNativeFilePath('src/app.ts', '/work/project')).toBe(
      '/work/project/src/app.ts',
    );
    expect(projectNativeFilePath('../shared/data.json', '/work/project')).toBe(
      '/work/shared/data.json',
    );
    expect(projectNativeFilePath('app.ts/', '/work/project')).toBe(
      '/work/project/app.ts/',
    );
  });

  it('leaves non-filesystem schemes unchanged during Workspace projection', () => {
    expect(projectNativeFilePath('kb://Space/notes/a', '/work/project')).toBe(
      'kb://Space/notes/a',
    );
    expect(projectNativeFilePath('skill://pdf/SKILL.md', '/work/project')).toBe(
      'skill://pdf/SKILL.md',
    );
    expect(
      projectNativeFilePath('https://example.test/guide', '/work/project'),
    ).toBe('https://example.test/guide');
    expect(projectNativeFilePath('vault://notes/a.md', '/work/project')).toBe(
      'vault://notes/a.md',
    );
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

  it('admits a file alias through a host-path allow', () => {
    const map: ToolPermissionMap = {
      read: { allow: [{ field: 'path', regex: '^/srv/docs(?:/|$)' }] },
    };
    expect(
      decideNative(map, 'read', { path: 'file:///srv/docs/guide.md' }),
    ).toMatchObject({ decision: 'allow' });
  });

  it('rejects a file-form allow as inert against a valid alias', () => {
    const map: ToolPermissionMap = {
      read: { allow: [{ field: 'path', regex: '^file:///srv/docs/' }] },
    };
    expect(
      decideNative(map, 'read', { path: 'file:///srv/docs/guide.md' }),
    ).toMatchObject({ decision: 'reject', reason: 'no_allow' });
  });

  it('does not reject a valid alias on the projected path when the clause targets the URL scheme', () => {
    // A reject for ^file:// only catches the submitted text, which the
    // runner's two-pass evaluateToolPermission handles. The projection-level
    // evaluator sees the decoded host path, so the clause does not match here.
    const map: ToolPermissionMap = {
      read: { allow: true, reject: [{ field: 'path', regex: '^file://' }] },
    };
    expect(
      decideNative(map, 'read', { path: 'file:///srv/docs/guide.md' }),
    ).toMatchObject({ decision: 'allow' });
    // The equivalent absolute path also does not match
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
      expect(nativeFileProjection('read')('path', path)).toBe(path);
    }
  });

  it('matches a file alias read without its selector', () => {
    const map: ToolPermissionMap = {
      read: { allow: [{ field: 'path', regex: '^/srv/docs/guide\\.md$' }] },
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
  it('admits a selector spelling through an anchored exact allow', () => {
    // Admission is text-only, so a literal file named `/tmp/file:1-2` is the
    // same text the suffix names: the clause cannot tell them apart.
    const map: ToolPermissionMap = {
      read: { allow: [{ field: 'path', regex: '^/tmp/file$' }] },
    };
    expect(decideNative(map, 'read', { path: '/tmp/file:1-2' })).toMatchObject({
      decision: 'allow',
    });
    expect(decideNative(map, 'read', { path: '/tmp/file:raw' })).toMatchObject({
      decision: 'allow',
    });
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

  it('matches no read against a clause written with a selector spelling', () => {
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
        decision: 'allow',
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

  it('applies the same selector-free text when all-fields rejection visits path', () => {
    const rejectWith = (literal: string): ToolPermissionMap => ({
      read: { allow: true, reject: [{ allFields: true, literal }] },
    });
    expect(
      decideNative(rejectWith('/srv/private/notes.md:1-5'), 'read', {
        path: '/srv/private/notes.md:1-5',
      }),
    ).toMatchObject({ decision: 'allow' });
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
    expect(projectNativeFilePath('https://example.test/%%370rivate')).toBe(
      'https://example.test/%2570rivate',
    );
    expect(
      decideNative(map, 'read', {
        path: 'https://example.test/%%370rivate',
      }),
    ).toMatchObject({ decision: 'allow' });
  });
  it('leaves non-path native permission fields unchanged', () => {
    expect(nativeFileProjection('read')('other', 'kb://Space/notes/%61')).toBe(
      'kb://Space/notes/%61',
    );
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
    // off exactly that text, so an anchored clause still catches the page and
    // `a:5` is the locator that requests `:6`.
    for (const suffix of [':raw', ':5', ':outline']) {
      expect(
        withoutReadSelector(`https://en.wikipedia.org/wiki/Talk:Foo${suffix}`),
      ).toBe('https://en.wikipedia.org/wiki/Talk:Foo');
    }
    expect(withoutReadSelector('https://example.test/a:5:6')).toBe(
      'https://example.test/a:5',
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
