import { Injectable, NotFoundException } from '@nestjs/common';
import { type Chat, type Compaction, type Message } from '../db/schema';
import { TenantDbService } from '../db/tenant-db.service';
import {
  ChatsRepository,
  CompactionsRepository,
  MessagesRepository,
} from './chats-repository';
import { RunsRepository } from '../runs/runs-repository';
import { RunAbortRegistry } from '../runs/run-abort-registry';

/** Title for a forked chat. */
export function forkTitle(title: string): string {
  return `${title} (fork)`;
}

@Injectable()
export class ChatsService {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly aborts: RunAbortRegistry,
  ) {}

  /** Owned chats newest-first, each with its latest message (chat-list previews). */
  async listChatsWithLastMessage(
    userId: string,
  ): Promise<{ chat: Chat; lastMessage: Message | undefined }[]> {
    return this.tenantDb.runAs(userId, async (tx) => {
      // Independent queries — let postgres.js pipeline them on the connection.
      const [chatList, latest] = await Promise.all([
        new ChatsRepository(tx).findByOwner(userId),
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

  /** The chat's latest compaction (#57), for surfacing the summary boundary. */
  async getChatCompaction(
    chatId: string,
    ownerUserId: string,
  ): Promise<Compaction | undefined> {
    return this.tenantDb.runAs(ownerUserId, (tx) =>
      new CompactionsRepository(tx).findLatestByChatId(chatId, ownerUserId),
    );
  }

  async getChatMessages(
    chatId: string,
    ownerUserId: string,
    options: { limit: number; beforeSeq?: number },
  ): Promise<Message[] | undefined> {
    return this.tenantDb.runAs(ownerUserId, async (tx) => {
      const chatsRepository = new ChatsRepository(tx);
      const chat = await chatsRepository.findById(chatId, ownerUserId);
      if (!chat) {
        return undefined;
      }

      return new MessagesRepository(tx).findByChatId(chatId, ownerUserId, {
        limit: options.limit,
        maxSeq:
          options.beforeSeq === undefined ? undefined : options.beforeSeq - 1,
      });
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

  async updateChat(
    chatId: string,
    ownerUserId: string,
    patch: { title?: string; pinned?: boolean },
  ): Promise<Chat | undefined> {
    return this.tenantDb.runAs(ownerUserId, (tx) =>
      new ChatsRepository(tx).update(chatId, ownerUserId, patch),
    );
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
    return this.tenantDb.runAs(ownerUserId, async (tx) => {
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

      const forked = await chatsRepo.create({
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
          chatId: forked.id,
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

      return forked;
    });
  }
}
