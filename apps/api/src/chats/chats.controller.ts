import {
  Controller,
  Get,
  Param,
  Post,
  Body,
  Put,
  Query,
  NotFoundException,
} from '@nestjs/common';
import { ChatsService } from './chats.service';
import { Chat } from '../db/schema';

/**
 * SECURITY (v0.1, pre-auth): `ownerUserId` is currently taken from client input
 * (params/body). That means it sets the RLS tenant identity from caller-supplied
 * data — a client could read/write another tenant by passing a different id. These
 * endpoints are dev scaffolding and MUST NOT be exposed until `ownerUserId` is
 * derived from a verified auth session/guard (separate follow-up). RLS + owner-scoped
 * repositories are defense-in-depth, not a substitute for trusted identity.
 */
@Controller('chats')
export class ChatsController {
  constructor(private readonly chatsService: ChatsService) {}

  @Get('owner/:ownerUserId')
  async getChatsByOwner(
    @Param('ownerUserId') ownerUserId: string,
  ): Promise<Chat[]> {
    return this.chatsService.getChatsByUserId(ownerUserId);
  }

  // ownerUserId via @Query, not @Body: GET request bodies are dropped by many
  // clients, caches, and proxies, so a @Body() value arrives undefined in practice.
  @Get(':id')
  async getChatById(
    @Param('id') id: string,
    @Query('ownerUserId') ownerUserId: string,
  ): Promise<Chat> {
    const chat = await this.chatsService.getChatById(id, ownerUserId);
    if (!chat) {
      throw new NotFoundException(`Chat ${id} not found`);
    }
    return chat;
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
  ): Promise<Chat> {
    const chat = await this.chatsService.updateChatTitle(
      id,
      ownerUserId,
      title,
    );
    if (!chat) {
      throw new NotFoundException(`Chat ${id} not found`);
    }
    return chat;
  }
}
