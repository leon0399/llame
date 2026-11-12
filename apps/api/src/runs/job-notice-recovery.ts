import { and, asc, desc, eq, gt, lt, sql } from 'drizzle-orm';
import { isRecord, isString } from '@workspace/runtime-safety';

import { runEvents, runs } from '../db/schema';
import { type Db } from '../db/tenant-db.service';

/**
 * Return notice receipts from the discarded segment before this attempt's
 * dispatch. The first query is deliberately limited to the current attempt's
 * start metadata; a boundary attempt has no such event and reads no completion
 * receipts.
 */
export async function discardedJobNoticeIds(input: {
  readonly tx: Db;
  readonly runId: string;
  readonly ownerUserId: string;
  readonly attemptId: string;
}): Promise<Array<string>> {
  const currentStart = await currentAttemptStart(input);

  if (currentStart === undefined) return [];

  const segmentStart = await latestDeliveredSequence(input, currentStart);

  return readConsumedNoticeIds(input, segmentStart, currentStart);
}

/** Read receipts consumed by this Run and results retained through Continue. */
export async function sourceSegmentJobNoticeIds(input: {
  readonly tx: Db;
  readonly sourceRunId: string;
  readonly chatId: string;
  readonly ownerUserId: string;
}): Promise<Array<{ runId: string; deliveryIds: Array<string> }>> {
  const deliveredSequence = await latestSourceDeliverySequence(
    input,
    input.sourceRunId,
  );

  const receipts = await readSourceSegmentReceipts(
    input,
    deliveredSequence ?? 0,
  );

  const groups = new Map<string, Array<string>>();

  if (receipts.length > 0) groups.set(input.sourceRunId, receipts);

  if (deliveredSequence === undefined) {
    await collectContinuedJobNoticeIds(input, groups);
  }

  return Array.from(groups, ([runId, deliveryIds]) => ({
    runId,
    deliveryIds,
  }));
}

async function latestSourceDeliverySequence(
  input: {
    readonly tx: Db;
    readonly chatId: string;
    readonly ownerUserId: string;
  },
  runId: string,
): Promise<number | undefined> {
  const [delivered] = await input.tx
    .select({ sequence: runEvents.sequence })
    .from(runEvents)
    .innerJoin(runs, eq(runEvents.runId, runs.id))
    .where(
      and(
        eq(runEvents.runId, runId),
        eq(runs.chatId, input.chatId),
        eq(runs.userId, input.ownerUserId),
        eq(runEvents.eventType, 'run.delivered'),
      ),
    )
    .orderBy(desc(runEvents.sequence))
    .limit(1);

  return delivered?.sequence;
}

async function readSourceSegmentReceipts(
  input: {
    readonly tx: Db;
    readonly sourceRunId: string;
    readonly chatId: string;
    readonly ownerUserId: string;
  },
  deliveredSequence: number,
): Promise<Array<string>> {
  const rows = await input.tx
    .select({
      receipts: sql<unknown>`${runEvents.payload}->'consumedJobNoticeIds'`,
    })
    .from(runEvents)
    .innerJoin(runs, eq(runEvents.runId, runs.id))
    .where(
      and(
        eq(runEvents.runId, input.sourceRunId),
        eq(runs.chatId, input.chatId),
        eq(runs.userId, input.ownerUserId),
        eq(runEvents.eventType, 'tool.completed'),
        gt(runEvents.sequence, deliveredSequence),
      ),
    )
    .orderBy(asc(runEvents.sequence));

  return rows.flatMap(({ receipts }) =>
    Array.isArray(receipts) ? receipts.filter(isString) : [],
  );
}

/** Collect receipts from retained Continue results, grouped by their consumer. */
async function collectContinuedJobNoticeIds(
  input: {
    readonly tx: Db;
    readonly sourceRunId: string;
    readonly chatId: string;
    readonly ownerUserId: string;
  },
  groups: Map<string, Array<string>>,
): Promise<void> {
  const visited = new Set<string>();
  let runId = input.sourceRunId;
  let kept: Set<string> | undefined;

  while (!visited.has(runId)) {
    visited.add(runId);

    if (
      runId !== input.sourceRunId &&
      (await latestSourceDeliverySequence(input, runId)) !== undefined
    )
      return;

    const checkpoint = await readContinuedCheckpoint(input, runId, kept);

    if (!checkpoint) return;

    const deliveryIds = await readKeptResultReceipts(input, checkpoint);

    if (deliveryIds.length > 0) {
      const existing = groups.get(checkpoint.sourceRunId);

      if (existing) existing.push(...deliveryIds);
      else groups.set(checkpoint.sourceRunId, deliveryIds);
    }

    runId = checkpoint.sourceRunId;
    kept = checkpoint.toolCallIds;
  }
}

type ContinuedCheckpoint = {
  sourceRunId: string;
  toolCallIds: Set<string>;
};

async function readContinuedCheckpoint(
  input: {
    readonly tx: Db;
    readonly chatId: string;
    readonly ownerUserId: string;
  },
  runId: string,
  retainedToolCallIds?: Set<string>,
): Promise<ContinuedCheckpoint | undefined> {
  const [continued] = await input.tx
    .select({ payload: runEvents.payload })
    .from(runEvents)
    .innerJoin(runs, eq(runEvents.runId, runs.id))
    .where(
      and(
        eq(runEvents.runId, runId),
        eq(runs.chatId, input.chatId),
        eq(runs.userId, input.ownerUserId),
        eq(runEvents.eventType, 'run.continued'),
      ),
    )
    .orderBy(asc(runEvents.sequence))
    .limit(1);

  if (!isRecord(continued?.payload)) return undefined;

  const sourceRunId = continued.payload['sourceRunId'];
  const parts = continued.payload['parts'];

  if (!isString(sourceRunId) || !Array.isArray(parts)) return undefined;

  const toolCallIds = retainedToolCallIdsFromParts(parts, retainedToolCallIds);

  return toolCallIds.size > 0 ? { sourceRunId, toolCallIds } : undefined;
}

function retainedToolCallIdsFromParts(
  parts: Array<unknown>,
  retainedToolCallIds?: Set<string>,
): Set<string> {
  return new Set(
    parts.flatMap((part) =>
      isRecord(part) &&
      isString(part['toolCallId']) &&
      (retainedToolCallIds === undefined ||
        retainedToolCallIds.has(part['toolCallId']))
        ? [part['toolCallId']]
        : [],
    ),
  );
}

async function readKeptResultReceipts(
  input: {
    readonly tx: Db;
    readonly chatId: string;
    readonly ownerUserId: string;
  },
  checkpoint: ContinuedCheckpoint,
): Promise<Array<string>> {
  const rows = await input.tx
    .select({ payload: runEvents.payload })
    .from(runEvents)
    .innerJoin(runs, eq(runEvents.runId, runs.id))
    .where(
      and(
        eq(runEvents.runId, checkpoint.sourceRunId),
        eq(runs.chatId, input.chatId),
        eq(runs.userId, input.ownerUserId),
        eq(runEvents.eventType, 'tool.completed'),
      ),
    )
    .orderBy(asc(runEvents.sequence));

  return rows.flatMap(({ payload }) =>
    isRecord(payload) &&
    isString(payload['toolCallId']) &&
    checkpoint.toolCallIds.has(payload['toolCallId']) &&
    Array.isArray(payload['consumedJobNoticeIds'])
      ? payload['consumedJobNoticeIds'].filter(isString)
      : [],
  );
}

async function currentAttemptStart(input: {
  readonly tx: Db;
  readonly runId: string;
  readonly ownerUserId: string;
  readonly attemptId: string;
}): Promise<number | undefined> {
  const [started] = await input.tx
    .select({ sequence: runEvents.sequence })
    .from(runEvents)
    .innerJoin(runs, eq(runEvents.runId, runs.id))
    .where(
      and(
        eq(runEvents.runId, input.runId),
        eq(runs.userId, input.ownerUserId),
        eq(runEvents.eventType, 'run.started'),
        sql`${runEvents.payload}->>'attemptId' = ${input.attemptId}`,
      ),
    )
    .orderBy(asc(runEvents.sequence))
    .limit(1);

  return started?.sequence;
}

async function latestDeliveredSequence(
  input: {
    readonly tx: Db;
    readonly runId: string;
    readonly ownerUserId: string;
  },
  beforeSequence: number,
): Promise<number> {
  const [delivered] = await input.tx
    .select({ sequence: runEvents.sequence })
    .from(runEvents)
    .innerJoin(runs, eq(runEvents.runId, runs.id))
    .where(
      and(
        eq(runEvents.runId, input.runId),
        eq(runs.userId, input.ownerUserId),
        eq(runEvents.eventType, 'run.delivered'),
        lt(runEvents.sequence, beforeSequence),
      ),
    )
    .orderBy(desc(runEvents.sequence))
    .limit(1);

  return delivered?.sequence ?? 0;
}

async function readConsumedNoticeIds(
  input: {
    readonly tx: Db;
    readonly runId: string;
    readonly ownerUserId: string;
  },
  segmentStart: number,
  attemptStart: number,
): Promise<Array<string>> {
  const rows = await input.tx
    .select({
      receipts: sql<unknown>`${runEvents.payload}->'consumedJobNoticeIds'`,
    })
    .from(runEvents)
    .innerJoin(runs, eq(runEvents.runId, runs.id))
    .where(
      and(
        eq(runEvents.runId, input.runId),
        eq(runs.userId, input.ownerUserId),
        eq(runEvents.eventType, 'tool.completed'),
        gt(runEvents.sequence, segmentStart),
        lt(runEvents.sequence, attemptStart),
      ),
    )
    .orderBy(asc(runEvents.sequence));

  return rows.flatMap(({ receipts }) =>
    Array.isArray(receipts) ? receipts.filter(isString) : [],
  );
}
