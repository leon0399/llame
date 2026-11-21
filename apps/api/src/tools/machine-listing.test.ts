import { drizzle } from 'drizzle-orm/postgres-js';

import { type Db } from '../db/tenant-db.service';
import { MachineConnector } from '../machines/machine-connector.service';
import { type MachineStatusView } from '../machines/machines-status';
import { configuredMachines } from './machine-listing';
import { type ToolContext } from './types';

const MACHINES = {
  ssh: { knownHostsFile: '/etc/llame/machine_known_hosts' },
  hosts: {
    devl: { destination: 'box' },
    gpu: { destination: 'me@gpu.lan:2222' },
  },
};

/** The facts a handshake reports: the listing shows only the OS and arch. */
const FACTS = {
  os: 'linux',
  arch: 'x64',
  kernel: '6.8.0-45-generic',
  cpuCount: 8,
  totalMemoryBytes: 16_000_000_000,
  rootDisks: [{ root: '/srv/app', totalBytes: 500_000_000_000 }],
} as const;

const STATUS: ReadonlyArray<MachineStatusView> = [
  {
    name: 'devl',
    status: 'online',
    lastSeenAt: '2026-10-18T00:00:00.000Z',
    failureReason: null,
    hubProtocolVersion: 1,
    daemonProtocolVersion: 1,
    daemonVersion: '1.0.0',
    facts: FACTS,
    factsCapturedAt: new Date('2026-10-18T00:00:00.000Z'),
    roots: ['/srv/app'],
  },
  {
    name: 'gpu',
    status: 'offline',
    lastSeenAt: null,
    failureReason: 'unreachable',
    hubProtocolVersion: 1,
    daemonProtocolVersion: null,
    daemonVersion: null,
    facts: null,
    factsCapturedAt: null,
    roots: [],
  },
];

function connector(): MachineConnector {
  return new MachineConnector({
    machines: MACHINES,
    hubVersion: '9.9.9',
    bindIdentity: () => Promise.resolve('match'),
  });
}

function context(
  machines: MachineConnector,
  overrides: Partial<ToolContext> = {},
): ToolContext {
  const db: Db = drizzle.mock();

  return {
    userId: 'owner',
    chatId: 'chat',
    nativeDeliverySequence: 1,
    toolCallId: 'call',
    tenantDb: {
      runAs: <T>(_userId: string, callback: (tx: Db) => Promise<T>) =>
        callback(db),
    },
    machines,
    machineStatus: { list: () => Promise.resolve(STATUS) },
    ...overrides,
    configuredCredentials: overrides.configuredCredentials ?? [],
  };
}

describe('configuredMachines', () => {
  it('lists the configured Machines with their status and no route', async () => {
    const machines = connector();

    const result = await configuredMachines(context(machines), machines);

    expect(result).toMatchObject({
      status: 'success',
      kind: 'directory',
      path: 'machine://',
      content:
        '- machine://devl (online, linux/x64)\n' +
        '- machine://gpu (offline, unreachable)',
    });
    expect(JSON.stringify(result)).not.toContain('box');
    expect(JSON.stringify(result)).not.toContain('gpu.lan');
  });

  it('lists each status and failure form with the OS and architecture', async () => {
    const machines = connector();

    const row = (overrides: Partial<MachineStatusView>): MachineStatusView => ({
      name: 'devl',
      status: 'online',
      lastSeenAt: '2026-10-18T00:00:00.000Z',
      failureReason: null,
      hubProtocolVersion: 2,
      daemonProtocolVersion: 2,
      daemonVersion: '0.0.2',
      facts: FACTS,
      factsCapturedAt: new Date('2026-10-18T00:00:00.000Z'),
      roots: ['/srv/app'],
      ...overrides,
    });

    const cases: ReadonlyArray<{
      readonly status: MachineStatusView;
      readonly line: string;
    }> = [
      { status: row({}), line: '(online, linux/x64)' },
      {
        status: row({ status: 'offline', facts: null }),
        line: '(offline)',
      },
      {
        status: row({
          status: 'offline',
          failureReason: 'incompatible_version',
        }),
        line: '(offline, update required, linux/x64)',
      },
      {
        status: row({ status: 'offline', failureReason: 'auth_failed' }),
        line: '(offline, auth_failed, linux/x64)',
      },
      {
        status: row({
          status: 'offline',
          failureReason: 'identity_mismatch',
        }),
        line: '(offline, identity_mismatch, linux/x64)',
      },
      {
        status: row({ status: 'offline', failureReason: null }),
        line: '(offline, linux/x64)',
      },
    ];

    for (const { status, line } of cases) {
      const result = await configuredMachines(
        context(machines, {
          machineStatus: { list: () => Promise.resolve([status]) },
        }),
        machines,
      );

      expect(result).toMatchObject({
        content: `- machine://devl ${line}\n- machine://gpu`,
      });
      // The instance id and the kernel never reach a listing.
      expect(JSON.stringify(result)).not.toContain('ffffffff');
      expect(JSON.stringify(result)).not.toContain('6.8.0');
    }
  });

  it('lists the names without status when no reader is supplied', async () => {
    const machines = connector();

    const result = await configuredMachines(
      context(machines, { machineStatus: undefined }),
      machines,
    );

    expect(result).toMatchObject({
      content: '- machine://devl\n- machine://gpu',
    });
  });
});
