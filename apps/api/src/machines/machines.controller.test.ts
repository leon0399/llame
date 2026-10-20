/**
 * MachinesController — the two answers `GET /api/v1/machines` has. An instance
 * without a `machines` section has no Machine surface at all, so the endpoint
 * is a 404 rather than an empty list; with one, every configured Machine's view
 * maps to the response shape (the shape is asserted field by field, including
 * the registered roots, which are addressing information and nothing more).
 */

import { NotFoundException } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
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
    drizzle.mock({ schema }),
    new TenantDbService({
      transaction: async <T>(callback: (tx: Db) => Promise<T>) =>
        callback(drizzle.mock({ schema })),
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
        roots: [],
      },
    ]);
    expect(list).toHaveBeenCalledWith('user-1');
  });
});
