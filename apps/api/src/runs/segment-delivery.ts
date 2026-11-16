/**
 * The delivery of pending `steer` and `interrupt` items to a live Run
 * (run-steering D3/D4): the step-end query that stops a model call, and the one
 * fenced transaction that closes the current segment's reply, stores the
 * delivered message, and moves the Run onto it.
 */

import { randomUUID } from 'node:crypto';

import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { ChatJobsRepository } from '../jobs/chat-jobs.repository';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import { type StoppedCall } from '../chats/interrupted-notice';
import type { MessagePart } from '../chats/context-builder';
import type { CompactionSummary } from '../compaction/compaction.service';
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
import {
  appendDeliveryEvent,
  closeAndPublishBoundaryCheckpoint,
  deliverCompactionItems,
  deliveryCause,
  finishCompactionDelivery,
  isCompactCommand,
} from './boundary-compaction-delivery';

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
      checkpointId?: string;
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

/** What caused a delivery: an interrupt, owner steer, or job notice. */
export type DeliveryCause = 'steer' | 'interrupt' | 'notice' | 'compaction';

export type DeliveryInput = {
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
  /** The configured liveness window for Chat job workers. */
  deadWorkerAfterSeconds: number;
  /**
   * The first-epoch baselines the closing segment's attempt derived: a steer
   * closes its reply `completed`, the successful turn that establishes them.
   * They are written only when every delivered item is a steer.
   */
  baselines?: FirstEpochBaselines;
  boundaryCompaction?: {
    ids: ReadonlyArray<string>;
    summary: CompactionSummary | null;
    continueItem: MessagePart;
    stepBudgetUsed: number;
    publishCheckpoint: (tx: Db, reply: Message) => Promise<string>;
  };
};

async function storeDeliveredMessage(
  tx: Db,
  locked: Run,
  items: ReadonlyArray<ChatDelivery>,
  extraParts: ReadonlyArray<MessagePart> = [],
): Promise<Message> {
  const parts = [...items.flatMap((item) => item.parts), ...extraParts];
  const ownerAuthored = items.some((item) => item.producer === 'owner');

  const message = ownerAuthored
    ? await new MessagesRepository(tx).createUserMessageIfAbsent({
        id: randomUUID(),
        chatId: locked.chatId,
        senderUserId: locked.userId,
        parts,
      })
    : await new MessagesRepository(tx).create({
        id: randomUUID(),
        chatId: locked.chatId,
        role: 'user',
        senderUserId: null,
        parts,
        attachments: [],
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
  if (cause !== 'interrupt') return input;
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
async function closeReply(
  tx: Db,
  closing: DeliveryInput,
  locked: Run,
  cause: DeliveryCause,
): Promise<Message | undefined> {
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

  return closedReply;
}

async function closeSegmentAndStore(
  tx: Db,
  closing: DeliveryInput,
  delivery: {
    locked: Run;
    cause: DeliveryCause;
    items: ReadonlyArray<ChatDelivery>;
  },
  extraParts: ReadonlyArray<MessagePart> = [],
): Promise<{ closedReply: Message | undefined; message: Message }> {
  const { locked, cause, items } = delivery;
  const closedReply = await closeReply(tx, closing, locked, cause);
  const message = await storeDeliveredMessage(tx, locked, items, extraParts);

  return { closedReply, message };
}

/**
 * Mark the items delivered as `message`, move the Run onto it under a fresh
 * attempt, and append `run.delivered`. Returns that attempt's id.
 */
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
  const commandIds = new Set(input.commandItems.map((item) => item.id));

  for (const item of [...input.items, ...input.commandItems]) {
    const marked = await deliveries.markDelivered(
      item.id,
      input.locked.userId,
      {
        ...(!commandIds.has(item.id) && { messageId: input.message.id }),
        runId: input.locked.id,
      },
    );

    if (!marked) throw new Error(`Steer item ${item.id} was not pending.`);
  }
}

async function moveRunToDelivery(
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

  await appendDeliveryEvent({ tx, runId, delivery, message, attemptId });

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

  if (items.length === 0) return { kind: 'nothing-pending' };

  return finishDelivery(tx, input, locked, items);
}

async function finishDelivery(
  tx: Db,
  input: DeliveryInput,
  locked: Run,
  items: ReadonlyArray<ChatDelivery>,
): Promise<BoundaryDelivery> {
  const compactDelivery = await deliverCompactionItems({
    tx,
    delivery: input,
    locked,
    items,
    finish: ({ lockedItems, commandItems, messageItems, compaction }) =>
      finishCompactionDelivery({
        delivery: input,
        locked,
        lockedItems,
        commandItems,
        messageItems,
        compaction,
        closeAndPublish: (cause) =>
          closeAndPublishBoundaryCheckpoint({
            tx,
            delivery: input,
            locked,
            cause,
            closeReply: () =>
              closeReply(tx, closingAs(input, cause), locked, cause),
            persistBaselines: () =>
              persistFirstEpochBaselines(tx, locked, input.baselines),
          }),
        storeMessage: (storedItems, extraParts) =>
          storeDeliveredMessage(tx, locked, storedItems, extraParts),
        moveRun: (move) => moveRunToDelivery(tx, locked, input.attemptId, move),
      }),
  });

  if (compactDelivery !== undefined) return compactDelivery;

  return finishOrdinaryDelivery({ tx, delivery: input, locked, items });
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
