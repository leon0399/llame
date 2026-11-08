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
  resolvePermissionMode,
  type ModelSelectionValidator,
} from '../models/models.service';
import { type PermissionMode } from '../tools/permissions/permission-mode';
import { type RunJob } from './run-queues';

/**
 * Whether a send with these settings would be accepted now: the model is in
 * the catalog, the effort is one of its levels, and the permission mode is
 * enabled. Media were resolved and owner-checked at admission, so they are not
 * resolved again.
 */
function settingsStillValid(
  settings: ChatDeliverySettings,
  models: ModelSelectionValidator,
  enabledModes: ReadonlyArray<PermissionMode>,
): boolean {
  try {
    const model = models.validateModelSelection(settings.modelId);
    if (settings.effort !== undefined) {
      models.resolveEffortSelection(model, settings.effort);
    }
    resolvePermissionMode(settings.permissionMode, enabledModes);
    return true;
  } catch {
    return false;
  }
}

/**
 * Start the Run of the first pending queue item of the completed Run's Chat.
 * The Run row is already settled in `tx`; the Chat row lock taken here comes
 * after it, the codebase lock order. The lock also serializes with admission,
 * so an item admitted during the Run is either seen here or admitted after the
 * commit into an idle Chat. An item whose settings no longer validate stays
 * pending: the queue is paused and starts nothing until the owner acts.
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
  await new ChatsRepository(tx).lock(chatId, userId);
  const deliveries = new ChatDeliveriesRepository(tx);
  const item = await deliveries.firstPendingQueueItem(chatId, userId);
  if (
    !item ||
    !settingsStillValid(
      item.settings,
      input.models,
      input.enabledPermissionModes,
    )
  ) {
    return undefined;
  }
  return startItemRun(tx, deliveries, item);
}

async function startItemRun(
  tx: Db,
  deliveries: ChatDeliveriesRepository,
  item: ChatDelivery,
): Promise<RunJob | undefined> {
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
  await deliveries.markDelivered(item.id, item.ownerUserId, {
    messageId: message.id,
    runId: run.id,
  });
  return {
    runId: run.id,
    chatId: item.chatId,
    userId: item.ownerUserId,
    modelId: item.settings.modelId,
    userMessage: toRunUserMessage(message),
  };
}
