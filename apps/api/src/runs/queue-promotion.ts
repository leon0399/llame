/**
 * Promotion of a pending `queue` item (run-steering D5). The transaction that
 * settles a Run `completed` takes the Chat's first pending queue item, stores
 * it as a user message under the item's id, and creates its Run under the
 * item's named selector and the Chat's stored selection (writer `derived`).
 * The caller dispatches the returned job after the commit.
 */

import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import {
  parseChatCommand,
  validateCompactCommand,
} from '../chats/commands/parse-chat-command';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import {
  createCompactionRun,
  createRunForMessage,
  runSelectionFields,
  type RunSelection,
} from '../chats/run-creation';
import { toRunUserMessage } from '../chats/chat-message-parts';
import { storeSelectionUpdate } from '../chats/selection-update';
import {
  type ChatDelivery,
  type ChatDeliverySettings,
  type Message,
  type Run,
} from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { type ChatModelSelection } from '../models/model-selection';
import {
  resolveSendSettings,
  type ModelSelectionValidator,
  type ResolvedSendSettings,
} from '../models/models.service';
import { type PermissionMode } from '../tools/permissions/permission-mode';
import { type RunJob } from './run-queues';

/** The item left `pending` between the locked read and its delivery. */
class ItemNoLongerPending extends Error {}

/**
 * The selection one pending item starts its Run with, resolved by the caller
 * that owns the Chat row lock. `modelId` is the served model the Run and its
 * job record; `effort` is both the served effort and the selection's effort.
 * {@link resolveItemRunSettings} returns the full settings, whose
 * `nextSelection` is the only write a derived creator may make: the removal of
 * a hold its admission dropped.
 */
export type ItemRunResolution = RunSelection;

/**
 * Start the Run of the first pending queue item of the completed Run's Chat.
 * The Run row is already settled in `tx`; the Chat row lock taken here comes
 * after it, the codebase lock order. The lock also serializes with admission,
 * so an item admitted during the Run is either seen here or admitted after the
 * commit into an idle Chat. An item whose settings no longer validate stays
 * pending: the queue is paused and starts nothing until the owner acts.
 *
 * The lock is unconditional: skipping it on an empty queue would strand an
 * item admitted concurrently into an idle Chat. Run then Chat stays the lock
 * order. A send waits at most on the Chat row or answers 409 while the Run is
 * active; it does not wait on the Run row this transaction holds. One pair can
 * still deadlock: a dead-letter expiry and a send's own expiry of the same Run
 * lock the same rows in opposite order. Postgres detects it (40P01) and aborts
 * one transaction; the other proceeds.
 */
export async function promoteNextQueueItem(
  tx: Db,
  input: {
    completed: Run;
    models: ModelSelectionValidator;
    enabledPermissionModes: ReadonlyArray<PermissionMode>;
  },
): Promise<RunJob | undefined> {
  const { chatId, userId } = input.completed;
  // The locked Chat row decides: a missing or archived Chat promotes nothing.
  const chats = new ChatsRepository(tx);
  const chat = await chats.lock(chatId, userId);

  if (!chat || chat.archivedAt !== null) return undefined;

  const item = await new ChatDeliveriesRepository(tx).firstPendingQueueItem(
    chatId,
    userId,
  );

  if (!item) return undefined;

  const resolved = tryResolveItemRunSettings({
    models: input.models,
    enabledPermissionModes: input.enabledPermissionModes,
    settings: item.settings,
    stored: chat.modelSelection,
    now: await chats.transactionNow(),
  });

  if (resolved === undefined) return undefined;

  // A promoted item keeps the owner's selector and effort; the one thing it
  // may store is the removal of a hold this admission dropped.
  await storeSelectionUpdate(chats, chat, resolved);

  // A savepoint, so an item that stopped being pending leaves no message and
  // no Run behind while the completed Run's own settlement commits.
  try {
    const started = await tx.transaction((inner) =>
      startItemRun(inner, item, resolved),
    );

    return started?.job;
  } catch (error) {
    if (error instanceof ItemNoLongerPending) return undefined;

    if (error instanceof BadRequestException) return undefined;

    throw error;
  }
}

/**
 * The settings a pending item's Run starts with, resolved by the resolver a
 * send uses (writer `derived`): a named selector wins, else the Chat's stored
 * one, else the configured default. Queue promotion, a job notice, and a
 * delivery mode change share it, so an item starts only under settings a send
 * would be accepted with now.
 */
export function resolveItemRunSettings(input: {
  models: ModelSelectionValidator;
  enabledPermissionModes: ReadonlyArray<PermissionMode>;
  settings: ChatDeliverySettings;
  stored: ChatModelSelection | null;
  /** The starting transaction's `now()`, compared with a hold's `revertAt`. */
  now: Date;
}): ResolvedSendSettings {
  return resolveSendSettings(input.models, input.enabledPermissionModes, {
    stored: input.stored,
    request: {
      // An item that records the selector the Chat already stores is not a
      // pick: the owner's selection says the same role, so the item resolves
      // that selection and a fallback hold still applies (`background-jobs`:
      // "A notice uses the hold of the Chat"). A different selector is the
      // item's own and replaces it.
      selector:
        input.settings.selector === input.stored?.selector
          ? undefined
          : input.settings.selector,
      effort: input.settings.effort,
    },
    writer: 'derived',
    permissionMode: input.settings.permissionMode,
    now: input.now,
  });
}

/**
 * {@link resolveItemRunSettings} for a caller that starts nothing on a
 * refusal: an item whose settings no longer validate leaves the queue paused
 * and a notice unstarted, rather than failing the transaction that settled the
 * Run which triggered them.
 */
export function tryResolveItemRunSettings(
  input: Parameters<typeof resolveItemRunSettings>[0],
): ResolvedSendSettings | undefined {
  try {
    return resolveItemRunSettings(input);
  } catch {
    return undefined;
  }
}

/**
 * Start one pending item either as a message Run or, for `/compact`, as a
 * message-less compaction Run, under the resolution its caller made from the
 * Chat's stored selection.
 */
export async function startItemRun(
  tx: Db,
  item: ChatDelivery,
  resolved: ItemRunResolution,
): Promise<{ job: RunJob; delivered: ChatDelivery } | undefined> {
  const command = parseChatCommand(item.parts);

  if (command?.name === 'compact') {
    return startCompactItemRun(tx, item, command.argument, resolved);
  }

  return startMessageItemRun(tx, item, resolved);
}

async function startCompactItemRun(
  tx: Db,
  item: ChatDelivery,
  argument: string,
  resolved: ItemRunResolution,
): Promise<{ job: RunJob; delivered: ChatDelivery }> {
  const focus = validateCompactCommand(item.parts, argument);

  const run = await createCompactionRun(tx, {
    id: randomUUID(),
    chatId: item.chatId,
    userId: item.ownerUserId,
    ...runSelectionFields(resolved),
    focus,
  });

  const delivered = await deliverPromotedItem(tx, item, { runId: run.id });

  return {
    delivered,
    job: {
      runId: run.id,
      chatId: item.chatId,
      userId: item.ownerUserId,
      modelId: resolved.modelId,
    },
  };
}

async function startMessageItemRun(
  tx: Db,
  item: ChatDelivery,
  resolved: ItemRunResolution,
): Promise<{ job: RunJob; delivered: ChatDelivery } | undefined> {
  const created = await createItemRun(tx, item, resolved);

  if (!created) return undefined;

  const { message, run } = created;
  await deliverPendingJobNotices(tx, item, message.id, run.id);

  const delivered = await deliverPromotedItem(tx, item, {
    messageId: message.id,
    runId: run.id,
  });

  return {
    delivered,
    job: {
      runId: run.id,
      chatId: item.chatId,
      userId: item.ownerUserId,
      modelId: resolved.modelId,
      userMessage: toRunUserMessage(message),
    },
  };
}

/**
 * The promoted item's user message and its Run, in this transaction. The item
 * id is the message id, so a retried promotion finds the message it stored.
 */
async function createItemRun(
  tx: Db,
  item: ChatDelivery,
  resolved: ItemRunResolution,
): Promise<{ message: Message; run: Run } | undefined> {
  const message = await new MessagesRepository(tx).createUserMessageIfAbsent({
    id: item.id,
    chatId: item.chatId,
    senderUserId: item.ownerUserId,
    parts: item.parts,
  });

  if (!message) return undefined;

  const { run } = await createRunForMessage(
    tx,
    {
      userId: item.ownerUserId,
      chatId: item.chatId,
      ...runSelectionFields(resolved),
      targetRunId: randomUUID(),
    },
    message,
  );

  return { message, run };
}

async function deliverPendingJobNotices(
  tx: Db,
  item: ChatDelivery,
  messageId: string,
  runId: string,
): Promise<void> {
  await new ChatDeliveriesRepository(tx).deliverPendingJobNotices(
    item.chatId,
    item.ownerUserId,
    { messageId, runId },
  );
}

/** Commit the promoted owner item and its held results to the same trigger. */
async function deliverPromotedItem(
  tx: Db,
  item: ChatDelivery,
  target: { messageId?: string; runId: string },
): Promise<ChatDelivery> {
  const deliveries = new ChatDeliveriesRepository(tx);

  const delivered = await deliveries.markDelivered(
    item.id,
    item.ownerUserId,
    target,
  );

  if (!delivered) throw new ItemNoLongerPending();

  return delivered;
}
