import { isRecord } from '@workspace/runtime-safety';
import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { parseChatCommand } from '../chats/commands/parse-chat-command';
import type { MessagePart } from '../chats/context-builder';
import type { ChatDelivery, Message, Run } from '../db/schema';
import type { Db } from '../db/tenant-db.service';
import type {
  BoundaryDelivery,
  DeliveryCause,
  DeliveryInput,
} from './segment-delivery';
import { RunEventsRepository } from './runs-repository';

export type BoundaryCompaction = NonNullable<
  DeliveryInput['boundaryCompaction']
>;

type CompactionMove = {
  items: ReadonlyArray<ChatDelivery>;
  commandItems: ReadonlyArray<ChatDelivery>;
  message: Message;
  cause: DeliveryCause;
  stoppedCalls: NonNullable<DeliveryInput['stoppedCalls']>;
  checkpointId: string;
  stepBudgetUsed: number;
};

type FinishCompactionDeliveryInput = {
  delivery: DeliveryInput;
  locked: Run;
  lockedItems: ReadonlyArray<ChatDelivery>;
  commandItems: ReadonlyArray<ChatDelivery>;
  messageItems: ReadonlyArray<ChatDelivery>;
  compaction: BoundaryCompaction;
  closeAndPublish: (cause: DeliveryCause) => Promise<{
    closedReply: Message;
    checkpointId: string;
  }>;
  storeMessage: (
    items: ReadonlyArray<ChatDelivery>,
    extraParts: ReadonlyArray<MessagePart>,
  ) => Promise<Message>;
  moveRun: (input: CompactionMove) => Promise<string>;
};

export function isCompactCommand(item: ChatDelivery): boolean {
  return (
    item.producer === 'owner' &&
    parseChatCommand(item.parts)?.name === 'compact'
  );
}

export function deliveryCause(
  input: DeliveryInput,
  items: ReadonlyArray<ChatDelivery>,
): DeliveryCause {
  const hasOwnerSteer = items.some(
    (item) =>
      item.producer === 'owner' &&
      item.mode === 'steer' &&
      !isCompactCommand(item),
  );

  const hasInterrupt = items.some(
    (item) => item.producer === 'owner' && item.mode === 'interrupt',
  );

  return input.stoppedCalls !== undefined || hasInterrupt
    ? 'interrupt'
    : hasOwnerSteer
      ? 'steer'
      : items.some((item) => !isCompactCommand(item))
        ? 'notice'
        : 'compaction';
}

async function settleFailedCompaction(
  tx: Db,
  locked: Run,
  commandItems: ReadonlyArray<ChatDelivery>,
  live: DeliveryInput['live'],
): Promise<void> {
  if (
    live &&
    !live.parts.some(
      (part) => isRecord(part) && part['type'] === 'data-compaction-failed',
    )
  ) {
    live.parts.push({ type: 'data-compaction-failed', data: {} });
  }

  const deliveries = new ChatDeliveriesRepository(tx);

  for (const item of commandItems) {
    if (
      !(await deliveries.markDelivered(item.id, locked.userId, {
        runId: locked.id,
      }))
    ) {
      throw new Error(`Compact item ${item.id} was not pending.`);
    }
  }

  await new RunEventsRepository(tx).append(
    locked.id,
    'run.compaction_failed',
    {},
  );
}

export async function deliverCompactionItems(input: {
  tx: Db;
  delivery: DeliveryInput;
  locked: Run;
  items: ReadonlyArray<ChatDelivery>;
  finish: (input: {
    lockedItems: ReadonlyArray<ChatDelivery>;
    commandItems: ReadonlyArray<ChatDelivery>;
    messageItems: ReadonlyArray<ChatDelivery>;
    compaction: BoundaryCompaction;
  }) => Promise<BoundaryDelivery>;
}): Promise<BoundaryDelivery | undefined> {
  const compaction = input.delivery.boundaryCompaction;

  if (compaction === undefined) return undefined;

  const commandItems = input.items.filter(
    (item) =>
      isCompactCommand(item) &&
      (compaction.finalAnswer === true || compaction.ids.includes(item.id)),
  );

  if (commandItems.length === 0) return undefined;

  if (compaction.summary === null) {
    await settleFailedCompaction(
      input.tx,
      input.locked,
      commandItems,
      input.delivery.live,
    );

    return { kind: 'compaction-failed' };
  }

  const messageItems = input.items.filter((item) => !isCompactCommand(item));

  if (compaction.finalAnswer === true && messageItems.length === 0) {
    return { kind: 'final-compacted', commandItems, compaction };
  }

  return input.finish({
    lockedItems: input.items,
    commandItems,
    messageItems,
    compaction,
  });
}

export async function finishCompactionDelivery(
  input: FinishCompactionDeliveryInput,
): Promise<BoundaryDelivery> {
  const cause = deliveryCause(input.delivery, input.lockedItems);
  const { closedReply, checkpointId } = await input.closeAndPublish(cause);

  const message = await input.storeMessage(
    input.messageItems,
    input.compaction.finalAnswer === true
      ? []
      : [input.compaction.continueItem],
  );

  const attemptId = await input.moveRun({
    items: input.messageItems,
    commandItems: input.commandItems,
    message,
    cause,
    stoppedCalls: input.delivery.stoppedCalls ?? [],
    checkpointId,
    stepBudgetUsed: input.compaction.stepBudgetUsed,
  });

  return deliveredCompactionResult({
    closedReply,
    message,
    attemptId,
    cause,
    checkpointId,
  });
}

function deliveredCompactionResult(input: {
  closedReply: Message;
  message: Message;
  attemptId: string;
  cause: DeliveryCause;
  checkpointId: string;
}): BoundaryDelivery {
  return { kind: 'delivered', ...input };
}

export async function appendDeliveryEvent(input: {
  tx: Db;
  runId: string;
  delivery: {
    items: ReadonlyArray<ChatDelivery>;
    commandItems?: ReadonlyArray<ChatDelivery>;
    message: Message;
    cause: DeliveryCause;
    stoppedCalls: ReadonlyArray<
      import('../chats/interrupted-notice').StoppedCall
    >;
    checkpointId?: string;
    stepBudgetUsed?: number;
  };
  message: Message;
  attemptId: string;
}): Promise<void> {
  const { tx, runId, delivery, message, attemptId } = input;

  await new RunEventsRepository(tx).append(runId, 'run.delivered', {
    messageId: message.id,
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
  });
}

export async function closeAndPublishBoundaryCheckpoint(input: {
  tx: Db;
  delivery: DeliveryInput;
  locked: Run;
  cause: DeliveryCause;
  closeReply: () => Promise<Message | undefined>;
  persistBaselines: () => Promise<void>;
}): Promise<{ closedReply: Message; checkpointId: string }> {
  const closedReply = await input.closeReply();

  if (!closedReply) {
    throw new Error(`Run ${input.locked.id} has no closed reply.`);
  }

  await input.persistBaselines();
  const compaction = input.delivery.boundaryCompaction;

  if (!compaction) {
    throw new Error('Boundary compaction disappeared.');
  }

  return {
    closedReply,
    checkpointId: await compaction.publishCheckpoint(input.tx, closedReply),
  };
}
