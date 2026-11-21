import { drizzle } from 'drizzle-orm/postgres-js';

import { type Checkout } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { type MachineStatusView } from '../machines/machines-status';
import { ProjectLinksRepository } from '../projects/project-links.repository';
import {
  creationLocationSource,
  executorOnline,
  executorTarget,
} from './chat-creation-executors';

/*
 * Executor identity for chat creation (openspec `chat-start-location`):
 * whether the configuration provides an id, whether it can run now, the typed
 * target one resolved location runs on, and the resolver source that drops an
 * offline Machine from an implicit step. Every id is a Machine name, the host
 * Machine included.
 */

const OWNER = 'owner-a';
const REPOSITORY_ID = '22222222-2222-4222-8222-222222222222';

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
    facts: null,
    factsCapturedAt: null,
    roots: [],
  };
}

function checkoutRow(overrides: Partial<Checkout> = {}): Checkout {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    ownerUserId: OWNER,
    repositoryId: REPOSITORY_ID,
    executorId: 'host',
    path: 'machine://host/srv/llame',
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

describe('executorOnline', () => {
  const input = {
    machines: [machineView('nas', 'online'), machineView('attic', 'offline')],
  };

  it('reads each Machine’s own status', () => {
    expect(executorOnline('nas', input)).toBe(true);
    expect(executorOnline('attic', input)).toBe(false);
  });

  it('reads the host Machine’s status like any other', () => {
    expect(
      executorOnline('host', { machines: [machineView('host', 'offline')] }),
    ).toBe(false);
  });

  it('treats an unconfigured or unnamed executor as offline', () => {
    expect(executorOnline('basement', input)).toBe(false);
    expect(executorOnline('nowhere', input)).toBe(false);
  });
});

describe('executorTarget', () => {
  it('unwraps the locator of its own Machine', () => {
    expect(executorTarget('host', 'machine://host/srv/llame')).toEqual({
      executorId: 'host',
      machine: 'host',
      path: '/srv/llame',
    });
  });

  it('names the Machine for a remote checkout too', () => {
    expect(executorTarget('nas', 'machine://nas/srv/llame')).toEqual({
      executorId: 'nas',
      machine: 'nas',
      path: '/srv/llame',
    });
  });

  it('refuses a locator of another Machine and a bare path', () => {
    expect(executorTarget('nas', 'machine://attic/srv/llame')).toBeUndefined();
    expect(executorTarget('nas', '/srv/llame')).toBeUndefined();
    expect(executorTarget('nas', 'machine://nas')).toBeUndefined();
  });
});

describe('creationLocationSource', () => {
  function source(rows: ReadonlyArray<Checkout>, online: Array<string>) {
    const db: Db = drizzle.mock();

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
        checkoutRow({ id: 'offline', executorId: 'attic' }),
        checkoutRow({ id: 'online', executorId: 'host' }),
      ],
      ['host'],
    );

    // The lowest id would win a tie, so the offline row must be gone before
    // the resolver sorts; `attic` sorts first.
    const rows = await locationSource.listMainCheckouts(OWNER, REPOSITORY_ID);
    expect(rows.map((row) => row.id)).toEqual(['online']);
  });

  it('keeps every row of an explicit executor so the route can answer unavailable', async () => {
    const { locationSource } = source(
      [checkoutRow({ id: 'offline', executorId: 'attic' })],
      [],
    );

    const rows = await locationSource.listMainCheckouts(
      OWNER,
      REPOSITORY_ID,
      'attic',
    );

    expect(rows.map((row) => row.id)).toEqual(['offline']);
  });

  it('forwards every other read to the link repository unchanged', async () => {
    const db: Db = drizzle.mock();

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
