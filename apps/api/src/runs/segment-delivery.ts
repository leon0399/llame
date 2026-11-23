import { randomUUID } from 'node:crypto';
/**
 * The delivery of pending `steer` and `interrupt` items to a live Run
 * (run-steering D3/D4): the step-end query that stops a model call, and the one
 * fenced transaction that closes the current segment's reply, stores the
 * delivered message, and moves the Run onto it.
 */

import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import { createCompactionContinueItem } from '../chats/compaction-continue-item';
import { partsToText, type MessagePart } from '../chats/context-builder';
import { isRecord } from '@workspace/runtime-safety';
import type { StoppedCall } from '../chats/interrupted-notice';

import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { ChatJobsRepository } from '../jobs/chat-jobs.repository';
import { type ChatDelivery, type Message, type Run } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { RunEventsRepository, RunsRepository } from './runs-repository';
import { RunRowFenceRepository } from './run-row-fence.repository';
import { markCompactItemsDelivered } from './mark-compact-items-delivered';
import { deliveryCause } from './boundary-compaction-delivery';
import { isCompactCommand } from '../chats/commands/parse-chat-command';

import {
  deliveredEventPayload,
  storeDeliveredMessage,
  closeReply,
  closeSegmentAndStore,
  closingAs,
  type BoundaryDelivery,
  type DeliveryCause,
  type DeliveryInput,
  persistFirstEpochBaselines,
} from './segment-delivery-close';

export {
  abortedByInterrupt,
  closedTelemetry,
  failedByFailover,
  persistFirstEpochBaselines,
} from './segment-delivery-close';

export type {
  BoundaryDelivery,
  DeliveryCause,
  DeliveryInput,
  DeliveredBoundary,
  FirstEpochBaselines,
} from './segment-delivery-close';

async function markDeliveryItems(
  tx: Db,
  input: {
    locked: Run;
    items: ReadonlyArray<ChatDelivery>;
    commandItems: ReadonlyArray<ChatDelivery>;
    message: Message;
  },
): Promise<void> {
  const deliveries = new ChatDeliveriesRepository(tx);

  for (const item of input.items) {
    if (
      !(await deliveries.markDelivered(item.id, input.locked.userId, {
        messageId: input.message.id,
        runId: input.locked.id,
      }))
    ) {
      throw new Error(`Steer item ${item.id} was not pending.`);
    }
  }

  await markCompactItemsDelivered(
    tx,
    input.commandItems,
    input.locked.userId,
    input.locked.id,
  );
}

/**
 * Mark items delivered as `message`, move the Run onto it, and append the event.
 * The pointer moves after message creation because it has an immediate FK.
 * Exported for the model switch, which supplies a cause the pending items
 * cannot derive.
 */
export async function moveRunToDelivery(
  tx: Db,
  locked: Run,
  fromAttemptId: string,
  delivery: {
    items: ReadonlyArray<ChatDelivery>;
    message: Message;
    cause: DeliveryCause;
    stoppedCalls: ReadonlyArray<StoppedCall>;
    commandItems?: ReadonlyArray<ChatDelivery>;
    checkpointId?: string;
    stepBudgetUsed?: number;
  },
): Promise<string> {
  const { id: runId, userId } = locked;

  const { items, message } = delivery;
  await markDeliveryItems(tx, {
    locked,
    items,
    commandItems: delivery.commandItems ?? [],
    message,
  });

  const attemptId = randomUUID();

  const moved = await new RunsRepository(tx).updateForAttempt(
    runId,
    userId,
    fromAttemptId,
    { messageId: message.id, activeAttemptId: attemptId },
  );

  if (!moved) throw new Error(`Run ${runId} could not move to its delivery.`);

  await new RunEventsRepository(tx).append(runId, 'run.delivered', {
    messageId: message.id,
    ...deliveredEventPayload(attemptId, delivery),
  });

  return attemptId;
}

/** Lock Run then chat, settle dead jobs, and apply the pending boundary set.
 * The Run pointer moves last because it references the stored delivery message.
 * An item withdrawn after the step-end check cannot make the delivery an
 * interrupt; only the fenced item state or a stopped call can do so.
 */
export async function deliverPendingSteering(
  tx: Db,
  input: DeliveryInput,
): Promise<BoundaryDelivery> {
  const locked = await new RunRowFenceRepository(tx).lockForDelivery(
    input.run.runId,
    input.run.userId,
    input.attemptId,
  );

  if (!locked) return { kind: 'fenced' };

  if (locked.cancelRequestedAt !== null) return { kind: 'cancelled' };
  const { chatId, userId } = locked;

  if (!(await new ChatsRepository(tx).lock(chatId, userId))) {
    return { kind: 'fenced' };
  }

  await new ChatJobsRepository(tx).settleOnDeadWorkers(
    chatId,
    userId,
    input.deadWorkerAfterSeconds,
  );

  const items = await new ChatDeliveriesRepository(tx).lockPendingBoundary(
    chatId,
    userId,
  );

  if (items.length === 0 && input.boundaryCompaction?.automatic !== true) {
    return { kind: 'nothing-pending' };
  }

  return finishDelivery(tx, input, locked, items);
}

async function settleFailedCompaction(input: {
  tx: Db;
  locked: Run;
  commandItems: ReadonlyArray<ChatDelivery>;
  live: DeliveryInput['live'];
  automatic: boolean;
}): Promise<void> {
  const { tx, locked, commandItems, live, automatic } = input;

  const partType = automatic
    ? 'data-compaction-disabled'
    : 'data-compaction-failed';

  const eventType = automatic
    ? 'run.compaction_disabled'
    : 'run.compaction_failed';

  if (
    live &&
    !live.parts.some((part) => isRecord(part) && part['type'] === partType)
  ) {
    live.parts.push({ type: partType, data: {} });
  }

  await markCompactItemsDelivered(tx, commandItems, locked.userId, locked.id);
  await new RunEventsRepository(tx).append(locked.id, eventType, {});
}

function compactCommandItems(
  items: ReadonlyArray<ChatDelivery>,
  ids: ReadonlyArray<string>,
  finalAnswer: boolean,
): ReadonlyArray<ChatDelivery> {
  return items.filter(
    (item) => isCompactCommand(item) && (finalAnswer || ids.includes(item.id)),
  );
}

async function settleFailedCompactionDelivery(input: {
  tx: Db;
  delivery: DeliveryInput;
  locked: Run;
  commandItems: ReadonlyArray<ChatDelivery>;
  items: ReadonlyArray<ChatDelivery>;
}): Promise<BoundaryDelivery> {
  await settleFailedCompaction({
    tx: input.tx,
    locked: input.locked,
    commandItems: input.commandItems,
    live: input.delivery.live,
    automatic: input.delivery.boundaryCompaction?.automatic === true,
  });

  const ordinary = await finishOrdinaryDelivery({
    tx: input.tx,
    delivery: input.delivery,
    locked: input.locked,
    items: input.items,
  });

  return ordinary.kind === 'nothing-pending'
    ? { kind: 'nothing-pending', compactionFailed: true }
    : ordinary;
}

async function findClosedReply(input: {
  tx: Db;
  closing: DeliveryInput;
  locked: Run;
  cause: DeliveryCause;
}): Promise<Message | undefined> {
  const closed = await closeReply(
    input.tx,
    input.closing,
    input.locked,
    input.cause,
  );

  if (closed !== undefined) return closed;

  const inReplyTo = input.closing.live?.inReplyTo ?? input.locked.messageId;

  if (inReplyTo === null) return undefined;

  return (
    await new MessagesRepository(input.tx).findTurnState(
      input.locked.chatId,
      input.locked.userId,
      inReplyTo,
    )
  ).assistantMessage;
}

async function closeAndPublishBoundaryCheckpoint(input: {
  tx: Db;
  delivery: DeliveryInput;
  locked: Run;
  compaction: NonNullable<DeliveryInput['boundaryCompaction']>;
  cause: DeliveryCause;
}): Promise<{ closedReply: Message; checkpointId: string }> {
  const closing = closingAs(input.delivery, input.cause);

  const closedReply = await findClosedReply({
    tx: input.tx,
    closing,
    locked: input.locked,
    cause: input.cause,
  });

  if (!closedReply) {
    throw new Error(`Run ${input.locked.id} has no closed reply.`);
  }

  await persistFirstEpochBaselines(
    input.tx,
    input.locked,
    input.delivery.baselines,
  );

  return {
    closedReply,
    checkpointId: await input.compaction.publishCheckpoint(
      input.tx,
      closedReply,
    ),
  };
}

function createContinueItem(input: {
  locked: Run;
  messageItems: ReadonlyArray<ChatDelivery>;
  compaction: NonNullable<DeliveryInput['boundaryCompaction']>;
}): MessagePart {
  const newestOwnerMessage = input.messageItems.findLast(
    (item) => item.producer === 'owner',
  );

  return createCompactionContinueItem({
    runId: input.locked.id,
    quote:
      newestOwnerMessage === undefined
        ? input.compaction.quote
        : partsToText(newestOwnerMessage.parts),
  });
}

async function finishBoundaryCompaction(input: {
  tx: Db;
  delivery: DeliveryInput;
  locked: Run;
  commandItems: ReadonlyArray<ChatDelivery>;
  messageItems: ReadonlyArray<ChatDelivery>;
  compaction: NonNullable<DeliveryInput['boundaryCompaction']>;
}): Promise<BoundaryDelivery> {
  const cause = deliveryCause(input.delivery, [
    ...input.messageItems,
    ...input.commandItems,
  ]);

  const { closedReply, checkpointId } = await closeAndPublishBoundaryCheckpoint(
    { ...input, cause },
  );

  const continuation =
    input.compaction.finalAnswer === true ? [] : [createContinueItem(input)];

  const message = await storeDeliveredMessage(
    input.tx,
    input.locked,
    input.messageItems,
    { trailing: continuation },
  );

  const attemptId = await moveRunToDelivery(
    input.tx,
    input.locked,
    input.delivery.attemptId,
    {
      items: input.messageItems,
      commandItems: input.commandItems,
      message,
      cause,
      stoppedCalls: input.delivery.stoppedCalls ?? [],
      checkpointId,
      stepBudgetUsed: input.compaction.stepBudgetUsed,
    },
  );

  return { kind: 'delivered', closedReply, message, attemptId, cause };
}

async function settleCompactionDelivery(input: {
  tx: Db;
  delivery: DeliveryInput;
  locked: Run;
  items: ReadonlyArray<ChatDelivery>;
  commandItems: ReadonlyArray<ChatDelivery>;
  compaction: NonNullable<DeliveryInput['boundaryCompaction']>;
}): Promise<BoundaryDelivery> {
  if (input.compaction.summary === null) {
    return settleFailedCompactionDelivery({
      tx: input.tx,
      delivery: input.delivery,
      locked: input.locked,
      commandItems: input.commandItems,
      items: input.items,
    });
  }

  const messageItems = input.items.filter((item) => !isCompactCommand(item));

  if (input.compaction.finalAnswer === true && messageItems.length === 0) {
    return {
      kind: 'final-compacted',
      commandItems: input.commandItems,
      compaction: input.compaction,
    };
  }

  return finishBoundaryCompaction({
    tx: input.tx,
    delivery: input.delivery,
    locked: input.locked,
    commandItems: input.commandItems,
    messageItems,
    compaction: input.compaction,
  });
}

async function attemptCompactionDelivery(
  tx: Db,
  input: DeliveryInput,
  locked: Run,
  items: ReadonlyArray<ChatDelivery>,
): Promise<BoundaryDelivery | undefined> {
  const compaction = input.boundaryCompaction;

  if (compaction === undefined) return undefined;

  const commandItems = compactCommandItems(
    items,
    compaction.ids,
    compaction.finalAnswer === true,
  );

  if (commandItems.length === 0 && compaction.automatic !== true) {
    return undefined;
  }

  return settleCompactionDelivery({
    tx,
    delivery: input,
    locked,
    items,
    commandItems,
    compaction,
  });
}

async function finishDelivery(
  tx: Db,
  input: DeliveryInput,
  locked: Run,
  items: ReadonlyArray<ChatDelivery>,
): Promise<BoundaryDelivery> {
  if (needsDeferredFinalCompaction(input, items)) {
    return deliverDeferredFinalCompaction(tx, input, locked);
  }

  const compactDelivery = await attemptCompactionDelivery(
    tx,
    input,
    locked,
    items,
  );

  return (
    compactDelivery ??
    finishOrdinaryDelivery({ tx, delivery: input, locked, items })
  );
}

function needsDeferredFinalCompaction(
  input: DeliveryInput,
  items: ReadonlyArray<ChatDelivery>,
): boolean {
  return (
    input.finalAnswer === true &&
    items.some(isCompactCommand) &&
    input.boundaryCompaction === undefined
  );
}

async function deliverDeferredFinalCompaction(
  tx: Db,
  input: DeliveryInput,
  locked: Run,
): Promise<BoundaryDelivery> {
  const cause: DeliveryCause = 'compaction';

  const { closedReply, message } = await closeSegmentAndStore(tx, input, {
    locked,
    cause,
    items: [],
  });

  const attemptId = await moveRunToDelivery(tx, locked, input.attemptId, {
    items: [],
    message,
    cause,
    stoppedCalls: [],
    stepBudgetUsed: input.stepBudgetUsed ?? 0,
  });

  return { kind: 'delivered', closedReply, message, attemptId, cause };
}

async function finishOrdinaryDelivery(input: {
  tx: Db;
  delivery: DeliveryInput;
  locked: Run;
  items: ReadonlyArray<ChatDelivery>;
}): Promise<BoundaryDelivery> {
  const { tx, delivery, locked, items } = input;
  const deliverableItems = items.filter((item) => !isCompactCommand(item));

  if (deliverableItems.length === 0) return { kind: 'nothing-pending' };

  const cause = deliveryCause(delivery, deliverableItems);

  const { closedReply, message } = await closeSegmentAndStore(
    tx,
    closingAs(delivery, cause),
    { locked, cause, items: deliverableItems },
  );

  if (
    cause === 'steer' &&
    deliverableItems.every((item) => item.producer === 'owner')
  ) {
    await persistFirstEpochBaselines(tx, locked, delivery.baselines);
  }

  const attemptId = await moveRunToDelivery(tx, locked, delivery.attemptId, {
    items: deliverableItems,
    message,
    cause,
    stoppedCalls: delivery.stoppedCalls ?? [],
  });

  return {
    kind: 'delivered',
    ...(closedReply !== undefined && { closedReply }),
    message,
    attemptId,
    cause,
  };
}
