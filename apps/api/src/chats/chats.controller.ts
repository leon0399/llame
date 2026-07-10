import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiCookieAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Request, Response as ExpressResponse } from 'express';
import { CurrentUser } from '../auth/auth-context';
import { TenantDbService } from '../db/tenant-db.service';
import { ChatLoopService } from './chat-loop.service';
import { ChatsService } from './chats.service';
import {
  ModelConfigurationError,
  ModelNotAvailableError,
} from '../models/models.service';
import { ModelDomainErrorResponse } from '../models/dto/models.dto';
import { RunStreamBridgeService } from '../runs/run-stream-bridge';
import { RunsRepository } from '../runs/runs-repository';
import {
  ChatListItemResponse,
  ChatMessagesQueryDto,
  ChatMessagesResponse,
  ChatResponse,
  ChatSearchQueryDto,
  ChatSearchResponse,
  CreateMessageDto,
  ForkChatDto,
  toChatListItemResponse,
  toChatMessageResponse,
  toChatResponse,
  toCompactionResponse,
  UpdateChatDto,
} from './dto/chats.dto';

const streamLogger = new Logger('ChatStream');

@ApiTags('chats')
@ApiBearerAuth('bearer')
@ApiCookieAuth('cookie')
@Controller('api/v1/chats')
export class ChatsController {
  private readonly logger = new Logger(ChatsController.name);

  constructor(
    private readonly chatsService: ChatsService,
    private readonly chatLoopService: ChatLoopService,
    private readonly tenantDb: TenantDbService,
    private readonly bridge: RunStreamBridgeService,
  ) {}

  /**
   * Resume the chat's active run as a UI-message stream (#49, SPEC §9.4).
   *
   * The AI SDK transport contract for reconnectToStream: GET returns the live
   * stream when a run is in flight, 204 when there is nothing to resume. The
   * bridge replays the run's persisted events from the start, so a page
   * refresh mid-run restores every delta already generated and then continues
   * live — nothing is lost with the socket.
   *
   * A cross-tenant or unknown chat id answers 204, indistinguishable from
   * "no active run" (no existence leak).
   */
  @Get(':id/stream')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({
    description: 'AI SDK v5 UI-message stream (SSE) replaying the active run',
    content: { 'text/event-stream': { schema: { type: 'string' } } },
  })
  @ApiResponse({ status: 204, description: 'No active run to resume' })
  @ApiBadRequestResponse({ description: 'Malformed chat id (not a UUID)' })
  @ApiUnauthorizedResponse()
  async resumeChatStream(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() response: ExpressResponse,
  ): Promise<void> {
    // Abort registration comes FIRST: a client that disconnects while the
    // run lookup is in flight fires 'close' before any listener would exist,
    // and the bridge would then stream to a destroyed response until its cap.
    const abort = requestAbortSignal(response);
    try {
      const run = await this.tenantDb.runAs(userId, (tx) =>
        new RunsRepository(tx).findActiveByChatId(id, userId),
      );
      if (abort.signal.aborted) {
        return; // client is gone — nothing to write to
      }
      if (!run) {
        response.status(204).end();
        return;
      }

      const streamResponse = this.bridge.createUiMessageStreamResponse({
        runId: run.id,
        userId,
        abortSignal: abort.signal,
      });
      await writeWebResponse(streamResponse, response, abort.signal);
    } finally {
      abort.cleanup();
    }
  }

  @Get()
  @ApiOkResponse({ type: ChatListItemResponse, isArray: true })
  @ApiUnauthorizedResponse()
  async getChats(
    @CurrentUser() userId: string,
  ): Promise<ChatListItemResponse[]> {
    const chats = await this.chatsService.listChatsWithLastMessage(userId);
    return chats.map(({ chat, lastMessage }) =>
      toChatListItemResponse(chat, lastMessage),
    );
  }

  // Declared BEFORE `@Get(':id')` so the static `/chats/search` path is matched
  // here and never captured by the `:id` param route (which would then reject
  // "search" via ParseUUIDPipe → 400). NestJS/Express match by declaration order.
  @Get('search')
  @ApiOkResponse({ type: ChatSearchResponse })
  @ApiBadRequestResponse({ description: 'Invalid search query' })
  @ApiUnauthorizedResponse()
  async searchChats(
    @CurrentUser() userId: string,
    @Query() query: ChatSearchQueryDto,
  ): Promise<ChatSearchResponse> {
    const results = await this.chatsService.searchChats(
      userId,
      query.q,
      query.limit,
    );
    return { results };
  }

  @Get(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ChatResponse })
  @ApiBadRequestResponse({ description: 'Malformed chat id (not a UUID)' })
  @ApiNotFoundResponse()
  @ApiUnauthorizedResponse()
  async getChatById(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ChatResponse> {
    const chat = await this.chatsService.getChatById(id, userId);
    if (!chat) {
      throw new NotFoundException(`Chat ${id} not found`);
    }

    return toChatResponse(chat);
  }

  // Messages + the chat's latest compaction (#57) embedded as `compaction`,
  // in one round trip (#136: this used to be a separate `GET :id/compaction`
  // call — folded in here so the client never has to stitch two responses
  // together, and there's no second, independently-failing fetch). The
  // embed is owner-scoped like everything else on this route — NOT exposed
  // via the shared-chat view (a cross-tenant/foreign id 404s exactly like
  // before; embedding a field doesn't change that).
  @Get(':id/messages')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ChatMessagesResponse })
  @ApiBadRequestResponse({
    description: 'Malformed chat id or invalid history pagination query',
  })
  @ApiNotFoundResponse({ description: 'Chat not found or not owned' })
  @ApiUnauthorizedResponse()
  async getChatMessages(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ChatMessagesQueryDto,
  ): Promise<ChatMessagesResponse> {
    const result = await this.chatsService.getChatMessages(id, userId, {
      limit: query.limit,
      beforeSeq: query.beforeSeq,
    });
    if (!result) {
      throw new NotFoundException(`Chat ${id} not found`);
    }

    return {
      messages: result.messages.map(toChatMessageResponse),
      compaction: result.compaction
        ? toCompactionResponse(result.compaction, result.absorbedMessageCount)
        : null,
    };
  }

  // Create-or-append (#86): posting the first message to a not-yet-existing chat id creates
  // the chat, then streams the reply — the single-call flow Claude.ai/ChatGPT use. This is a
  // deliberate deviation from the purist REST form (PUT /chats/:id then POST a message); the
  // "design the surface deliberately" rule in AGENTS.md sanctions it for the single-call win.
  // Tenancy is preserved: the client `:id` is routing + idempotency only; the owner is always
  // derived from the session (@CurrentUser), so id ≠ owner. Chats are created exclusively by
  // their first message — there is no separate empty-chat endpoint. Model selection is validated
  // first, so unavailable models create nothing.
  @Post(':id/messages')
  @HttpCode(200)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: CreateMessageDto })
  @ApiOkResponse({
    description: 'AI SDK v5 UI-message stream (SSE)',
    content: {
      'text/event-stream': {
        schema: { type: 'string' },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Malformed chat id or invalid message body',
  })
  @ApiUnauthorizedResponse()
  @ApiResponse({
    status: 503,
    description: 'Model catalog is not configured correctly',
    type: ModelDomainErrorResponse,
  })
  @ApiUnprocessableEntityResponse({
    description: 'Selected model is not available',
    type: ModelDomainErrorResponse,
  })
  @ApiNotFoundResponse({ description: 'Chat not found or not owned' })
  @ApiConflictResponse({
    description:
      'Message id already exists, or another run is already in flight for this chat',
  })
  async createMessage(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: CreateMessageDto,
    @Req() request: Request,
    @Res() response: ExpressResponse,
  ): Promise<void> {
    const abort = requestAbortSignal(response);

    try {
      const result = await this.chatLoopService.createMessageStream({
        chatId: id,
        userId,
        modelId: input.modelId,
        message: input.message,
        abortSignal: abort.signal,
      });

      const streamResponse = result.toUIMessageStreamResponse({
        onError: (error) => {
          this.logger.error(
            'Model stream failed',
            error instanceof Error ? error.stack : String(error),
          );
          return 'An error occurred.';
        },
      });

      await writeWebResponse(streamResponse, response, abort.signal);
    } catch (error) {
      if (error instanceof ModelNotAvailableError) {
        throw new HttpException(
          {
            statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
            error: 'Unprocessable Entity',
            message: error.message,
            code: error.code,
          },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      if (error instanceof ModelConfigurationError) {
        throw new HttpException(
          {
            statusCode: HttpStatus.SERVICE_UNAVAILABLE,
            error: 'Service Unavailable',
            message: error.message,
            code: error.code,
          },
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      throw error;
    } finally {
      abort.cleanup();
    }
  }

  // PATCH (partial update) of a chat resource — RESTful, not an RPC-style verb endpoint.
  @Patch(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ChatResponse })
  @ApiBadRequestResponse({ description: 'Malformed chat id (not a UUID)' })
  @ApiNotFoundResponse()
  @ApiUnauthorizedResponse()
  async updateChat(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateChatDto,
  ): Promise<ChatResponse> {
    const chat = await this.chatsService.updateChat(id, userId, input);
    if (!chat) {
      throw new NotFoundException(`Chat ${id} not found`);
    }

    return toChatResponse(chat);
  }

  // Hard delete. Owner-scoped (RLS + ownerUserId); the FK cascade removes the
  // chat's messages, compactions, runs → run_events in one statement.
  @Delete(':id')
  @HttpCode(204)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({ description: 'Malformed chat id (not a UUID)' })
  @ApiNotFoundResponse()
  @ApiUnauthorizedResponse()
  async deleteChat(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    const deleted = await this.chatsService.deleteChat(userId, id);
    if (!deleted) {
      throw new NotFoundException(`Chat ${id} not found`);
    }
  }

  // Fork: copy this chat up to `fromMessageId` (or the WHOLE conversation
  // when `fromMessageId` is omitted — the sidebar's "Fork"/clone action) into
  // a NEW chat the caller owns, so an alternate direction can be explored
  // without touching the original. A fork IS a new chat resource → POST to
  // the chat's `forks` SUB-COLLECTION (not an RPC `/fork` verb) — see
  // AGENTS.md "design the surface deliberately". Owner-scoped — a chat/message
  // not owned by the caller yields 404 and copies nothing (RLS + the
  // owner-scoped lookups in the service).
  @Post(':id/forks')
  @HttpCode(201)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: ForkChatDto })
  @ApiCreatedResponse({ type: ChatResponse })
  @ApiNotFoundResponse({
    description:
      'Chat not found, not owned, or the fork-point message (when given) is absent',
  })
  @ApiUnauthorizedResponse()
  async forkChat(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: ForkChatDto,
  ): Promise<ChatResponse> {
    const forked = await this.chatsService.forkChat(
      id,
      userId,
      input.fromMessageId,
    );
    return toChatResponse(forked);
  }
}

/**
 * Creates an abort signal tied to the request and response lifecycle.
 *
 * @returns The abort signal and a cleanup function that removes the registered listeners.
 */
function requestAbortSignal(response: ExpressResponse): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };
  const abortOnResponseClose = () => {
    if (!response.writableEnded) {
      abort();
    }
  };

  // `response` 'close' fires on client disconnect (before or during streaming) — this is
  // the reliable abort signal on Node 20+. (The old request 'aborted' event is deprecated
  // and does not fire reliably, so it is not used.) If the socket is already
  // gone by registration time, abort immediately — 'close' has already fired.
  // response.destroyed = the socket is really gone. (request.destroyed is NOT
  // usable here: a POST whose body stream has been fully consumed can read as
  // destroyed while the connection is perfectly alive.)
  if (response.destroyed) {
    abort();
  }
  response.on('close', abortOnResponseClose);

  return {
    signal: controller.signal,
    cleanup: () => {
      response.off('close', abortOnResponseClose);
    },
  };
}

/**
 * Writes a web response to an Express response.
 *
 * @param streamResponse - The response to send, including status, headers, and optional body
 * @param response - The Express response to write to
 * @param abortSignal - The abort signal used to suppress errors after cancellation
 */
async function writeWebResponse(
  streamResponse: Response,
  response: ExpressResponse,
  abortSignal: AbortSignal,
): Promise<void> {
  response.status(streamResponse.status || 200);
  streamResponse.headers.forEach((value, key) => {
    response.setHeader(key, value);
  });

  if (!streamResponse.body) {
    response.end();
    return;
  }

  try {
    await pipeline(Readable.fromWeb(streamResponse.body as never), response);
  } catch (error) {
    if (abortSignal.aborted) {
      return;
    }
    // A mid-stream failure after the status+headers were flushed cannot be turned into
    // an HTTP error response — re-throwing would trigger ERR_HTTP_HEADERS_SENT. Log and
    // destroy the connection instead. (Pre-headers failures still throw → exception filter.)
    if (response.headersSent) {
      streamLogger.error(
        'Stream pipeline failed after headers were sent',
        error instanceof Error ? error.stack : String(error),
      );
      response.destroy(
        error instanceof Error ? error : new Error(String(error)),
      );
      return;
    }
    throw error;
  }
}
