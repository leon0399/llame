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

type QuerySelection = Partial<{
  sequence: unknown;
  receipts: unknown;
  payload: unknown;
  toolCallId: unknown;
}>;

type QueryResponse = {
  selection: string;
  rows: Array<QueryRow>;
};

function finiteQueryDb(responses: Array<QueryResponse>) {
  let nextResponse = 0;

  const db = {
    select(selection: QuerySelection) {
      const response = responses[nextResponse++];
      const selectedColumns = Object.keys(selection).join(',');

      if (!response)
        throw new Error(`Unexpected query selecting ${selectedColumns}.`);

      if (response.selection !== selectedColumns) {
        throw new Error(
          `Expected query selecting ${response.selection}, got ${selectedColumns}.`,
        );
      }

      const result = Object.assign(Promise.resolve(response.rows), {
        from: () => result,
        innerJoin: () => result,
        where: () => result,
        orderBy: () => result,
        limit: () => result,
      });

      return result;
    },
  };

  // SAFETY: this strict finite double supplies only the select/query chain used
  // by these functions. Every query consumes one explicitly queued response.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion
  return { tx: db as Db, queryCount: () => nextResponse };
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
  });

  it('keeps only retained receipts while terminating a cyclic Continue chain', async () => {
    const queries = finiteQueryDb([
      // Starting run has no delivered boundary or direct receipt rows.
      { selection: 'sequence', rows: [] },
      { selection: 'receipts', rows: [] },
      // First checkpoint points to its ancestor and retains only kept-tool.
      {
        selection: 'payload',
        rows: [
          {
            payload: {
              sourceRunId: 'run-ancestor',
              parts: [{ toolCallId: 'kept-tool' }],
            },
          },
        ],
      },
      {
        selection: 'toolCallId,receipts',
        rows: [
          { toolCallId: 'kept-tool', receipts: ['ancestor-kept'] },
          { toolCallId: 'discarded-tool', receipts: ['ancestor-discarded'] },
        ],
      },
      // Ancestor also has no delivery and points back to the starting run.
      { selection: 'sequence', rows: [] },
      {
        selection: 'payload',
        rows: [
          {
            payload: {
              sourceRunId: 'run-start',
              parts: [
                { toolCallId: 'kept-tool' },
                { toolCallId: 'discarded-tool' },
              ],
            },
          },
        ],
      },
      {
        selection: 'toolCallId,receipts',
        rows: [
          { toolCallId: 'kept-tool', receipts: ['starting-kept'] },
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
      { runId: 'run-ancestor', deliveryIds: ['ancestor-kept'] },
      { runId: 'run-start', deliveryIds: ['starting-kept'] },
    ]);
    expect(queries.queryCount()).toBe(7);
  });
});
