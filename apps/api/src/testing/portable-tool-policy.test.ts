import { readFileSync } from 'node:fs';
import { BlockList } from 'node:net';
import path from 'node:path';

import { parse as parseJsonc } from 'jsonc-parser';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { compileRegexMatcher } from '../tools/permissions/matcher';
import { type PermissionClause } from '../tools/permissions/types';
import { PORTABLE_TOOL_PERMISSIONS } from './portable-tool-policy';

type AddressLocator = { readonly address: string; readonly locator: string };
type ExampleReadRejects = ReadonlyArray<PermissionClause>;
type ExampleConfig = {
  readonly tools: {
    readonly permissions: {
      readonly read: {
        readonly reject?: true | ExampleReadRejects;
      };
    };
  };
};

const examplePermissionClauseSchema = z.union([
  z.object({ field: z.string().min(1), literal: z.string().min(1) }).strict(),
  z.object({ field: z.string().min(1), regex: z.string().min(1) }).strict(),
  z.object({ allFields: z.literal(true), literal: z.string().min(1) }).strict(),
  z.object({ allFields: z.literal(true), regex: z.string().min(1) }).strict(),
]);
const examplePermissionMatcherSchema = z.union([
  z.literal(true),
  z.array(examplePermissionClauseSchema),
]);
const exampleConfigSchema = z
  .object({
    tools: z
      .object({
        permissions: z
          .object({
            read: z
              .object({
                reject: examplePermissionMatcherSchema.optional(),
              })
              .passthrough(),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

const INTERNAL_ADDRESSES = createInternalAddresses();
const ADDRESS_LOCATORS = createBoundaryAddressLocators();

function createInternalAddresses(): BlockList {
  const addresses = new BlockList();
  addresses.addSubnet('0.0.0.0', 8, 'ipv4');
  addresses.addSubnet('10.0.0.0', 8, 'ipv4');
  addresses.addSubnet('100.64.0.0', 10, 'ipv4');
  addresses.addSubnet('127.0.0.0', 8, 'ipv4');
  addresses.addSubnet('169.254.0.0', 16, 'ipv4');
  addresses.addSubnet('172.16.0.0', 12, 'ipv4');
  addresses.addSubnet('192.168.0.0', 16, 'ipv4');
  addresses.addAddress('::', 'ipv6');
  addresses.addAddress('::1', 'ipv6');
  addresses.addSubnet('fc00::', 7, 'ipv6');
  addresses.addSubnet('fe80::', 10, 'ipv6');
  return addresses;
}

function appendAddressLocators(
  result: Array<AddressLocator>,
  seen: Set<string>,
  address: string,
  hostname: string,
): void {
  for (const port of ['', ':8080']) {
    const locator = `http://${hostname}${port}/`;
    if (seen.has(locator)) continue;
    seen.add(locator);
    result.push({ address, locator });
  }
}

function appendIpv6Locators(
  result: Array<AddressLocator>,
  seen: Set<string>,
  address: string,
): void {
  const hostname = new URL(`http://[${address}]/`).hostname;
  appendAddressLocators(result, seen, hostname.slice(1, -1), hostname);
}

function appendIpv4BoundaryLocators(
  result: Array<AddressLocator>,
  seen: Set<string>,
): void {
  for (let first = 0; first <= 255; first += 1) {
    for (let second = 0; second <= 255; second += 1) {
      for (const tail of ['0.1', '255.254']) {
        const address = `${first}.${second}.${tail}`;
        appendAddressLocators(result, seen, address, address);
      }
    }
  }
}

function createIpv6FirstHextets(): Set<number> {
  const hextets = new Set<number>();
  for (let value = 0; value <= 0x1f; value += 1) hextets.add(value);
  for (let highByte = 0; highByte <= 0xff; highByte += 1) {
    hextets.add(highByte << 8);
    hextets.add((highByte << 8) | 0xff);
  }
  for (let value = 0xfb_00; value <= 0xff_ff; value += 1) hextets.add(value);
  return hextets;
}

function appendIpv6BoundaryLocators(
  result: Array<AddressLocator>,
  seen: Set<string>,
): void {
  const suffixes = ['::1', ':0:0:0:0:0:0:1', '::'];
  for (const firstHextet of createIpv6FirstHextets()) {
    const prefix = firstHextet.toString(16);
    for (const suffix of suffixes) {
      appendIpv6Locators(result, seen, `${prefix}${suffix}`);
    }
  }

  for (const address of [
    '::1',
    '::',
    '::2',
    '::1:2',
    '::a',
    '::ffff',
    '1::',
    '::1:0:0:1',
  ]) {
    appendIpv6Locators(result, seen, address);
  }
}

function createBoundaryAddressLocators(): ReadonlyArray<AddressLocator> {
  const result: Array<AddressLocator> = [];
  const seen = new Set<string>();
  appendIpv4BoundaryLocators(result, seen);
  appendIpv6BoundaryLocators(result, seen);
  return result;
}

function readRegexRejects(): Array<string> {
  const rejects = PORTABLE_TOOL_PERMISSIONS.read.reject;
  if (rejects === undefined || rejects === true) {
    throw new Error('portable read rejects are missing');
  }
  return rejects.flatMap((clause) =>
    'field' in clause && clause.field === 'path' && 'regex' in clause
      ? [clause.regex]
      : [],
  );
}

function exampleReadRejects(): ExampleReadRejects {
  const document: ExampleConfig = exampleConfigSchema.parse(
    parseJsonc(
      readFileSync(
        path.resolve(__dirname, '../../llame.config.json.example'),
        'utf8',
      ),
    ),
  );
  const rejects = document.tools.permissions.read.reject;
  if (rejects === undefined || rejects === true) {
    throw new Error('example read rejects are missing');
  }
  return rejects;
}

describe('portable web address policy', () => {
  const f5Patterns = readRegexRejects().filter((pattern) =>
    pattern.startsWith('^http://'),
  );
  const f5Matchers = f5Patterns.map((pattern) =>
    compileRegexMatcher(pattern, 'tools.permissions.read.reject'),
  );

  // The sweep is exhaustive over the first two IPv4 octets (about 270,000
  // checks), which exceeds the default timeout under coverage instrumentation.
  it(
    'matches exactly the public addresses in the generated boundaries',
    {
      timeout: 60_000,
    },
    () => {
      expect(f5Patterns).toHaveLength(6);
      const mismatches: Array<string> = [];
      for (const { address, locator } of ADDRESS_LOCATORS) {
        const rejected = f5Matchers.some((matcher) =>
          matcher.matchesExact(locator),
        );
        const expected = !INTERNAL_ADDRESSES.check(
          address,
          address.includes(':') ? 'ipv6' : 'ipv4',
        );
        if (rejected !== expected) mismatches.push(locator);
      }
      expect(mismatches).toEqual([]);
    },
  );

  it('does not match hostname text with any F5 row', () => {
    const hostnames = [
      'http://localhost:3000/',
      'http://nas.lan/',
      'http://example.com/',
      'http://1e100.net/',
      'http://10.example/',
    ];
    const matches = hostnames.filter((locator) =>
      f5Matchers.some((matcher) => matcher.matchesExact(locator)),
    );
    expect(matches).toEqual([]);
  });

  it('matches only the listed metadata and credential endpoints with F7', () => {
    const f7Pattern = readRegexRejects().find((pattern) =>
      pattern.startsWith(String.raw`^https?://(?:169\.254\.169\.254`),
    );
    if (f7Pattern === undefined) throw new Error('F7 is missing');
    const matcher = compileRegexMatcher(
      f7Pattern,
      'tools.permissions.read.reject',
    );

    for (const locator of [
      'http://169.254.169.254/latest',
      'https://169.254.169.254:80/x',
      'http://169.254.170.2/v2/credentials',
      'http://169.254.0.23/',
      'https://100.100.100.200/latest',
      'https://[fd00:ec2::254]/x',
    ]) {
      expect(matcher.matchesExact(locator)).toBe(true);
    }
    for (const locator of [
      'http://169.254.169.25/x',
      'http://169.254.170.20/',
      'http://100.100.100.2000/',
    ]) {
      expect(matcher.matchesExact(locator)).toBe(false);
    }
  });

  it('keeps the example read rejects identical to the portable mirror', () => {
    expect(exampleReadRejects()).toEqual(PORTABLE_TOOL_PERMISSIONS.read.reject);
  });
});
