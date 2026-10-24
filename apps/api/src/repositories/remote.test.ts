import { canonicalOrigin, normalizeRemote } from './remote';

describe('normalizeRemote', () => {
  it.each([
    ['git@github.com:leon0399/llame.git', 'github.com/leon0399/llame'],
    ['https://github.com/leon0399/llame', 'github.com/leon0399/llame'],
    ['https://github.com/leon0399/llame.git', 'github.com/leon0399/llame'],
    ['https://github.com/leon0399/llame/', 'github.com/leon0399/llame'],
    ['https://github.com/leon0399/llame.git/', 'github.com/leon0399/llame'],
    ['ssh://git@GitHub.com/leon0399/llame.git', 'github.com/leon0399/llame'],
    ['  git://github.com/leon0399/Llame.git  ', 'github.com/leon0399/Llame'],
    ['GitHub.com:Leon0399/Llame.git', 'github.com/Leon0399/Llame'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeRemote(input)).toBe(expected);
  });

  it('keeps the path case while lowercasing the host', () => {
    expect(normalizeRemote('https://GitHub.COM/Leon0399/Llame')).toBe(
      'github.com/Leon0399/Llame',
    );
  });

  it('removes a token carried in the userinfo part', () => {
    for (const input of [
      'https://ghp_secret@github.com/leon0399/llame',
      'https://user:password@github.com/leon0399/llame',
      'ssh://token@github.com/leon0399/llame',
    ]) {
      const normalized = normalizeRemote(input);
      expect(normalized).toBe('github.com/leon0399/llame');
      expect(normalized).not.toMatch(/secret|password|token/u);
    }
  });

  it('leaves a string that is not a remote as its trimmed text', () => {
    expect(normalizeRemote('  not a remote  ')).toBe('not a remote');
    expect(normalizeRemote('')).toBe('');
    expect(normalizeRemote('   ')).toBe('');
  });

  it('treats a bare host and path as a remote and lowercases only the host', () => {
    expect(normalizeRemote('GitHub.com/Leon0399/Llame')).toBe(
      'github.com/Leon0399/Llame',
    );
  });

  it('reads the user-less scp form as the same remote as its https form', () => {
    expect(normalizeRemote('GitHub.com:Leon0399/Llame')).toBe(
      normalizeRemote('https://github.com/Leon0399/Llame'),
    );
  });

  // A remote may be submitted with no path at all, and then the authority is
  // the whole value: the userinfo strip and the host lowercase both have to
  // read up to the end of the string, not to a slash that is not there.
  it('normalizes a URL whose authority is the whole value', () => {
    expect(normalizeRemote('https://ghp_secret@GitHub.COM')).toBe('github.com');
    expect(normalizeRemote('https://GitHub.COM')).toBe('github.com');
  });

  // One trailing slash is the documented case; a clone URL a shell pasted can
  // carry several, and every one of them has to go before the `.git` check so
  // `r.git//` and `r//` both collapse to the same identity.
  it.each([
    ['https://github.com/leon0399/llame///', 'github.com/leon0399/llame'],
    ['https://github.com/leon0399/llame.git//', 'github.com/leon0399/llame'],
    ['github.com/leon0399/llame//', 'github.com/leon0399/llame'],
    ['https://github.com///', 'github.com'],
    ['///', ''],
  ])('strips every trailing slash of %s', (input, expected) => {
    expect(normalizeRemote(input)).toBe(expected);
  });

  it('keeps a `.git` that is not the final suffix', () => {
    expect(normalizeRemote('https://github.com/leon0399/llame.git/next')).toBe(
      'github.com/leon0399/llame.git/next',
    );
  });

  // `r/.git` is a real clone URL. Stripping the `.git` leaves the separator
  // that preceded it, so the suffix pass has to strip slashes again, not once.
  it.each([
    ['https://github.com/leon0399/llame/.git', 'github.com/leon0399/llame'],
    ['git@github.com:leon0399/llame/.git', 'github.com/leon0399/llame'],
    ['https://github.com/leon0399/llame/.git/', 'github.com/leon0399/llame'],
  ])('strips a `.git` that sits after a separator in %s', (input, expected) => {
    expect(normalizeRemote(input)).toBe(expected);
  });

  // The remote's own text is case-sensitive in the path, but a value that is
  // not a remote at all (no slash, no scheme, no scp colon) is returned
  // untouched instead of being lowercased.
  it('returns an opaque value unchanged', () => {
    expect(normalizeRemote('GitHub.COM')).toBe('GitHub.COM');
  });
});

describe('canonicalOrigin', () => {
  it('reads only the remote named origin', () => {
    expect(
      canonicalOrigin([
        { name: 'upstream', url: 'https://github.com/other/llame' },
        { name: 'origin', url: 'git@github.com:leon0399/llame.git' },
      ]),
    ).toBe('github.com/leon0399/llame');
  });

  it('is null for a clone whose only remote is upstream', () => {
    expect(
      canonicalOrigin([{ name: 'upstream', url: 'https://github.com/o/r' }]),
    ).toBeNull();
  });

  it('is null for a clone with no remote at all', () => {
    expect(canonicalOrigin([])).toBeNull();
  });

  // An origin that normalizes to nothing names no repository, exactly like the
  // absence of an origin: `''` is not a canonical remote a row may store.
  it('is null for an origin whose url normalizes to nothing', () => {
    expect(canonicalOrigin([{ name: 'origin', url: '   ' }])).toBeNull();
    expect(canonicalOrigin([{ name: 'origin', url: '///' }])).toBeNull();
  });
});
