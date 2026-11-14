/**
 * The delivery of pending `steer` and `interrupt` items to a live Run
 * (run-steering D3/D4): the step-end query that stops a model call, and the one
 * fenced transaction that closes the current segment's reply, stores the
 * delivered message, and moves the Run onto it.
 */

import { randomUUID } from 'node:crypto';

import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import { type StoppedCall } from '../chats/interrupted-notice';
import { type ChatDelivery, type Message, type Run } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import {
  type RecencyDigestInitialization,
  type SkillCatalogFreeze,
} from './run-execution.service';
import {
  finalizeRunReply,
  type AssistantTurnTelemetry,
  type AssistantTurnWrite,
  type BillingCatalog,
} from './run-reply-finalizer';
import { RunEventsRepository, RunsRepository } from './runs-repository';
import { RunRowFenceRepository } from './run-row-fence.repository';
import { finalizeUsageCompleteness } from './usage-completeness';

/**
 * The baselines only a successful turn establishes: the chat's first digest
 * baseline and a first-epoch skill-catalog freeze. Both live only in the
 * system prompt, so no history item accompanies them and they ride the
 * attempt-fenced transaction that closes the turn.
 */
export type FirstEpochBaselines = {
  recencyDigestInitialization?: RecencyDigestInitialization | undefined;
  skillCatalogFreeze?: SkillCatalogFreeze | undefined;
};

export async function persistFirstEpochBaselines(
  tx: Db,
  run: { chatId: string; userId: string },
  baselines: FirstEpochBaselines | undefined,
): Promise<void> {
  const chatsRepo = new ChatsRepository(tx);

  const { recencyDigestInitialization: digest, skillCatalogFreeze: freeze } =
    baselines ?? {};

  if (digest !== undefined) {
    await chatsRepo.setRecencyDigestIfAbsent(
      run.chatId,
      run.userId,
      digest.baseline,
      digest.told,
    );
  }

  if (freeze !== undefined) {
    await chatsRepo.setSkillCatalogBaseline({
      chatId: run.chatId,
      ownerUserId: run.userId,
      baseline: freeze.baseline,
      rebakedFrom: freeze.rebakedFrom,
    });
    await chatsRepo.updateSkillCatalogTold(run.chatId, run.userId, freeze.told);
  }
}

export type BoundaryDelivery =
  | {
      kind: 'delivered';
      /** The reply the delivery closed, when this call wrote one. */
      closedReply?: Message;
      message: Message;
      /** The attempt that runs the delivered message's segment. */
      attemptId: string;
      /** `interrupt` closed the reply `aborted`; `steer` closed it as given. */
      cause: DeliveryCause;
    }
  /** No pending item remained: the transaction wrote nothing. */
  | { kind: 'nothing-pending' }
  /** The attempt was superseded or the Run is terminal. */
  | { kind: 'fenced' }
  /** A cancellation is recorded: the items stay pending. */
  | { kind: 'cancelled' };

/** A delivery that moved the Run onto a new message. */
export type DeliveredBoundary = Extract<
  BoundaryDelivery,
  { kind: 'delivered' }
>;

/** What caused a delivery: an `interrupt` item among the items, or only steers. */
export type DeliveryCause = 'steer' | 'interrupt';

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
  /**
   * Set only by the interrupt stop: the `bash` and MCP calls it stopped after
   * they started. Its presence makes the delivery's cause `interrupt` even when
   * the owner withdrew the item, because the step was cut (run-steering D7).
   * The step-end check leaves it unset and takes the cause from the items.
   */
  stoppedCalls?: ReadonlyArray<StoppedCall>;
  models: BillingCatalog;
  /**
   * The first-epoch baselines the closing segment's attempt derived: a steer
   * closes its reply `completed`, the successful turn that establishes them.
   * They are written only when every delivered item is a steer.
   */
  baselines?: FirstEpochBaselines;
};

async function storeDeliveredMessage(
  tx: Db,
  locked: Run,
  items: ReadonlyArray<ChatDelivery>,
): Promise<Message> {
  const message = await new MessagesRepository(tx).createUserMessageIfAbsent({
    id: randomUUID(),
    chatId: locked.chatId,
    senderUserId: locked.userId,
    parts: items.flatMap((item) => item.parts),
  });

  if (!message) {
    throw new Error(`Run ${locked.id} could not store its delivery.`);
  }

  return message;
}

/**
 * The usage an interrupt delivery records for the reply it closes: `aborted`,
 * never `complete`, and marked so a later request replays the reply under the
 * interrupted-reply rule of `reasoning-output`.
 */
export function abortedByInterrupt(
  telemetry: AssistantTurnTelemetry,
): AssistantTurnTelemetry {
  return {
    ...telemetry,
    status: 'aborted',
    complete: false,
    interrupted: true,
  };
}

/** The telemetry a delivery stored for the reply it closed: the segment's own, or the interrupt's. */
export function closedTelemetry(
  delivery: DeliveredBoundary,
  telemetry: AssistantTurnTelemetry,
): AssistantTurnTelemetry {
  return delivery.cause === 'interrupt'
    ? abortedByInterrupt(telemetry)
    : telemetry;
}

function closingAs(input: DeliveryInput, cause: DeliveryCause): DeliveryInput {
  if (cause === 'steer') return input;
  const { live, modelCompleted, telemetry } = input;

  return {
    ...input,
    ...(live !== undefined && {
      live: { ...live, telemetry: abortedByInterrupt(live.telemetry) },
    }),
    ...(modelCompleted?.telemetry !== undefined && {
      modelCompleted: {
        ...modelCompleted,
        telemetry: abortedByInterrupt(modelCompleted.telemetry),
      },
    }),
    ...(telemetry !== undefined && {
      telemetry: abortedByInterrupt(telemetry),
    }),
  };
}

/**
 * A delivery closes the reply while the Run is live, so the Run's status does
 * not decide the completeness of its usage (run-usage-accounting).
 */
async function finalizeSegmentUsage(
  tx: Db,
  locked: Run,
  closing: DeliveryInput,
): Promise<void> {
  const telemetry = closing.modelCompleted?.telemetry;

  if (!telemetry) return;
  await finalizeUsageCompleteness(tx, {
    userId: locked.userId,
    runId: locked.id,
    attemptId: closing.attemptId,
    run: locked,
    chatId: locked.chatId,
    inReplyTo: closing.live?.inReplyTo ?? locked.messageId,
    telemetry,
    closedBySteer: true,
  });
}

/**
 * Close the segment's reply and publish its usage, then store ONE user message
 * holding every item's parts in order. A steer closes it `completed`, an
 * interrupt `aborted`.
 */
async function closeSegmentAndStore(
  tx: Db,
  closing: DeliveryInput,
  delivery: {
    locked: Run;
    cause: DeliveryCause;
    items: ReadonlyArray<ChatDelivery>;
  },
): Promise<{ closedReply: Message | undefined; message: Message }> {
  const { locked, cause, items } = delivery;
  await finalizeSegmentUsage(tx, locked, closing);

  const closedReply = await finalizeRunReply(tx, {
    run: locked,
    status: cause === 'interrupt' ? 'cancelled' : 'completed',
    attemptId: closing.attemptId,
    live: closing.live,
    telemetry: closing.telemetry,
    models: closing.models,
  });

  if (closing.modelCompleted) {
    await new RunEventsRepository(tx).append(
      locked.id,
      'model.completed',
      closing.modelCompleted,
    );
  }

  const message = await storeDeliveredMessage(tx, locked, items);

  return { closedReply, message };
}

/**
 * Mark the items delivered as `message`, move the Run onto it under a fresh
 * attempt, and append `run.delivered`. Returns that attempt's id.
 */
async function moveRunToDelivery(
  tx: Db,
  locked: Run,
  fromAttemptId: string,
  delivery: {
    items: ReadonlyArray<ChatDelivery>;
    message: Message;
    cause: DeliveryCause;
    stoppedCalls: ReadonlyArray<StoppedCall>;
  },
): Promise<string> {
  const { id: runId, userId } = locked;
  const { items, message } = delivery;
  const deliveries = new ChatDeliveriesRepository(tx);

  for (const item of items) {
    const marked = await deliveries.markDelivered(item.id, userId, {
      messageId: message.id,
      runId,
    });

    // The items are locked, so a miss means the transaction must not commit.
    if (!marked) throw new Error(`Steer item ${item.id} was not pending.`);
  }

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
    deliveryIds: items.map((item) => item.id),
    cause: delivery.cause,
    stoppedCalls: delivery.stoppedCalls,
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
 * current). The cause is `interrupt` when the stop cut the step or an
 * `interrupt` item is among the locked items; an item the owner withdrew after
 * the step-end check cannot make that delivery an interrupt.
 *
 * The Run's `message_id` moves last: the foreign key to `messages` is
 * immediate, so the message must exist first, and the row lock taken first
 * already fences every other writer of the Run.
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

  const items = await new ChatDeliveriesRepository(tx).lockPendingSteering(
    chatId,
    userId,
  );

  if (items.length === 0) return { kind: 'nothing-pending' };

  return finishDelivery(tx, input, locked, items);
}

/** Closes the reply, stores the message, and moves the Run onto it. */
async function finishDelivery(
  tx: Db,
  input: DeliveryInput,
  locked: Run,
  items: ReadonlyArray<ChatDelivery>,
): Promise<DeliveredBoundary> {
  const cause: DeliveryCause =
    input.stoppedCalls !== undefined ||
    items.some((item) => item.mode === 'interrupt')
      ? 'interrupt'
      : 'steer';

  const { closedReply, message } = await closeSegmentAndStore(
    tx,
    closingAs(input, cause),
    { locked, cause, items },
  );

  if (cause === 'steer') {
    await persistFirstEpochBaselines(tx, locked, input.baselines);
  }

  const attemptId = await moveRunToDelivery(tx, locked, input.attemptId, {
    items,
    message,
    cause,
    stoppedCalls: input.stoppedCalls ?? [],
  });

  return {
    kind: 'delivered',
    ...(closedReply !== undefined && { closedReply }),
    message,
    attemptId,
    cause,
  };
}
