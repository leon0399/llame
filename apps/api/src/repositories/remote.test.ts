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

  it('keeps an explicit port in the canonical form', () => {
    expect(normalizeRemote('ssh://git@example.com:2222/owner/repo.git')).toBe(
      'example.com:2222/owner/repo',
    );
    expect(normalizeRemote('https://Example.COM:8443/owner/repo')).toBe(
      'example.com:8443/owner/repo',
    );
    // A port with no path is the whole authority, and it stays there.
    expect(normalizeRemote('ssh://example.com:2222/')).toBe('example.com:2222');
  });

  // The canonical value is stored and then submitted again — as a checkout's
  // `remote` selector, or in a PATCH that re-declares it — so normalizing it a
  // second time has to leave it alone. A port read as an scp path would move
  // the first path segment, and the second submission would name another
  // repository (or none).
  it('is idempotent over every form it accepts', () => {
    for (const input of [
      'git@github.com:leon0399/llame.git',
      'https://github.com/leon0399/llame',
      'ssh://git@example.com:2222/owner/repo.git',
      'example.com:2222/owner/repo',
      'ssh://example.com:2222',
      'example.com/owner/repo',
      'git@example.com:2024/repo',
      'not a remote',
      '',
    ]) {
      const once = normalizeRemote(input);
      expect(normalizeRemote(once)).toBe(once);
    }
  });

  // An all-digit first path segment is indistinguishable from a port, and a
  // port is the reading that keeps a canonical value stable, so it wins.
  it('reads a numeric first segment after the colon as a port', () => {
    expect(normalizeRemote('git@example.com:2024/repo')).toBe(
      'example.com:2024/repo',
    );
  });

  // A remote may be submitted with no path at all, and then the authority is
  // the whole value: the userinfo strip and the host lowercase both have to
  // read up to the end of the string, not to a slash that is not there.
  it('normalizes a URL whose authority is the whole value', () => {
    expect(normalizeRemote('https://ghp_secret@GitHub.COM')).toBe('github.com');
    expect(normalizeRemote('https://GitHub.COM')).toBe('github.com');
  });

  // Userinfo belongs to the authority, so an `@` later in the path is part of
  // the repository's own name and survives the strip.
  it('strips userinfo only up to the first slash', () => {
    expect(normalizeRemote('https://github.com/leon0399/ll@me')).toBe(
      'github.com/leon0399/ll@me',
    );
  });

  // The strip is bounded by the `@` index, not by the literal `-1`: a
  // single-character userinfo sits at index 1, and reading it as "no userinfo"
  // would keep the credential in the stored remote.
  it('strips a one-character userinfo', () => {
    expect(normalizeRemote('https://a@github.com/owner/repo')).toBe(
      'github.com/owner/repo',
    );
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
