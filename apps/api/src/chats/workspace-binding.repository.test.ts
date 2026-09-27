import { type SQL } from 'drizzle-orm';

import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { WorkspaceBindingRepository } from './workspace-binding.repository';

type QueryValue = string | number | null | SQL;
type QueryRow = Readonly<Record<string, QueryValue>>;
type QueryUpdate = Readonly<Record<string, QueryValue | undefined>>;
type QueryCall = { method: string; value?: QueryUpdate };
type QueryRows = ReadonlyArray<QueryRow>;

function queryResult(value: QueryRows, calls: Array<QueryCall>) {
  const terminal = Promise.resolve(value);
  const chain = () => terminal;
  const set = (next: QueryUpdate) => {
    calls.push({ method: 'set', value: next });
    return terminal;
  };
  return Object.assign(terminal, {
    from: chain,
    where: chain,
    for: chain,
    limit: chain,
    orderBy: chain,
    set,
    returning: () => terminal,
  });
}

function asQuery<T extends object>(query: T): never {
  // SAFETY: this double implements the small fluent surface used by the repository.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  return query as never;
}

function makeDb(options: {
  select?: Array<QueryRows>;
  update?: Array<QueryRows>;
}) {
  const db: Db = drizzle.mock({ schema });
  const calls: Array<QueryCall> = [];
  const selects = [...(options.select ?? [])];
  const updates = [...(options.update ?? [])];
  vi.spyOn(db, 'select').mockImplementation(() =>
    asQuery(queryResult(selects.shift() ?? [], calls)),
  );
  vi.spyOn(db, 'update').mockImplementation(() =>
    asQuery(queryResult(updates.shift() ?? [], calls)),
  );
  return { db, calls };
}

const run = [{ id: 'run-1' }];
const started = [{ sequence: 7 }];
const current = {
  workspaceRoot: '/work/old',
  workspaceExecutorId: 'worker-a',
  workspaceGeneration: 4,
};

function fenceSelect(
  chat: {
    workspaceRoot: string | null;
    workspaceExecutorId: string | null;
    workspaceGeneration: number;
  } = current,
): Array<QueryRows> {
  return [run, started, [chat]];
}

describe('WorkspaceBindingRepository', () => {
  it('stores told state with the compaction epoch that rendered it', async () => {
    const { db, calls } = makeDb({ update: [[]] });

    await new WorkspaceBindingRepository(db).setTold({
      chatId: 'chat-a',
      ownerUserId: 'owner-a',
      told: '/work/project',
      toldFrom: 'compaction-a',
      clearDetachReason: true,
    });

    expect(calls).toContainEqual({
      method: 'set',
      value: {
        workspaceTold: '/work/project',
        workspaceToldFrom: 'compaction-a',
        workspaceDetachReason: null,
      },
    });
  });

  it('returns fence_lost before a stale delivery can update the Run or Chat', async () => {
    const { db } = makeDb({ select: [run, [{ sequence: 6 }]] });

    await expect(
      new WorkspaceBindingRepository(db).enter({
        chatId: 'chat-a',
        ownerUserId: 'owner-a',
        runId: 'run-1',
        deliverySequence: 7,
        executorId: 'worker-a',
        root: '/work/new',
      }),
    ).resolves.toEqual({ status: 'fence_lost' });
  });
  it('checks the current owner delivery without locking or writing', async () => {
    const current = makeDb({ select: [run, started] });
    await expect(
      new WorkspaceBindingRepository(current.db).isCurrentDelivery({
        runId: 'run-1',
        ownerUserId: 'owner-a',
        deliverySequence: 7,
      }),
    ).resolves.toBe(true);
    expect(current.calls.filter(({ method }) => method === 'set')).toHaveLength(
      0,
    );

    const stale = makeDb({ select: [run, [{ sequence: 6 }]] });
    await expect(
      new WorkspaceBindingRepository(stale.db).isCurrentDelivery({
        runId: 'run-1',
        ownerUserId: 'owner-a',
        deliverySequence: 7,
      }),
    ).resolves.toBe(false);
    await expect(
      new WorkspaceBindingRepository(stale.db).isCurrentDelivery({
        runId: 'run-1',
        ownerUserId: 'owner-a',
        deliverySequence: undefined,
      }),
    ).resolves.toBe(false);
  });

  it('keeps the generation on same-root re-entry and increments on a switch', async () => {
    const same = makeDb({ select: fenceSelect(), update: [[{ id: 'run-1' }]] });
    await expect(
      new WorkspaceBindingRepository(same.db).enter({
        chatId: 'chat-a',
        ownerUserId: 'owner-a',
        runId: 'run-1',
        deliverySequence: 7,
        executorId: 'worker-a',
        root: '/work/old',
      }),
    ).resolves.toMatchObject({
      status: 'unchanged',
      previousRoot: '/work/old',
    });
    expect(same.calls.filter(({ method }) => method === 'set')).toHaveLength(1);

    const switched = makeDb({
      select: fenceSelect(),
      update: [[{ id: 'run-1' }], [{ workspaceGeneration: 5 }]],
    });
    await expect(
      new WorkspaceBindingRepository(switched.db).enter({
        chatId: 'chat-a',
        ownerUserId: 'owner-a',
        runId: 'run-1',
        deliverySequence: 7,
        executorId: 'worker-a',
        root: '/work/new',
      }),
    ).resolves.toMatchObject({
      status: 'switched',
      previousRoot: '/work/old',
    });
    const sets = switched.calls
      .filter(({ method, value }) => method === 'set' && value !== undefined)
      .map(({ value }) => value);
    expect(sets[0]).toMatchObject({ workerId: 'worker-a' });
    expect(sets[1]).toMatchObject({
      workspaceRoot: '/work/new',
      workspaceExecutorId: 'worker-a',
      workspaceDetachReason: null,
    });
  });

  it('increments the generation when an unbound Chat is first entered', async () => {
    const unbound = {
      workspaceRoot: null,
      workspaceExecutorId: null,
      workspaceGeneration: 0,
    };
    const { db } = makeDb({
      select: fenceSelect(unbound),
      update: [[{ id: 'run-1' }], [{ workspaceGeneration: 1 }]],
    });

    await expect(
      new WorkspaceBindingRepository(db).enter({
        chatId: 'chat-a',
        ownerUserId: 'owner-a',
        runId: 'run-1',
        deliverySequence: 7,
        executorId: 'worker-a',
        root: '/work/new',
      }),
    ).resolves.toMatchObject({
      status: 'bound',
      previousRoot: null,
    });
  });

  it('increments on exit only while bound and fences stale detach generations', async () => {
    const exiting = makeDb({
      select: fenceSelect(),
      update: [[{ id: 'run-1' }], [{ workspaceGeneration: 6 }]],
    });
    await expect(
      new WorkspaceBindingRepository(exiting.db).exit({
        chatId: 'chat-a',
        ownerUserId: 'owner-a',
        runId: 'run-1',
        deliverySequence: 7,
        executorId: 'worker-a',
      }),
    ).resolves.toMatchObject({
      status: 'cleared',
      previousRoot: '/work/old',
    });

    const stale = makeDb({
      select: fenceSelect(),
      update: [[{ id: 'run-1' }]],
    });
    await expect(
      new WorkspaceBindingRepository(stale.db).detach({
        chatId: 'chat-a',
        ownerUserId: 'owner-a',
        runId: 'run-1',
        deliverySequence: 7,
        expectedGeneration: 3,
        reason: 'root_missing',
      }),
    ).resolves.toBe('stale');
    expect(stale.calls.filter(({ method }) => method === 'set')).toHaveLength(
      0,
    );
  });

  it('detaches with a reason and increments only the matching generation', async () => {
    const { db, calls } = makeDb({
      select: fenceSelect(),
      update: [[{ id: 'run-1' }], [{ id: 'chat-a' }]],
    });

    await expect(
      new WorkspaceBindingRepository(db).detach({
        chatId: 'chat-a',
        ownerUserId: 'owner-a',
        runId: 'run-1',
        deliverySequence: 7,
        expectedGeneration: 4,
        reason: 'permission_rejected',
      }),
    ).resolves.toBe('detached');
    const sets = calls
      .filter(({ method, value }) => method === 'set' && value !== undefined)
      .map(({ value }) => value);
    expect(sets[0]).toMatchObject({
      workspaceRoot: null,
      workspaceExecutorId: null,
      workspaceDetachReason: 'permission_rejected',
    });
  });
});
