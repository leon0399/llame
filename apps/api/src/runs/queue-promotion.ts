/**
 * Promotion of a pending `queue` item (run-steering D5). The transaction that
 * settles a Run `completed` takes the Chat's first pending queue item, stores
 * it as a user message under the item's id, and creates its Run with the
 * settings the item was sent with. The caller dispatches the returned job
 * after the commit.
 */

import { randomUUID } from 'node:crypto';

import { createRunForMessage } from '../chats/run-creation';
import { ChatDeliveriesRepository } from '../chats/chat-deliveries.repository';
import { toRunUserMessage } from '../chats/chat-message-parts';
import { ChatsRepository, MessagesRepository } from '../chats/chats-repository';
import {
  type ChatDelivery,
  type ChatDeliverySettings,
  type Run,
} from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import {
  resolveSendSettings,
  type ModelSelectionValidator,
} from '../models/models.service';
import { type PermissionMode } from '../tools/permissions/permission-mode';
import { type RunJob } from './run-queues';

/** The item left `pending` between the locked read and its delivery. */
class ItemNoLongerPending extends Error {}

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
  const chat = await new ChatsRepository(tx).lock(chatId, userId);

  if (!chat || chat.archivedAt !== null) return undefined;

  const item = await new ChatDeliveriesRepository(tx).firstPendingQueueItem(
    chatId,
    userId,
  );

  if (!item || !settingsStillValid(item.settings, input)) return undefined;

  // A savepoint, so an item that stopped being pending leaves no message and
  // no Run behind while the completed Run's own settlement commits.
  try {
    const started = await tx.transaction((inner) => startItemRun(inner, item));

    return started?.job;
  } catch (error) {
    if (error instanceof ItemNoLongerPending) return undefined;
    throw error;
  }
}

/**
 * Media were resolved and owner-checked at admission, so only the settings a
 * send re-checks are validated again, by the resolver a send uses.
 */
function settingsStillValid(
  settings: ChatDeliverySettings,
  input: {
    models: ModelSelectionValidator;
    enabledPermissionModes: ReadonlyArray<PermissionMode>;
  },
): boolean {
  try {
    resolveSendSettings(input.models, input.enabledPermissionModes, settings);

    return true;
  } catch {
    return false;
  }
}

/**
 * Store one pending item as the user message of a new Run and mark it
 * delivered. The completion path and a mode change on a paused item share it,
 * so both start the Run the same way. Returns the Run's job and the item as
 * delivered; undefined when the item's id is already a message.
 */
export async function startItemRun(
  tx: Db,
  item: ChatDelivery,
): Promise<{ job: RunJob; delivered: ChatDelivery } | undefined> {
  const message = await new MessagesRepository(tx).createUserMessageIfAbsent({
    id: item.id,
    chatId: item.chatId,
    senderUserId: item.ownerUserId,
    parts: item.parts,
  });

  // The id is already a message: nothing to promote safely, so the item waits.
  if (!message) return undefined;

  const { run } = await createRunForMessage(
    tx,
    {
      userId: item.ownerUserId,
      chatId: item.chatId,
      modelId: item.settings.modelId,
      effort: item.settings.effort,
      permissionMode: item.settings.permissionMode,
      targetRunId: randomUUID(),
    },
    message,
  );

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
      modelId: item.settings.modelId,
      userMessage: toRunUserMessage(message),
    },
  };
}

/** Commit the promoted owner item and its held results to the same trigger. */
async function deliverPromotedItem(
  tx: Db,
  item: ChatDelivery,
  target: { messageId: string; runId: string },
): Promise<ChatDelivery> {
  const deliveries = new ChatDeliveriesRepository(tx);
  await deliveries.deliverPendingJobNotices(
    item.chatId,
    item.ownerUserId,
    target,
  );

  const delivered = await deliveries.markDelivered(
    item.id,
    item.ownerUserId,
    target,
  );

  if (!delivered) throw new ItemNoLongerPending();

  return delivered;
}
