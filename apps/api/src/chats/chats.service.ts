import {
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type Chat,
  type Compaction,
  type Message,
  type MessageRole,
} from '../db/schema';
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
  isCompletedAssistantTurn,
  MessagesRepository,
} from './chats-repository';
import { RunsRepository } from '../runs/runs-repository';
import { RunAbortRegistry } from '../runs/run-abort-registry';
import { pgErrorCode } from '../db/pg-error';
import { toSharedChatResponse } from './dto/chats.dto';
import { resolveForkBoundary } from './fork-boundary';

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
   * Shared write side of both fork paths: copy `toCopy` into a new chat
   * with remapped IDs. No usage, no evidence — used by shared/public forks.
   */
  private async copyMessagesIntoNewChat(
    tx: Db,
    ownerUserId: string,
    title: string | null,
    toCopy: Array<{
      id: string;
      role: MessageRole;
      parts: Array<unknown>;
      senderUserId: string | null;
      attachments: Array<unknown>;
      inReplyTo: string | null;
    }>,
  ): Promise<Chat> {
    const chatsRepo = new ChatsRepository(tx);
    const created = await chatsRepo.create({
      ownerUserId,
      ...(title !== null && { title: forkTitle(title) }),
    });
    const idMap = new Map(toCopy.map((m) => [m.id, crypto.randomUUID()]));
    await new MessagesRepository(tx).createMany(
      toCopy.map((message, index) => ({
        id: idMap.get(message.id)!,
        chatId: created.id,
        seq: index + 1,
        role: message.role,
        senderUserId: message.senderUserId,
        parts: message.parts,
        attachments: message.attachments,
        inReplyTo: message.inReplyTo
          ? (idMap.get(message.inReplyTo) ?? null)
          : null,
      })),
    );
    return created;
  }

  /**
   * Owner-fork copy (#154): copy the selected message prefix, applicable
   * compaction lineage, and set the initial continuation state.
   */
  private async copyOwnerPrefix(
    tx: Db,
    ownerUserId: string,
    source: Chat,
    toCopy: Array<Message>,
  ): Promise<Chat> {
    const chatsRepo = new ChatsRepository(tx);
    const created = await chatsRepo.create({
      ownerUserId,
      ...(source.title !== null && { title: forkTitle(source.title) }),
      ...(toCopy.length > 0 && {
        inheritedContextOriginAt:
          source.inheritedContextOriginAt ?? source.createdAt,
      }),
    });
    // Copy messages with provenance.
    const msgIdMap = new Map(toCopy.map((m) => [m.id, crypto.randomUUID()]));
    await new MessagesRepository(tx).createMany(
      toCopy.map((m, i) =>
        mapOwnerCopiedMessage(m, i, created.id, msgIdMap, toCopy),
      ),
    );
    // Copy applicable compactions (uptoSeq within the prefix boundary).
    if (toCopy.length > 0) {
      const maxSeq = toCopy.at(-1)!.seq;
      await copyCompactionLineage(
        tx,
        source.id,
        ownerUserId,
        created.id,
        maxSeq,
      );
    }
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
          // Not part of the public contract — never copied (same precedent
          // as forkChat's usage: a fork made zero API calls and must not
          // inherit telemetry or attachments it didn't produce).
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

  /** Fork a conversation (#154 owner-chat-forks). */
  async forkChat(
    chatId: string,
    ownerUserId: string,
    fromMessageId?: string,
  ): Promise<Chat> {
    const forked = await this.forkChatTransaction(
      chatId,
      ownerUserId,
      fromMessageId,
    );
    void this.reindexDispatch.enqueueChatReindex(forked.id, ownerUserId);
    void this.embedDispatch.enqueueChatEmbed(forked.id, ownerUserId);
    return forked;
  }

  /**
   * REPEATABLE READ transaction: resolve source, boundary, and copy the
   * selected prefix into a new private chat. Empty whole-chat creates an
   * empty chat. Explicit anchors on unfinished turns → 409.
   */
  private async forkChatTransaction(
    chatId: string,
    ownerUserId: string,
    fromMessageId: string | undefined,
  ): Promise<Chat> {
    return this.tenantDb.runAs(
      ownerUserId,
      async (tx) => {
        const chatsRepo = new ChatsRepository(tx);
        const messagesRepo = new MessagesRepository(tx);
        const source = await chatsRepo.findById(chatId, ownerUserId);
        if (!source) throw new NotFoundException('Chat not found');
        const scope = {
          messagesRepo,
          runsRepo: new RunsRepository(tx),
          chatId,
          ownerUserId,
        };
        const maxSeq = await resolveForkBoundary(scope, fromMessageId);
        if (maxSeq === null) {
          return chatsRepo.create({
            ownerUserId,
            ...(source.title !== null && { title: forkTitle(source.title) }),
          });
        }
        const toCopy = await messagesRepo.findByChatId(chatId, ownerUserId, {
          maxSeq,
        });
        return this.copyOwnerPrefix(tx, ownerUserId, source, toCopy);
      },
      { isolationLevel: 'repeatable read' },
    );
  }
}

/** Map a source message to its owner-fork destination shape. */
function mapOwnerCopiedMessage(
  message: Message,
  index: number,
  destChatId: string,
  idMap: Map<string, string>,
  allCopied: Array<Message>,
) {
  return {
    id: idMap.get(message.id)!,
    chatId: destChatId,
    seq: index + 1,
    role: message.role,
    senderUserId: message.senderUserId,
    parts: message.parts,
    attachments: message.attachments,
    usage: message.usage,
    createdAt: message.createdAt,
    inReplyTo: message.inReplyTo
      ? (idMap.get(message.inReplyTo) ?? null)
      : null,
    inheritedTurnComplete:
      message.inheritedTurnComplete ||
      (message.role === 'user' &&
        allCopied.some(
          (m) =>
            m.role === 'assistant' &&
            m.inReplyTo === message.id &&
            isCompletedAssistantTurn(m),
        )),
    ...(message.usage != null && {
      usageOriginKind: message.usageOriginKind ?? ('message' as const),
      usageOriginId: message.usageOriginId ?? message.id,
      usageProvenanceCol: 'inherited' as const,
    }),
  };
}

/** Copy applicable compaction lineage from source to destination. */
async function copyCompactionLineage(
  tx: Db,
  sourceChatId: string,
  ownerUserId: string,
  destChatId: string,
  maxSeq: number,
): Promise<void> {
  const compactionsRepo = new CompactionsRepository(tx);
  const allCompactions = await compactionsRepo.findByCoverage(
    sourceChatId,
    ownerUserId,
    maxSeq,
  );
  if (allCompactions.length === 0) return;
  const compIdMap = new Map(
    allCompactions.map((c) => [c.id, crypto.randomUUID()]),
  );
  for (const comp of allCompactions) {
    await compactionsRepo.create({
      id: compIdMap.get(comp.id),
      chatId: destChatId,
      uptoSeq: comp.uptoSeq,
      parentId: comp.parentId ? (compIdMap.get(comp.parentId) ?? null) : null,
      summary: comp.summary,
      replacementHistory: comp.replacementHistory,
      usage: comp.usage,
      ...(comp.usage != null && {
        usageOriginKind: comp.usageOriginKind ?? ('compaction' as const),
        usageOriginId: comp.usageOriginId ?? comp.id,
        usageProvenanceCol: 'inherited' as const,
      }),
    });
  }
}
