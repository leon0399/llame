import {
  Controller,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/auth-context';
import { Public } from '../auth/public.decorator';
import { ChatsService } from './chats.service';
import {
  ChatMessagesQueryDto,
  ChatResponse,
  SharedChatResponse,
  toChatResponse,
  toSharedChatResponse,
} from './dto/chats.dto';

/**
 * Public read-only chat sharing. `@Public` (no session) — a shared link opens
 * for anyone. The tenant boundary is `runAsPublic` + the SELECT-only
 * `*_public_read` RLS policies (only `visibility='public'` chats are visible),
 * so a private/absent id is a plain 404 (no existence oracle), regardless of
 * pagination params. `no-store` so a chat later made private is never served
 * stale from a cache/CDN.
 *
 * The fork route below is the one exception: it requires a session (no
 * `@Public`, fail-closed default) — see its own doc comment.
 */
@ApiTags('chats')
@Controller('api/v1/shared/chats')
export class SharedChatsController {
  constructor(private readonly chatsService: ChatsService) {}

  /**
   * Reuses `ChatMessagesQueryDto` (the same `limit`/`beforeSeq` cursor
   * contract as the owner's `GET /chats/:id/messages`) — per-request cost is
   * bounded by pagination, never by truncating the conversation. The client
   * walks it exactly like the owner chat page's "load older" does
   * (`paginateAllMessages`): each page returns `messages` oldest-first;
   * fewer than `limit` rows means the start of the conversation was reached.
   */
  @Public()
  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: SharedChatResponse })
  @ApiNotFoundResponse({ description: 'Chat not found or not public' })
  async getSharedChat(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ChatMessagesQueryDto,
  ): Promise<SharedChatResponse> {
    const shared = await this.chatsService.getSharedChat(id, {
      limit: query.limit,
      beforeSeq: query.beforeSeq,
    });
    if (!shared) {
      throw new NotFoundException(`Shared chat ${id} not found`);
    }
    return toSharedChatResponse(shared.chat, shared.messages);
  }

  /**
   * Fork a public chat into a NEW chat the caller owns, so a signed-in
   * visitor can continue a shared conversation. Deliberately NOT `@Public` —
   * the read side reuses the public read model (`runAsPublic`, unpaginated —
   * a fork copies the WHOLE conversation faithfully, same as the owner-scoped
   * fork), filtered through the exact same egress allowlist
   * `GET /shared/chats/:id` returns (public-visibility check, text-only
   * parts, no reasoning, no sender ids — a content filter, not a length
   * limit), but the write side creates the copy under the caller's own
   * identity, so a verified session is required like every other write in
   * this API. A private/absent chat 404s identically to the read route (no
   * existence oracle).
   */
  @Post(':id/forks')
  @HttpCode(201)
  @ApiBearerAuth('bearer')
  @ApiCookieAuth('cookie')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiCreatedResponse({ type: ChatResponse })
  @ApiNotFoundResponse({ description: 'Chat not found or not public' })
  @ApiUnauthorizedResponse()
  async forkSharedChat(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ChatResponse> {
    const forked = await this.chatsService.forkSharedChat(id, userId);
    if (!forked) {
      throw new NotFoundException(`Shared chat ${id} not found`);
    }
    return toChatResponse(forked);
  }
}
