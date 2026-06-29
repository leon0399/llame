import { Injectable } from '@nestjs/common';
import { type Chat } from '../db/schema';
import { TenantDbService } from '../db/tenant-db.service';
import { ChatsRepository } from './chats-repository';

@Injectable()
export class ChatsService {
  constructor(private readonly tenantDb: TenantDbService) {}

  async getChatsByUserId(userId: string): Promise<Chat[]> {
    return this.tenantDb.runAs(userId, (tx) =>
      new ChatsRepository(tx).findByOwner(userId),
    );
  }

  async getChatById(
    chatId: string,
    ownerUserId: string,
  ): Promise<Chat | undefined> {
    return this.tenantDb.runAs(ownerUserId, (tx) =>
      new ChatsRepository(tx).findById(chatId, ownerUserId),
    );
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
}
