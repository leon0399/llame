/**
 * The Chat a send admits into: its creation lock inside the admission
 * transaction, and the read-or-create of the row itself. Split out of
 * `chat-loop.service.ts` so the admission transaction reads step by step.
 */

import { NotFoundException } from '@nestjs/common';

import { type Chat } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { ChatsRepository } from './chats-repository';
import {
  creationInProgress,
  tryCreationTransactionLock,
} from './chat-creation-lock';

/**
 * The Chat's creation lock, inside the admission transaction: a create
 * request holding it answers 409 here, and this route holds it only until the
 * transaction ends, never for the life of the Run.
 */
export async function takeCreationLock(
  tx: Db,
  input: { takeCreationLock: boolean; chatId: string },
): Promise<void> {
  if (
    input.takeCreationLock &&
    !(await tryCreationTransactionLock(tx, input.chatId))
  ) {
    throw creationInProgress();
  }
}

/**
 * Resolve or create the chat: the first message creates the chat (#86). The
 * client supplies the id (routing + idempotency); the owner is always the
 * session user. If the chat is absent, upsert it; a conflict means the id is
 * already taken — by us (a concurrent first send) or by another tenant.
 * Re-query to disambiguate: our own row becomes visible (relies on the
 * default READ COMMITTED seeing the concurrent commit), a cross-tenant id
 * stays invisible → 404 (no existence leak).
 */
export async function resolveSendChat(
  chatsRepo: ChatsRepository,
  input: { chatId: string; userId: string },
): Promise<{ chat: Chat; createdByUs: boolean }> {
  let chat = await chatsRepo.findById(input.chatId, input.userId);

  if (chat) return { chat, createdByUs: false };

  chat = await chatsRepo.createIfAbsent({
    id: input.chatId,
    ownerUserId: input.userId,
  });

  if (chat) return { chat, createdByUs: true };

  chat = await chatsRepo.findById(input.chatId, input.userId);

  if (!chat) {
    throw new NotFoundException(`Chat ${input.chatId} not found`);
  }

  return { chat, createdByUs: false };
}
