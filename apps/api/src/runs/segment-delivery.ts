/**
 * The delivery of pending `steer` and `interrupt` items to a live Run
 * (run-steering D3/D4): the step-end query that stops a model call, and the one
 * fenced transaction that closes the current segment's reply, stores the
 * delivered message, and moves the Run onto it.
 */

import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import { runs, type ChatDelivery, type Message, type Run } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import {
  finalizeRunReply,
  type AssistantTurnTelemetry,
  type AssistantTurnWrite,
  type BillingCatalog,
} from './run-reply-finalizer';
import { RunEventsRepository, RunsRepository } from './runs-repository';

export type BoundaryDelivery =
  | {
      kind: 'delivered';
      /** The reply the delivery closed, when this call wrote one. */
      closedReply?: Message;
      message: Message;
      /** The attempt that runs the delivered message's segment. */
      attemptId: string;
    }
  /** No pending item remained: the transaction wrote nothing. */
  | { kind: 'nothing-pending' }
  /** The attempt was superseded, the Run is terminal, or a cancel is recorded. */
  | { kind: 'fenced' };

/** A delivery that moved the Run onto a new message. */
export type DeliveredBoundary = Extract<
  BoundaryDelivery,
  { kind: 'delivered' }
>;

type DeliveryInput = {
  run: { runId: string; userId: string };
  attemptId: string;
  /** The closing segment's usage event, as the terminal path writes it. */
  modelCompleted?: {
    usage?: unknown;
    finishReason: unknown;
    telemetry?: AssistantTurnTelemetry;
  };
  /** The attempt's live reply, when its collector is at hand. */
  live?: AssistantTurnWrite;
  telemetry?: AssistantTurnTelemetry;
  models: BillingCatalog;
};

/**
 * Close the segment's reply as `completed` and publish its usage, then store
 * ONE user message holding every item's parts in order.
 */
async function closeSegmentAndStore(
  tx: Db,
  input: DeliveryInput,
  locked: Run,
  items: ReadonlyArray<ChatDelivery>,
): Promise<{ closedReply: Message | undefined; message: Message }> {
  const closedReply = await finalizeRunReply(tx, {
    run: locked,
    status: 'completed',
    attemptId: input.attemptId,
    live: input.live,
    telemetry: input.telemetry,
    models: input.models,
  });
  if (input.modelCompleted) {
    await new RunEventsRepository(tx).append(
      locked.id,
      'model.completed',
      input.modelCompleted,
    );
  }
  const message = await new MessagesRepository(tx).createUserMessageIfAbsent({
    id: randomUUID(),
    chatId: locked.chatId,
    senderUserId: locked.userId,
    parts: items.flatMap((item) => item.parts),
  });
  if (!message)
    throw new Error(`Run ${locked.id} could not store its delivery.`);
  return { closedReply, message };
}

/**
 * Mark the items delivered as `message`, move the Run onto it under a fresh
 * attempt, and append `run.delivered`. Returns that attempt's id.
 */
async function moveRunToDelivery(
  tx: Db,
  locked: Run,
  items: ReadonlyArray<ChatDelivery>,
  message: Message,
): Promise<string> {
  const { id: runId, userId } = locked;
  const deliveries = new ChatDeliveriesRepository(tx);
  for (const item of items) {
    await deliveries.markDelivered(item.id, userId, {
      messageId: message.id,
      runId,
    });
  }
  const attemptId = randomUUID();
  await tx
    .update(runs)
    .set({ messageId: message.id, activeAttemptId: attemptId })
    .where(and(eq(runs.id, runId), eq(runs.userId, userId)));
  await new RunEventsRepository(tx).append(runId, 'run.delivered', {
    messageId: message.id,
    deliveryIds: items.map((item) => item.id),
    cause: 'steer',
    stoppedCalls: [],
    attemptId,
  });
  return attemptId;
}

/**
 * One tenant transaction, in the Run-then-chat lock order. Locks the Run row
 * behind the attempt and cancel fences, then the chat row, then the Chat's
 * pending items. With none, it writes nothing. Otherwise it closes the current
 * segment's reply, stores the delivered message, marks the items delivered,
 * moves the Run onto that message under a fresh attempt, and appends
 * `run.delivered` (no `run.started`: the claim's delivery sequence stays
 * current).
 *
 * The Run's `message_id` moves last: the foreign key to `messages` is
 * immediate, so the message must exist first, and the row lock taken first
 * already fences every other writer of the Run.
 */
export async function deliverPendingSteering(
  tx: Db,
  input: DeliveryInput,
): Promise<BoundaryDelivery> {
  const locked = await new RunsRepository(tx).lockForDelivery(
    input.run.runId,
    input.run.userId,
    input.attemptId,
  );
  if (!locked) return { kind: 'fenced' };
  const { chatId, userId } = locked;
  if (!(await new ChatsRepository(tx).lock(chatId, userId))) {
    return { kind: 'fenced' };
  }
  const deliveries = new ChatDeliveriesRepository(tx);
  const items = await deliveries.lockPendingSteering(chatId, userId);
  if (items.length === 0) return { kind: 'nothing-pending' };

  const { closedReply, message } = await closeSegmentAndStore(
    tx,
    input,
    locked,
    items,
  );
  const attemptId = await moveRunToDelivery(tx, locked, items, message);
  return {
    kind: 'delivered',
    ...(closedReply !== undefined && { closedReply }),
    message,
    attemptId,
  };
}
