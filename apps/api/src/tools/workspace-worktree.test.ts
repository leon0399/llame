import { describe, expect, it } from 'vitest';

import {
  defaultWorktreeBase,
  generatedWorktreeName,
  namedWorktree,
  readWorktreeRequest,
  WORKTREE_DIRECTORY,
  worktreeDirectory,
  type WorktreeName,
} from './workspace-worktree';

/*
 * The pure name, branch, and placement rules of a worktree entry (openspec
 * `repositories` "Worktree names, branches, and base refs follow one rule" and
 * "Worktree placement follows the source clone and its worktree base"). No
 * filesystem, git, or database is involved, so a refusal here starts nothing.
 */

/** The problem message of one refused name, or `undefined` when accepted. */
function problemOf(name: string): string | undefined {
  const named = namedWorktree(name);
  return 'message' in named ? named.message : undefined;
}

/** The name one accepted value produces. */
function accepted(name: string): WorktreeName {
  const named = namedWorktree(name);
  if ('message' in named) throw new Error(`Refused: ${named.message}`);
  return named;
}

describe('worktree names', () => {
  it('keeps a slashless name in the llame namespace', () => {
    expect(accepted('calm-otter-9f2c')).toStrictEqual({
      name: 'calm-otter-9f2c',
      slug: 'calm-otter-9f2c',
      branch: 'llame/calm-otter-9f2c',
    });
  });

  it('makes a name with a slash the whole branch and flattens its slug', () => {
    expect(accepted('feature/login')).toStrictEqual({
      name: 'feature/login',
      slug: 'feature-login',
      branch: 'feature/login',
    });
  });

  it.each(['-upload', '--force', '-'])(
    'refuses the option-like name %s',
    (name) => {
      expect(problemOf(name)).toBe('A worktree name must not start with `-`.');
    },
  );

  it.each(['..', '.', '../escape', 'a/..', 'a/.hidden'])(
    'refuses the escaping name %s',
    (name) => {
      expect(problemOf(name)).toBeDefined();
    },
  );

  it.each([
    'a b',
    'a~b',
    'a^b',
    'a:b',
    'a?b',
    'a*b',
    'a[b',
    String.raw`a\b`,
    'a\nb',
  ])('refuses the ref punctuation or whitespace in %s', (name) => {
    expect(problemOf(name)).toBe(
      'A branch name must not hold whitespace or ref punctuation.',
    );
  });

  it('refuses the sequences git never accepts', () => {
    expect(problemOf('a..b')).toBe('A branch name must not hold `..` or `@{`.');
    expect(problemOf('a@{1}')).toBe(
      'A branch name must not hold `..` or `@{`.',
    );
    expect(problemOf('feature/')).toBe(
      'A branch name must not end with `/`, `.`, or `.lock`.',
    );
    expect(problemOf('feature.lock')).toBe(
      'A branch name must not end with `/`, `.`, or `.lock`.',
    );
    expect(problemOf('feature//login')).toBe(
      'A branch name must not hold an empty or dot-leading segment.',
    );
  });

  it('refuses the empty name', () => {
    expect(problemOf('')).toBe('A worktree name must not be empty.');
  });
});

describe('worktree base refs', () => {
  it('accepts an omitted base ref', () => {
    expect(readWorktreeRequest({})).toStrictEqual({});
  });

  it('keeps a supplied base ref', () => {
    expect(readWorktreeRequest({ baseRef: 'origin/main' })).toStrictEqual({
      baseRef: 'origin/main',
    });
  });

  it.each(['--force', '-n'])(
    'refuses the option-like base ref %s before any probe',
    (baseRef) => {
      expect(readWorktreeRequest({ baseRef })).toStrictEqual({
        message: 'A base ref must not start with `-`.',
      });
    },
  );

  it('refuses an empty base ref and control bytes', () => {
    expect(readWorktreeRequest({ baseRef: '' })).toStrictEqual({
      message: 'A base ref must not be empty.',
    });
    expect(readWorktreeRequest({ baseRef: 'main\nx' })).toStrictEqual({
      message: 'A base ref must not hold whitespace or control bytes.',
    });
  });

  it('validates both members of one request', () => {
    expect(
      readWorktreeRequest({ name: 'clear-field', baseRef: 'main' }),
    ).toStrictEqual({
      baseRef: 'main',
      name: {
        name: 'clear-field',
        slug: 'clear-field',
        branch: 'llame/clear-field',
      },
    });
    expect(readWorktreeRequest({ name: '-x', baseRef: 'main' })).toStrictEqual({
      message: 'A worktree name must not start with `-`.',
    });
  });
});

describe('generated names', () => {
  it('draws one adjective, one noun, and four hex characters', () => {
    const picks = [0, 1];
    const name = generatedWorktreeName({
      int: () => picks.shift() ?? 0,
      bytes: () => Buffer.from([0xab, 0xcd]),
    });

    expect(name.name).toBe('amber-cedar-abcd');
    expect(name.slug).toBe('amber-cedar-abcd');
    expect(name.branch).toBe('llame/amber-cedar-abcd');
  });

  it('draws each word within its own table and the suffix from two bytes', () => {
    const bounds: Array<number> = [];
    const bytes = vi.fn(() => Buffer.from([0xab, 0xcd]));
    const name = generatedWorktreeName({
      int: (max) => {
        bounds.push(max);
        return max - 1;
      },
      bytes,
    });

    // Both tables hold 16 words, and each draw is bounded by its own length.
    expect(bounds).toStrictEqual([16, 16]);
    expect(bytes).toHaveBeenCalledWith(2);
    expect(name.name).toBe('vivid-river-abcd');
  });
});

describe('worktree placement', () => {
  it('places the worktree beside the clone by default', () => {
    const base = defaultWorktreeBase('/home/dev/src/llame');

    expect(base).toBe(`/home/dev/src/${WORKTREE_DIRECTORY}`);
    expect(worktreeDirectory(base, 'llame', 'clear-field-0192')).toBe(
      '/home/dev/src/.llame-worktrees/llame/clear-field-0192',
    );
  });

  it('never places the worktree inside the clone', () => {
    const directory = worktreeDirectory(
      defaultWorktreeBase('/home/dev/src/llame'),
      'llame',
      'clear-field-0192',
    );

    expect(directory.startsWith('/home/dev/src/llame/')).toBe(false);
  });

  it('lets a worktree base replace the default directory', () => {
    expect(worktreeDirectory('/srv/trees', 'llame', 'clear-field-0192')).toBe(
      '/srv/trees/llame/clear-field-0192',
    );
  });

  it('keeps the display name as one segment of the path', () => {
    expect(worktreeDirectory('/srv/trees', 'llame-fork', 'feature-login')).toBe(
      '/srv/trees/llame-fork/feature-login',
    );
  });
});
