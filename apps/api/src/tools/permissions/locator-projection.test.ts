import { describe, expect, it } from 'vitest';

import { type UnknownRecord } from '@workspace/runtime-safety';

import { compileToolPermissionMap } from './compile-permissions';
import { evaluatePermission } from './evaluator';
import {
  nativeFileProjection,
  projectNativeFilePath,
} from './locator-projection';
import { type ToolPermissionMap } from './types';

function decideNative(
  map: ToolPermissionMap,
  toolId: string,
  args: UnknownRecord,
) {
  return evaluatePermission(compileToolPermissionMap(map, 'p'), {
    toolId,
    args,
    projectFieldValue: nativeFileProjection(toolId),
  });
}

describe('projectNativeFilePath', () => {
  it('excludes Knowledge read selectors from the resource identity', () => {
    expect(projectNativeFilePath('kb://Space/notes/a:10-20')).toBe(
      'kb://Space/notes/a',
    );
    expect(projectNativeFilePath('kb://Space/notes/a:raw')).toBe(
      'kb://Space/notes/a',
    );
    expect(projectNativeFilePath('kb://Space/notes/a')).toBe(
      'kb://Space/notes/a',
    );
  });

  it('excludes comma read selectors from the resource identity', () => {
    expect(projectNativeFilePath('kb://Space/notes/a:10-20,30-40')).toBe(
      'kb://Space/notes/a',
    );
    expect(projectNativeFilePath('kb://Space/notes/a:raw:10-20,30-40')).toBe(
      'kb://Space/notes/a',
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
    expect(projectNativeFilePath('skill://pdf:raw')).toBe('skill://pdf');
    expect(projectNativeFilePath('skill://pdf:10-20')).toBe('skill://pdf');
    expect(projectNativeFilePath('skill://pdf/')).toBe('skill://pdf/');
    expect(projectNativeFilePath('skill://')).toBe('skill://');
    expect(projectNativeFilePath('skill://pdf/references/a%20b.md:5+10')).toBe(
      'skill://pdf/references/a%20b.md',
    );
  });

  it('leaves an invalid skill locator unchanged', () => {
    expect(projectNativeFilePath('skill://PDF')).toBe('skill://PDF');
    expect(projectNativeFilePath('skill://pdf/%2F')).toBe('skill://pdf/%2F');
  });

  it('leaves direct host locators textual', () => {
    expect(projectNativeFilePath('/tmp/file:1-2')).toBe('/tmp/file:1-2');
  });

  it('leaves an invalid locator unchanged', () => {
    expect(projectNativeFilePath('kb://Space/%2F')).toBe('kb://Space/%2F');
  });
});

describe('native file permission projection', () => {
  it('does not resolve a selector-like host filename against an anchored allow', () => {
    const map: ToolPermissionMap = {
      read: { allow: [{ field: 'path', regex: '^/tmp/file$' }] },
    };
    expect(decideNative(map, 'read', { path: '/tmp/file:1-2' })).toMatchObject({
      decision: 'reject',
      reason: 'no_allow',
    });
    expect(decideNative(map, 'read', { path: '/tmp/file' })).toMatchObject({
      decision: 'allow',
    });
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
});
