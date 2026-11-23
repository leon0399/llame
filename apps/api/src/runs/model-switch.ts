/**
 * The model switch inside a live Run (model-roles D6): one fenced transaction
 * that closes the failed reply, delivers a host message holding the switch
 * item and the pending boundary items, moves the Run onto that message, and
 * records the switch on the new model.
 *
 * The caller owns the rest of D6: it applies the failed-send cut before this
 * call, writes the hold after it, and re-enters execution on the new model.
 * This module deliberately does none of those, so a later layer can keep them
 * beside their policy while the record is written here.
 */

import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { isCompactCommand } from '../chats/commands/parse-chat-command';
import { ChatsRepository } from '../chats/chats-repository';
import {
  createModelChangeItem,
  type ModelChangeModel,
} from '../chats/context-item-producers';
import {
  type ChatDelivery,
  type Chat,
  type Message,
  type Run,
} from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { ChatJobsRepository } from '../jobs/chat-jobs.repository';
import { type FailureClass } from '../models/provider-failure/provider-failure';
import { writeSwitchHold } from '../chats/selection-update';
import { revertAtFor } from '../models/model-selection';
import { RunEventsRepository, RunsRepository } from './runs-repository';
import { RunRowFenceRepository } from './run-row-fence.repository';
import { moveRunToDelivery } from './segment-delivery';
import {
  closeReply,
  storeDeliveredMessage,
  type DeliveryInput,
} from './segment-delivery-close';

/** Who decided the switch: the owner, or the failover policy. */
export type ModelSwitchOrigin = 'owner' | 'policy';

/** The event a switch appends after its `run.delivered`. */
export type ModelSwitchedPayload = {
  fromModelId: string;
  fromEffort: string | null;
  toModelId: string;
  toEffort: string | null;
  failureClass: FailureClass;
  messageId: string;
  origin: ModelSwitchOrigin;
};

export type ModelSwitchInput = {
  /** The closing segment's inputs: its live reply, usage, and Chat. */
  delivery: DeliveryInput;
  /**
   * The prior model as the catalog names it. The id always comes from the Run
   * row, so the item and the event cannot name different sources.
   */
  fromModel: ModelChangeModel;
  /** The selected model, as the switch item names it. */
  toModel: ModelChangeModel;
  /** `runs.effort` after the switch, as `effortAfterSwitch` answered it. */
  toEffort: string | null;
  failureClass: FailureClass;
  origin: ModelSwitchOrigin;
  failureTiming?: { resetsAt?: Date; hintMs?: number };
};

export type ModelSwitchResult = {
  attemptId: string;
  message: Message;
  messageId: string;
  closedReply: Message;
};

/**
 * Lock the Run, then its Chat, and collect the boundary items the switch
 * delivers: every pending steer or notice, but no compact command (that is an
 * interrupt, not content of a switch).
 */
async function lockForSwitch(
  tx: Db,
  delivery: DeliveryInput,
): Promise<{ locked: Run; chat: Chat; items: ReadonlyArray<ChatDelivery> }> {
  const { run, attemptId } = delivery;

  const locked = await new RunRowFenceRepository(tx).lockForDelivery(
    run.runId,
    run.userId,
    attemptId,
  );

  if (!locked) {
    throw new Error(`Run ${run.runId} no longer owns its attempt to switch.`);
  }

  if (locked.cancelRequestedAt !== null) {
    throw new Error(`Run ${run.runId} was cancelled before its switch.`);
  }

  const { chatId, userId } = locked;

  if (!(await new ChatsRepository(tx).lock(chatId, userId))) {
    throw new Error(`Run ${run.runId} could not lock its Chat to switch.`);
  }

  const chat = await new ChatsRepository(tx).findById(chatId, userId);

  if (chat === undefined) {
    throw new Error(`Run ${run.runId} could not load its Chat to switch.`);
  }

  await new ChatJobsRepository(tx).settleOnDeadWorkers(
    chatId,
    userId,
    delivery.deadWorkerAfterSeconds,
  );

  const pending = await new ChatDeliveriesRepository(tx).lockPendingBoundary(
    chatId,
    userId,
  );

  return {
    locked,
    chat,
    items: pending.filter((item) => !isCompactCommand(item)),
  };
}

async function writeSwitchHoldForFailure(
  tx: Db,
  chat: Chat,
  run: Run,
  switching: ModelSwitchInput,
): Promise<void> {
  const failureTiming = switching.failureTiming;

  if (failureTiming === undefined) return;

  const chats = new ChatsRepository(tx);
  const now = await chats.transactionNow();

  await writeSwitchHold(chats, chat, {
    runSelectionRevision: run.selectionRevision,
    runSelector: run.selector,
    modelId: switching.toModel.id,
    effort: switching.toEffort,
    revertAt: revertAtFor(
      {
        resetsAt: failureTiming.resetsAt?.toISOString() ?? null,
        hintMs: failureTiming.hintMs ?? null,
      },
      now,
    ),
  });
}

/** Write the new model onto the Run and record the switch after its delivery. */
async function recordSwitch(
  tx: Db,
  input: {
    locked: Run;
    chat: Chat;
    switching: ModelSwitchInput;
    attemptId: string;
    messageId: string;
  },
): Promise<void> {
  const { locked, switching } = input;
  const { toModel, toEffort } = switching;

  const moved = await new RunsRepository(tx).updateForAttempt(
    locked.id,
    locked.userId,
    input.attemptId,
    { modelId: toModel.id, effort: toEffort },
  );

  if (!moved) {
    throw new Error(`Run ${locked.id} could not take its switched model.`);
  }

  await writeSwitchHoldForFailure(tx, input.chat, locked, switching);
  await new RunEventsRepository(tx).append(locked.id, 'model.switched', {
    fromModelId: locked.modelId,
    fromEffort: locked.effort,
    toModelId: toModel.id,
    toEffort,
    failureClass: switching.failureClass,
    messageId: input.messageId,
    origin: switching.origin,
  } satisfies ModelSwitchedPayload);
}

/**
 * Close the segment's reply as failed, store the host message of the switch,
 * move the Run onto it, and record the new model and the event. Runs in the
 * caller's transaction, in the Run-then-Chat lock order.
 */
export async function deliverModelSwitch(
  tx: Db,
  input: ModelSwitchInput,
): Promise<ModelSwitchResult> {
  const fromAttemptId = input.delivery.attemptId;
  const { locked, chat, items } = await lockForSwitch(tx, input.delivery);

  const closedReply = await closeReply(tx, input.delivery, locked, 'failover');

  if (closedReply === undefined) {
    throw new Error(`Run ${locked.id} had no reply to close for its switch.`);
  }

  const switchItem = createModelChangeItem({
    oldModel: { ...input.fromModel, id: locked.modelId },
    newModel: input.toModel,
    runId: locked.id,
    failureClass: input.failureClass,
  });

  const message = await storeDeliveredMessage(tx, locked, items, {
    leading: [switchItem],
  });

  const attemptId = await moveRunToDelivery(tx, locked, fromAttemptId, {
    items,
    message,
    cause: 'failover',
    stoppedCalls: [],
  });

  await recordSwitch(tx, {
    locked,
    chat,
    switching: input,
    attemptId,
    messageId: message.id,
  });

  return { attemptId, message, messageId: message.id, closedReply };
}
