import { Controller, Get, Param, Post, Body, Put } from '@nestjs/common';
import { ChatsService } from './chats.service';
import { Chat } from '../db/schema';

@Controller('chats')
export class ChatsController {
  constructor(private readonly chatsService: ChatsService) {}

  @Get('user/:userId')
  async getChatsByUserId(@Param('userId') userId: string): Promise<Chat[]> {
    return this.chatsService.getChatsByUserId(userId);
  }

  @Get(':id')
  async getChatById(@Param('id') id: string): Promise<Chat | undefined> {
    return this.chatsService.getChatById(id);
  }

  @Post()
  async createChat(
    @Body() chatData: { userId: string; title: string; createdAt?: Date },
  ): Promise<Chat> {
    return this.chatsService.createChat(chatData);
  }

  @Put(':id/last-message')
  async updateChatLastMessage(
    @Param('id') id: string,
    @Body() { lastMessageAt }: { lastMessageAt: string | Date },
  ): Promise<Chat | undefined> {
    const date =
      typeof lastMessageAt === 'string'
        ? new Date(lastMessageAt)
        : lastMessageAt;
    return this.chatsService.updateChatLastMessage(id, date);
  }
}
