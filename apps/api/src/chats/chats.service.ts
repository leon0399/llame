import { Inject, Injectable } from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../db/schema';
import { type Chat } from '../db/schema';
import { ChatsRepository } from './chats-repository';

@Injectable()
export class ChatsService {
  private readonly chatsRepo: ChatsRepository;

  constructor(@Inject('DB_DEV') private db: PostgresJsDatabase<typeof schema>) {
    this.chatsRepo = new ChatsRepository(db);
  }

  async getChatsByUserId(userId: string): Promise<Chat[]> {
    return this.chatsRepo.findByOwner(userId);
  }

  async getChatById(
    chatId: string,
    ownerUserId: string,
  ): Promise<Chat | undefined> {
    return this.chatsRepo.findById(chatId, ownerUserId);
  }

  async createChat(input: {
    ownerUserId: string;
    title?: string;
  }): Promise<Chat> {
    return this.chatsRepo.create(input);
  }

  async updateChatTitle(
    chatId: string,
    ownerUserId: string,
    title: string,
  ): Promise<Chat | undefined> {
    return this.chatsRepo.updateTitle(chatId, ownerUserId, title);
  }
}
