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
  });

  it('treats a bare host and path as a remote and lowercases only the host', () => {
    expect(normalizeRemote('GitHub.com/Leon0399/Llame')).toBe(
      'github.com/Leon0399/Llame',
    );
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
});
