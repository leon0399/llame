import { describe, expect, it } from 'vitest';

import { decodeFileAlias, isFileAlias } from './file-alias';

describe('isFileAlias', () => {
  it.each(['file:///x', 'FILE:///x', 'file:/x', 'file:x', 'file:'])(
    'recognizes %s',
    (value) => {
      expect(isFileAlias(value)).toBe(true);
    },
  );

  it.each(['files://x', 'fil', 'http://file:///x', ''])(
    'rejects %s',
    (value) => {
      expect(isFileAlias(value)).toBe(false);
    },
  );
});

describe('decodeFileAlias', () => {
  it.each([
    ['file:///tmp/guide.md', '/tmp/guide.md'],
    ['file://localhost/tmp/x', '/tmp/x'],
    ['file://LOCALHOST/tmp/x', '/tmp/x'],
    ['file:///', '/'],
    ['file:/tmp/x', '/tmp/x'],
    ['FILE:///x', '/x'],
    ['file:///tmp/%2e%2e/secret', '/tmp/../secret'],
    ['file:///tmp/notes%3A10-12', '/tmp/notes:10-12'],
    ['file:///tmp/a.md ', '/tmp/a.md '],
    ['file:///C|/x', '/C|/x'],
    ['file:///C:/x', '/C:/x'],
    ['file:////x', '//x'],
  ])('decodes %s to %s', (value, hostPath) => {
    expect(decodeFileAlias(value)).toEqual({ ok: true, hostPath });
  });

  const remoteMessage =
    'A file:// URL with a host other than localhost names another machine. ' +
    "Only this host's files are readable; write the absolute path instead.";

  it.each([
    'file://other.example/x',
    'file://C:/x',
    'file://C|/x',
    'file://%6Cocalhost/x',
  ])('rejects remote authority %s', (value) => {
    expect(decodeFileAlias(value)).toEqual({
      ok: false,
      message: remoteMessage,
    });
  });

  it.each([
    'file://',
    'file://localhost',
    'file:x',
    'file:',
    'file:///a?',
    'file:///a#',
    String.raw`file:///a\b`,
    'file:///a\tb',
    'file:///a\nb',
    'file:///a%FF',
    'file:///a%zz',
    'file:///a%2F',
    'file:///a%00',
    'file:///a\x7f',
  ])('rejects invalid alias %s', (value) => {
    expect(decodeFileAlias(value)).toMatchObject({ ok: false });
  });

  it('accepts literal non-ASCII characters', () => {
    expect(decodeFileAlias('file:///home/u/M\u00fcller/notes.md')).toEqual({
      ok: true,
      hostPath: '/home/u/M\u00fcller/notes.md',
    });
  });
});
