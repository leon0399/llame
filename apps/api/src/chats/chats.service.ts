import { Inject, Injectable } from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { desc, eq } from 'drizzle-orm';
import * as schema from '../db/schema';
import { Chat, chats } from '../db/schema';

@Injectable()
export class ChatsService {
  constructor(
    @Inject('DB_DEV') private db: PostgresJsDatabase<typeof schema>,
  ) {}

  async getChatsByUserId(userId: string): Promise<Chat[]> {
    const userChats = await this.db
      .select()
      .from(chats)
      .where(eq(chats.userId, userId))
      .orderBy(desc(chats.lastMessageAt), desc(chats.createdAt));

    return userChats.length ? userChats : [];
  }

  async getChatById(chatId: string): Promise<Chat | undefined> {
    const chat = await this.db
      .select()
      .from(chats)
      .where(eq(chats.id, chatId))
      .limit(1);

    return chat.length ? chat[0] : undefined;
  }

  async createChat({
    userId,
    title,
    createdAt,
  }: {
    userId: string;
    title: string;
    createdAt?: Date;
  }): Promise<Chat> {
    const [newChat] = await this.db
      .insert(chats)
      .values({
        userId,
        title,
        createdAt: createdAt ?? new Date(),
      })
      .returning();

    return newChat;
  }

  async updateChatLastMessage(
    chatId: string,
    lastMessageAt: Date,
  ): Promise<Chat | undefined> {
    const [updatedChat] = await this.db
      .update(chats)
      .set({ lastMessageAt })
      .where(eq(chats.id, chatId))
      .returning();

    return updatedChat;
  }
}
