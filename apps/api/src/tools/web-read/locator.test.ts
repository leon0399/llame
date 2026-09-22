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

  it('keeps a trailing separator, a query, and a fragment in the URL', () => {
    expect(parseWebLocator('https://example.test/dir/')).toEqual({
      url: 'https://example.test/dir/',
    });
    expect(parseWebLocator('https://example.test/guide?x=1#top')).toEqual({
      url: 'https://example.test/guide?x=1#top',
    });
    expect(parseWebLocator('https://example.test:8080/guide')).toEqual({
      url: 'https://example.test:8080/guide',
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

  it('refuses a non-web scheme and a degenerate locator', () => {
    expect(parseWebLocator('ftp://example.test/guide')).toMatchObject({
      type: 'invalid_path',
    });
    expect(parseWebLocator('https://')).toMatchObject({
      type: 'invalid_path',
    });
    expect(parseWebLocator('https://exa mple.test/guide')).toMatchObject({
      type: 'invalid_path',
    });
  });
});
