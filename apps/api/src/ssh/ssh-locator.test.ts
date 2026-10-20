import {
  formatSshLocator,
  parseSshLocator,
  SSH_LOCATOR_HELP,
} from './ssh-locator';

function pathOf(value: string) {
  const parsed = parseSshLocator(value);
  if (parsed.kind !== 'path') {
    throw new Error(`expected a path locator for ${value}`);
  }
  return parsed;
}

describe('parseSshLocator destinations', () => {
  it('accepts an explicit user, port, and IPv6 literal in an uppercase scheme', () => {
    const parsed = pathOf('SSH://Deploy@[2001:DB8::1]:2222/etc/hostname');
    expect(parsed.destination).toEqual({
      user: 'Deploy',
      host: '2001:db8::1',
      port: 2222,
    });
    expect(parsed.path).toBe('/etc/hostname');
  });

  it('lowercases a name host and accepts an IPv6 literal without a user', () => {
    expect(pathOf('ssh://Box/etc/hostname').destination).toEqual({
      host: 'box',
    });
    expect(pathOf('ssh://[::1]/etc/hostname').destination).toEqual({
      host: '::1',
    });
  });

  it('carries no user or port property when the locator wrote neither', () => {
    expect(parseSshLocator('ssh://Box/etc/hostname')).toStrictEqual({
      kind: 'path',
      destination: { host: 'box' },
      path: '/etc/hostname',
    });
    expect(parseSshLocator('ssh://[::1]/etc/hostname')).toStrictEqual({
      kind: 'path',
      destination: { host: '::1' },
      path: '/etc/hostname',
    });
  });

  it('accepts a one-character user and keeps it on the destination', () => {
    expect(parseSshLocator('ssh://a@box/etc/hostname')).toStrictEqual({
      kind: 'path',
      destination: { user: 'a', host: 'box' },
      path: '/etc/hostname',
    });
  });

  it('refuses a name host that begins with an option marker', () => {
    const host = parseSshLocator('ssh://-box/etc/hostname');
    expect(host.kind).toBe('invalid');
    expect(host.kind === 'invalid' && host.message).toContain('ssh host');
  });

  it('refuses a bracketed literal that is not IPv6', () => {
    const parsed = parseSshLocator('ssh://[abc]/etc/hostname');
    expect(parsed.kind).toBe('invalid');
    expect(parsed.kind === 'invalid' && parsed.message).toContain('ssh host');
  });

  it('refuses an IPv6 literal with no closing bracket', () => {
    const parsed = parseSshLocator('ssh://[::1/etc/hostname');
    expect(parsed.kind).toBe('invalid');
    expect(parsed.kind === 'invalid' && parsed.message).toContain('ssh host');
  });

  it('refuses a port suffix that does not begin with a colon', () => {
    const parsed = parseSshLocator('ssh://[::1]x2222/etc/hostname');
    expect(parsed.kind).toBe('invalid');
    expect(parsed.kind === 'invalid' && parsed.message).toContain('ssh port');
  });

  it('refuses an option-shaped host before anything resolves', () => {
    const parsed = parseSshLocator('ssh://-oProxyCommand=id/etc/hostname');
    expect(parsed.kind).toBe('invalid');
    expect(parsed.kind === 'invalid' && parsed.message).toContain('host');
  });

  it.each([
    ['a percent expansion in a name', 'ssh://bo%78/etc/hostname'],
    ['an IPv6 zone', 'ssh://[fe80::1%25eth0]/etc/hostname'],
    ['unbracketed IPv6', 'ssh://2001:db8::1/etc/hostname'],
    ['a shell metacharacter', 'ssh://bo;x/etc/hostname'],
    ['a slash in the authority', 'ssh://box@/etc/hostname'],
  ])('refuses %s', (_label, value) => {
    expect(parseSshLocator(value).kind).toBe('invalid');
  });

  it.each([
    ['an empty user', 'ssh://@box/etc/hostname'],
    ['a shell metacharacter', 'ssh://a;id@box/etc/hostname'],
    ['an option-shaped user', 'ssh://-u@box/etc/hostname'],
    ['a doubled user delimiter', 'ssh://me@@box/etc/hostname'],
  ])('refuses %s', (_label, value) => {
    expect(parseSshLocator(value).kind).toBe('invalid');
  });

  it('refuses a password and says passwords are not accepted', () => {
    const parsed = parseSshLocator('ssh://root:secret@box/etc/hostname');
    expect(parsed.kind).toBe('invalid');
    if (parsed.kind !== 'invalid') throw new Error('expected a refusal');
    expect(parsed.message).toContain('password');
  });

  it.each([
    ['an empty port', 'ssh://box:/etc/hostname'],
    ['port zero', 'ssh://box:0/etc/hostname'],
    ['a port above 65535', 'ssh://box:65536/etc/hostname'],
    ['a non-numeric port', 'ssh://box:ssh/etc/hostname'],
    ['a port that only starts with digits', 'ssh://box:0x10/etc/hostname'],
    ['an empty IPv6 port', 'ssh://[::1]:/etc/hostname'],
  ])('refuses %s', (_label, value) => {
    expect(parseSshLocator(value).kind).toBe('invalid');
  });

  it('accepts port 1', () => {
    expect(pathOf('ssh://box:1/etc/hostname').destination.port).toBe(1);
  });

  it('accepts port 65535', () => {
    expect(pathOf('ssh://box:65535/etc/hostname').destination.port).toBe(
      65_535,
    );
  });
});

describe('parseSshLocator paths', () => {
  it('decodes percent escapes once and re-encodes the same locator', () => {
    const parsed = pathOf('ssh://box/srv/a%23b.txt');
    expect(parsed.path).toBe('/srv/a#b.txt');
    expect(formatSshLocator(parsed.destination, parsed.path)).toBe(
      'ssh://box/srv/a%23b.txt',
    );
  });

  it('splits a read selector off the raw text and keeps it a selector', () => {
    const parsed = pathOf('ssh://box/etc/os-release:2-3');
    expect(parsed.path).toBe('/etc/os-release');
    expect(parsed.selector).toBe('2-3');
    expect(
      formatSshLocator(parsed.destination, parsed.path, parsed.selector),
    ).toBe('ssh://box/etc/os-release:2-3');
  });

  it('treats a suffix that is not a read selector as part of the path', () => {
    const parsed = pathOf('ssh://box/notes:draft');
    expect(parsed.path).toBe('/notes:draft');
    expect(parsed.selector).toBeUndefined();
  });

  it('keeps dot segments and a trailing separator as written', () => {
    const parsed = pathOf('ssh://box/var/log/../../etc/shadow');
    expect(parsed.path).toBe('/var/log/../../etc/shadow');
    expect(formatSshLocator(parsed.destination, parsed.path)).toBe(
      'ssh://box/var/log/../../etc/shadow',
    );
    expect(pathOf('ssh://box/srv/').path).toBe('/srv/');
  });

  it('refuses a missing path and tells the model to give an absolute one', () => {
    const parsed = parseSshLocator('ssh://box');
    expect(parsed.kind).toBe('invalid');
    if (parsed.kind !== 'invalid') throw new Error('expected a refusal');
    expect(parsed.message).toContain('absolute path');
  });

  it('refuses an empty authority and says the locator must name a host', () => {
    const parsed = parseSshLocator('ssh:///etc/hostname');
    expect(parsed).toEqual({
      kind: 'invalid',
      message: 'An ssh:// locator must name a host.',
    });
  });

  it('refuses text that is not an ssh:// locator at all', () => {
    expect(parseSshLocator('file:///etc/hostname')).toEqual({
      kind: 'invalid',
      message: 'This path is not an ssh:// locator.',
    });
  });

  it.each([
    ['an encoded slash', 'ssh://box/srv%2Fx'],
    ['an encoded NUL', 'ssh://box/srv%00x'],
    ['a literal query', 'ssh://box/srv?x'],
    ['a literal fragment', 'ssh://box/srv#x'],
    ['a backslash', String.raw`ssh://box/srv\x`],
    ['a control character', 'ssh://box/srv\u0001x'],
  ])('refuses %s', (_label, value) => {
    expect(parseSshLocator(value).kind).toBe('invalid');
  });

  it('round-trips a path whose last segment carries a colon', () => {
    const parsed = pathOf('ssh://box/srv/a:b');
    expect(formatSshLocator(parsed.destination, parsed.path)).toBe(
      'ssh://box/srv/a%3Ab',
    );
  });
});

describe('bare ssh locators', () => {
  it('gives the same fixed message for ssh:// and ssh:///', () => {
    expect(parseSshLocator('ssh://')).toEqual({ kind: 'help' });
    expect(parseSshLocator('ssh:///')).toEqual({ kind: 'help' });
    expect(SSH_LOCATOR_HELP).toContain('Permissions select');
    expect(SSH_LOCATOR_HELP).toContain('does not list hosts');
  });
});

describe('formatSshLocator', () => {
  it('renders a default user and port with a bracketed IPv6 host', () => {
    expect(
      formatSshLocator(
        { user: 'deploy', host: '2001:db8::1', port: 22 },
        '/etc/hosts',
      ),
    ).toBe('ssh://deploy@[2001:db8::1]:22/etc/hosts');
  });

  it('refuses parts outside the grammar', () => {
    expect(
      formatSshLocator({ host: '-oProxyCommand=id' }, '/x'),
    ).toBeUndefined();
    expect(
      formatSshLocator({ host: 'box', user: 'a;id' }, '/x'),
    ).toBeUndefined();
    expect(formatSshLocator({ host: 'box', port: 0 }, '/x')).toBeUndefined();
    expect(formatSshLocator({ host: 'box' }, 'relative')).toBeUndefined();
    expect(formatSshLocator({ host: 'box' }, '/x\u0000y')).toBeUndefined();
  });

  it.each([
    ['a name host with a punctuation character', { host: 'box;x' }],
    ['a name host that begins with an option marker', { host: '-box' }],
    ['a user that begins with an option marker', { host: 'box', user: '-u' }],
    ['an IPv6 literal with a zone', { host: 'fe80::1%eth0' }],
  ])('refuses %s', (_label, destination) => {
    expect(formatSshLocator(destination, '/x')).toBeUndefined();
  });

  it.each([
    [1, 'ssh://box:1/x'],
    [65_535, 'ssh://box:65535/x'],
  ])('renders port %s at the edge of the range', (port, expected) => {
    expect(formatSshLocator({ host: 'box', port }, '/x')).toBe(expected);
  });

  it('refuses a port above 65535 and a suffix that is not a read selector', () => {
    expect(
      formatSshLocator({ host: 'box', port: 65_536 }, '/x'),
    ).toBeUndefined();
    expect(formatSshLocator({ host: 'box' }, '/x', 'draft')).toBeUndefined();
  });
});
