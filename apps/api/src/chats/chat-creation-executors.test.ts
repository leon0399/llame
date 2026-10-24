import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { type Checkout } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import {
  BUILT_IN_DEFAULTS,
  type LlameConfig,
} from '../instance-config/llame-config';
import { type MachineStatusView } from '../machines/machines-status';
import { ProjectLinksRepository } from '../projects/project-links.repository';
import {
  creationLocationSource,
  executorOnline,
  executorTarget,
  isConfiguredExecutor,
} from './chat-creation-executors';

/*
 * Executor identity for chat creation (openspec `chat-start-location`):
 * whether the configuration provides an id, whether it can run now, the typed
 * target one resolved location runs on, and the resolver source that drops an
 * offline Machine from an implicit step.
 */

const OWNER = 'owner-a';
const REPOSITORY_ID = '22222222-2222-4222-8222-222222222222';

function config(
  tools: Partial<LlameConfig['tools']> = {},
  machines?: LlameConfig['machines'],
): LlameConfig {
  return {
    ...BUILT_IN_DEFAULTS,
    ...(machines !== undefined && { machines }),
    tools: {
      ...BUILT_IN_DEFAULTS.tools,
      nativeExecutorId: 'host',
      ...tools,
    },
  };
}

const MACHINES = {
  ssh: { knownHostsFile: '/dev/null' },
  hosts: {
    nas: { destination: 'nas.example' },
    attic: { destination: 'attic.example' },
  },
} satisfies NonNullable<LlameConfig['machines']>;

function machineView(
  name: string,
  status: MachineStatusView['status'],
): MachineStatusView {
  return {
    name,
    status,
    lastSeenAt: null,
    failureReason: null,
    hubProtocolVersion: 1,
    daemonProtocolVersion: null,
    daemonVersion: null,
    roots: [],
  };
}

function checkoutRow(overrides: Partial<Checkout> = {}): Checkout {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    ownerUserId: OWNER,
    repositoryId: REPOSITORY_ID,
    executorId: 'host',
    path: '/srv/llame',
    kind: 'main',
    parentCheckoutId: null,
    branch: 'main',
    origin: 'registered',
    worktreeBase: null,
    createdAt: new Date('2026-10-24T00:00:00.000Z'),
    updatedAt: new Date('2026-10-24T00:00:00.000Z'),
    ...overrides,
  };
}

describe('isConfiguredExecutor', () => {
  it('accepts the local executor and every configured Machine', () => {
    expect(isConfiguredExecutor('host', config({}, MACHINES))).toBe(true);
    expect(isConfiguredExecutor('machine:nas', config({}, MACHINES))).toBe(
      true,
    );
  });

  it('refuses an unconfigured Machine, a bad name, and a bare id', () => {
    expect(isConfiguredExecutor('machine:basement', config({}, MACHINES))).toBe(
      false,
    );
    expect(
      isConfiguredExecutor('machine:NOT a name', config({}, MACHINES)),
    ).toBe(false);
    expect(isConfiguredExecutor('somewhere-else', config({}, MACHINES))).toBe(
      false,
    );
  });

  it('refuses every Machine id when no Machine is configured', () => {
    expect(isConfiguredExecutor('machine:nas', config())).toBe(false);
  });
});

describe('executorOnline', () => {
  const input = {
    config: config({}, MACHINES),
    machines: [machineView('nas', 'online'), machineView('attic', 'offline')],
  };

  it('treats the local executor as always online', () => {
    expect(executorOnline('host', input)).toBe(true);
  });

  it('reads each Machine’s own status', () => {
    expect(executorOnline('machine:nas', input)).toBe(true);
    expect(executorOnline('machine:attic', input)).toBe(false);
  });

  it('treats an unconfigured or unnamed executor as offline', () => {
    expect(executorOnline('machine:basement', input)).toBe(false);
    expect(executorOnline('nowhere', input)).toBe(false);
  });
});

describe('executorTarget', () => {
  it('keeps a local address as its own path', () => {
    expect(executorTarget('host', '/srv/llame')).toEqual({
      executorId: 'host',
      machine: undefined,
      path: '/srv/llame',
    });
  });

  it('unwraps the locator of its own Machine', () => {
    expect(executorTarget('machine:nas', 'machine://nas/srv/llame')).toEqual({
      executorId: 'machine:nas',
      machine: 'nas',
      path: '/srv/llame',
    });
  });

  it('refuses a locator of another Machine and a bare path for a Machine executor', () => {
    expect(
      executorTarget('machine:nas', 'machine://attic/srv/llame'),
    ).toBeUndefined();
    expect(executorTarget('machine:nas', '/srv/llame')).toBeUndefined();
    expect(executorTarget('machine:nas', 'machine://nas')).toBeUndefined();
  });
});

describe('creationLocationSource', () => {
  function source(rows: ReadonlyArray<Checkout>, online: Array<string>) {
    const db: Db = drizzle.mock({ schema });
    const listMainCheckouts = vi
      .spyOn(ProjectLinksRepository.prototype, 'listMainCheckouts')
      .mockResolvedValue([...rows]);
    const locationSource = creationLocationSource(db, (executorId) =>
      online.includes(executorId),
    );
    return { locationSource, listMainCheckouts };
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('drops an offline executor from the unfiltered main-checkout step', async () => {
    const { locationSource } = source(
      [
        checkoutRow({ id: 'offline', executorId: 'machine:attic' }),
        checkoutRow({ id: 'online', executorId: 'host' }),
      ],
      ['host'],
    );

    // The lowest id would win a tie, so the offline row must be gone before
    // the resolver sorts; `machine:attic` sorts first.
    const rows = await locationSource.listMainCheckouts(OWNER, REPOSITORY_ID);
    expect(rows.map((row) => row.id)).toEqual(['online']);
  });

  it('keeps every row of an explicit executor so the route can answer unavailable', async () => {
    const { locationSource } = source(
      [checkoutRow({ id: 'offline', executorId: 'machine:attic' })],
      [],
    );

    const rows = await locationSource.listMainCheckouts(
      OWNER,
      REPOSITORY_ID,
      'machine:attic',
    );
    expect(rows.map((row) => row.id)).toEqual(['offline']);
  });

  it('forwards every other read to the link repository unchanged', async () => {
    const db: Db = drizzle.mock({ schema });
    const listLinks = vi
      .spyOn(ProjectLinksRepository.prototype, 'listLinks')
      .mockResolvedValue([]);
    const findCheckout = vi
      .spyOn(ProjectLinksRepository.prototype, 'findCheckout')
      .mockResolvedValue(undefined);
    const locationSource = creationLocationSource(db, () => true);

    await expect(locationSource.listLinks(OWNER, 'project-1')).resolves.toEqual(
      [],
    );
    await locationSource.findCheckout(OWNER, 'checkout-1');

    expect(listLinks).toHaveBeenCalledWith(OWNER, 'project-1');
    expect(findCheckout).toHaveBeenCalledWith(OWNER, 'checkout-1');
  });
});
