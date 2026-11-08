/**
 * ChatDeliveriesRepository — owner-scoped access to `chat_deliveries`, the
 * pending items of a Chat (run-steering D1). Every query filters by the owner
 * and the Chat as defense-in-depth beside the table's forced RLS policy.
 */

import { and, asc, eq } from 'drizzle-orm';

import {
  chatDeliveries,
  type ChatDelivery,
  type ChatDeliveryMode,
  type ChatDeliverySettings,
} from '../db/schema';
import { type Db } from '../db/tenant-db.service';

export type NewChatDelivery = {
  id: string;
  chatId: string;
  ownerUserId: string;
  mode: ChatDeliveryMode;
  parts: Array<unknown>;
  settings: ChatDeliverySettings;
};

export class ChatDeliveriesRepository {
  constructor(private readonly db: Db) {}

  /** The item with this message id, in any state, for its owner. */
  async findById(
    id: string,
    ownerUserId: string,
  ): Promise<ChatDelivery | undefined> {
    const [item] = await this.db
      .select()
      .from(chatDeliveries)
      .where(
        and(
          eq(chatDeliveries.id, id),
          eq(chatDeliveries.ownerUserId, ownerUserId),
        ),
      );
    return item;
  }

  /** The owner's item in this Chat; the chat-scoped lookup of a withdrawal. */
  async findInChat(
    chatId: string,
    id: string,
    ownerUserId: string,
  ): Promise<ChatDelivery | undefined> {
    const item = await this.findById(id, ownerUserId);
    return item?.chatId === chatId ? item : undefined;
  }

  /** A new pending item of the `owner` producer. */
  async insertPending(input: NewChatDelivery): Promise<ChatDelivery> {
    const [created] = await this.db
      .insert(chatDeliveries)
      .values({ ...input, producer: 'owner', senderRef: null })
      .returning();
    return created;
  }

  /** The Chat's pending items, first to deliver first. */
  listPending(
    chatId: string,
    ownerUserId: string,
  ): Promise<Array<ChatDelivery>> {
    return this.db
      .select()
      .from(chatDeliveries)
      .where(this.pendingOf(chatId, ownerUserId))
      .orderBy(asc(chatDeliveries.position));
  }

  /** The pending `queue` item the next completion promotes. */
  async firstPendingQueueItem(
    chatId: string,
    ownerUserId: string,
  ): Promise<ChatDelivery | undefined> {
    const [item] = await this.db
      .select()
      .from(chatDeliveries)
      .where(
        and(
          this.pendingOf(chatId, ownerUserId),
          eq(chatDeliveries.mode, 'queue'),
        ),
      )
      .orderBy(asc(chatDeliveries.position))
      .limit(1);
    return item;
  }

  /**
   * One conditional update: only a `pending` item of this Chat is withdrawn,
   * so a delivery that won the race leaves the item untouched (zero rows).
   */
  async withdrawPending(
    chatId: string,
    id: string,
    ownerUserId: string,
  ): Promise<ChatDelivery | undefined> {
    const [withdrawn] = await this.db
      .update(chatDeliveries)
      .set({ state: 'withdrawn', updatedAt: new Date() })
      .where(
        and(this.pendingOf(chatId, ownerUserId), eq(chatDeliveries.id, id)),
      )
      .returning();
    return withdrawn;
  }

  /** Mark a pending item delivered as the user message and Run it became. */
  async markDelivered(
    id: string,
    ownerUserId: string,
    delivered: { messageId: string; runId: string },
  ): Promise<void> {
    await this.db
      .update(chatDeliveries)
      .set({
        state: 'delivered',
        deliveredMessageId: delivered.messageId,
        runId: delivered.runId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(chatDeliveries.id, id),
          eq(chatDeliveries.ownerUserId, ownerUserId),
          eq(chatDeliveries.state, 'pending'),
        ),
      );
  }

  private pendingOf(chatId: string, ownerUserId: string) {
    return and(
      eq(chatDeliveries.chatId, chatId),
      eq(chatDeliveries.ownerUserId, ownerUserId),
      eq(chatDeliveries.state, 'pending'),
    );
  }
}
