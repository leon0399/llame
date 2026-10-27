/**
 * RunningReplyRepository — the writes that keep an assistant reply `running`
 * while its Run's attempt is in flight: the dispatch-time create/reset and
 * the write-through of in-Run parts. Terminal writers finalize the row through
 * MessagesRepository.updateAssistantReply.
 */
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { type FollowUpAction, type Message, messages } from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { insertWithChatSequence } from './message-sequence';
import { replaceableReply } from './messages-repository';
import { type RunningReplyUsage } from '../runs/run-reply-finalizer';

/**
 * The conflict-update guard of one dispatch's reply reset (turn-actions D7).
 * A non-completed reply is always replaceable. A `completed` reply is too when
 * the dispatching Run regenerates the turn and that reply's usage names another
 * Run — the answer a Regenerate replaces, never the answer its own earlier
 * attempt salvaged while the Run stayed live. A completed reply that names no
 * Run is left alone: nothing proves another Run wrote it.
 */
export function replaceableReplyGuard(input: {
  /** The dispatching Run, from the usage the reset writes. */
  runId: string;
  /** Whether that Run regenerates the turn. */
  regenerate: boolean;
}): SQL {
  const status = sql`(${messages.usage} ->> 'status')`;
  const replyRunId = sql`(${messages.usage} ->> 'runId')`;
  if (!input.regenerate) return replaceableReply;
  return sql`(${replaceableReply}) or (${status} = 'completed' and ${replyRunId} is not null and ${replyRunId} <> ${input.runId})`;
}

/**
 * The `revised_at` a Regenerate's reset writes: the moment a `completed` reply
 * is replaced, and the row's own value on every other reset. A reply that was
 * never completed was never eligible evidence, so it takes no mark
 * (turn-actions D7).
 */
const revisedAtOnReset = sql`case when (${messages.usage} ->> 'status') = 'completed' then now() else ${messages.revisedAt} end`;

export class RunningReplyRepository {
  constructor(private readonly db: Db) {}

  /**
   * Create the reply for `inReplyTo` with no parts and `running` usage, or
   * reset an existing non-completed reply to that state, in one upsert. A
   * completed reply is only replaced by the dispatch of a Regenerate Run, and
   * that same statement marks it revised so no reader treats it as evidence
   * again (turn-actions D7). The caller holds the answered user row's lock.
   */
  async upsertRunningReply(input: {
    chatId: string;
    inReplyTo: string;
    usage: RunningReplyUsage;
    /** The dispatching Run's own follow-up action, `null` for a chat send. */
    followUpAction: FollowUpAction | null;
  }): Promise<Message | undefined> {
    const regenerate = input.followUpAction === 'regenerate';
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
            set: {
              parts: [],
              usage: sql`excluded.usage`,
              ...(regenerate && { revisedAt: revisedAtOnReset }),
            },
            setWhere: replaceableReplyGuard({
              runId: input.usage.runId,
              regenerate,
            }),
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
