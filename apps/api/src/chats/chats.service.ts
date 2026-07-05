import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type Chat, type Compaction, type Message } from '../db/schema';
import { TenantDbService } from '../db/tenant-db.service';
import {
  ChatsRepository,
  CompactionsRepository,
  MessagesRepository,
} from './chats-repository';
import { RunsRepository } from '../runs/runs-repository';
import { RunAbortRegistry } from '../runs/run-abort-registry';

/** Upper bound on messages copied by a single fork (storage / tx-length guard). */
const MAX_FORK_MESSAGES = 1000;

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

  /**
   * Fork a conversation: copy every message up to (and including) `fromMessageId`
   * into a NEW chat owned by the caller, so an alternate direction can be explored
   * without touching the original. Owner-scoped and atomic (one `runAs` tx): the
   * source chat AND the fork-point message are located ONLY within the caller's
   * own chat (a cross-chat/cross-tenant message id simply isn't in the list → no
   * copy); the new chat + copies INSERT under the caller's identity, so RLS makes
   * them the caller's. `in_reply_to` is remapped to the copied user turns (satisfies
   * the #73 integrity trigger + the one-reply-per-message index — the copy is 1:1).
   */
  async forkChat(
    chatId: string,
    ownerUserId: string,
    fromMessageId: string,
  ): Promise<Chat> {
    return this.tenantDb.runAs(ownerUserId, async (tx) => {
      const chatsRepo = new ChatsRepository(tx);
      const messagesRepo = new MessagesRepository(tx);

      const source = await chatsRepo.findById(chatId, ownerUserId);
      if (!source) {
        // Unknown/cross-tenant chat (RLS makes it indistinguishable from absent).
        throw new NotFoundException('Chat not found');
      }

      const all = await messagesRepo.findByChatId(chatId, ownerUserId);
      const target = all.find((m) => m.id === fromMessageId);
      if (!target) {
        throw new NotFoundException(
          'Fork-point message not found in this chat',
        );
      }

      const toCopy = all.filter((m) => m.seq <= target.seq);
      if (toCopy.length > MAX_FORK_MESSAGES) {
        // Bound the copy: a fork duplicates the whole prefix, so an unbounded
        // copy would be a storage / long-transaction hazard.
        throw new BadRequestException(
          `Cannot fork a conversation longer than ${MAX_FORK_MESSAGES} messages`,
        );
      }

      const forked = await chatsRepo.create({
        ownerUserId,
        ...(source.title !== null ? { title: forkTitle(source.title) } : {}),
      });

      const idMap = new Map<string, string>();
      for (const message of toCopy) {
        const created = await messagesRepo.create({
          chatId: forked.id,
          role: message.role,
          senderUserId: message.senderUserId,
          parts: message.parts,
          attachments: message.attachments,
          // usage is deliberately NOT copied: a fork makes ZERO API calls, so its
          // turns must not carry cost/token telemetry — else the BYOK usage
          // dashboard (which sums messages.usage by created_at) would double-count
          // the original spend at the fork date.
          inReplyTo: message.inReplyTo
            ? (idMap.get(message.inReplyTo) ?? null)
            : null,
        });
        idMap.set(message.id, created.id);
      }

      return forked;
    });
  }

  async searchChats(
    userId: string,
    query: string,
    limit: number,
  ): Promise<
    Array<{
      id: string;
      title: string;
      snippet: string | null;
      updatedAt: Date;
    }>
  > {
    return this.tenantDb.runAs(userId, (tx) =>
      new ChatsRepository(tx).searchByOwner(userId, query, limit),
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
    patch: {
      title?: string;
      visibility?: 'private' | 'public';
      pinned?: boolean;
    },
  ): Promise<Chat | undefined> {
    return this.tenantDb.runAs(ownerUserId, (tx) =>
      new ChatsRepository(tx).update(chatId, ownerUserId, patch),
    );
  }

  /**
   * Read a PUBLIC chat + its messages for the share view — via `runAsPublic`
   * (no tenant identity), so a private/absent chat returns undefined (→ 404).
   */
  async getSharedChat(
    chatId: string,
  ): Promise<{ chat: Chat; messages: Message[] } | undefined> {
    return this.tenantDb.runAsPublic(async (tx) => {
      const chat = await new ChatsRepository(tx).findPublicById(chatId);
      if (!chat) {
        return undefined;
      }
      const messages = await new MessagesRepository(tx).listPublicByChatId(
        chatId,
      );
      return { chat, messages };
    });
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
}
