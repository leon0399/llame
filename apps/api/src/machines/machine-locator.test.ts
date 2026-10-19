import {
  formatMachineLocator,
  isMachineExecutorId,
  isMachineLocator,
  machineExecutorId,
  parseMachineExecutorId,
  parseMachineLocator,
} from './machine-locator';

describe('parseMachineLocator', () => {
  it('reads the bare list form', () => {
    expect(parseMachineLocator('machine://')).toEqual({ kind: 'list' });
    expect(parseMachineLocator('MACHINE://')).toEqual({ kind: 'list' });
  });

  it('reads the roots form and canonicalizes the name to lowercase', () => {
    expect(parseMachineLocator('machine://devl')).toEqual({
      kind: 'roots',
      name: 'devl',
    });
    expect(parseMachineLocator('MACHINE://Dev-L')).toEqual({
      kind: 'roots',
      name: 'dev-l',
    });
  });

  it('reads a path, decoding percent-escapes exactly once', () => {
    expect(
      parseMachineLocator('machine://devl/home/me/shop/README.md'),
    ).toEqual({
      kind: 'path',
      name: 'devl',
      path: '/home/me/shop/README.md',
    });
    expect(
      parseMachineLocator('MACHINE://DEVL/home/me/a%23b%3Fc%2525'),
    ).toEqual({
      kind: 'path',
      name: 'devl',
      path: '/home/me/a#b?c%25',
    });
  });

  it('splits the selector before decoding the path', () => {
    expect(
      parseMachineLocator('machine://devl/home/me/shop/README.md:1-5'),
    ).toEqual({
      kind: 'path',
      name: 'devl',
      path: '/home/me/shop/README.md',
      selector: '1-5',
    });
    // `:10-20:raw` is the shared grammar's canonical `raw:10-20` spelling.
    expect(parseMachineLocator('machine://devl/home/me/a:10-20:raw')).toEqual({
      kind: 'path',
      name: 'devl',
      path: '/home/me/a',
      selector: 'raw:10-20',
    });
    // A percent-encoded colon is part of the path, never a selector boundary.
    expect(parseMachineLocator('machine://devl/home/me/a%3A1-5')).toEqual({
      kind: 'path',
      name: 'devl',
      path: '/home/me/a:1-5',
    });
  });

  it('keeps a suffix that is not a read selector on the path', () => {
    expect(parseMachineLocator('machine://devl/home/me/notes:draft')).toEqual({
      kind: 'path',
      name: 'devl',
      path: '/home/me/notes:draft',
    });
    expect(parseMachineLocator('machine://devl/tmp/a:b/c')).toEqual({
      kind: 'path',
      name: 'devl',
      path: '/tmp/a:b/c',
    });
  });

  it('keeps ., .., and a trailing separator as written', () => {
    expect(parseMachineLocator('machine://devl/../home/./me/')).toEqual({
      kind: 'path',
      name: 'devl',
      path: '/../home/./me/',
    });
  });

  it('addresses the absolute root for machine://<name>/', () => {
    expect(parseMachineLocator('machine://devl/')).toEqual({
      kind: 'path',
      name: 'devl',
      path: '/',
    });
  });

  it('parses an unconfigured name without judging it', () => {
    expect(parseMachineLocator('machine://nope/etc/hostname')).toEqual({
      kind: 'path',
      name: 'nope',
      path: '/etc/hostname',
    });
  });

  it.each([
    ['machine:/etc/hostname', 'not a machine:// locator'],
    ['file:///etc/hostname', 'not a machine:// locator'],
    ['/etc/hostname', 'not a machine:// locator'],
    ['machine://Dev_L/etc', 'must name a Machine'],
    ['machine:///etc/hostname', 'must name a Machine'],
  ])('refuses %s', (value, message) => {
    const parsed = parseMachineLocator(value);
    expect(parsed.kind).toBe('invalid');
    if (parsed.kind !== 'invalid') throw new Error('unreachable');
    expect(parsed.message).toContain(message);
  });

  it.each([
    ['machine://devl/tmp/a#b', 'fragment'],
    ['machine://devl/tmp/a?b', 'query'],
    [String.raw`machine://devl/tmp/a\b`, 'backslash'],
    ['machine://devl/tmp/a%2Fb', 'separator'],
    ['machine://devl/tmp/a%00b', 'NUL'],
    ['machine://devl/tmp/a%ZZ', 'UTF-8'],
    ['machine://devl/tmp/a%ef%bf', 'UTF-8'],
  ])('refuses the path spelling %s', (value) => {
    expect(parseMachineLocator(value).kind).toBe('invalid');
  });

  it('keeps a suffix the shared grammar does not treat as a selector on the path', () => {
    expect(
      parseMachineLocator('machine://devl/home/me/notes:draft:raw'),
    ).toEqual({
      kind: 'path',
      name: 'devl',
      path: '/home/me/notes:draft',
      selector: 'raw',
    });
  });
});

describe('isMachineLocator', () => {
  it('accepts only the machine:// scheme, in any case', () => {
    expect(isMachineLocator('machine://devl/a')).toBe(true);
    expect(isMachineLocator('MaChInE://')).toBe(true);
    expect(isMachineLocator('machine:/devl')).toBe(false);
    expect(isMachineLocator('machines://devl')).toBe(false);
    expect(isMachineLocator('file:///a')).toBe(false);
  });
});

describe('formatMachineLocator', () => {
  it('re-encodes only the characters the grammar requires', () => {
    expect(formatMachineLocator('devl', '/home/me/shop/README.md')).toBe(
      'machine://devl/home/me/shop/README.md',
    );
    expect(formatMachineLocator('DEVL', '/home/me/a:b/c:d')).toBe(
      'machine://devl/home/me/a:b/c%3Ad',
    );
    expect(formatMachineLocator('devl', String.raw`/tmp/a#b?c%d\e`)).toBe(
      'machine://devl/tmp/a%23b%3Fc%25d%5Ce',
    );
    expect(formatMachineLocator('devl', '/tmp/a\u0007b')).toBe(
      'machine://devl/tmp/a%07b',
    );
    expect(formatMachineLocator('devl', '/tmp/a\u007fb')).toBe(
      'machine://devl/tmp/a%7Fb',
    );
  });

  it('appends a selector as written', () => {
    expect(formatMachineLocator('devl', '/home/me/shop/README.md', '1-5')).toBe(
      'machine://devl/home/me/shop/README.md:1-5',
    );
  });

  it.each([
    ['Dev_L', '/home/me/a'],
    ['devl', 'home/me/a'],
    ['devl', ''],
    ['devl', '/home/me/a\u0000b'],
  ])('refuses %s %s', (name, path) => {
    expect(formatMachineLocator(name, path)).toBeUndefined();
  });

  it('refuses a selector that is not a read selector', () => {
    expect(formatMachineLocator('devl', '/tmp/a', 'draft')).toBeUndefined();
    expect(formatMachineLocator('devl', '/tmp/a', 'raw')).toBe(
      'machine://devl/tmp/a:raw',
    );
  });

  it.each([
    '/home/me/shop/README.md',
    '/home/me/a#b',
    '/home/me/a?b',
    '/home/me/a%b',
    String.raw`/home/me/a\b`,
    '/home/me/a:b',
    '/home/me/a%23b',
    '/home/me/a%2Fb',
    '/a/../b/./c/',
    '/',
    '/\u0007\u007f\u001f',
    '/tmp/1-5:raw',
    '/tmp/notes:10-20',
  ])('round-trips %s through parse(format(x))', (path) => {
    const locator = formatMachineLocator('devl', path);
    expect(locator).toBeDefined();
    expect(parseMachineLocator(locator!)).toEqual({
      kind: 'path',
      name: 'devl',
      path,
    });
  });

  it('round-trips a path with its selector', () => {
    const locator = formatMachineLocator('devl', '/home/me/a:b', '1-5');
    expect(locator).toBe('machine://devl/home/me/a%3Ab:1-5');
    expect(parseMachineLocator(locator!)).toEqual({
      kind: 'path',
      name: 'devl',
      path: '/home/me/a:b',
      selector: '1-5',
    });
  });

  it('round-trips a path whose last segment looks like a selector', () => {
    const locator = formatMachineLocator('devl', '/tmp/10-20:raw');
    expect(locator).toBe('machine://devl/tmp/10-20%3Araw');
    expect(parseMachineLocator(locator!)).toEqual({
      kind: 'path',
      name: 'devl',
      path: '/tmp/10-20:raw',
    });
  });
});

describe('Machine executor ids', () => {
  it('builds and reads machine:<name>', () => {
    expect(machineExecutorId('devl')).toBe('machine:devl');
    expect(machineExecutorId('DEVL')).toBe('machine:devl');
    expect(parseMachineExecutorId('machine:devl')).toBe('devl');
    expect(parseMachineExecutorId('MACHINE:DEV-L')).toBe('dev-l');
  });

  it('refuses anything else', () => {
    expect(parseMachineExecutorId('machine:')).toBeUndefined();
    expect(parseMachineExecutorId('machine:Dev_L')).toBeUndefined();
    expect(parseMachineExecutorId('devl')).toBeUndefined();
    expect(parseMachineExecutorId('machines:devl')).toBeUndefined();
    expect(isMachineExecutorId('machine:devl')).toBe(true);
    expect(isMachineExecutorId('machine:dev_l')).toBe(false);
  });

  it('requires the prefix itself, not a name that starts at its length', () => {
    // 'aaaaaaaadevl' slices to 'devl', so a reader that skipped the prefix
    // check would claim a Machine here.
    expect(parseMachineExecutorId('aaaaaaaadevl')).toBeUndefined();
    expect(isMachineExecutorId('aaaaaaaadevl')).toBe(false);
  });
});
