import { HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { type Chat, type Compaction, type Message } from '../db/schema';
import { TenantDbService } from '../db/tenant-db.service';
import { SearchReindexDispatchService } from '../search/search-reindex-dispatch.service';
import {
  ChatsRepository,
  CompactionsRepository,
  MessagesRepository,
} from './chats-repository';
import { RunsRepository } from '../runs/runs-repository';
import { RunAbortRegistry } from '../runs/run-abort-registry';
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
    private readonly reindexDispatch: SearchReindexDispatchService,
  ) {}

  /**
   * Owned chats newest-first, each with its latest message (chat-list
   * previews). `filter.projectId` narrows to chats filed into that project
   * (the /projects page's list). The previews query stays unfiltered — it is
   * one indexed pass either way, and the map lookup discards the rest.
   */
  async listChatsWithLastMessage(
    userId: string,
    filter: { projectId?: string } = {},
  ): Promise<{ chat: Chat; lastMessage: Message | undefined }[]> {
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
   */
  async getChatMessages(
    chatId: string,
    ownerUserId: string,
    options: { limit: number; beforeSeq?: number },
  ): Promise<
    | {
        messages: Message[];
        compaction: Compaction | undefined;
        absorbedMessageCount: number | null;
      }
    | undefined
  > {
    return this.tenantDb.runAs(ownerUserId, async (tx) => {
      const chatsRepository = new ChatsRepository(tx);
      const chat = await chatsRepository.findById(chatId, ownerUserId);
      if (!chat) {
        return undefined;
      }

      const compactionsRepository = new CompactionsRepository(tx);
      const [messages, compaction] = await Promise.all([
        new MessagesRepository(tx).findByChatId(chatId, ownerUserId, {
          limit: options.limit,
          maxSeq:
            options.beforeSeq === undefined ? undefined : options.beforeSeq - 1,
        }),
        compactionsRepository.findLatestByChatId(chatId, ownerUserId),
      ]);

      let absorbedMessageCount: number | null = null;
      if (compaction) {
        const previous = compaction.parentId
          ? await compactionsRepository.findLatestByChatId(
              chatId,
              ownerUserId,
              { beforeSeq: compaction.uptoSeq },
            )
          : undefined;
        absorbedMessageCount = compaction.uptoSeq - (previous?.uptoSeq ?? 0);
      }

      return { messages, compaction, absorbedMessageCount };
    });
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
    },
  ): Promise<Chat | undefined> {
    try {
      return await this.tenantDb.runAs(ownerUserId, (tx) =>
        new ChatsRepository(tx).update(chatId, ownerUserId, patch),
      );
    } catch (err) {
      if (err instanceof HttpException) {
        throw err;
      }
      const code = pgErrorCode(err);
      // Sound today because project_id is the ONLY patchable FK on chats
      // (owner_user_id isn't patchable, so the WITH CHECK's other conjunct
      // can't fail). If chats ever gains another patchable FK, this catch
      // would mislabel its violations "Project not found" — key the mapping
      // on the constraint name in the pg error instead when that happens.
      if (code === '23503' || code === '42501') {
        throw new NotFoundException('Project not found');
      }
      throw err;
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
    return this.tenantDb.runAs(userId, (tx) =>
      new ChatsRepository(tx).searchByOwner(userId, query, limit),
    );
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
  ): Promise<{ chat: Chat; messages: Message[] } | undefined> {
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

    const forked = await this.tenantDb.runAs(callerId, async (tx) => {
      const chatsRepo = new ChatsRepository(tx);
      const messagesRepo = new MessagesRepository(tx);

      const created = await chatsRepo.create({
        ownerUserId: callerId,
        ...(dto.title !== null ? { title: forkTitle(dto.title) } : {}),
      });

      const idMap = new Map(
        dto.messages.map((m) => [m.id, crypto.randomUUID()]),
      );

      await messagesRepo.createMany(
        dto.messages.map((message) => {
          const originalInReplyTo = inReplyToById.get(message.id) ?? null;
          return {
            id: idMap.get(message.id)!,
            chatId: created.id,
            role: message.role,
            senderUserId: message.role === 'user' ? callerId : null,
            parts: message.parts,
            // Not part of the public contract — never copied (same
            // precedent as forkChat's usage: a fork made zero API calls and
            // must not inherit telemetry or attachments it didn't produce).
            attachments: [],
            inReplyTo: originalInReplyTo
              ? (idMap.get(originalInReplyTo) ?? null)
              : null,
          };
        }),
      );

      return created;
    });

    // Index the forked chat's copied content for search (#195). Fork stays
    // async by design (grill Q4) — no model call to hide an inline rebuild
    // behind, and a fork is a copy of an already-indexed chat. Best-effort,
    // post-commit; the discovery sweep backstops a missed enqueue.
    void this.reindexDispatch.enqueueChatReindex(forked.id, callerId);
    return forked;
  }

  async deleteChat(userId: string, chatId: string): Promise<boolean> {
    return this.tenantDb.runAs(userId, async (tx) => {
      // Cancel an in-flight run FIRST: stamp cancel_requested_at and abort the
      // in-process controller, so the provider stream stops (real token spend +
      // a burst of FK-violation log noise on each post-cascade event append)
      // instead of running until the deadman timeout. Reuses the stop path.
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
   * Fork a conversation: copy every message up to (and including)
   * `fromMessageId` into a NEW chat owned by the caller, so an alternate
   * direction can be explored without touching the original. When
   * `fromMessageId` is omitted, the WHOLE conversation is copied instead —
   * the anchor for the sidebar's "Fork" (clone) menu item, as opposed to the
   * per-message "fork from here" action; both reuse this exact machinery.
   * Owner-scoped and atomic (one `runAs` tx): the source chat AND the
   * fork-point message (when given) are located ONLY within the caller's own
   * chat (a cross-chat/cross-tenant message id simply isn't in the list → no
   * copy); the new chat + copies INSERT under the caller's identity, so RLS
   * makes them the caller's. `in_reply_to` is remapped to the copied user
   * turns (satisfies the #73 integrity trigger + the one-reply-per-message
   * index — the copy is 1:1).
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
    const forked = await this.tenantDb.runAs(ownerUserId, async (tx) => {
      const chatsRepo = new ChatsRepository(tx);
      const messagesRepo = new MessagesRepository(tx);

      const source = await chatsRepo.findById(chatId, ownerUserId);
      if (!source) {
        // Unknown/cross-tenant chat (RLS makes it indistinguishable from absent).
        throw new NotFoundException('Chat not found');
      }

      // Absent anchor → no maxSeq bound → the whole chat (clone). A given
      // anchor is resolved to ITS seq, scoped the same way as the chat above
      // (owner + chat id), so a cross-chat/cross-tenant message id 404s here
      // exactly like an unknown chat does.
      let maxSeq: number | undefined;
      if (fromMessageId !== undefined) {
        const target = await messagesRepo.findById(
          chatId,
          ownerUserId,
          fromMessageId,
        );
        if (!target) {
          throw new NotFoundException(
            'Fork-point message not found in this chat',
          );
        }
        maxSeq = target.seq;
      }

      const toCopy = await messagesRepo.findByChatId(chatId, ownerUserId, {
        maxSeq,
      });

      const created = await chatsRepo.create({
        ownerUserId,
        // Nullable title (#78): a still-untitled chat stays untitled when forked
        // rather than forcing a title onto it.
        ...(source.title !== null ? { title: forkTitle(source.title) } : {}),
      });

      // Pre-assign every copy's new id up front so in_reply_to can be remapped
      // BEFORE any insert happens — a chunked bulk insert has no per-row
      // RETURNING to learn a new id mid-batch, and a reply's in_reply_to only
      // ever points to an earlier message in this same prefix (lower seq), so
      // every reference is guaranteed to already be in the map.
      const idMap = new Map(toCopy.map((m) => [m.id, crypto.randomUUID()]));

      await messagesRepo.createMany(
        toCopy.map((message) => ({
          id: idMap.get(message.id)!,
          chatId: created.id,
          role: message.role,
          senderUserId: message.senderUserId,
          parts: message.parts,
          attachments: message.attachments,
          // usage is deliberately NOT copied: a fork makes ZERO API calls, so its
          // turns must not carry cost/token telemetry — else a future usage
          // aggregation (summed by created_at) would double-count the original
          // spend at the fork date.
          inReplyTo: message.inReplyTo
            ? (idMap.get(message.inReplyTo) ?? null)
            : null,
        })),
      );

      return created;
    });

    // Index the forked chat's copied content for search (#195). Fork stays
    // async by design (grill Q4) — no model call to hide an inline rebuild
    // behind, and a fork is a copy of an already-indexed chat. Best-effort,
    // post-commit; the discovery sweep backstops a missed enqueue.
    void this.reindexDispatch.enqueueChatReindex(forked.id, ownerUserId);
    return forked;
  }
}

/** Extract the Postgres SQLSTATE from a raw driver error or a Drizzle wrapper. */
function pgErrorCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code ?? e?.cause?.code;
}
