import { randomUUID } from 'node:crypto';
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
import { RunEventsRepository } from './runs-repository';
import { type SupersededModelOutput } from './superseded-output';
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
  /** A final-answer checkpoint is published by the terminal transaction. */
  | {
      kind: 'final-compacted';
      commandItems: ReadonlyArray<ChatDelivery>;
      compaction: NonNullable<DeliveryInput['boundaryCompaction']>;
    }
  /** No pending item remained: the transaction wrote nothing. */
  | {
      kind: 'nothing-pending';
      compactionFailed?: true;
    }
  /** The attempt was superseded or the Run is terminal. */
  | { kind: 'fenced' }
  /** A cancellation is recorded: the items stay pending. */
  | { kind: 'cancelled' };

/** A delivery that moved the Run onto a new message. */
export type DeliveredBoundary = Extract<
  BoundaryDelivery,
  { kind: 'delivered' }
>;

/**
 * What caused a delivery: an interrupt, owner steer, job notice, compaction,
 * or a model switch inside the Run. A switch supplies its cause explicitly;
 * the item-driven derivation never yields it.
 */
export type DeliveryCause =
  | 'steer'
  | 'interrupt'
  | 'notice'
  | 'compaction'
  | 'failover';

export type DeliveredEventPayload = {
  deliveryIds: Array<string>;
  cause: DeliveryCause;
  stoppedCalls: ReadonlyArray<StoppedCall>;
  attemptId: string;
  checkpointId?: string;
  stepBudgetUsed?: number;
};

export function deliveredEventPayload(
  attemptId: string,
  delivery: {
    items: ReadonlyArray<ChatDelivery>;
    cause: DeliveryCause;
    stoppedCalls: ReadonlyArray<StoppedCall>;
    commandItems?: ReadonlyArray<ChatDelivery>;
    checkpointId?: string;
    stepBudgetUsed?: number;
  },
): DeliveredEventPayload {
  return {
    deliveryIds: [...delivery.items, ...(delivery.commandItems ?? [])].map(
      (item) => item.id,
    ),
    cause: delivery.cause,
    stoppedCalls: delivery.stoppedCalls,
    attemptId,
    ...(delivery.checkpointId !== undefined && {
      checkpointId: delivery.checkpointId,
    }),
    ...(delivery.stepBudgetUsed !== undefined && {
      stepBudgetUsed: delivery.stepBudgetUsed,
    }),
  };
}

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
  finalAnswer?: true;
  stepBudgetUsed?: number;
  /**
   * The cut of a failed send this delivery closes (continue-after-broken-send
   * D6): appended as `model.superseded` in the same transaction that stores
   * the reply's cut and notice.
   */
  superseded?: SupersededModelOutput;
  boundaryCompaction?: {
    ids: ReadonlyArray<string>;
    summary: CompactionSummary | null;
    quote: string | null;
    stepBudgetUsed: number;
    automatic?: true;
    finalAnswer?: true;
    publishCheckpoint: (tx: Db, reply: Message) => Promise<string>;
  };
};

/**
 * Store ONE user message of the delivered items' parts. `leading` parts
 * precede every item (a model switch puts its notice first, the pending steer
 * after it); `trailing` parts follow them (a compaction's continuation item).
 */
export async function storeDeliveredMessage(
  tx: Db,
  locked: Run,
  items: ReadonlyArray<ChatDelivery>,
  parts?: {
    readonly leading?: ReadonlyArray<MessagePart>;
    readonly trailing?: ReadonlyArray<MessagePart>;
  },
): Promise<Message> {
  const stored = [
    ...(parts?.leading ?? []),
    ...items.flatMap((item) => item.parts),
    ...(parts?.trailing ?? []),
  ];

  const ownerAuthored = items.some((item) => item.producer === 'owner');

  const message = ownerAuthored
    ? await new MessagesRepository(tx).createUserMessageIfAbsent({
        id: randomUUID(),
        chatId: locked.chatId,
        senderUserId: locked.userId,
        parts: stored,
      })
    : await new MessagesRepository(tx).create({
        id: randomUUID(),
        chatId: locked.chatId,
        role: 'user',
        senderUserId: null,
        parts: stored,
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

/**
 * The usage a failover delivery records for the reply it closes: `error`,
 * never `complete`, and not `interrupted` — the provider failed, the owner did
 * not stop it.
 */
export function failedByFailover(
  telemetry: AssistantTurnTelemetry,
): AssistantTurnTelemetry {
  return {
    ...telemetry,
    status: 'error',
    complete: false,
  };
}

/** The telemetry a delivery stored for the reply it closed: the segment's own, or the terminal cause's. */
export function closedTelemetry(
  delivery: DeliveredBoundary,
  telemetry: AssistantTurnTelemetry,
): AssistantTurnTelemetry {
  if (delivery.cause === 'interrupt') return abortedByInterrupt(telemetry);

  return delivery.cause === 'failover'
    ? failedByFailover(telemetry)
    : telemetry;
}

/**
 * The same delivery with the terminal cause's close applied to the telemetry
 * it carries. Only `closeReply` calls it: the cause decides what the reply's
 * usage says, whoever prepared the delivery.
 */
function closingAs(input: DeliveryInput, cause: DeliveryCause): DeliveryInput {
  if (cause !== 'interrupt' && cause !== 'failover') return input;

  const close = cause === 'interrupt' ? abortedByInterrupt : failedByFailover;

  const { live, modelCompleted, telemetry } = input;

  return {
    ...input,
    ...(live !== undefined && {
      live: { ...live, telemetry: close(live.telemetry) },
    }),
    ...(modelCompleted?.telemetry !== undefined && {
      modelCompleted: {
        ...modelCompleted,
        telemetry: close(modelCompleted.telemetry),
      },
    }),
    ...(telemetry !== undefined && {
      telemetry: close(telemetry),
    }),
  };
}

/**
 * A delivery closes the reply while the Run is live, so the Run's status does
 * not decide the completeness of its usage (run-usage-accounting). A failover
 * is the exception: the reply it closes failed, so its usage stays incomplete
 * even though the Run itself keeps living.
 */
async function finalizeSegmentUsage(
  tx: Db,
  locked: Run,
  closing: DeliveryInput,
  cause: DeliveryCause,
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
    closedBySteer: cause !== 'failover',
  });
}

/**
 * Close the segment's reply and publish its usage, then store ONE user message
 * holding every item's parts in order. A steer closes it `completed`, an
 * interrupt `aborted`, a model switch `failed`.
 */
export async function closeReply(
  tx: Db,
  closingInput: DeliveryInput,
  locked: Run,
  cause: DeliveryCause,
): Promise<Message | undefined> {
  // The terminal cause decides what the reply's usage says, whoever prepared
  // the delivery (a switch closes a reply it did not steer).
  const closing = closingAs(closingInput, cause);

  await finalizeSegmentUsage(tx, locked, closing, cause);

  const closedReply = await finalizeRunReply(tx, {
    run: locked,
    status:
      cause === 'interrupt'
        ? 'cancelled'
        : cause === 'failover'
          ? 'failed'
          : 'completed',
    attemptId: closing.attemptId,
    live: closing.live,
    telemetry: closing.telemetry,
    models: closing.models,
  });

  // The cut this segment closed with: the reply above already holds the kept
  // parts and the notice, and this event names the output it dropped. It
  // precedes `model.completed` because the live bridge prunes the step's part
  // starts at `model.completed`, so a cut arriving after it would survive in
  // the live view until reload (design D7).
  if (closing.superseded !== undefined) {
    await new RunEventsRepository(tx).append(
      locked.id,
      'model.superseded',
      closing.superseded,
    );
  }

  if (closing.modelCompleted) {
    await new RunEventsRepository(tx).append(
      locked.id,
      'model.completed',
      closedReply === undefined
        ? closing.modelCompleted
        : { ...closing.modelCompleted, telemetry: closedReply.usage },
    );
  }

  return closedReply;
}

export async function closeSegmentAndStore(
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

  const message = await storeDeliveredMessage(tx, locked, items, {
    trailing: extraParts,
  });

  return { closedReply, message };
}
