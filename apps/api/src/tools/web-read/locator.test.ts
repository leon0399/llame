import { parseWebLocator } from './locator';

describe('parseWebLocator', () => {
  it('assembles the canonical URL for both admitted schemes', () => {
    expect(parseWebLocator('https://example.test/guide')).toEqual({
      url: 'https://example.test/guide',
    });
    expect(parseWebLocator('http://example.test/guide')).toEqual({
      url: 'http://example.test/guide',
    });
  });

  it('omits the selector key for a locator that carries none', () => {
    // The selector is absent, not present-and-undefined: a locator without
    // one is the two-field shape, exactly as the type spells it.
    expect(parseWebLocator('https://example.test/guide')).toStrictEqual({
      url: 'https://example.test/guide',
    });
  });

  it('keeps a trailing separator and a query in the URL', () => {
    expect(parseWebLocator('https://example.test/dir/')).toEqual({
      url: 'https://example.test/dir/',
    });
    expect(parseWebLocator('https://example.test:8080/guide')).toEqual({
      url: 'https://example.test:8080/guide',
    });
  });

  it('refuses a fragment, naming the locator without it', () => {
    // The fragment never leaves the process, so it is text the request would
    // drop: a locator carrying one is refused before it can reach policy as a
    // URL other than the one fetched.
    const fragment = parseWebLocator('https://example.test/guide?x=1#top');
    expect(fragment).toMatchObject({ type: 'invalid_path' });
    expect(fragment).toHaveProperty(
      'message',
      'Write this locator as https://example.test/guide?x=1',
    );
    // A bare `#` is a fragment too, and one `new URL` keeps in `href` while
    // the request would drop it, so the delimiter decides and not `hash`.
    const bare = parseWebLocator('https://example.test/guide#');
    expect(bare).toMatchObject({ type: 'invalid_path' });
    expect(bare).toHaveProperty(
      'message',
      'Write this locator as https://example.test/guide',
    );
    // The spelling the refusal named is admitted, so the whole cost of the
    // fragment is one resubmission.
    expect(parseWebLocator('https://example.test/guide?x=1')).toEqual({
      url: 'https://example.test/guide?x=1',
    });
  });

  it('splits the trailing selector at the last colon after the last slash', () => {
    expect(parseWebLocator('https://example.test/guide:10-20')).toEqual({
      url: 'https://example.test/guide',
      selector: '10-20',
    });
    expect(parseWebLocator('https://example.test/docs/2024:10-20')).toEqual({
      url: 'https://example.test/docs/2024',
      selector: '10-20',
    });
    expect(parseWebLocator('https://example.test/docs/2024:5+10')).toEqual({
      url: 'https://example.test/docs/2024',
      selector: '5+10',
    });
    // The shipped grammar has no bare line number, so a digit-only last
    // segment needs its colon encoded rather than selected.
    const digitOnly = parseWebLocator('https://example.test/report:10');
    expect(digitOnly).toMatchObject({ type: 'invalid_selector' });
    expect(digitOnly).toHaveProperty(
      'message',
      expect.stringContaining('https://example.test/report%3A10'),
    );
    expect(parseWebLocator('https://example.test/guide:raw')).toEqual({
      url: 'https://example.test/guide',
      selector: 'raw',
    });
    expect(parseWebLocator('https://example.test/guide:raw:10-20')).toEqual({
      url: 'https://example.test/guide',
      selector: 'raw:10-20',
    });
    expect(parseWebLocator('https://example.test/doc:raw')).toEqual({
      url: 'https://example.test/doc',
      selector: 'raw',
    });
    expect(parseWebLocator('https://example.test/a/b:4-5')).toEqual({
      url: 'https://example.test/a/b',
      selector: '4-5',
    });
  });

  it('keeps a query colon out of the selector grammar and refuses a fragment', () => {
    // Every query locator here is its own serialization, so each one is
    // fetched as written: the colon is URL text, never a selector that
    // truncates it.
    expect(parseWebLocator('https://example.test/path?mode=raw')).toEqual({
      url: 'https://example.test/path?mode=raw',
    });
    expect(parseWebLocator('https://example.test/path?mode:raw')).toEqual({
      url: 'https://example.test/path?mode:raw',
    });
    expect(parseWebLocator('https://example.test/path?mode=:raw')).toEqual({
      url: 'https://example.test/path?mode=:raw',
    });
    const queryColons = 'https://example.test/search?time=10:30:00';
    expect(parseWebLocator(queryColons)).toEqual({ url: queryColons });
    expect(parseWebLocator('https://example.test/a?b/c:10-20')).toEqual({
      url: 'https://example.test/a?b/c:10-20',
    });
    expect(parseWebLocator('https://example.test/a?mode=1:4-5')).toEqual({
      url: 'https://example.test/a?mode=1:4-5',
    });
    // A fragment is refused before the gate is asked, so no colon after one
    // is ever read as a selector: the request drops the fragment, and the
    // refusal names the same locator without it.
    const afterFragment = parseWebLocator('https://example.test/a#x:raw');
    expect(afterFragment).toMatchObject({ type: 'invalid_path' });
    expect(afterFragment).toHaveProperty(
      'message',
      'Write this locator as https://example.test/a',
    );
    const beforeFragment = parseWebLocator('https://example.test/a:raw#x');
    expect(beforeFragment).toMatchObject({ type: 'invalid_path' });
    expect(beforeFragment).toHaveProperty(
      'message',
      'Write this locator as https://example.test/a:raw',
    );
    // A query after a colon in the path leaves that colon literal too: a
    // selector cannot sit in front of a query, so none is read out of one.
    expect(parseWebLocator('https://example.test/a:b?x=1')).toEqual({
      url: 'https://example.test/a:b?x=1',
    });
  });

  it('refuses a noncanonical query locator with its canonical query', () => {
    const defaultPort = parseWebLocator(
      'https://example.test:443/path?mode=:raw',
    );
    expect(defaultPort).toMatchObject({ type: 'invalid_path' });
    expect(defaultPort).toHaveProperty(
      'message',
      expect.stringContaining('https://example.test/path?mode=:raw'),
    );
    const spelling = 'https://example.test/search?time=10:30:00';
    const uppercaseHost = parseWebLocator(
      'https://Example.test/search?time=10:30:00',
    );
    expect(uppercaseHost).toMatchObject({ type: 'invalid_path' });
    expect(uppercaseHost).toHaveProperty(
      'message',
      expect.stringContaining(spelling),
    );
    // The query colon stays literal, because encoding it would name a
    // different URL; the named spelling is admitted on the next attempt.
    expect(parseWebLocator(spelling)).toEqual({ url: spelling });
  });

  it('encodes every colon of the suggested spelling in one refusal', () => {
    const refused = parseWebLocator('https://example.test/a:b:10');
    expect(refused).toMatchObject({ type: 'invalid_selector' });
    // The hint encodes the colon the split left in the segment as well, so
    // the resubmitted locator is admitted rather than split once more.
    const spelling = 'https://example.test/a%3Ab%3A10';
    expect(refused).toHaveProperty(
      'message',
      expect.stringContaining(spelling),
    );
    expect(parseWebLocator(spelling)).toEqual({ url: spelling });
  });

  it('keeps a port with no path out of the selector grammar', () => {
    // The split reads `:8080` as a selector, and the URL it leaves behind is
    // the empty-path locator, which is not its own serialization.
    const portOnly = parseWebLocator('https://example.test:8080');
    expect(portOnly).toMatchObject({ type: 'invalid_path' });
    expect(portOnly).toHaveProperty(
      'message',
      expect.stringContaining('https://example.test/'),
    );
    expect(parseWebLocator('https://example.test:8080/')).toEqual({
      url: 'https://example.test:8080/',
    });
  });

  it('reads a colon in the last path segment only when it is encoded', () => {
    expect(parseWebLocator('https://w.example/wiki/Special%3ASearch')).toEqual({
      url: 'https://w.example/wiki/Special%3ASearch',
    });
    const literalColon = parseWebLocator(
      'https://w.example/wiki/Special:Search',
    );
    expect(literalColon).toMatchObject({ type: 'invalid_selector' });
    expect(literalColon).toHaveProperty(
      'message',
      expect.stringContaining('https://w.example/wiki/Special%3ASearch'),
    );
  });

  it.each([
    ['https://Example.test/Guide', 'https://example.test/Guide'],
    ['https://g%72okipedia.com/page', 'https://grokipedia.com/page'],
    ['https://example.test:443/guide', 'https://example.test/guide'],
    ['https://example.test', 'https://example.test/'],
    ['https://example.test/a b', 'https://example.test/a%20b'],
  ])(
    'refuses the noncanonical locator %s with its canonical spelling',
    (locator, canonical) => {
      const result = parseWebLocator(locator);
      expect(result).toMatchObject({ type: 'invalid_path' });
      expect(result).toHaveProperty(
        'message',
        expect.stringContaining(canonical),
      );
    },
  );

  it.each([
    ['HTTPS://example.test/guide', 'https://example.test/guide'],
    ['Https://example.test/guide', 'https://example.test/guide'],
    ['HTTP://example.test/guide', 'http://example.test/guide'],
  ])(
    'refuses the uppercase scheme in %s with its canonical spelling',
    (locator, canonical) => {
      const result = parseWebLocator(locator);
      expect(result).toMatchObject({ type: 'invalid_path' });
      expect(result).toHaveProperty(
        'message',
        expect.stringContaining(canonical),
      );
      // The same locator spelled as the model must submit it is admitted, so
      // the refusal is the scheme's case and nothing else about the text.
      expect(parseWebLocator(canonical)).toEqual({ url: canonical });
    },
  );

  it.each([
    'https://user:secret@example.test/guide',
    'https://user:secret@example.test',
    // The scheme is judged after the credentials, so an uppercase one cannot
    // turn the canonical spelling into a place the password is echoed.
    'HTTPS://user:secret@example.test/guide',
  ])('refuses userinfo in %s without echoing it', (locator) => {
    const result = parseWebLocator(locator);
    expect(result).toMatchObject({ type: 'invalid_path' });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('refuses a locator that carries only one of the two userinfo parts', () => {
    // Either half alone is a credential: the guard asks whether either part
    // is present, so a lone username and a lone password are both refused.
    for (const locator of [
      'https://user@example.test/guide',
      'https://:secret@example.test/guide',
    ]) {
      const result = parseWebLocator(locator);
      expect(result).toMatchObject({ type: 'invalid_path' });
      expect(result).toHaveProperty(
        'message',
        expect.stringContaining('credentials'),
      );
    }
  });

  it('refuses an uppercase scheme with the whole locator, selector included', () => {
    // The refusal names the spelling the model resubmits, so it carries the
    // selector: a hint without it would silently change the requested read.
    const result = parseWebLocator('HTTPS://example.test/guide:10-20');
    expect(result).toMatchObject({ type: 'invalid_path' });
    expect(result).toHaveProperty(
      'message',
      expect.stringContaining('https://example.test/guide:10-20'),
    );
  });

  it('refuses a non-web scheme and a degenerate locator', () => {
    // The scheme is judged before every other admission: a scheme outside the
    // two admitted ones gets the shape refusal, never a spelling hint that
    // echoes it back as something to resubmit.
    expect(parseWebLocator('ftp://example.test/guide')).toEqual({
      type: 'invalid_path',
      message: 'Write this locator as an absolute http:// or https:// URL.',
    });
    expect(parseWebLocator('https://')).toMatchObject({
      type: 'invalid_path',
    });
    expect(parseWebLocator('https://exa mple.test/guide')).toMatchObject({
      type: 'invalid_path',
    });
  });
});
