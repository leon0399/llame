import {
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type Chat, type Compaction, type Message } from '../db/schema';
import { TenantDbService, type Db } from '../db/tenant-db.service';
import {
  ChatSearchQueryEmbedder,
  type QueryEmbedderPort,
} from '../search/chat-search-query-embedder';
import {
  SearchEmbedDispatchService,
  type ChatEmbedDispatcher,
} from '../search/search-embed-dispatch.service';
import {
  SearchReindexDispatchService,
  type ChatReindexDispatcher,
} from '../search/search-reindex-dispatch.service';
import {
  ChatsRepository,
  CompactionsRepository,
  MessagesRepository,
  type ChatInheritedValues,
} from './chats-repository';
import {
  copiedMessageRows,
  inheritForkedChatState,
  type CopyableMessage,
} from './fork-copy';
import { RunsRepository } from '../runs/runs-repository';
import { RunAbortRegistry } from '../runs/run-abort-registry';
import { pgErrorCode } from '../db/pg-error';
import { toSharedChatResponse } from './dto/chats.dto';

/** Title for a forked chat. */
export function forkTitle(title: string): string {
  return `${title} (fork)`;
}

@Injectable()
export class ChatsService {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly aborts: RunAbortRegistry,
    @Inject(SearchReindexDispatchService)
    private readonly reindexDispatch: ChatReindexDispatcher,
    @Inject(SearchEmbedDispatchService)
    private readonly embedDispatch: ChatEmbedDispatcher,
    @Inject(ChatSearchQueryEmbedder)
    private readonly queryEmbedder: QueryEmbedderPort,
  ) {}

  /**
   * Owned chats newest-first, each with its latest message (chat-list
   * previews). `filter.projectId` narrows to chats filed into that project
   * (the /projects page's list). The previews query stays unfiltered — it is
   * one indexed pass either way, and the map lookup discards the rest.
   */
  async listChatsWithLastMessage(
    userId: string,
    filter: {
      projectId?: string;
      pinned?: 'only' | 'with' | 'exclude';
      archived?: 'only' | 'with';
    } = {},
  ): Promise<Array<{ chat: Chat; lastMessage: Message | undefined }>> {
    return this.tenantDb.runAs(userId, async (tx) => {
      // Independent queries — let postgres.js pipeline them on the connection.
      const [chatList, latest] = await Promise.all([
        new ChatsRepository(tx).findByOwner(userId, filter),
        new MessagesRepository(tx).findLatestPerOwnedChat(userId),
      ]);
      const latestByChat = new Map(latest.map((m) => [m.chatId, m]));

      return chatList.map((chat) => ({
        chat,
        lastMessage: latestByChat.get(chat.id),
      }));
    });
  }

  async getChatById(
    chatId: string,
    ownerUserId: string,
  ): Promise<Chat | undefined> {
    return this.tenantDb.runAs(ownerUserId, (tx) =>
      new ChatsRepository(tx).findById(chatId, ownerUserId),
    );
  }

  /**
   * Messages + the chat's latest compaction (#57), in one round trip (#136:
   * folds what used to be a separate `GET :id/compaction` call into this same
   * response). The two repository reads are independent — `Promise.all` lets
   * postgres.js pipeline them on the connection, mirroring
   * `listChatsWithLastMessage`'s pattern above. When the latest compaction
   * chains to a previous one (`parentId` set), a third, conditional lookup
   * fetches that previous compaction's `uptoSeq` (reusing
   * `findLatestByChatId`'s existing `beforeSeq` filter — no new repository
   * method) purely to derive `absorbedMessageCount`; this can't be
   * parallelized with the first two since it depends on the first read's
   * result, but it's a single indexed lookup (`compactions_chat_upto_seq_idx`)
   * and only runs when a previous compaction exists.
   *
   * A target-ended read uses the existing one-statement, owner-scoped bounded
   * message query. Requiring its final chronological row to equal `targetSeq`
   * makes a missing/deleted/foreign target indistinguishable from a missing
   * chat without a second target lookup that could race the window read.
   */
  async getChatMessages(
    chatId: string,
    ownerUserId: string,
    options: { limit: number; beforeSeq?: number; targetSeq?: number },
  ): Promise<
    | {
        messages: Array<Message>;
        compaction: Compaction | undefined;
        absorbedMessageCount: number | null;
      }
    | undefined
  > {
    return this.tenantDb.runAs(ownerUserId, async (tx) => {
      const window = await this.loadMessageWindow(
        tx,
        chatId,
        ownerUserId,
        options,
      );
      if (!window) {
        return undefined;
      }

      const absorbedMessageCount = await this.computeAbsorbedMessageCount(
        new CompactionsRepository(tx),
        chatId,
        ownerUserId,
        window.compaction,
      );

      return { ...window, absorbedMessageCount };
    });
  }

  /**
   * Either an exact-target window (final row must land on `targetSeq`, else
   * the target is missing/deleted/foreign and the read reports "not found")
   * or a `beforeSeq`-paginated one — see `getChatMessages`'s own doc for the
   * shape of the contract these two strategies share.
   */
  private async loadMessageWindow(
    tx: Db,
    chatId: string,
    ownerUserId: string,
    options: { limit: number; beforeSeq?: number; targetSeq?: number },
  ): Promise<
    { messages: Array<Message>; compaction: Compaction | undefined } | undefined
  > {
    const chat = await new ChatsRepository(tx).findById(chatId, ownerUserId);
    if (!chat) {
      return undefined;
    }

    const scope = { chatId, ownerUserId, limit: options.limit };
    return options.targetSeq !== undefined
      ? this.loadWindowAtTarget(tx, scope, options.targetSeq)
      : this.loadWindowBeforeSeq(tx, scope, options.beforeSeq);
  }

  /** The window ending exactly at `targetSeq`, or undefined if it doesn't land there. */
  private async loadWindowAtTarget(
    tx: Db,
    scope: { chatId: string; ownerUserId: string; limit: number },
    targetSeq: number,
  ): Promise<
    { messages: Array<Message>; compaction: Compaction | undefined } | undefined
  > {
    const { chatId, ownerUserId, limit } = scope;
    const messages = await new MessagesRepository(tx).findByChatId(
      chatId,
      ownerUserId,
      { limit, maxSeq: targetSeq },
    );
    if (messages.at(-1)?.seq !== targetSeq) {
      return undefined;
    }
    const compaction = await new CompactionsRepository(tx).findLatestByChatId(
      chatId,
      ownerUserId,
      { maxSeq: targetSeq },
    );
    return { messages, compaction };
  }

  /** The most recent `limit` messages strictly before `beforeSeq` (or the tail, if omitted). */
  private async loadWindowBeforeSeq(
    tx: Db,
    scope: { chatId: string; ownerUserId: string; limit: number },
    beforeSeq: number | undefined,
  ): Promise<{ messages: Array<Message>; compaction: Compaction | undefined }> {
    const { chatId, ownerUserId, limit } = scope;
    const [messages, compaction] = await Promise.all([
      new MessagesRepository(tx).findByChatId(chatId, ownerUserId, {
        limit,
        maxSeq: beforeSeq === undefined ? undefined : beforeSeq - 1,
      }),
      new CompactionsRepository(tx).findLatestByChatId(chatId, ownerUserId),
    ]);
    return { messages, compaction };
  }

  /** How many messages the latest compaction's chain has absorbed, if any. */
  private async computeAbsorbedMessageCount(
    compactionsRepository: CompactionsRepository,
    chatId: string,
    ownerUserId: string,
    compaction: Compaction | undefined,
  ): Promise<number | null> {
    if (!compaction) {
      return null;
    }
    const previous = compaction.parentId
      ? await compactionsRepository.findLatestByChatId(chatId, ownerUserId, {
          beforeSeq: compaction.uptoSeq,
        })
      : undefined;
    return compaction.uptoSeq - (previous?.uptoSeq ?? 0);
  }

  async createChat(input: {
    ownerUserId: string;
    title?: string;
  }): Promise<Chat> {
    return this.tenantDb.runAs(input.ownerUserId, (tx) =>
      new ChatsRepository(tx).create(input),
    );
  }

  /**
   * Filing (`patch.projectId`) is gated by the `chats_owner` RLS WITH CHECK
   * (projects-foundation): a project id that doesn't exist surfaces as an FK
   * violation (23503); one that exists but belongs to another owner surfaces
   * as an RLS denial (42501, the subquery only matches the caller's own
   * projects). Both are reported as "project not found" — never a 500, and
   * deliberately no existence oracle distinguishing the two cases, matching
   * this module's other owner-scoped 404s (getChatById, findPublicById, …).
   */
  async updateChat(
    chatId: string,
    ownerUserId: string,
    patch: {
      title?: string;
      visibility?: 'private' | 'public';
      projectId?: string | null;
      archived?: boolean;
    },
  ): Promise<Chat | undefined> {
    try {
      return await this.tenantDb.runAs(ownerUserId, (tx) =>
        new ChatsRepository(tx).update(chatId, ownerUserId, patch),
      );
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      const code = pgErrorCode(error);
      // Sound today because project_id is the ONLY patchable FK on chats
      // (owner_user_id isn't patchable, so the WITH CHECK's other conjunct
      // can't fail). If chats ever gains another patchable FK, this catch
      // would mislabel its violations "Project not found" — key the mapping
      // on the constraint name in the pg error instead when that happens.
      if (code === '23503' || code === '42501') {
        throw new NotFoundException('Project not found');
      }
      throw error;
    }
  }

  async searchChats(
    userId: string,
    query: string,
    limit: number,
  ): Promise<
    Array<{
      id: string;
      title: string | null;
      snippet: string | null;
      updatedAt: Date;
    }>
  > {
    const embedResult = await this.queryEmbedder.embedQueryForSearch(
      'web',
      query,
    );
    const vectorParams =
      'vector' in embedResult
        ? { queryVector: embedResult.vector, modelKey: embedResult.modelKey }
        : undefined;

    return this.tenantDb.runAs(userId, async (tx) => {
      const rows = await new ChatsRepository(tx).searchByOwner(userId, query, {
        limit,
        vector: vectorParams,
      });

      return rows.map(({ id, title, snippet, updatedAt }) => ({
        id,
        title,
        snippet,
        updatedAt,
      }));
    });
  }

  /**
   * Read a PUBLIC chat + its messages for the share view — via `runAsPublic`
   * (no tenant identity), so a private/absent chat returns undefined (→ 404).
   *
   * `options` mirrors `getChatMessages`'s own cursor contract exactly
   * (`beforeSeq` exclusive at this boundary, translated to an inclusive
   * `maxSeq` for the repository, same -1 shift): bounded per-request cost via
   * pagination, never truncation. Omitting `options` (the fork's read path,
   * `forkSharedChat` below) returns the WHOLE conversation — faithfulness is
   * the invariant for a copy, same reasoning as the owner fork.
   */
  async getSharedChat(
    chatId: string,
    options?: { limit?: number; beforeSeq?: number },
  ): Promise<{ chat: Chat; messages: Array<Message> } | undefined> {
    return this.tenantDb.runAsPublic(async (tx) => {
      const chat = await new ChatsRepository(tx).findPublicById(chatId);
      if (!chat) {
        return undefined;
      }
      const messages = await new MessagesRepository(tx).listPublicByChatId(
        chatId,
        {
          limit: options?.limit,
          maxSeq:
            options?.beforeSeq === undefined
              ? undefined
              : options.beforeSeq - 1,
        },
      );
      return { chat, messages };
    });
  }

  /**
   * Shared write side of both fork paths (`forkSharedChat` and `forkChat`
   * below): create a new chat owned by `ownerUserId` and copy `toCopy` into
   * it in order, with fresh storage identities (see `copiedMessageRows`).
   *
   * `inherited` carries the Chat-row values the owner fork copies off its
   * source, as `createdAt`/`usage` do per row; the shared fork passes neither,
   * so its rows stay exactly what the public projection describes
   * (complete-owner-forks D5).
   */
  private async copyMessagesIntoNewChat(
    tx: Db,
    ownerUserId: string,
    title: string | null,
    toCopy: ReadonlyArray<CopyableMessage>,
    inherited: ChatInheritedValues = {},
  ): Promise<Chat> {
    // Nullable title (#78): a still-untitled chat stays untitled when forked
    // rather than forcing a title onto it.
    const created = await new ChatsRepository(tx).create({
      ownerUserId,
      ...(title !== null && { title: forkTitle(title) }),
      ...inherited,
    });

    await new MessagesRepository(tx).createMany(
      copiedMessageRows(toCopy, created.id),
    );

    return created;
  }

  /**
   * Fork a PUBLIC chat into a NEW chat owned by `callerId`, so an
   * authenticated visitor can continue a shared conversation in their own
   * account. Read side goes through the exact same public read model as
   * `GET /shared/chats/:id` (`runAsPublic` + `getSharedChat`), called with NO
   * pagination options — the WHOLE conversation, faithfully, same reasoning
   * as the owner-scoped `forkChat` (which has no message cap either): a fork
   * is a copy, and a copy must reproduce its source exactly, never silently
   * truncate it. Write side creates the copy under the caller's identity
   * (`runAs(callerId)`), same as `forkChat`. Returns undefined for a
   * private/absent chat (→ 404, no existence oracle — same as the read
   * route).
   *
   * SECURITY INVARIANT: the copy can never contain more than the public share
   * itself exposes — a CONTENT filter (public-visibility check, text-only
   * parts, no reasoning, no sender ids), not a length limit. Content (title +
   * each message's parts) is derived from `toSharedChatResponse` — the SAME
   * mapping `GET /shared/chats/:id` returns — never a second,
   * independently-maintained filter that could drift from it. `inReplyTo` is
   * the one thing looked up from the raw rows, but it is pure structural
   * threading between messages that are ALREADY in the shared set (every id
   * also appears in the DTO) — not additional content — so preserving it
   * doesn't weaken the invariant. Sender identity is never copied from the
   * source (the public DTO carries none): copied "user" turns are attributed
   * to the caller (the new owner), "assistant" turns to null, matching how
   * every other assistant message in this schema is stored.
   */
  async forkSharedChat(
    chatId: string,
    callerId: string,
  ): Promise<Chat | undefined> {
    const shared = await this.getSharedChat(chatId);
    if (!shared) {
      return undefined;
    }

    const dto = toSharedChatResponse(shared.chat, shared.messages);
    const inReplyToById = new Map(
      shared.messages.map((m) => [m.id, m.inReplyTo]),
    );

    const forked = await this.tenantDb.runAs(callerId, (tx) =>
      this.copyMessagesIntoNewChat(
        tx,
        callerId,
        dto.title,
        dto.messages.map((message) => ({
          id: message.id,
          role: message.role,
          parts: message.parts,
          senderUserId: message.role === 'user' ? callerId : null,
          // Not part of the public contract — never copied, so a fork can
          // never disclose more than the shared view it was made from.
          attachments: [],
          inReplyTo: inReplyToById.get(message.id) ?? null,
        })),
      ),
    );

    // Index the forked chat's copied content for search (#195). Fork stays
    // async by design (grill Q4) — no model call to hide an inline rebuild
    // behind, and a fork is a copy of an already-indexed chat. Best-effort,
    // post-commit; the discovery sweep backstops a missed enqueue.
    void this.reindexDispatch.enqueueChatReindex(forked.id, callerId);
    // chat-search-embeddings design D5: fork is one of the three enqueue
    // sites embed work must fire from. The reindex above hasn't run yet, so
    // this job typically finds nothing outstanding on its first pass — the
    // reindex worker's own post-rebuild enqueue (or the sweep) drives the
    // real embed once the fork's projection actually exists. Coalesced by
    // singletonKey, so this early send is never wasted more than once.
    void this.embedDispatch.enqueueChatEmbed(forked.id, callerId);
    return forked;
  }

  async deleteChat(userId: string, chatId: string): Promise<boolean> {
    return this.tenantDb.runAs(userId, async (tx) => {
      // Cancel an in-flight run FIRST: stamp cancel_requested_at and abort the
      // in-process controller, so the provider stream stops (real token spend +
      // a burst of FK-violation log noise on each post-cascade event append)
      // instead of running until the deadman timeout. Reuses the stop path.
      //
      // This order is also load-bearing for deadlock avoidance, so do not
      // reorder it to delete first: taking the run row before the chat row is
      // what lets the run finalizer's terminal transaction insert its assistant
      // message without closing a cycle with this one. See the LOCK ORDER note
      // in run-execution.service.ts#finishRun for the full argument.
      const runsRepo = new RunsRepository(tx);
      const active = await runsRepo.findActiveByChatId(chatId, userId);
      if (active) {
        await runsRepo.requestCancel(active.id, userId);
        this.aborts.abort(active.id);
      }
      return new ChatsRepository(tx).deleteById(chatId, userId);
    });
  }

  /**
   * What the fork reads from and where it stops: the owned source Chat, plus
   * the inclusive sequence the copied prefix ends at — the anchor message's
   * own `seq`, or nothing for a whole-chat clone. Both are resolved within the
   * caller's own chat, never by id alone, so an unknown chat and a
   * cross-chat/cross-tenant anchor are both 404s here and RLS makes either
   * indistinguishable from absent.
   */
  private async resolveForkBoundary(
    tx: Db,
    chatId: string,
    ownerUserId: string,
    fromMessageId: string | undefined,
  ) {
    const source = await new ChatsRepository(tx).findById(chatId, ownerUserId);
    if (!source) {
      throw new NotFoundException('Chat not found');
    }
    if (fromMessageId === undefined) {
      return { source, maxSeq: undefined };
    }

    const anchor = await new MessagesRepository(tx).findById(
      chatId,
      ownerUserId,
      fromMessageId,
    );
    if (!anchor) {
      throw new NotFoundException('Fork-point message not found in this chat');
    }
    return { source, maxSeq: anchor.seq };
  }

  /**
   * Copy the prefix's compactions into the fork, oldest-first — a parent is
   * always inserted before the child whose `parentId` names it (the
   * `(parent_id, chat_id)` FK is checked per row).
   *
   * Only storage identity moves: `parentId` follows the pre-assigned id map.
   * `uptoSeq` copies verbatim because message sequences are already dense from
   * 1 (allocation is `max + 1` and rows are never deleted), so the copied
   * numbers are the source's and a copied checkpoint still covers exactly the
   * prefix it covered before — which is what keeps the fork's absorbed-message
   * count and replay boundary identical to its source's. `create` keeps its
   * own write validation, so a malformed source row fails the whole fork
   * rather than landing broken.
   */
  private async copyCompactionsIntoNewChat(
    tx: Db,
    chatId: string,
    toCopy: ReadonlyArray<Compaction>,
    idMap: ReadonlyMap<string, string>,
  ): Promise<void> {
    const compactionsRepo = new CompactionsRepository(tx);
    for (const compaction of toCopy) {
      await compactionsRepo.create({
        id: idMap.get(compaction.id)!,
        chatId,
        uptoSeq: compaction.uptoSeq,
        parentId: compaction.parentId
          ? (idMap.get(compaction.parentId) ?? null)
          : null,
        summary: compaction.summary,
        replacementHistory: compaction.replacementHistory,
        usage: compaction.usage,
        createdAt: compaction.createdAt,
      });
    }
  }

  /**
   * The owner fork's whole read-and-write sequence, inside the caller's
   * transaction: resolve the source and the prefix bound, read the prefix and
   * the checkpoints covering it from that one snapshot, then write the
   * destination Chat (already naming its copied checkpoints), its messages,
   * and its compactions.
   */
  private async copyOwnedChat(
    tx: Db,
    chatId: string,
    ownerUserId: string,
    fromMessageId: string | undefined,
  ): Promise<Chat> {
    const { source, maxSeq } = await this.resolveForkBoundary(
      tx,
      chatId,
      ownerUserId,
      fromMessageId,
    );

    // Independent reads of that one snapshot — let postgres.js pipeline them
    // on the connection, mirroring loadWindowBeforeSeq.
    const [toCopy, compactions] = await Promise.all([
      new MessagesRepository(tx).findByChatId(chatId, ownerUserId, { maxSeq }),
      new CompactionsRepository(tx).findByChatId(chatId, ownerUserId, {
        maxSeq,
      }),
    ]);

    const { compactionIds, inherited } = inheritForkedChatState(
      source,
      compactions,
    );
    const created = await this.copyMessagesIntoNewChat(
      tx,
      ownerUserId,
      source.title,
      toCopy,
      inherited,
    );
    await this.copyCompactionsIntoNewChat(
      tx,
      created.id,
      compactions,
      compactionIds,
    );
    return created;
  }

  /**
   * Fork a conversation: copy the source Chat, every durable message up to
   * (and including) `fromMessageId`, and the compactions covering that prefix
   * into a NEW chat owned by the caller, so an alternate direction can be
   * explored without touching the original. When `fromMessageId` is omitted,
   * the WHOLE conversation is copied instead — the anchor for the sidebar's
   * "Fork" (clone) menu item, as opposed to the per-message "fork from here"
   * action; both reuse this exact machinery. Owner-scoped and atomic (one
   * `runAs` tx): the source chat AND the fork-point message (when given) are
   * located ONLY within the caller's own chat (a cross-chat/cross-tenant
   * message id simply isn't in the list → no copy); the new chat + copies
   * INSERT under the caller's identity, so RLS makes them the caller's.
   * `in_reply_to` is remapped to the copied user turns (satisfies the #73
   * integrity trigger + the one-reply-per-message index — the copy is 1:1).
   *
   * The copy is the source's LIVE state, not just its turns
   * (complete-owner-forks D1-D3): compaction lineage, message times and usage,
   * and the Chat row's creation time and frozen prompt baselines travel too,
   * so the fork's next turn renders the same inherited prefix the source's
   * next turn would — which is also what keeps that prefix eligible for
   * provider prompt caching. Run status is never consulted: the fork takes
   * what the source has committed, so forking mid-Run (or mid-retry) copies
   * the accepted user message plus whatever assistant row an attempt already
   * persisted. Only storage identifiers are rewritten, never a value inside
   * `parts` or `usage`.
   *
   * Faithful, not bounded: a fork copies the ENTIRE prefix (or the entire
   * chat, for a whole-chat clone), however long, in one atomic transaction —
   * no message-count cap (a fork must reproduce the source conversation
   * exactly, never silently truncate it). The prefix is fetched by `maxSeq`
   * (bounded to the fork point when one is given, no over-read of later
   * messages; unbounded — the whole chat — when absent) and written via
   * `createMany`'s chunked bulk insert, so an arbitrarily large conversation
   * is still a small, bounded number of round-trips.
   */
  async forkChat(
    chatId: string,
    ownerUserId: string,
    fromMessageId?: string,
  ): Promise<Chat> {
    // REPEATABLE READ: the source Chat, its messages, and its compactions must
    // describe one instant — under the default READ COMMITTED each statement
    // takes its own snapshot, so a turn or compaction committing between the
    // reads would land half-copied (messages a copied `uptoSeq` no longer
    // covers, or a checkpoint past the copied prefix). The fork writes only
    // new rows of its own, so the stricter level costs nothing but the
    // snapshot it is here for.
    const forked = await this.tenantDb.runAs(
      ownerUserId,
      (tx) => this.copyOwnedChat(tx, chatId, ownerUserId, fromMessageId),
      { isolationLevel: 'repeatable read' },
    );

    // Index the forked chat's copied content for search (#195). Fork stays
    // async by design (grill Q4) — no model call to hide an inline rebuild
    // behind, and a fork is a copy of an already-indexed chat. Best-effort,
    // post-commit; the discovery sweep backstops a missed enqueue.
    void this.reindexDispatch.enqueueChatReindex(forked.id, ownerUserId);
    // chat-search-embeddings design D5 — see the sibling fork() above for
    // why this is safe to send before the reindex has run.
    void this.embedDispatch.enqueueChatEmbed(forked.id, ownerUserId);
    return forked;
  }
}
