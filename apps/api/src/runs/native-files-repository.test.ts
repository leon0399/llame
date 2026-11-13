import { type SQL } from 'drizzle-orm';
import { PgDialect, type SelectedFields } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import { describe, expect, it, vi } from 'vitest';

import * as schema from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { asDouble } from '../testing/support';
import { NativeFilesRepository } from './native-files-repository';

type StoredEvent = { eventType: string; payload: unknown };

/** A repository whose event query answers exactly `rows`. */
function repositoryOf(...rows: Array<StoredEvent>) {
  const db: Db = drizzle.mock();

  const query = db.select({
    eventType: schema.runEvents.eventType,
    payload: schema.runEvents.payload,
  });

  const terminal = Promise.resolve(rows);
  Object.assign(query, {
    from: () => query,
    where: () => query,
    orderBy: () => query,
    limit: () => terminal,
  });
  vi.spyOn(db, 'select').mockReturnValue(query);

  return new NativeFilesRepository(db);
}

describe('NativeFilesRepository prior outcomes', () => {
  it('identifies an unknown MCP dispatch without allowing a replay', async () => {
    const repository = repositoryOf({
      eventType: 'native.attempt',
      payload: { toolCallId: 'mcp-call', operation: 'mcp' },
    });

    await expect(repository.priorOutcome('run-1', 'mcp-call')).resolves.toEqual(
      {
        status: 'error',
        type: 'outcome_unknown',
        message:
          'A previous host command, mutation, or MCP operation may have executed; it will not be repeated.',
      },
    );
  });

  it('keeps the artifact locator of a settled error result', async () => {
    const repository = repositoryOf({
      eventType: 'native.result',
      payload: {
        toolCallId: 'bash-call',
        result: {
          status: 'error',
          type: 'command_failed',
          message: 'exit 1',
          artifact: 'artifact://bash-4/stderr',
        },
      },
    });

    await expect(
      repository.priorOutcome('run-1', 'bash-call'),
    ).resolves.toEqual({
      status: 'error',
      type: 'command_failed',
      message: 'exit 1',
      artifact: 'artifact://bash-4/stderr',
    });
  });

  it('drops an artifact value that is not a locator', async () => {
    const repository = repositoryOf({
      eventType: 'native.result',
      payload: {
        toolCallId: 'bash-call',
        result: {
          status: 'error',
          type: 'command_failed',
          message: 'exit 1',
          artifact: 'x',
        },
      },
    });

    await expect(
      repository.priorOutcome('run-1', 'bash-call'),
    ).resolves.toEqual({
      status: 'error',
      type: 'command_failed',
      message: 'exit 1',
    });
  });

  it('treats any other recorded status as the unknown outcome', async () => {
    const repository = repositoryOf({
      eventType: 'native.result',
      payload: {
        toolCallId: 'bash-call',
        result: { status: 'pending', artifact: 'artifact://bash-4/stdout' },
      },
    });

    await expect(
      repository.priorOutcome('run-1', 'bash-call'),
    ).resolves.toEqual({
      status: 'error',
      type: 'outcome_unknown',
      message:
        'A previous host command, mutation, or MCP operation may have executed; it will not be repeated.',
    });
  });

  it('keeps the artifact locator of a settled success result', async () => {
    const repository = repositoryOf({
      eventType: 'native.result',
      payload: {
        toolCallId: 'bash-call',
        result: {
          status: 'success',
          exitCode: 0,
          artifact: 'artifact://bash-4/stdout',
        },
      },
    });

    await expect(
      repository.priorOutcome('run-1', 'bash-call'),
    ).resolves.toEqual({
      status: 'success',
      exitCode: 0,
      artifact: 'artifact://bash-4/stdout',
    });
  });
});

describe('NativeFilesRepository segment mutation scope', () => {
  it("counts only attempts after the Run's latest delivery", async () => {
    const db: Db = drizzle.mock();
    // Never spied: the embedded latest-delivery subquery stays a real builder.
    const subqueries: Db = drizzle.mock();
    const outer = db.select({ id: schema.runEvents.sequence });
    let condition: SQL | undefined;
    vi.spyOn(db, 'select')
      .mockImplementationOnce((fields: SelectedFields) =>
        subqueries.select(fields),
      )
      .mockReturnValueOnce(outer);
    // The outer query captures its filter instead of reaching a database.
    Object.assign(outer, {
      from: () => outer,
      where: (filter: SQL) => {
        condition = filter;

        return outer;
      },
      limit: () => Promise.resolve([{ id: 5 }]),
    });

    await expect(
      new NativeFilesRepository(db).hasMutation('run-1'),
    ).resolves.toBe(true);

    expect(condition).toBeDefined();

    if (condition === undefined) return;
    const issued = new PgDialect().sqlToQuery(condition);
    expect(issued.sql).toBe(
      '("run_events"."run_id" = $1 and "run_events"."event_type" = $2 and "run_events"."sequence" > coalesce(((select max("sequence") from "run_events" where ("run_events"."run_id" = $3 and "run_events"."event_type" = $4))), 0))',
    );
    expect(issued.params).toEqual([
      'run-1',
      'native.attempt',
      'run-1',
      'run.delivered',
    ]);
  });
});

type SelectChain = {
  from: () => SelectChain;
  where: () => SelectChain;
  orderBy: () => SelectChain;
  for: () => SelectChain;
  limit: () => Promise<Array<unknown> | undefined>;
};

/** A repository whose successive queries answer `answers` in order, recording each. */
function sequencedRepository(...answers: Array<Array<unknown>>) {
  const pending = [...answers];

  const chain: SelectChain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    for: () => chain,
    limit: () => Promise.resolve(pending.shift()),
  };

  const select = vi.fn(() => chain);
  const db = asDouble<Db>({ select });

  return { repository: new NativeFilesRepository(db), select };
}

describe('NativeFilesRepository.isCurrentDelivery', () => {
  const base = { runId: 'run-1', userId: 'user-1' };

  it('is false without reading anything when the caller has no delivery sequence', async () => {
    const { repository, select } = sequencedRepository();

    await expect(
      repository.isCurrentDelivery({ ...base, deliverySequence: undefined }),
    ).resolves.toBe(false);
    expect(select).not.toHaveBeenCalled();
  });

  it('is false when the Run row is not visible to the owner', async () => {
    const { repository, select } = sequencedRepository([]);

    await expect(
      repository.isCurrentDelivery({ ...base, deliverySequence: 3 }),
    ).resolves.toBe(false);
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('is true when the latest started sequence is the caller sequence', async () => {
    const { repository } = sequencedRepository(
      [{ activeAttemptId: 'attempt-9' }],
      [{ sequence: 3 }],
    );

    await expect(
      repository.isCurrentDelivery({ ...base, deliverySequence: 3 }),
    ).resolves.toBe(true);
  });

  it('is false when a later started sequence superseded the caller sequence', async () => {
    const { repository } = sequencedRepository(
      [{ activeAttemptId: 'attempt-9' }],
      [{ sequence: 7 }],
    );

    await expect(
      repository.isCurrentDelivery({ ...base, deliverySequence: 3 }),
    ).resolves.toBe(false);
  });

  it('is false for a named attempt that is no longer the active attempt', async () => {
    const { repository, select } = sequencedRepository(
      [{ activeAttemptId: 'attempt-2' }],
      [{ sequence: 3 }],
    );

    await expect(
      repository.isCurrentDelivery({
        ...base,
        deliverySequence: 3,
        attemptId: 'attempt-1',
      }),
    ).resolves.toBe(false);
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('is true for a named attempt that is the active attempt', async () => {
    const { repository } = sequencedRepository(
      [{ activeAttemptId: 'attempt-1' }],
      [{ sequence: 3 }],
    );

    await expect(
      repository.isCurrentDelivery({
        ...base,
        deliverySequence: 3,
        attemptId: 'attempt-1',
      }),
    ).resolves.toBe(true);
  });
});
