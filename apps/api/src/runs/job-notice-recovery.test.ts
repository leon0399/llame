import { PgDialect } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import { isSQLWrapper, type SQL } from 'drizzle-orm';

import * as schema from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import {
  discardedJobNoticeIds,
  sourceSegmentJobNoticeIds,
} from './job-notice-recovery';

type QueryRow = {
  sequence?: number;
  receipts?: unknown;
  payload?: unknown;
  toolCallId?: unknown;
};

type QueryObservation = {
  selection: string;
  projectionSql: Array<string>;
  whereSql?: { sql: string; params: Array<unknown> };
};

type QueryResponse = {
  selection: string;
  rows: Array<QueryRow>;
};

const dialect = new PgDialect();

function compileProjection(value: unknown): string | undefined {
  if (!isSQLWrapper(value)) return undefined;

  return dialect.sqlToQuery(value.getSQL()).sql;
}

function queryResult(rows: Array<QueryRow>, observation: QueryObservation) {
  const terminal = Promise.resolve(rows);
  const chain = () => terminal;

  return Object.assign(terminal, {
    from: chain,
    innerJoin: chain,
    where(condition: SQL) {
      observation.whereSql = dialect.sqlToQuery(condition);

      return terminal;
    },
    orderBy: chain,
    limit: chain,
  });
}

function asQuery(value: ReturnType<typeof queryResult>): never {
  // SAFETY: this query builder implements every select-chain method these
  // functions use, and all method calls return a real Promise.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  return value as never;
}

function finiteQueryDb(responses: Array<QueryResponse>) {
  let nextResponse = 0;
  const observations: Array<QueryObservation> = [];
  const db: Db = drizzle.mock({ schema });

  const select = vi.spyOn(db, 'select').mockImplementation((selection) => {
    const response = responses[nextResponse++];
    const selectedColumns = Object.keys(selection).join(',');

    if (!response)
      throw new Error(`Unexpected query selecting ${selectedColumns}.`);

    if (response.selection !== selectedColumns) {
      throw new Error(
        `Expected query selecting ${response.selection}, got ${selectedColumns}.`,
      );
    }

    const observation: QueryObservation = {
      selection: selectedColumns,
      projectionSql: Object.values(selection).flatMap((projection) => {
        const compiled = compileProjection(projection);

        return compiled === undefined ? [] : [compiled];
      }),
    };

    observations.push(observation);

    return asQuery(queryResult(response.rows, observation));
  });

  return {
    tx: db,
    queryCount: () => select.mock.calls.length,
    observations,
  };
}

describe('job notice recovery', () => {
  it('returns only string notice IDs found in consumed receipt rows', async () => {
    const queries = finiteQueryDb([
      { selection: 'sequence', rows: [{ sequence: 5 }] },
      { selection: 'sequence', rows: [{ sequence: 2 }] },
      {
        selection: 'receipts',
        rows: [{ receipts: ['notice-a', 12, 'notice-b'] }],
      },
    ]);

    await expect(
      discardedJobNoticeIds({
        tx: queries.tx,
        runId: 'run-current',
        ownerUserId: 'owner',
        attemptId: 'attempt-current',
      }),
    ).resolves.toEqual(['notice-a', 'notice-b']);
    expect(queries.queryCount()).toBe(3);
    expect(queries.observations[0]?.whereSql?.params).toContain(
      'attempt-current',
    );
    expect(queries.observations[1]?.whereSql?.params).toContain(
      'run.delivered',
    );
    expect(queries.observations[2]?.whereSql?.params).toContain(
      'tool.completed',
    );
    expect(queries.observations[2]?.projectionSql).toContain(
      `"run_events"."payload"->'consumedJobNoticeIds'`,
    );
  });

  it('keeps direct receipts and stops at a delivered source boundary', async () => {
    const queries = finiteQueryDb([
      { selection: 'sequence', rows: [{ sequence: 10 }] },
      { selection: 'receipts', rows: [{ receipts: ['direct-receipt'] }] },
    ]);

    await expect(
      sourceSegmentJobNoticeIds({
        tx: queries.tx,
        sourceRunId: 'run-source',
        chatId: 'chat',
        ownerUserId: 'owner',
      }),
    ).resolves.toEqual([
      { runId: 'run-source', deliveryIds: ['direct-receipt'] },
    ]);
    expect(queries.queryCount()).toBe(2);
  });

  it('ignores missing and empty Continue checkpoints', async () => {
    const missing = finiteQueryDb([
      { selection: 'sequence', rows: [] },
      { selection: 'receipts', rows: [] },
      { selection: 'payload', rows: [] },
    ]);

    await expect(
      sourceSegmentJobNoticeIds({
        tx: missing.tx,
        sourceRunId: 'run-missing',
        chatId: 'chat',
        ownerUserId: 'owner',
      }),
    ).resolves.toEqual([]);
    expect(missing.queryCount()).toBe(3);

    const empty = finiteQueryDb([
      { selection: 'sequence', rows: [] },
      { selection: 'receipts', rows: [] },
      {
        selection: 'payload',
        rows: [
          {
            payload: { sourceRunId: 'run-ancestor', parts: [] },
          },
        ],
      },
    ]);

    await expect(
      sourceSegmentJobNoticeIds({
        tx: empty.tx,
        sourceRunId: 'run-empty',
        chatId: 'chat',
        ownerUserId: 'owner',
      }),
    ).resolves.toEqual([]);
    expect(empty.queryCount()).toBe(3);
  });

  it('filters retained results and terminates a cyclic Continue chain', async () => {
    const queries = finiteQueryDb([
      { selection: 'sequence', rows: [] },
      { selection: 'receipts', rows: [] },
      {
        selection: 'payload',
        rows: [
          {
            payload: {
              sourceRunId: 'run-ancestor',
              parts: [{ toolCallId: 'cycle-tool' }],
            },
          },
        ],
      },
      {
        selection: 'toolCallId,receipts',
        rows: [
          { toolCallId: 'cycle-tool', receipts: [] },
          { toolCallId: 'discarded-tool', receipts: ['ancestor-discarded'] },
        ],
      },
      { selection: 'sequence', rows: [] },
      {
        selection: 'payload',
        rows: [
          {
            payload: {
              sourceRunId: 'run-start',
              parts: [{ toolCallId: 'cycle-tool' }],
            },
          },
        ],
      },
      {
        selection: 'toolCallId,receipts',
        rows: [
          { toolCallId: 'cycle-tool', receipts: ['starting-kept', 12] },
          { toolCallId: 'discarded-tool', receipts: ['starting-discarded'] },
        ],
      },
    ]);

    await expect(
      sourceSegmentJobNoticeIds({
        tx: queries.tx,
        sourceRunId: 'run-start',
        chatId: 'chat',
        ownerUserId: 'owner',
      }),
    ).resolves.toEqual([
      { runId: 'run-start', deliveryIds: ['starting-kept'] },
    ]);
    expect(queries.queryCount()).toBe(7);
    expect(
      queries.observations.some((query) =>
        query.whereSql?.params.includes('run.continued'),
      ),
    ).toBe(true);
    expect(
      queries.observations.some((query) =>
        query.whereSql?.params.includes('tool.completed'),
      ),
    ).toBe(true);
    expect(queries.observations[2]?.projectionSql).toContain(
      `"run_events"."payload"`,
    );
    expect(queries.observations[3]?.projectionSql).toEqual([
      `"run_events"."payload"->'toolCallId'`,
      `"run_events"."payload"->'consumedJobNoticeIds'`,
    ]);
  });
});
