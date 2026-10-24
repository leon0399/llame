import { derivedDisplayName, displayNameProblem } from './display-name';

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
});
