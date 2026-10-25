import {
  DISPLAY_NAME_MAX,
  derivedDisplayName,
  displayNameProblem,
} from './display-name';

describe('displayNameProblem', () => {
  it('accepts one ordinary segment', () => {
    expect(displayNameProblem('llame')).toBeNull();
    expect(displayNameProblem('LLame-2.0')).toBeNull();
  });

  it.each([
    ['team/llame', 'must not contain "/" or a NUL byte'],
    ['team\0llame', 'must not contain "/" or a NUL byte'],
    ['.', 'must not be "." or ".."'],
    ['..', 'must not be "." or ".."'],
    ['   ', 'must not be blank'],
  ])('refuses %s', (name, reason) => {
    expect(displayNameProblem(name)).toBe(reason);
  });

  it('refuses a name past the cap', () => {
    expect(displayNameProblem('x'.repeat(201))).toBe(
      'must be at most 200 characters',
    );
  });

  it('accepts a name exactly at the cap', () => {
    // The DTO's `@MaxLength(200)` admits the boundary value, so the rule has to
    // as well; an off-by-one here would reject a name the client accepts.
    expect(displayNameProblem('x'.repeat(DISPLAY_NAME_MAX))).toBeNull();
  });
});

describe('derivedDisplayName', () => {
  it('takes the last segment of the canonical remote', () => {
    expect(derivedDisplayName('github.com/leon0399/llame', '/srv/clone')).toBe(
      'llame',
    );
  });

  it('falls back to the toplevel basename for a remote-less clone', () => {
    expect(derivedDisplayName(null, '/srv/clone/llame')).toBe('llame');
  });

  it('names a repository whose only candidates are unusable', () => {
    expect(derivedDisplayName(null, '/')).toBe('repository');
    expect(derivedDisplayName(null, '/srv/..')).toBe('repository');
  });

  it('skips the empty segments a trailing slash leaves behind', () => {
    // The last element of the split is '' for a trailing slash, so the segment
    // has to come from the last non-empty part, not the literal last part.
    expect(derivedDisplayName(null, '/srv/clone/llame/')).toBe('llame');
    expect(derivedDisplayName('github.com/leon0399/llame/', '/srv/other')).toBe(
      'llame',
    );
  });

  it('prefers the remote over the toplevel', () => {
    expect(derivedDisplayName('github.com/leon0399/llame', '/srv/other')).toBe(
      'llame',
    );
  });

  it('names an empty remote from the toplevel only when the remote is absent', () => {
    // An empty string is a canonical remote that simply names nothing; only a
    // `null` remote defers to the toplevel.
    expect(derivedDisplayName('', '/srv/clone/llame')).toBe('repository');
  });

  it('accepts a segment at the display-name cap', () => {
    expect(
      derivedDisplayName(
        `github.com/leon0399/${'x'.repeat(DISPLAY_NAME_MAX)}`,
        '/srv/clone',
      ),
    ).toBe('x'.repeat(DISPLAY_NAME_MAX));
  });
});
