import {
  PROTOCOL_VERSION,
  type JsonValue,
  type SerializableRecord,
} from '@workspace/machine-protocol';

import {
  MACHINE_ROOT_MAX_LENGTH,
  MACHINE_ROOTS_LIMIT,
  MACHINE_VERSION_MAX_LENGTH,
} from './machines-status';
import { readHelloResult } from './machine-hello';

/** A full protocol-2 handshake: identity, build, and static facts included. */
const FACTS = {
  os: 'linux',
  arch: 'x64',
  kernel: '6.8.0-45-generic',
  cpuCount: 8,
  totalMemoryBytes: 16 * 1024 ** 3,
  rootDisks: [{ root: '/srv/app', totalBytes: 512 * 1024 ** 3 }],
};

function hello(overrides: SerializableRecord = {}): SerializableRecord {
  return {
    protocolVersion: PROTOCOL_VERSION,
    daemonVersion: '0.0.1',
    roots: ['/srv/app', '/home/me'],
    instanceId: '00000000-0000-4000-8000-000000000001',
    buildId: '0123456789ab',
    facts: FACTS,
    ...overrides,
  };
}

describe('readHelloResult', () => {
  it('accepts a full protocol-2 handshake and rebuilds it', () => {
    expect(readHelloResult(hello())).toEqual({
      protocolVersion: PROTOCOL_VERSION,
      daemonVersion: '0.0.1',
      roots: ['/srv/app', '/home/me'],
      instanceId: '00000000-0000-4000-8000-000000000001',
      buildId: '0123456789ab',
      facts: FACTS,
    });
  });

  it('carries the git methods a daemon lists', () => {
    expect(
      readHelloResult(
        hello({ methods: ['git.state', 'git.status', 'git.inspect'] }),
      ),
    ).toEqual({
      protocolVersion: PROTOCOL_VERSION,
      daemonVersion: '0.0.1',
      roots: ['/srv/app', '/home/me'],
      instanceId: '00000000-0000-4000-8000-000000000001',
      buildId: '0123456789ab',
      facts: FACTS,
      // Rebuilt from the protocol's own vocabulary, so an unknown method a
      // daemon names cannot reach a hub-side check.
      methods: ['git.inspect', 'git.state'],
    });
  });

  it.each([[['fs.read', 'git']], [[7]], ['git.inspect'], [null]])(
    'reads a malformed method list as absent, keeping the handshake usable',
    (methods) => {
      expect(readHelloResult(hello({ methods }))).toEqual({
        protocolVersion: PROTOCOL_VERSION,
        daemonVersion: '0.0.1',
        roots: ['/srv/app', '/home/me'],
        instanceId: '00000000-0000-4000-8000-000000000001',
        buildId: '0123456789ab',
        facts: FACTS,
      });
    },
  );

  const MALFORMED: ReadonlyArray<JsonValue> = [
    null,
    'hello',
    [],
    {},
    { protocolVersion: 2 },
    { protocolVersion: 2, daemonVersion: 'x' },
    { protocolVersion: 2, daemonVersion: 'x', roots: 'not-an-array' },
    { protocolVersion: 2, daemonVersion: 'x', roots: ['/a', 7] },
    hello({ protocolVersion: '2' }),
    hello({ protocolVersion: 1.5 }),
    hello({ protocolVersion: -1 }),
    hello({ daemonVersion: 7 }),
  ];

  it.each(MALFORMED)('refuses %j', (value) => {
    expect(readHelloResult(value)).toBeUndefined();
  });

  it.each([
    ['an uppercase id', { instanceId: '00000000-0000-4000-8000-00000000000A' }],
    [
      'a version-1 UUID',
      { instanceId: '00000000-0000-1000-8000-000000000001' },
    ],
    ['a malformed id', { instanceId: 'not-a-uuid' }],
    ['a non-string id', { instanceId: 7 }],
    ['a missing id', { instanceId: undefined }],
  ])('refuses %s', (_label, override) => {
    expect(readHelloResult(hello(override))).toBeUndefined();
  });

  it.each([
    ['eleven hex chars', '0123456789a'],
    ['thirteen hex chars', '0123456789abc'],
    ['uppercase hex', '0123456789AB'],
    ['a word other than unknown', 'UNKNOWN'],
  ])('refuses a build id of %s', (_label, buildId) => {
    expect(readHelloResult(hello({ buildId }))).toBeUndefined();
  });

  it.each([
    ['a non-string build id', 7],
    ['a missing build id', undefined],
  ])('refuses %s', (_label, buildId) => {
    expect(readHelloResult(hello({ buildId }))).toBeUndefined();
  });

  it('accepts the build id "unknown", which a daemon reports without a build', () => {
    expect(readHelloResult(hello({ buildId: 'unknown' }))?.buildId).toBe(
      'unknown',
    );
  });

  it.each([
    ['no facts', { facts: undefined }],
    ['null facts', { facts: null }],
    ['a string', { facts: 'linux' }],
    ['an empty os', { facts: { ...FACTS, os: '' } }],
    [
      'an os past the bound',
      { facts: { ...FACTS, os: 'o'.repeat(MACHINE_VERSION_MAX_LENGTH + 1) } },
    ],
    ['a non-string arch', { facts: { ...FACTS, arch: 7 } }],
    ['a missing kernel', { facts: { ...FACTS, kernel: undefined } }],
    ['a negative cpu count', { facts: { ...FACTS, cpuCount: -1 } }],
    ['a fractional cpu count', { facts: { ...FACTS, cpuCount: 1.5 } }],
    [
      'an unsafe cpu count',
      { facts: { ...FACTS, cpuCount: Number.MAX_SAFE_INTEGER + 1 } },
    ],
    ['a negative memory total', { facts: { ...FACTS, totalMemoryBytes: -1 } }],
    ['a non-array disk list', { facts: { ...FACTS, rootDisks: '/srv' } }],
  ])('refuses %s', (_label, override) => {
    expect(readHelloResult(hello(override))).toBeUndefined();
  });

  it('refuses more root disks than the roots limit', () => {
    const rootDisks = Array.from(
      { length: MACHINE_ROOTS_LIMIT + 1 },
      (_, index) => ({ root: `/r/${index}`, totalBytes: null }),
    );

    expect(
      readHelloResult(hello({ facts: { ...FACTS, rootDisks } })),
    ).toBeUndefined();
  });

  it.each([
    ['an empty root', { root: '', totalBytes: null }],
    [
      'a root past the bound',
      { root: `/${'x'.repeat(MACHINE_ROOT_MAX_LENGTH)}`, totalBytes: null },
    ],
    ['a missing total', { root: '/srv/app' }],
    ['a negative total', { root: '/srv/app', totalBytes: -1 }],
    ['a fractional total', { root: '/srv/app', totalBytes: 1.5 }],
    ['an entry that is not an object', '/srv/app'],
  ])('refuses a root disk with %s', (_label, disk) => {
    expect(
      readHelloResult(hello({ facts: { ...FACTS, rootDisks: [disk] } })),
    ).toBeUndefined();
  });

  it('keeps a root disk whose statfs failed as an explicit null', () => {
    expect(
      readHelloResult(
        hello({
          facts: {
            ...FACTS,
            rootDisks: [{ root: '/srv/app', totalBytes: null }],
          },
        }),
      )?.facts.rootDisks,
    ).toEqual([{ root: '/srv/app', totalBytes: null }]);
  });

  it('drops every key the protocol does not define', () => {
    const read = readHelloResult(hello({ extra: 'ignored', secrets: ['x'] }));

    expect(read).toBeDefined();
    expect(Object.keys(read ?? {}).sort()).toEqual([
      'buildId',
      'daemonVersion',
      'facts',
      'instanceId',
      'protocolVersion',
      'roots',
    ]);
  });
});
