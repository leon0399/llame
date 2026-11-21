/**
 * MachinesController — the two answers `GET /api/v1/machines` has. An instance
 * without a `machines` section has no Machine surface at all, so the endpoint
 * is a 404 rather than an empty list; with one, every configured Machine's view
 * maps to the response shape (the shape is asserted field by field, including
 * the registered roots, which are addressing information and nothing more).
 */

import { NotFoundException } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';

import { TenantDbService, type Db } from '../db/tenant-db.service';
import type { MachinesConfig } from '../instance-config/machines-config';

import { MachineConnector } from './machine-connector.service';
import { MachinesController } from './machines.controller';
import { MachinesService } from './machines.service';
import { type MachineStatusView } from './machines-status';
import { MachinesStatusRepository } from './machines-status.repository';

const MACHINES: MachinesConfig = {
  ssh: { knownHostsFile: '/etc/llame/machine_known_hosts' },
  hosts: { devl: { destination: 'box' } },
};

function makeController(enabled: boolean) {
  const connector = new MachineConnector({
    machines: enabled ? MACHINES : undefined,
    hubVersion: '9.9.9',
  });

  const status = new MachinesStatusRepository(
    drizzle.mock(),
    new TenantDbService({
      transaction: async <T>(callback: (tx: Db) => Promise<T>) =>
        callback(drizzle.mock()),
    }),
  );

  const machines = new MachinesService(connector, status);
  const list = vi.spyOn(machines, 'list');

  return { controller: new MachinesController(connector, machines), list };
}

describe('MachinesController.list', () => {
  it('answers 404 when the instance configures no Machines', async () => {
    const { controller, list } = makeController(false);

    await expect(controller.list('user-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(list).not.toHaveBeenCalled();
  });

  it('maps every configured Machine view to the response shape', async () => {
    const { controller, list } = makeController(true);

    const views: ReadonlyArray<MachineStatusView> = [
      {
        name: 'devl',
        status: 'online',
        lastSeenAt: '2026-10-19T09:59:00.000Z',
        failureReason: 'unreachable',
        hubProtocolVersion: 4,
        daemonProtocolVersion: 3,
        daemonVersion: '1.4.0',
        facts: {
          os: 'linux',
          arch: 'x64',
          kernel: '6.8.0-45-generic',
          cpuCount: 8,
          totalMemoryBytes: 16_000_000_000,
          rootDisks: [{ root: '/srv/work', totalBytes: 500_000_000_000 }],
        },
        factsCapturedAt: new Date('2026-10-19T09:58:30.000Z'),
        roots: ['/srv/work'],
      },
      {
        name: 'ci',
        status: 'offline',
        lastSeenAt: null,
        failureReason: null,
        hubProtocolVersion: 4,
        daemonProtocolVersion: null,
        daemonVersion: null,
        facts: null,
        factsCapturedAt: null,
        roots: [],
      },
    ];

    list.mockResolvedValue(views);

    await expect(controller.list('user-1')).resolves.toEqual([
      {
        name: 'devl',
        status: 'online',
        lastSeenAt: '2026-10-19T09:59:00.000Z',
        failureReason: 'unreachable',
        hubProtocolVersion: 4,
        daemonProtocolVersion: 3,
        daemonVersion: '1.4.0',
        facts: {
          os: 'linux',
          arch: 'x64',
          kernel: '6.8.0-45-generic',
          cpuCount: 8,
          totalMemoryBytes: 16_000_000_000,
          rootDisks: [{ root: '/srv/work', totalBytes: 500_000_000_000 }],
        },
        factsCapturedAt: '2026-10-19T09:58:30.000Z',
        roots: ['/srv/work'],
      },
      {
        name: 'ci',
        status: 'offline',
        lastSeenAt: null,
        failureReason: null,
        hubProtocolVersion: 4,
        daemonProtocolVersion: null,
        daemonVersion: null,
        facts: null,
        factsCapturedAt: null,
        roots: [],
      },
    ]);
    expect(list).toHaveBeenCalledWith('user-1');
  });

  it('never exposes the instance id the hub binds', async () => {
    const { controller, list } = makeController(true);

    list.mockResolvedValue([
      {
        name: 'devl',
        status: 'online',
        lastSeenAt: null,
        failureReason: null,
        hubProtocolVersion: 4,
        daemonProtocolVersion: 4,
        daemonVersion: '2.0.0',
        facts: {
          os: 'linux',
          arch: 'arm64',
          kernel: '6.8.0-45-generic',
          cpuCount: 4,
          totalMemoryBytes: 8_000_000_000,
          rootDisks: [{ root: '/srv/work', totalBytes: null }],
        },
        factsCapturedAt: new Date('2026-10-19T09:58:30.000Z'),
        roots: ['/srv/work'],
      },
    ]);

    const response = await controller.list('user-1');

    expect(JSON.stringify(response)).not.toContain('instanceId');
    expect(Object.keys(response[0] ?? {})).toEqual([
      'name',
      'status',
      'lastSeenAt',
      'failureReason',
      'hubProtocolVersion',
      'daemonProtocolVersion',
      'daemonVersion',
      'facts',
      'factsCapturedAt',
      'roots',
    ]);
  });
});
