import { drizzle } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { type Run, type RunContextItem, type RunEvent } from '../db/schema';
import { type Db, type TenantRunner } from '../db/tenant-db.service';
import {
  failRunTransactionally,
  RunEventsRepository,
  RunsRepository,
} from './runs-repository';

type QueryCall = { method: string; args: Array<unknown> };
type LoggedQuery = { sql: string; params: Array<unknown> };

type ActiveRunSummary = {
  id: string;
  chatId: string;
  chatTitle: string | null;
  status: Run['status'];
  createdAt: Date;
};

type QueryRows =
  | ReadonlyArray<Run>
  | ReadonlyArray<RunEvent>
  | ReadonlyArray<{ runs: Run }>
  | ReadonlyArray<{ run_events: RunEvent }>
  | ReadonlyArray<ActiveRunSummary>;

type QueryInput =
  | typeof schema.runs.$inferInsert
  | typeof schema.runEvents.$inferInsert
  | { status: Run['status']; startedAt: Date; workerId?: string }
  | { status: Run['status']; finishedAt: Date; error?: unknown }
  | { contextItems: Array<RunContextItem> }
  | { cancelRequestedAt: Date };

/** A Promise fluent query double with the small surface these repositories use. */
function queryResult(value: QueryRows, calls: Array<QueryCall>) {
  const terminal = Promise.resolve(value);
  const chain = () => terminal;
  const values = (valueToInsert: QueryInput) => {
    calls.push({ method: 'values', args: [valueToInsert] });
    return terminal;
  };
  const set = (valueToSet: QueryInput) => {
    calls.push({ method: 'set', args: [valueToSet] });
    return terminal;
  };
  return Object.assign(terminal, {
    from: chain,
    innerJoin: chain,
    where: chain,
    orderBy: chain,
    limit: chain,
    values,
    set,
    returning: () => {
      calls.push({ method: 'returning', args: [] });
      return terminal;
    },
  });
}

function asQuery(value: ReturnType<typeof queryResult>): never {
  // SAFETY: this double implements only the fluent methods exercised by the
  // repository, and every terminal is a real Promise.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  return value as never;
}

function makeDb(options: {
  select?: Array<QueryRows>;
  insert?: Array<QueryRows>;
  update?: Array<QueryRows>;
}) {
  const db: Db = drizzle.mock({ schema });
  const calls: Array<QueryCall> = [];
  const selectResults = [...(options.select ?? [])];
  const insertResults = [...(options.insert ?? [])];
  const updateResults = [...(options.update ?? [])];
  const select = vi
    .spyOn(db, 'select')
    .mockImplementation(() =>
      asQuery(queryResult(selectResults.shift() ?? [], calls)),
    );
  const insert = vi
    .spyOn(db, 'insert')
    .mockImplementation(() =>
      asQuery(queryResult(insertResults.shift() ?? [], calls)),
    );
  const update = vi
    .spyOn(db, 'update')
    .mockImplementation(() =>
      asQuery(queryResult(updateResults.shift() ?? [], calls)),
    );
  return { db, calls, select, insert, update };
}

function makeLoggedDb() {
  const queries: Array<LoggedQuery> = [];
  const db: Db = drizzle.mock({
    schema,
    logger: { logQuery: (sql, params) => queries.push({ sql, params }) },
  });
  return { db, queries };
}

const now = new Date('2026-09-02T00:00:00.000Z');
const run: Run = {
  id: 'run-1',
  chatId: 'chat-1',
  messageId: 'message-1',
  userId: 'owner-1',
  modelId: 'model-1',
  modelContextSnapshotId: 'snapshot-1',
  status: 'queued',
  workerId: null,
  cancelRequestedAt: null,
  error: null,
  contextItems: null,
  createdAt: now,
  startedAt: null,
  finishedAt: null,
  effort: null,
};

const event: RunEvent = {
  sequence: 1,
  runId: run.id,
  eventType: 'run.started',
  payload: { status: 'running_model' },
  createdAt: now,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RunsRepository', () => {
  it('includes optional id and effort only when supplied to create', async () => {
    const { db, calls } = makeDb({ insert: [[run], [run]] });
    const repository = new RunsRepository(db);
    const input = {
      chatId: run.chatId,
      messageId: 'message-1',
      userId: run.userId,
      modelId: run.modelId,
      modelContextSnapshotId: 'snapshot-1',
    };

    await expect(
      repository.create({ ...input, id: run.id, effort: 'high' }),
    ).resolves.toBe(run);
    await expect(repository.create(input)).resolves.toBe(run);

    const values = calls
      .filter(({ method }) => method === 'values')
      .map(({ args }) => args[0]);
    expect(values[0]).toMatchObject({ id: run.id, effort: 'high' });
    expect(values[1]).not.toHaveProperty('id');
    expect(values[1]).not.toHaveProperty('effort');
  });

  it('finds the most recent run and applies a strict message-sequence bound', async () => {
    const { db } = makeDb({ select: [[{ runs: run }], []] });
    const repository = new RunsRepository(db);

    await expect(
      repository.findMostRecentByChatMessageSequence(run.chatId, run.userId),
    ).resolves.toBe(run);
    await expect(
      repository.findMostRecentByChatMessageSequence(run.chatId, run.userId, {
        beforeSeq: 10,
      }),
    ).resolves.toBeUndefined();
  });

  it('binds owner, chat, and sequence cursor in the recent-run query', async () => {
    const { db, queries } = makeLoggedDb();
    await new RunsRepository(db)
      .findMostRecentByChatMessageSequence('chat-bound', 'owner-bound', {
        beforeSeq: 10,
      })
      .catch(() => undefined);

    expect(queries).toHaveLength(1);
    expect(queries[0]?.sql).toContain('"runs"."chat_id" = $');
    expect(queries[0]?.sql).toContain('"runs"."user_id" = $');
    expect(queries[0]?.sql).toContain('"messages"."seq" < $');
    expect(queries[0]?.params).toEqual(['chat-bound', 'owner-bound', 10, 1]);
  });

  it('reads runs by chat, active chat, active user, and owner-scoped id', async () => {
    const activeSummary = {
      id: run.id,
      chatId: run.chatId,
      chatTitle: 'Chat',
      status: run.status,
      createdAt: run.createdAt,
    };
    const { db, select } = makeDb({
      select: [[run], [run], [activeSummary], [run]],
    });
    const repository = new RunsRepository(db);

    await expect(
      repository.findByChatId(run.chatId, run.userId),
    ).resolves.toEqual([run]);
    await expect(
      repository.findActiveByChatId(run.chatId, run.userId),
    ).resolves.toBe(run);
    await expect(repository.findActiveByUser(run.userId)).resolves.toEqual([
      activeSummary,
    ]);
    await expect(repository.findById(run.id, run.userId)).resolves.toBe(run);
    expect(select).toHaveBeenCalledTimes(4);
  });

  it('records an optional worker id only when markStarted receives one', async () => {
    const { db, calls } = makeDb({ update: [[run], [run]] });
    const repository = new RunsRepository(db);

    await expect(
      repository.markStarted(run.id, run.userId, { workerId: 'worker-1' }),
    ).resolves.toBe(run);
    await expect(repository.markStarted(run.id, run.userId)).resolves.toBe(run);

    const sets = calls
      .filter(({ method }) => method === 'set')
      .map(({ args }) => args[0]);
    expect(sets[0]).toMatchObject({
      workerId: 'worker-1',
      status: 'running_model',
    });
    expect(sets[1]).not.toHaveProperty('workerId');
  });

  it('updates cancellation, context, and terminal state with the requested fields', async () => {
    const contextItems = [
      {
        producer: 'test',
        residency: 'rail' as const,
        text: 'Injected context',
      },
    ];
    const { db, calls } = makeDb({
      update: [[run], [run], [run], [run], [run]],
    });
    const repository = new RunsRepository(db);

    await expect(
      repository.cancelActiveRunsForMessage(run.messageId!, run.userId),
    ).resolves.toEqual([run]);
    await expect(
      repository.recordContextItems(run.id, run.userId, contextItems),
    ).resolves.toBe(run);
    await expect(repository.requestCancel(run.id, run.userId)).resolves.toBe(
      run,
    );
    await expect(
      repository.markFinished(run.id, run.userId, 'failed', {
        message: 'boom',
      }),
    ).resolves.toBe(run);
    await expect(
      repository.markFinished(run.id, run.userId, 'completed'),
    ).resolves.toBe(run);

    const sets = calls
      .filter(({ method }) => method === 'set')
      .map(({ args }) => args[0]);
    expect(sets[0]).toMatchObject({ status: 'cancelled' });
    expect(sets[1]).toEqual({ contextItems });
    expect(sets[2]).toHaveProperty('cancelRequestedAt');
    expect(sets[3]).toMatchObject({
      status: 'failed',
      error: { message: 'boom' },
    });
    expect(sets[4]).toMatchObject({ status: 'completed' });
    expect(sets[4]).not.toHaveProperty('error');
  });
});

describe('RunEventsRepository', () => {
  it('appends events and reads them after an optional sequence cursor', async () => {
    const { db, calls } = makeDb({
      insert: [[event]],
      select: [[{ run_events: event }], []],
    });
    const repository = new RunEventsRepository(db);

    await expect(
      repository.append(run.id, 'run.started', event.payload),
    ).resolves.toBe(event);
    await expect(repository.listByRunId(run.id, run.userId)).resolves.toEqual([
      event,
    ]);
    await expect(
      repository.listByRunId(run.id, run.userId, {
        afterSequence: event.sequence,
      }),
    ).resolves.toEqual([]);

    const values = calls.find(({ method }) => method === 'values');
    expect(values?.args[0]).toEqual({
      runId: run.id,
      eventType: event.eventType,
      payload: event.payload,
    });
  });
});

describe('failRunTransactionally', () => {
  it('appends run.failed only when the terminal update wins', async () => {
    const { db, calls, insert } = makeDb({
      update: [[run], []],
      insert: [[event]],
    });
    const runAsCalls: Array<string> = [];
    const tenantDb = {
      runAs<T>(_userId: string, callback: (tx: Db) => Promise<T>): Promise<T> {
        runAsCalls.push(_userId);
        return callback(db);
      },
    } satisfies TenantRunner;

    await failRunTransactionally(
      tenantDb,
      { runId: run.id, userId: run.userId },
      'failed once',
    );
    await failRunTransactionally(
      tenantDb,
      { runId: run.id, userId: run.userId },
      'late failure',
    );

    expect(runAsCalls).toHaveLength(2);
    expect(insert).toHaveBeenCalledOnce();
    expect(calls.find(({ method }) => method === 'values')?.args[0]).toEqual({
      runId: run.id,
      eventType: 'run.failed',
      payload: { status: 'failed', message: 'failed once' },
    });
  });
});
