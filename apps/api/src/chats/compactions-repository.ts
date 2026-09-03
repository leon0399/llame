/**
 * CompactionsRepository — owner-scoped database access to the `compactions`
 * table, plus `findLiveWindow` (the shared "compaction + trailing live
 * messages" read composing this with MessagesRepository). Split from
 * chats-repository.ts: ChatsRepository owns `chats`/`pins`,
 * MessagesRepository owns `messages`; each table gets its own repository
 * file.
 *
 * Every query filters by ownerUserId / chatId as defense-in-depth.
 * RLS is the primary isolation guarantee; these filters are the seatbelt.
 */

import { and, desc, eq, lt, lte } from 'drizzle-orm';
import {
  type Compaction,
  type CompactionReplacementMessage,
  type Message,
  chats,
  compactions,
} from '../db/schema';
import { type Db } from '../db/tenant-db.service';
import { parseCompactionReplacementHistory } from './compaction-replacement-history';
import { MessagesRepository } from './messages-repository';

export class CompactionsRepository {
  constructor(private readonly db: Db) {}

  /**
   * Latest compaction for a chat (highest uptoSeq), optionally bounded by an
   * inclusive maximum, or undefined when the chat has never compacted. The
   * existing `beforeSeq` option remains an exclusive bound for callers walking
   * to a compaction's parent. Owner-scoped as defense-in-depth, mirroring
   * MessagesRepository: the join requires the chat to be owned by
   * `ownerUserId`; RLS remains the primary guarantee.
   */
  async findLatestByChatId(
    chatId: string,
    ownerUserId: string,
    options?: { beforeSeq?: number; maxSeq?: number },
  ): Promise<Compaction | undefined> {
    const predicates = [
      eq(compactions.chatId, chatId),
      eq(chats.ownerUserId, ownerUserId),
    ];

    if (options?.beforeSeq !== undefined) {
      predicates.push(lt(compactions.uptoSeq, options.beforeSeq));
    }
    if (options?.maxSeq !== undefined) {
      predicates.push(lte(compactions.uptoSeq, options.maxSeq));
    }

    const rows = await this.db
      .select()
      .from(compactions)
      .innerJoin(chats, eq(compactions.chatId, chats.id))
      .where(and(...predicates))
      .orderBy(desc(compactions.uptoSeq))
      .limit(1);

    return rows.map((r) => r.compactions)[0];
  }

  /**
   * Record a compaction (#57). Write ownership is enforced by RLS: the
   * `compactions_owner` policy's implicit WITH CHECK rejects an insert whose
   * chat_id is not owned by the current app.current_user_id.
   */
  async create(input: {
    chatId: string;
    uptoSeq: number;
    parentId?: string | null;
    summary: string;
    replacementHistory: Array<CompactionReplacementMessage>;
    usage?: unknown;
  }): Promise<Compaction> {
    assertCompactionWrite(input.summary, input.replacementHistory);

    const [created] = await this.db
      .insert(compactions)
      .values(compactionInsertValues(input))
      .returning();

    return created;
  }

  /**
   * Record a compaction only when no peer already owns the same chat/cutoff.
   * Used by transition compaction after its model call, where duplicate job
   * delivery may legitimately race on the unique cutoff.
   */
  async createIfCutoffAbsent(input: {
    chatId: string;
    uptoSeq: number;
    parentId?: string | null;
    summary: string;
    replacementHistory: Array<CompactionReplacementMessage>;
    usage?: unknown;
  }): Promise<Compaction | undefined> {
    assertCompactionWrite(input.summary, input.replacementHistory);

    const [created] = await this.db
      .insert(compactions)
      .values(compactionInsertValues(input))
      .onConflictDoNothing({
        target: [compactions.chatId, compactions.uptoSeq],
      })
      .returning();

    return created;
  }
}

function compactionInsertValues(input: {
  chatId: string;
  uptoSeq: number;
  parentId?: string | null;
  summary: string;
  replacementHistory: Array<CompactionReplacementMessage>;
  usage?: unknown;
}) {
  return {
    chatId: input.chatId,
    uptoSeq: input.uptoSeq,
    parentId: input.parentId ?? null,
    summary: input.summary,
    replacementHistory: input.replacementHistory,
    usage: input.usage,
  };
}

function assertCompactionWrite(
  summary: string,
  replacementHistory: unknown,
): asserts replacementHistory is Array<CompactionReplacementMessage> {
  if (summary.trim().length === 0) {
    throw new Error('Compaction summary must be non-empty.');
  }

  if (parseCompactionReplacementHistory(replacementHistory) === null) {
    throw new Error(
      'Compaction replacement history must be a valid non-empty message sequence.',
    );
  }
}

/**
 * Load a chat's live context window (#57) in one place: the latest compaction
 * (optionally bounded to a turn) plus the messages after it. Shared by the chat
 * loop (bounded by the triggering turn's seq + message cap) and the compaction
 * service (unbounded) so the lineage read semantics cannot drift between them.
 */
export async function findLiveWindow(
  db: Db,
  chatId: string,
  ownerUserId: string,
  options?: { maxSeq?: number },
): Promise<{ compaction: Compaction | undefined; history: Array<Message> }> {
  const compaction = await new CompactionsRepository(db).findLatestByChatId(
    chatId,
    ownerUserId,
    options?.maxSeq !== undefined ? { beforeSeq: options.maxSeq } : undefined,
  );

  const historyOptions: NonNullable<
    Parameters<InstanceType<typeof MessagesRepository>['findByChatId']>[2]
  > = {};
  if (options?.maxSeq !== undefined) historyOptions.maxSeq = options.maxSeq;
  if (compaction) historyOptions.sinceSeq = compaction.uptoSeq;

  const history = await new MessagesRepository(db).findByChatId(
    chatId,
    ownerUserId,
    historyOptions,
  );

  return { compaction, history };
}
