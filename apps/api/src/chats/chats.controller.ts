import { Controller, Get, Param, Post, Body, Put } from '@nestjs/common';
import { ChatsService } from './chats.service';
import { Chat } from '../db/schema';

@Controller('chats')
export class ChatsController {
  constructor(private readonly chatsService: ChatsService) {}

  @Get('owner/:ownerUserId')
  async getChatsByOwner(
    @Param('ownerUserId') ownerUserId: string,
  ): Promise<Chat[]> {
    return this.chatsService.getChatsByUserId(ownerUserId);
  }

  @Get(':id')
  async getChatById(
    @Param('id') id: string,
    @Body() { ownerUserId }: { ownerUserId: string },
  ): Promise<Chat | undefined> {
    return this.chatsService.getChatById(id, ownerUserId);
  }

  @Post()
  async createChat(
    @Body() chatData: { ownerUserId: string; title?: string },
  ): Promise<Chat> {
    return this.chatsService.createChat(chatData);
  }

  @Put(':id/title')
  async updateChatTitle(
    @Param('id') id: string,
    @Body() { ownerUserId, title }: { ownerUserId: string; title: string },
  ): Promise<Chat | undefined> {
    return this.chatsService.updateChatTitle(id, ownerUserId, title);
  }
}
