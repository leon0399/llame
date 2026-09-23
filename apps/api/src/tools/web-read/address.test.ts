import { describe, expect, it } from 'vitest';

import {
  addressLocator,
  canonicalAddress,
  hostLiteralAddress,
} from './address';

describe('web-read address canonicalization', () => {
  it.each([
    ['https://127.0.0.1/path', '127.0.0.1'],
    ['https://[::1]/path', '::1'],
    ['https://[::ffff:7f00:1]/path', '::ffff:7f00:1'],
    ['https://docs.example.test/path', undefined],
  ] as const)('extracts the IP literal from %s', (text, expected) => {
    expect(hostLiteralAddress(new URL(text))).toBe(expected);
  });

  it.each([
    ['93.184.216.34', '93.184.216.34', '93.184.216.34'],
    ['0.0.0.0', '0.0.0.0', '0.0.0.0'],
    ['::', '::', '[::]'],
    ['::1', '::1', '[::1]'],
    ['2001:0DB8:0:0:0:0:0:1', '2001:db8::1', '[2001:db8::1]'],
    ['fe80::ABCD%eth0', 'fe80::abcd', '[fe80::abcd]'],
    ['::ffff:10.67.88.60', '10.67.88.60', '10.67.88.60'],
    ['::FFFF:a43:583c', '10.67.88.60', '10.67.88.60'],
  ])('canonicalizes %s', (address, text, host) => {
    expect(canonicalAddress(address)).toStrictEqual({ text, host });
  });

  it('replaces the host while keeping the requested port, path, and query', () => {
    expect(
      addressLocator(
        'https://docs.example.test:8443/private/page?q=one#section',
        '93.184.216.34',
      ),
    ).toBe('https://93.184.216.34:8443/private/page?q=one');
  });

  it('writes IPv4-mapped IPv6 addresses as dotted IPv4', () => {
    expect(
      addressLocator('https://docs.example.test/guide', '::ffff:a43:583c'),
    ).toBe('https://10.67.88.60/guide');
  });

  it('brackets a canonical IPv6 address and keeps a non-default port', () => {
    expect(
      addressLocator(
        'http://docs.example.test:8080/guide?mode=raw',
        '2001:0db8::1',
      ),
    ).toBe('http://[2001:db8::1]:8080/guide?mode=raw');
  });
});
