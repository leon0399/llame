import {
  expandRewriteTarget,
  parseRewriteTarget,
  type RewriteTarget,
} from './rewrite-target';

function parseTarget(target: string): RewriteTarget {
  const parsed = parseRewriteTarget(target);
  if ('error' in parsed) throw new Error(parsed.error);
  return parsed;
}

describe('parseRewriteTarget', () => {
  it('returns the declared origin, path prefix, and original template', () => {
    expect(
      parseRewriteTarget(
        'https://x.pcstyle.dev/prefix{path}?fixed=1&value={query}',
      ),
    ).toEqual({
      origin: 'https://x.pcstyle.dev',
      pathPrefix: '/prefix',
      template: '/prefix{path}?fixed=1&value={query}',
    });
  });

  it('allows a path placeholder directly after the origin', () => {
    expect(parseRewriteTarget('https://x.pcstyle.dev{path}')).toEqual({
      origin: 'https://x.pcstyle.dev',
      pathPrefix: '/',
      template: '{path}',
    });
  });
  it('normalizes the literal path prefix before expansion', () => {
    const target = parseTarget('https://x.pcstyle.dev/ü{path}');
    expect(expandRewriteTarget(target, new URL('https://x.com/a'))).toBe(
      'https://x.pcstyle.dev/%C3%BC/a',
    );
  });

  it.each([
    ['file:///tmp/x', 'absolute http or https'],
    ['https://user:secret@example.test/x', 'userinfo'],
    ['https://example.test/x#f', 'fragment'],
    [String.raw`https://example.test/a\b`, 'backslashes'],
    ['https://{path}.example.test/', 'placeholder'],
    ['https://example.test:{path}/', 'scheme, host, or port'],
    ['https://x{path}.example.test/', 'placeholder'],
    ['https://h{query}', 'placeholder'],
    ['https://example.test/{source}', 'unknown placeholder'],
    ['https://example.test/{path', 'unbalanced placeholder'],
    ['https://example.test/x?next={path}', 'path portion'],
  ])('rejects %s (%s)', (target, expected) => {
    const result = parseRewriteTarget(target);
    expect(result).toHaveProperty('error');
    if (!('error' in result)) throw new Error('expected target error');
    expect(result.error).toContain(expected);
  });
});

describe('expandRewriteTarget', () => {
  it('encodes the source query and retains literal target query text', () => {
    const target = parseTarget(
      'https://x.pcstyle.dev{path}?literal=kept&source={query}',
    );
    const source = new URL('https://x.com/a');
    Object.defineProperty(source, 'search', { value: '?/?#@&' });
    expect(expandRewriteTarget(target, source)).toBe(
      'https://x.pcstyle.dev/a?literal=kept&source=%2F%3F%23%40%26',
    );
  });

  it('keeps source pathname text as-is', () => {
    const target = parseTarget('https://x.pcstyle.dev{path}');
    expect(
      expandRewriteTarget(target, new URL('https://x.com/a&admin=1')),
    ).toBe('https://x.pcstyle.dev/a&admin=1');
  });

  it('returns undefined when the rebuilt URL leaves the declared origin or prefix', () => {
    const target = parseTarget('https://x.pcstyle.dev{path}');
    expect(
      expandRewriteTarget(
        { ...target, template: '@evil.example/a' },
        new URL('https://x.com/a'),
      ),
    ).toBeUndefined();
    expect(
      expandRewriteTarget(
        { ...target, pathPrefix: '/required' },
        new URL('https://x.com/a'),
      ),
    ).toBeUndefined();
  });
});
