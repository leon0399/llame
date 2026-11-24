/**
 * The model switch inside a live Run (model-roles D6): one fenced transaction
 * that closes the failed reply, delivers a host message holding the switch
 * item and the pending boundary items, moves the Run onto that message, and
 * records the switch on the new model.
 *
 * The caller applies the failed-send cut and re-enters execution on the new
 * model. This module writes the hold beside the switch event in the same
 * fenced transaction.
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
  type RunEvent,
} from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { ChatJobsRepository } from '../jobs/chat-jobs.repository';
import {
  type FailureClass,
  type ProviderFailure,
} from '../models/provider-failure/provider-failure';
import { recordOwnerSwitch } from '../chats/selection-update';
import { isRecord, isString } from '@workspace/runtime-safety';
import { type FailureTiming, revertAtFor } from '../models/model-selection';
import { RunsRepository } from './runs-repository';
import { RunRowFenceRepository } from './run-row-fence.repository';
import { moveRunToDelivery } from './segment-delivery';
import {
  closeReply,
  storeDeliveredMessage,
  type DeliveryInput,
} from './segment-delivery-close';

/** Whether the latest delivery starts a failover segment without a request. */
export function startsFailoverSegment(
  events: ReadonlyArray<Pick<RunEvent, 'eventType' | 'payload'>>,
): boolean {
  const latestDeliveryIndex = events.findLastIndex(
    (event) => event.eventType === 'run.delivered',
  );

  const latestDelivery = events[latestDeliveryIndex];

  return (
    latestDelivery !== undefined &&
    isRecord(latestDelivery.payload) &&
    latestDelivery.payload['cause'] === 'failover' &&
    !events
      .slice(latestDeliveryIndex + 1)
      .some((event) => event.eventType === 'model.requested')
  );
}

/** The index just past a reply's last tool part, or 0 when it has none. */
export function afterLastToolPart(parts: ReadonlyArray<unknown>): number {
  return (
    parts.findLastIndex(
      (part) => isRecord(part) && isString(part['toolCallId']),
    ) + 1
  );
}

/**
 * The parts a switch keeps from a failed send: everything before the step's
 * model output, and the step's settled tool parts.
 */
export function partsKeptBySwitch<T>(
  parts: ReadonlyArray<T>,
  outputStart: number,
): Array<T> {
  return parts.slice(0, Math.max(outputStart, afterLastToolPart(parts)));
}

/** The reset and retry hint of a failure, in the form a fallback hold reads. */
export function failureTimingOf(failure: ProviderFailure): FailureTiming {
  return {
    resetsAt:
      failure.resetsAt === undefined
        ? null
        : new Date(failure.resetsAt).toISOString(),
    hintMs: failure.hintMs ?? null,
  };
}

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
  failureTiming: FailureTiming;
};

export type ModelSwitchResult = {
  attemptId: string;
  message: Message;
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
): Promise<
  { locked: Run; chat: Chat; items: ReadonlyArray<ChatDelivery> } | undefined
> {
  const { run, attemptId } = delivery;

  const locked = await new RunRowFenceRepository(tx).lockForDelivery(
    run.runId,
    run.userId,
    attemptId,
  );

  if (!locked || locked.cancelRequestedAt !== null) return undefined;

  const { chatId, userId } = locked;
  const chat = await new ChatsRepository(tx).lock(chatId, userId);

  if (chat === undefined) {
    throw new Error(`Run ${run.runId} could not lock its Chat to switch.`);
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

  const chats = new ChatsRepository(tx);

  const revertAt = revertAtFor(
    switching.failureTiming,
    await chats.transactionNow(),
  );

  await recordOwnerSwitch(tx, {
    chat: input.chat,
    run: locked,
    eventRunId: locked.id,
    toModelId: toModel.id,
    toEffort,
    failureClass: switching.failureClass,
    messageId: input.messageId,
    revertAt,
    origin: switching.origin,
  });
}

/**
 * Close the segment's reply as failed, store the host message of the switch,
 * move the Run onto it, and record the new model and the event. Runs in the
 * caller's transaction, in the Run-then-Chat lock order.
 */
export async function deliverModelSwitch(
  tx: Db,
  input: ModelSwitchInput,
): Promise<ModelSwitchResult | undefined> {
  const fromAttemptId = input.delivery.attemptId;
  const lockedForSwitchResult = await lockForSwitch(tx, input.delivery);

  if (lockedForSwitchResult === undefined) return undefined;

  const { locked, chat, items } = lockedForSwitchResult;

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

  return { attemptId, message, closedReply };
}
