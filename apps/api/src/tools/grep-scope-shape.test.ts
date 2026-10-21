import { describe, expect, it, vi } from 'vitest';

import { compileGlob, type GrepEntry } from '@workspace/native-file-tools';

import { type GrepReadAdmission } from './grep-admission';
import { type GrepToolError } from './grep-results';
import {
  buildScope,
  encodeSearchLocator,
  hasGlobOperator,
  splitScopePath,
  type ScopeDraft,
  type ScopeOutcome,
} from './grep-scope-shape';

const NO_ENTRIES: ReadonlyArray<GrepEntry> = [];

function admission(allow = true): GrepReadAdmission & {
  admitted: Array<string>;
} {
  const admitted: Array<string> = [];
  return {
    admitted,
    admit(locator) {
      admitted.push(locator);
      return allow;
    },
    refused: 0,
    recordRefusals() {},
  };
}

function draft(overrides: Partial<ScopeDraft> = {}): ScopeDraft {
  return {
    index: 3,
    locatorFor: (rel) => (rel.length === 0 ? 'p' : `p/${rel}`),
    glob: undefined,
    port: () => ({
      followsLinks: false,
      list: () => Promise.resolve(NO_ENTRIES),
      read: () => Promise.resolve(new Uint8Array()),
    }),
    probe: () => Promise.resolve({ kind: 'directory' }),
    endsWithSeparator: false,
    admission: admission(),
    root: 'root',
    ...overrides,
  };
}

function scopesOf(outcome: ScopeOutcome) {
  if ('result' in outcome) {
    throw new Error(`expected scopes, received ${outcome.result.type}`);
  }
  return outcome;
}

describe('hasGlobOperator', () => {
  it.each(['*', 'notes/*.md', 'a?', '{a,b}', '[ab]'])(
    'sees the operator in %s',
    (text) => {
      expect(hasGlobOperator(text)).toBe(true);
    },
  );

  it('ignores a literal path', () => {
    expect(hasGlobOperator('notes/a.md')).toBe(false);
  });
});

describe('encodeSearchLocator', () => {
  it('encodes a literal glob character as the scope parser reads it back', () => {
    expect(encodeSearchLocator('skill://pdf/a*b?.md')).toBe(
      'skill://pdf/a%2Ab%3F.md',
    );
  });
});

describe('splitScopePath', () => {
  it('splits at the first glob segment and keeps the trailing separator', () => {
    const split = splitScopePath('notes/sub/*.md', () => true);
    if ('status' in split) throw new Error('the path splits');
    expect(split.prefixPath).toBe('notes/sub');
    expect(split.glob).toBeDefined();
    expect(split.endsWithSeparator).toBe(false);

    const directory = splitScopePath('notes/sub/', () => true);
    if ('status' in directory) throw new Error('the path splits');
    expect(directory.prefixPath).toBe('notes/sub');
    expect(directory.glob).toBeUndefined();
    expect(directory.endsWithSeparator).toBe(true);
  });

  it('decodes the literal prefix before the scheme probes it', () => {
    const split = splitScopePath('a%2Ab.md', () => true);
    if ('status' in split) throw new Error('the path splits');
    expect(split.prefixPath).toBe('a*b.md');
  });

  it('refuses an unsupported glob operator before any probe', () => {
    expect(splitScopePath('notes/{a,b}', () => true)).toMatchObject({
      status: 'error',
      type: 'invalid_path',
      message:
        'The glob operator `{` is not supported; write `*`, `**`, and `?` instead.',
    });
  });

  it('refuses a path the scheme itself would not resolve', () => {
    expect(splitScopePath('notes', () => false)).toEqual({
      status: 'error',
      type: 'invalid_path',
      message: 'The scope path is invalid.',
    });
  });
});

describe('buildScope', () => {
  it('returns a glob scope without probing its literal prefix', async () => {
    const probe = vi.fn(() => Promise.resolve({ kind: 'directory' as const }));
    const outcome = scopesOf(
      await buildScope(draft({ glob: compileGlob('**/*.md'), probe })),
    );

    expect(probe).not.toHaveBeenCalled();
    expect(outcome.roots).toEqual(['root']);
    expect(outcome.scopes).toHaveLength(1);
    expect(outcome.scopes[0]).toMatchObject({
      index: 3,
      locatorPrefix: 'p/',
      singleFile: false,
    });
  });

  it('keeps the separator for a directory prefix', async () => {
    const outcome = scopesOf(await buildScope(draft()));

    expect(outcome.roots).toEqual(['root']);
    expect(outcome.scopes[0]).toMatchObject({
      locatorPrefix: 'p/',
      singleFile: false,
    });
    expect(outcome.scopes[0]?.glob).toBeUndefined();
  });

  it('marks a prefix that names one file, without a separator', async () => {
    const outcome = scopesOf(
      await buildScope(
        draft({ probe: () => Promise.resolve({ kind: 'file' }) }),
      ),
    );

    expect(outcome.scopes[0]).toMatchObject({
      locatorPrefix: 'p',
      singleFile: true,
    });
  });

  it('refuses a missing prefix as not found', async () => {
    const outcome = await buildScope(
      draft({ probe: () => Promise.resolve({ kind: 'missing' }) }),
    );
    expect(outcome).toEqual({
      result: {
        status: 'error',
        type: 'not_found',
        message: 'File not found.',
      },
    });
  });

  it('returns the refusal a probe raised', async () => {
    const result: GrepToolError = {
      status: 'error',
      type: 'knowledge_space_unavailable',
      message: 'unavailable',
    };
    const outcome = await buildScope(
      draft({ probe: () => Promise.resolve({ result }) }),
    );
    expect(outcome).toEqual({ result });
  });

  it('treats a prefix the read group refuses as missing, without probing', async () => {
    const probe = vi.fn(() => Promise.resolve({ kind: 'file' as const }));
    const outcome = await buildScope(
      draft({ admission: admission(false), probe }),
    );

    expect(outcome).toMatchObject({
      result: { status: 'error', type: 'not_found' },
    });
    expect(probe).not.toHaveBeenCalled();
  });

  it('refuses a file that the submitted scope wrote with a trailing separator', async () => {
    const outcome = await buildScope(
      draft({
        probe: () => Promise.resolve({ kind: 'file' }),
        endsWithSeparator: true,
      }),
    );
    expect(outcome).toMatchObject({
      result: { status: 'error', type: 'not_found' },
    });
  });

  it('accepts a directory written with a trailing separator', async () => {
    const outcome = scopesOf(
      await buildScope(draft({ endsWithSeparator: true })),
    );
    expect(outcome.scopes[0]).toMatchObject({
      locatorPrefix: 'p/',
      singleFile: false,
    });
  });
});
