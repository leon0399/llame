/**
 * ChatDeliveriesRepository — owner-scoped access to `chat_deliveries`, the
 * pending items of a Chat (run-steering D1). Every query filters by the owner,
 * and the Chat where it concerns one Chat's queue, as defense-in-depth beside
 * the table's forced RLS policy.
 */

import { and, asc, eq, exists, inArray, isNotNull } from 'drizzle-orm';

import {
  chatDeliveries,
  chats,
  messages,
  runs,
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

  /** Whether the owner already has a message with this id, in any Chat. */
  async messageIdTaken(id: string, ownerUserId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: messages.id })
      .from(messages)
      .innerJoin(chats, eq(messages.chatId, chats.id))
      .where(and(eq(messages.id, id), eq(chats.ownerUserId, ownerUserId)))
      .limit(1);
    return row !== undefined;
  }

  /**
   * A new pending item of the `owner` producer; undefined when the id is
   * already an item, which the caller answers as a duplicate message id.
   */
  async insertPending(
    input: NewChatDelivery,
  ): Promise<ChatDelivery | undefined> {
    const [created] = await this.db
      .insert(chatDeliveries)
      .values({ ...input, producer: 'owner', senderRef: null })
      .onConflictDoNothing({ target: chatDeliveries.id })
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

  /**
   * The one owner-scoped query of a step end (run-steering D3): `cancel` when
   * the Run records a cancellation, so a signal that never reached this
   * process is still found, else `delivery` when the Chat holds a pending
   * `steer` or `interrupt` item.
   */
  async stepEndSignal(run: {
    runId: string;
    chatId: string;
    userId: string;
  }): Promise<'cancel' | 'delivery' | undefined> {
    const [row] = await this.db
      .select({
        cancelled: isNotNull(runs.cancelRequestedAt),
        pending: exists(
          this.db
            .select({ id: chatDeliveries.id })
            .from(chatDeliveries)
            .where(
              and(
                this.pendingOf(run.chatId, run.userId),
                inArray(chatDeliveries.mode, ['steer', 'interrupt']),
              ),
            ),
        ),
      })
      .from(runs)
      .where(and(eq(runs.id, run.runId), eq(runs.userId, run.userId)));
    if (row?.cancelled) return 'cancel';
    return row?.pending ? 'delivery' : undefined;
  }

  /**
   * The pending `steer` and `interrupt` items a boundary delivers, in
   * `position` order, locked so a concurrent withdrawal waits for the
   * delivery and then misses (`withdrawPending` filters on `pending`).
   */
  lockPendingSteering(
    chatId: string,
    ownerUserId: string,
  ): Promise<Array<ChatDelivery>> {
    return this.db
      .select()
      .from(chatDeliveries)
      .where(
        and(
          this.pendingOf(chatId, ownerUserId),
          inArray(chatDeliveries.mode, ['steer', 'interrupt']),
        ),
      )
      .orderBy(asc(chatDeliveries.position))
      .for('update');
  }

  /**
   * The pending `queue` item the next completion promotes, row-locked so a
   * withdrawal cannot slip in between this read and the delivery: it waits for
   * the promotion to commit and then finds the item no longer pending.
   */
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
      .limit(1)
      .for('update');
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

  /**
   * Mark a pending item delivered as the user message and Run it became.
   * Returns false when the item was no longer pending (zero rows), so the
   * caller rolls the promotion back.
   */
  async markDelivered(
    id: string,
    ownerUserId: string,
    delivered: { messageId: string; runId: string },
  ): Promise<boolean> {
    const rows = await this.db
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
      )
      .returning({ id: chatDeliveries.id });
    return rows.length > 0;
  }

  private pendingOf(chatId: string, ownerUserId: string) {
    return and(
      eq(chatDeliveries.chatId, chatId),
      eq(chatDeliveries.ownerUserId, ownerUserId),
      eq(chatDeliveries.state, 'pending'),
    );
  }
}
