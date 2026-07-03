import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { Public } from '../auth/public.decorator';
import { ChatsService } from './chats.service';
import { SharedChatResponse, toSharedChatResponse } from './dto/chats.dto';

/**
 * Public read-only chat sharing. `@Public` (no session) — a shared link opens
 * for anyone. The tenant boundary is `runAsPublic` + the SELECT-only
 * `*_public_read` RLS policies (only `visibility='public'` chats are visible),
 * so a private/absent id is a plain 404 (no existence oracle). `no-store` so a
 * chat later made private is never served stale from a cache/CDN.
 */
@ApiTags('chats')
@Controller('api/v1/shared/chats')
export class SharedChatsController {
  constructor(private readonly chatsService: ChatsService) {}

  @Public()
  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: SharedChatResponse })
  @ApiNotFoundResponse({ description: 'Chat not found or not public' })
  async getSharedChat(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SharedChatResponse> {
    const shared = await this.chatsService.getSharedChat(id);
    if (!shared) {
      throw new NotFoundException(`Shared chat ${id} not found`);
    }
    return toSharedChatResponse(shared.chat, shared.messages);
  }
}
