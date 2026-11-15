/**
 * ChatDeliveriesRepository — owner-scoped access to `chat_deliveries`, the
 * pending items of a Chat (run-steering D1). Every query filters by the owner,
 * and the Chat where it concerns one Chat's queue, as defense-in-depth beside
 * the table's forced RLS policy.
 */

import { and, asc, eq, exists, inArray, isNotNull, or, sql } from 'drizzle-orm';

import {
  chatDeliveries,
  chatJobs,
  chats,
  messages,
  runs,
  type Run,
  type ChatDelivery,
  type ChatJob,
  type ChatDeliveryMode,
  type ChatDeliverySettings,
} from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { ChatsRepository } from './chats-repository';
import { returnUndispatchedJobNotices } from './job-notice-terminal-recovery';

export type NewChatDelivery = {
  id: string;
  chatId: string;
  ownerUserId: string;
  mode: Exclude<ChatDeliveryMode, 'notice'>;
  parts: Array<unknown>;
  settings: ChatDeliverySettings;
};

/** Owner-facing delivery data, with only the job fields it may expose. */
export type ChatDeliveryView = {
  item: ChatDelivery;
  job: Pick<ChatJob, 'executor' | 'seq' | 'state'> | null;
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

  /** Delivered job notices attached to one message, in delivery order. */
  listDeliveredJobNotices(
    chatId: string,
    ownerUserId: string,
    messageId: string,
  ): Promise<Array<ChatDelivery>> {
    return this.db
      .select()
      .from(chatDeliveries)
      .where(
        and(
          eq(chatDeliveries.chatId, chatId),
          eq(chatDeliveries.ownerUserId, ownerUserId),
          eq(chatDeliveries.producer, 'job'),
          eq(chatDeliveries.mode, 'notice'),
          eq(chatDeliveries.state, 'delivered'),
          eq(chatDeliveries.deliveredMessageId, messageId),
        ),
      )
      .orderBy(asc(chatDeliveries.position));
  }

  /**
   * Pending settled-job notices held for the owner's next accepted turn.
   * Keep the producer/job checks here as well as RLS so stale or foreign
   * producer references can never be adopted by a caller.
   */
  async lockFirstPendingJobNotice(
    chatId: string,
    ownerUserId: string,
  ): Promise<ChatDelivery | undefined> {
    const [notice] = await this.db
      .select()
      .from(chatDeliveries)
      .where(
        and(
          this.pendingOf(chatId, ownerUserId),
          eq(chatDeliveries.producer, 'job'),
          eq(chatDeliveries.mode, 'notice'),
          this.settledNoticeJob(chatId, ownerUserId),
        ),
      )
      .orderBy(asc(chatDeliveries.position))
      .limit(1)
      .for('update');

    return notice;
  }

  /** Attach held notices to the accepted user message and its new Run. */
  async deliverPendingJobNotices(
    chatId: string,
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
          this.pendingOf(chatId, ownerUserId),
          eq(chatDeliveries.producer, 'job'),
          eq(chatDeliveries.mode, 'notice'),
          this.settledNoticeJob(chatId, ownerUserId),
        ),
      );
  }

  /** Return notices attached to a segment that never dispatched. */
  async returnUndispatchedJobNotices(run: Run): Promise<void> {
    await returnUndispatchedJobNotices(this.db, run);
  }

  listPendingViews(
    chatId: string,
    ownerUserId: string,
  ): Promise<Array<ChatDeliveryView>> {
    return this.selectView()
      .where(
        and(this.pendingOf(chatId, ownerUserId), this.resolvableProducer()),
      )
      .orderBy(asc(chatDeliveries.position));
  }

  async findView(
    id: string,
    ownerUserId: string,
  ): Promise<ChatDeliveryView | undefined> {
    const [view] = await this.selectView().where(
      and(
        eq(chatDeliveries.id, id),
        eq(chatDeliveries.ownerUserId, ownerUserId),
        this.resolvableProducer(),
      ),
    );

    return view;
  }

  /**
   * Insert the single notice for a settled job. The partial unique sender_ref
   * index makes settlement retries idempotent.
   */
  async insertJobNotice(job: ChatJob): Promise<ChatDelivery | undefined> {
    const [notice] = await this.db
      .insert(chatDeliveries)
      .values({
        id: crypto.randomUUID(),
        chatId: job.chatId,
        ownerUserId: job.ownerUserId,
        producer: 'job',
        senderRef: job.id,
        mode: 'notice',
        parts: [],
        settings: job.settings,
      })
      .onConflictDoNothing({
        target: chatDeliveries.senderRef,
        where: eq(chatDeliveries.producer, 'job'),
      })
      .returning();

    return notice;
  }

  /**
   * The pending owner steering items and job notices a boundary consumes.
   * Queue items stay out of this set, and the lock prevents a concurrent
   * owner withdrawal from racing the boundary.
   */
  lockPendingBoundary(
    chatId: string,
    ownerUserId: string,
  ): Promise<Array<ChatDelivery>> {
    return this.db
      .select()
      .from(chatDeliveries)
      .where(
        and(
          this.pendingOf(chatId, ownerUserId),
          or(
            and(
              eq(chatDeliveries.producer, 'owner'),
              inArray(chatDeliveries.mode, ['steer', 'interrupt']),
            ),
            and(
              eq(chatDeliveries.producer, 'job'),
              eq(chatDeliveries.mode, 'notice'),
            ),
          ),
        ),
      )
      .orderBy(asc(chatDeliveries.position))
      .for('update');
  }

  /**
   * Withdraw notices for jobs this caller has independently confirmed
   * settled. Filtering both the delivery and job rows defends owner, Chat,
   * and state even when a caller supplies foreign or stale job ids.
   */
  async consumeJobNotices(input: {
    chatId: string;
    ownerUserId: string;
    runId: string;
    jobIds: Array<string>;
  }): Promise<Array<string>> {
    if (input.jobIds.length === 0) return [];

    const rows = await this.db
      .update(chatDeliveries)
      .set({ state: 'withdrawn', runId: input.runId, updatedAt: new Date() })
      .where(
        and(
          this.pendingOf(input.chatId, input.ownerUserId),
          eq(chatDeliveries.producer, 'job'),
          eq(chatDeliveries.mode, 'notice'),
          inArray(chatDeliveries.senderRef, input.jobIds),
          this.settledNoticeJob(input.chatId, input.ownerUserId),
        ),
      )
      .returning({ id: chatDeliveries.id });

    return rows.map(({ id }) => id);
  }

  /** Restore only rows this Run itself withdrew, never an owner's withdrawal. */
  async restoreJobNotices(input: {
    chatId: string;
    ownerUserId: string;
    runId: string;
    deliveryIds: Array<string>;
  }): Promise<void> {
    if (input.deliveryIds.length === 0) return;

    await this.db
      .update(chatDeliveries)
      .set({ state: 'pending', runId: null, updatedAt: new Date() })
      .where(
        and(
          eq(chatDeliveries.chatId, input.chatId),
          eq(chatDeliveries.ownerUserId, input.ownerUserId),
          eq(chatDeliveries.producer, 'job'),
          eq(chatDeliveries.mode, 'notice'),
          eq(chatDeliveries.state, 'withdrawn'),
          eq(chatDeliveries.runId, input.runId),
          inArray(chatDeliveries.id, input.deliveryIds),
          this.settledNoticeJob(input.chatId, input.ownerUserId),
        ),
      );
  }

  /**
   * The one owner-scoped query of a step end (run-steering D3): `cancel` when
   * the Run records a cancellation or no longer exists (its Chat was deleted),
   * so a signal that never reached this process is still found, else
   * `delivery` when the Chat holds pending steering or a job notice.
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
                or(
                  and(
                    eq(chatDeliveries.producer, 'owner'),
                    inArray(chatDeliveries.mode, ['steer', 'interrupt']),
                  ),
                  and(
                    eq(chatDeliveries.producer, 'job'),
                    eq(chatDeliveries.mode, 'notice'),
                  ),
                ),
              ),
            ),
        ),
      })
      .from(runs)
      .where(and(eq(runs.id, run.runId), eq(runs.userId, run.userId)));

    if (!row || row.cancelled) return 'cancel';

    return row.pending ? 'delivery' : undefined;
  }

  /** Whether the Chat holds pending steering or a job notice. */
  async hasPendingSteering(
    chatId: string,
    ownerUserId: string,
  ): Promise<boolean> {
    const [row] = await this.db
      .select({ id: chatDeliveries.id })
      .from(chatDeliveries)
      .where(
        and(
          this.pendingOf(chatId, ownerUserId),
          or(
            and(
              eq(chatDeliveries.producer, 'owner'),
              inArray(chatDeliveries.mode, ['steer', 'interrupt']),
            ),
            and(
              eq(chatDeliveries.producer, 'job'),
              eq(chatDeliveries.mode, 'notice'),
            ),
          ),
        ),
      )
      .limit(1);

    return row !== undefined;
  }

  /** Whether the Chat holds a pending `interrupt` item. */
  async hasPendingInterrupt(
    chatId: string,
    ownerUserId: string,
  ): Promise<boolean> {
    const [row] = await this.db
      .select({ id: chatDeliveries.id })
      .from(chatDeliveries)
      .where(
        and(
          this.pendingOf(chatId, ownerUserId),
          eq(chatDeliveries.mode, 'interrupt'),
        ),
      )
      .limit(1);

    return row !== undefined;
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
          eq(chatDeliveries.producer, 'owner'),
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
          eq(chatDeliveries.producer, 'owner'),
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
   * The queue pauses behind a Run that did not deliver its steering items
   * (run-steering D5): move the Chat's pending `steer` and `interrupt` items
   * to the head of the queue, in their order. A Run that completes delivers or
   * promotes them itself; one that completes with a recorded cancellation, as
   * one that does not complete, leaves the owner to decide. The Chat row lock
   * serializes with an admission that read the Run as live: that item is
   * committed first and this move sees it. The lock comes after the Run row
   * the caller holds, the codebase order. Admission expiry holds the Chat row
   * first and then writes the Run row, so a concurrent terminal write of a
   * non-live Run against that expiry (a dead-letter expiry, say) inverts the
   * order. The inversion is accepted: Postgres aborts one of the two
   * transactions (40P01) and leaves the other consistent.
   */
  async pauseBehind(run: Run): Promise<void> {
    if (run.status === 'completed' && run.cancelRequestedAt === null) return;
    const { chatId, userId: ownerUserId } = run;
    await new ChatsRepository(this.db).lock(chatId, ownerUserId);
    const moving = await this.lockPendingSteering(chatId, ownerUserId);

    if (moving.length === 0) return;
    const head = await this.firstPendingQueueItem(chatId, ownerUserId);

    // Below the first queue item, or where they are when there is none.
    const below =
      head === undefined ? undefined : head.position - moving.length;

    for (const [index, item] of moving.entries()) {
      await this.db
        .update(chatDeliveries)
        .set({
          mode: 'queue',
          ...(below !== undefined && { position: below + index }),
          updatedAt: new Date(),
        })
        .where(eq(chatDeliveries.id, item.id));
    }
  }

  /**
   * One conditional update, as for a withdrawal: only a `pending` item of this
   * Chat changes mode, so a delivery that won the race leaves it untouched.
   */
  async changePendingMode(
    chatId: string,
    id: string,
    ownerUserId: string,
    mode: ChatDeliveryMode,
  ): Promise<ChatDelivery | undefined> {
    const [changed] = await this.db
      .update(chatDeliveries)
      .set({ mode, updatedAt: new Date() })
      .where(
        and(
          this.pendingOf(chatId, ownerUserId),
          eq(chatDeliveries.id, id),
          eq(chatDeliveries.producer, 'owner'),
        ),
      )
      .returning();

    return changed;
  }

  /**
   * Mark a pending item delivered as the user message and Run it became.
   * Returns the delivered row, or undefined when the item was no longer
   * pending (zero rows), so the caller rolls the promotion back.
   */
  async markDelivered(
    id: string,
    ownerUserId: string,
    delivered: { messageId: string; runId: string },
  ): Promise<ChatDelivery | undefined> {
    const [row] = await this.db
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
      .returning();

    return row;
  }

  private selectView() {
    return this.db
      .select({
        item: chatDeliveries,
        job: {
          executor: chatJobs.executor,
          seq: chatJobs.seq,
          state: chatJobs.state,
        },
      })
      .from(chatDeliveries)
      .leftJoin(
        chatJobs,
        and(
          eq(chatDeliveries.producer, 'job'),
          sql`${chatJobs.id} = case
            when pg_input_is_valid(${chatDeliveries.senderRef}, 'uuid')
            then ${chatDeliveries.senderRef}::uuid end`,
          eq(chatJobs.chatId, chatDeliveries.chatId),
          eq(chatJobs.ownerUserId, chatDeliveries.ownerUserId),
        ),
      );
  }

  private resolvableProducer() {
    return or(eq(chatDeliveries.producer, 'owner'), isNotNull(chatJobs.id));
  }

  private pendingOf(chatId: string, ownerUserId: string) {
    return and(
      eq(chatDeliveries.chatId, chatId),
      eq(chatDeliveries.ownerUserId, ownerUserId),
      eq(chatDeliveries.state, 'pending'),
    );
  }

  private settledNoticeJob(chatId: string, ownerUserId: string) {
    return exists(
      this.db
        .select({ id: chatJobs.id })
        .from(chatJobs)
        .where(
          and(
            sql`${chatJobs.id} = case
              when pg_input_is_valid(${chatDeliveries.senderRef}, 'uuid')
              then ${chatDeliveries.senderRef}::uuid end`,
            eq(chatJobs.chatId, chatId),
            eq(chatJobs.ownerUserId, ownerUserId),
            inArray(chatJobs.state, [
              'succeeded',
              'failed',
              'cancelled',
              'timed_out',
              'lost',
            ]),
          ),
        ),
    );
  }
}
