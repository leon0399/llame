import { Injectable } from '@nestjs/common';
import { type Chat, type Message } from '../db/schema';
import { TenantDbService } from '../db/tenant-db.service';
import { ChatsRepository, MessagesRepository } from './chats-repository';
import { RunsRepository } from '../runs/runs-repository';
import { RunAbortRegistry } from '../runs/run-abort-registry';

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
    patch: { title?: string },
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
}
