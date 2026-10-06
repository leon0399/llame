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

import { and, asc, desc, eq, lt, lte } from 'drizzle-orm';
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
   * The compaction a chat published at one exact absorbed-through sequence, or
   * undefined when that cutoff is still free. Publication takes the chat row
   * lock before this read, so an answer here means the checkpoint is already
   * standing and its epoch state was re-baked by whoever published it.
   * Owner-scoped as defense-in-depth, mirroring `findLatestByChatId`.
   */
  async findByCutoff(
    chatId: string,
    ownerUserId: string,
    uptoSeq: number,
  ): Promise<Compaction | undefined> {
    const rows = await this.db
      .select()
      .from(compactions)
      .innerJoin(chats, eq(compactions.chatId, chats.id))
      .where(
        and(
          eq(compactions.chatId, chatId),
          eq(compactions.uptoSeq, uptoSeq),
          eq(chats.ownerUserId, ownerUserId),
        ),
      )
      .limit(1);

    return rows.map((row) => row.compactions)[0];
  }

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
   * Every compaction covering part of a chat's prefix, oldest-first, optionally
   * bounded by an inclusive `maxSeq` — the owner fork's lineage read
   * (complete-owner-forks D2), which copies a source's whole checkpoint chain
   * rather than only its latest row, because `parentId` and the previous
   * checkpoint's `uptoSeq` are what the checkpoint UI derives the absorbed
   * count from. Ascending `uptoSeq` is also parent-before-child insert order.
   * Owner-scoped as defense-in-depth, mirroring `findLatestByChatId`: the join
   * requires the chat to be owned by `ownerUserId`; RLS remains the primary
   * guarantee.
   */
  async findByChatId(
    chatId: string,
    ownerUserId: string,
    options?: { maxSeq?: number },
  ): Promise<Array<Compaction>> {
    const predicates = [
      eq(compactions.chatId, chatId),
      eq(chats.ownerUserId, ownerUserId),
    ];

    if (options?.maxSeq !== undefined) {
      predicates.push(lte(compactions.uptoSeq, options.maxSeq));
    }

    const rows = await this.db
      .select()
      .from(compactions)
      .innerJoin(chats, eq(compactions.chatId, chats.id))
      .where(and(...predicates))
      .orderBy(asc(compactions.uptoSeq));

    return rows.map((r) => r.compactions);
  }

  /**
   * Record a compaction (#57). Write ownership is enforced by RLS: the
   * `compactions_owner` policy's implicit WITH CHECK rejects an insert whose
   * chat_id is not owned by the current app.current_user_id.
   *
   * `id` and `createdAt` exist for the owner fork (complete-owner-forks D2),
   * which copies a source row's identity and time verbatim. Both stay optional
   * so recording a fresh compaction still lets the database mint them.
   */
  async create(input: {
    chatId: string;
    uptoSeq: number;
    parentId?: string | null;
    summary: string;
    replacementHistory: Array<CompactionReplacementMessage>;
    usage?: unknown;
    id?: string;
    createdAt?: Date;
  }): Promise<Compaction> {
    assertCompactionWrite(input.summary, input.replacementHistory);

    const [created] = await this.db
      .insert(compactions)
      .values(compactionInsertValues(input))
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
  id?: string;
  createdAt?: Date;
}) {
  return {
    chatId: input.chatId,
    uptoSeq: input.uptoSeq,
    parentId: input.parentId ?? null,
    summary: input.summary,
    replacementHistory: input.replacementHistory,
    usage: input.usage,
    // `id`/`createdAt` are only supplied by the owner fork
    // (complete-owner-forks D2), which copies a source row's identity and time
    // verbatim. Omitted, both reach the INSERT as `undefined` and take their
    // database default — never an explicit NULL — so a fresh compaction mints
    // its own id and stamps its own time exactly as it did before the fork
    // needed to carry those values.
    id: input.id,
    createdAt: input.createdAt,
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

/** Load the latest compaction and the messages after it, optionally bounded by
 * `maxSeq`.
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
