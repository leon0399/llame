/**
 * RunningReplyRepository — the writes that keep an assistant reply `running`
 * while its Run's attempt is in flight: the dispatch-time create/reset and
 * the write-through of in-Run parts. Terminal writers finalize the row through
 * MessagesRepository.updateAssistantReply.
 */
import { and, eq, sql } from 'drizzle-orm';
import { type Message, messages } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { insertWithChatSequence } from './message-sequence';
import { replaceableReply } from './messages-repository';

export class RunningReplyRepository {
  constructor(private readonly db: Db) {}

  /**
   * Create the reply for `inReplyTo` with no parts and `running` usage, or
   * reset an existing non-completed reply to that state, in one upsert. A
   * completed reply is never touched: the conflict update's guard refuses it
   * and nothing is returned. The caller holds the answered user row's lock.
   */
  async upsertRunningReply(input: {
    chatId: string;
    inReplyTo: string;
    usage: unknown;
  }): Promise<Message | undefined> {
    return insertWithChatSequence(
      this.db,
      {
        chatId: input.chatId,
        role: 'assistant',
        senderUserId: null,
        parts: [],
        attachments: [],
        usage: input.usage,
        inReplyTo: input.inReplyTo,
      },
      async (tx, row) => {
        const [upserted] = await tx
          .insert(messages)
          .values(row)
          .onConflictDoUpdate({
            target: messages.inReplyTo,
            set: { parts: [], usage: sql`excluded.usage` },
            setWhere: replaceableReply,
          })
          .returning();
        return upserted;
      },
    );
  }

  /**
   * Write through the parts of the reply `attemptId` is producing. Matches
   * only while that reply is still `running` for that same attempt, so a
   * finalized reply or another attempt's reset row is never overwritten.
   */
  async updateRunningReplyParts(input: {
    chatId: string;
    inReplyTo: string;
    attemptId: string;
    parts: Array<unknown>;
  }): Promise<boolean> {
    const updated = await this.db
      .update(messages)
      .set({ parts: input.parts })
      .where(
        and(
          eq(messages.chatId, input.chatId),
          eq(messages.role, 'assistant'),
          eq(messages.inReplyTo, input.inReplyTo),
          sql`(${messages.usage} ->> 'status') = 'running'`,
          sql`(${messages.usage} ->> 'attemptId') = ${input.attemptId}`,
        ),
      )
      .returning({ id: messages.id });

    return updated.length > 0;
  }
}
