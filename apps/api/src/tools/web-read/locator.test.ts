import { canonicalHref, parseWebLocator } from './locator';

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

  it('drops a fragment rather than refusing the locator', () => {
    // A page's anchor is ordinary text in the links a model reads. The
    // request drops it either way, so it is cut here: one fragment-free text
    // is what policy matches, what a message names, and what is fetched.
    expect(parseWebLocator('https://example.test/guide?x=1#top')).toEqual({
      url: 'https://example.test/guide?x=1',
    });
    // A bare `#` is a fragment too, and one `new URL` keeps in `href`.
    expect(parseWebLocator('https://example.test/guide#')).toEqual({
      url: 'https://example.test/guide',
    });
    // A fragment cannot smuggle clause-matching text into the locator: it is
    // gone before policy, and gone before the request.
    expect(parseWebLocator('https://evil.test/x#/docs/')).toEqual({
      url: 'https://evil.test/x',
    });
    // The colon inside a fragment is never a selector, and the fragment that
    // held it leaves with it.
    expect(parseWebLocator('https://example.test/guide#x:raw')).toEqual({
      url: 'https://example.test/guide',
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
    // A bare line number is a selector: `:10` is line 10, the form a result's
    // own line prefixes teach the model to write.
    expect(parseWebLocator('https://example.test/report:10')).toEqual({
      url: 'https://example.test/report',
      selector: '10',
    });
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

  it('keeps a query colon out of the selector grammar and cuts a fragment', () => {
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
    // The fragment is cut before the gate is asked, so no colon inside one is
    // ever read as a selector, and a selector written ahead of one still is.
    expect(parseWebLocator('https://example.test/a#x:raw')).toEqual({
      url: 'https://example.test/a',
    });
    expect(parseWebLocator('https://example.test/a:raw#x')).toEqual({
      url: 'https://example.test/a',
      selector: 'raw',
    });
    // A query after a colon in the path leaves that colon literal too: a
    // selector cannot sit in front of a query, so none is read out of one.
    expect(parseWebLocator('https://example.test/a:b?x=1')).toEqual({
      url: 'https://example.test/a:b?x=1',
    });
  });

  it('normalizes a query locator instead of refusing it', () => {
    // The query survives the normalization: only the parts the parser owns
    // change, and a colon inside a query is never a selector.
    expect(parseWebLocator('https://example.test:443/path?mode=:raw')).toEqual({
      url: 'https://example.test/path?mode=:raw',
    });
    const spelling = 'https://example.test/search?time=10:30:00';
    expect(
      parseWebLocator('https://Example.test/search?time=10:30:00'),
    ).toEqual({ url: spelling });
    expect(parseWebLocator(spelling)).toEqual({ url: spelling });
  });

  it('encodes every colon of the suggested spelling in one refusal', () => {
    const refused = parseWebLocator('https://example.test/a:b:c');
    expect(refused).toMatchObject({ type: 'invalid_selector' });
    // The hint encodes the colon the split left in the segment as well, so
    // the resubmitted locator is admitted rather than split once more.
    const spelling = 'https://example.test/a%3Ab%3Ac';
    expect(refused).toHaveProperty(
      'message',
      expect.stringContaining(spelling),
    );
    expect(parseWebLocator(spelling)).toEqual({ url: spelling });
    // A colon left in the path is URL text once the suffix is a real
    // selector: `/a:b` is the page and `10` is its line.
    expect(parseWebLocator('https://example.test/a:b:10')).toEqual({
      url: 'https://example.test/a:b',
      selector: '10',
    });
  });

  it('reads a port on a pathless host as the port', () => {
    // No path means no place a selector could trail, so `:8080` is the port
    // it looks like. The empty path's slash is the one difference from the
    // serialization that is admitted, because it changes no endpoint.
    expect(parseWebLocator('https://example.test:8080')).toEqual({
      url: 'https://example.test:8080/',
    });
    expect(parseWebLocator('https://example.test:8080/')).toEqual({
      url: 'https://example.test:8080/',
    });
    expect(parseWebLocator('https://example.test')).toEqual({
      url: 'https://example.test/',
    });
    // Both at once: the digits before the path separator are the port, the
    // digits after the last one are the line.
    expect(parseWebLocator('https://example.test:88/:88')).toEqual({
      url: 'https://example.test:88/',
      selector: '88',
    });
    expect(parseWebLocator('https://example.test:88/docs:88-90')).toEqual({
      url: 'https://example.test:88/docs',
      selector: '88-90',
    });
    // The same digits after the path separator are a line, not a port.
    expect(parseWebLocator('https://example.test:8080/:88')).toEqual({
      url: 'https://example.test:8080/',
      selector: '88',
    });
  });

  it('keeps the selector while normalizing the URL half', () => {
    // The uppercase host is normalized, and the `:10-20` the model asked for
    // survives that normalization rather than being lost with the refusal.
    expect(parseWebLocator('https://EXAMPLE.test/guide:10-20')).toEqual({
      url: 'https://example.test/guide',
      selector: '10-20',
    });
    expect(parseWebLocator('https://example.test/guide:10-20')).toEqual({
      url: 'https://example.test/guide',
      selector: '10-20',
    });
  });

  it('names the path a selector written after the authority needs', () => {
    // `https://host:1-5` is not a URL at all — `1-5` is an invalid port — so
    // the parser refuses the whole text. Answering with the generic "write an
    // absolute URL" leaves the model to guess; the spelling that works is the
    // authority's own serialization carrying the same selector.
    for (const selector of ['1-5', 'raw', '1-3,7-9']) {
      expect(parseWebLocator(`https://example.test:${selector}`)).toEqual({
        type: 'invalid_path',
        message: `Write this locator as https://example.test/:${selector}`,
      });
      expect(parseWebLocator(`https://example.test/:${selector}`)).toEqual({
        url: 'https://example.test/',
        selector,
      });
    }
  });

  it('says what a malformed port is, rather than "write an absolute URL"', () => {
    // The locator is absolute; only its port is broken, so naming the rule it
    // broke is what the model can act on.
    expect(parseWebLocator('https://example.test:notaport/')).toEqual({
      type: 'invalid_path',
      message:
        'A port must be a number: write this locator with one, or as https://example.test/',
    });
    expect(parseWebLocator('https://example.test:notaselector')).toEqual({
      type: 'invalid_path',
      message:
        'A port must be a number: write this locator with one, or as https://example.test/',
    });
  });

  it('keeps the generic message when nothing recovers the locator', () => {
    expect(parseWebLocator('ftp://example.test:1-5')).toEqual({
      type: 'invalid_path',
      message: 'Write this locator as an absolute http:// or https:// URL.',
    });
    expect(parseWebLocator('not a locator at all')).toEqual({
      type: 'invalid_path',
      message: 'Write this locator as an absolute http:// or https:// URL.',
    });
  });

  it('drops a host’s root dot so a host clause cannot be side-stepped', () => {
    // `example.test.` and `example.test` are one host, but the URL parser
    // keeps the dot, so a clause written for the host would miss it. The
    // request and the permission decision both use the dotless form.
    expect(parseWebLocator('https://example.test./')).toEqual({
      url: 'https://example.test/',
    });
    expect(parseWebLocator('https://example.test.')).toEqual({
      url: 'https://example.test/',
    });
    expect(parseWebLocator('https://example.test./guide:1-5')).toEqual({
      url: 'https://example.test/guide',
      selector: '1-5',
    });
  });

  it('names the range forms for a suffix outside the line grammar', () => {
    // `:0` looks like a line but no file has one, and telling that model to
    // percent-encode the colon answers a question it did not ask.
    expect(parseWebLocator('https://example.test/guide:0')).toEqual({
      url: 'https://example.test/guide',
      selector: '0',
    });
    expect(parseWebLocator('https://example.test/guide:12+')).toEqual({
      type: 'invalid_selector',
      message:
        'A line selector is :N, :N-M, or :N+K, and a line number starts at 1, so line 12 is :12. For a literal colon, write this locator as https://example.test/guide%3A12+',
    });
    // A suffix that is a word still gets the encoding hint alone.
    expect(parseWebLocator('https://w.example/wiki/Special:Search')).toEqual({
      type: 'invalid_selector',
      message: 'Write this locator as https://w.example/wiki/Special%3ASearch',
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
    ['https://example.test/a?q=x y', 'https://example.test/a?q=x%20y'],
    ['https://example.test/a b', 'https://example.test/a%20b'],
    ['https://example.test./guide', 'https://example.test/guide'],
    ['HTTPS://example.test/guide', 'https://example.test/guide'],
    ['Https://example.test/guide', 'https://example.test/guide'],
    ['HTTP://example.test/guide', 'http://example.test/guide'],
  ])('normalizes %s to %s and requests that', (locator, canonical) => {
    // Nothing here changes which resource is addressed, so refusing it cost
    // a call and taught the model nothing it could carry forward. Permission
    // matching sees both texts, so an encoded host cannot slip past a reject.
    expect(parseWebLocator(locator)).toEqual({ url: canonical });
    expect(parseWebLocator(canonical)).toEqual({ url: canonical });
  });

  it.each([
    ['https://example.test/%70rivate', 'https://example.test/private'],
    ['https://example.test/%7E', 'https://example.test/~'],
    ['https://example.test/%7e', 'https://example.test/~'],
    ['https://example.test/%2d', 'https://example.test/-'],
    ['https://example.test/%%370rivate', 'https://example.test/%2570rivate'],
    ['https://example.test/a%2fb', 'https://example.test/a%2Fb'],
    ['https://example.test/%20', 'https://example.test/%20'],
    ['https://example.test/a/%2E%2E/b', 'https://example.test/b'],
    ['https://example.test/?q=%41%2f', 'https://example.test/?q=A%2F'],
  ])('normalizes path and query escapes in %s to %s', (locator, canonical) => {
    expect(parseWebLocator(locator)).toEqual({ url: canonical });
  });

  it.each([
    'https://example.test/%70rivate',
    'https://example.test/%%370rivate',
    'https://example.test/%2570rivate',
    'https://example.test/a%2fb',
    'https://example.test/a/%2E%2E/b',
    'https://example.test/?q=%41%2f',
    'https://example.test/?q=bad%',
  ])('normalizes %s to a fixed point', (locator) => {
    const canonical = canonicalHref(new URL(locator));
    expect(canonicalHref(new URL(canonical))).toBe(canonical);
  });

  it('preserves an empty query delimiter as a fixed point', () => {
    const locator = 'https://a.test/b?';
    const canonical = canonicalHref(new URL(locator));

    expect(canonical).toBe(locator);
    expect(canonicalHref(new URL(canonical))).toBe(canonical);
    expect(parseWebLocator(locator)).toStrictEqual({ url: locator });
  });

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

  it('normalizes an uppercase scheme with the whole locator, selector included', () => {
    expect(parseWebLocator('HTTPS://example.test/guide:10-20')).toEqual({
      url: 'https://example.test/guide',
      selector: '10-20',
    });
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
