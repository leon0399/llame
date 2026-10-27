import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Logger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiCookieAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  getSchemaPath,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/auth-context';
import { TenantDbService, type TenantRunner } from '../db/tenant-db.service';
import { ChatLoopService, type ChatMessageStream } from './chat-loop.service';
import { FollowUpAdmissionService } from './follow-up-admission.service';
import { ChatsService } from './chats.service';
import {
  RunStreamBridgeService,
  type RunStreamResponder,
} from '../runs/run-stream-bridge';
import { RunsRepository } from '../runs/runs-repository';
import { ModelDomainErrorResponse } from '../models/dto/models.dto';
import { throwModelDomainError } from './model-domain-error';
import {
  ChatListItemResponse,
  OwnerChatMessagesQueryDto,
  ChatMessagesResponse,
  ChatResponse,
  ChatSearchQueryDto,
  ChatSearchResponse,
  ContinueFollowUpRunDto,
  type CreateFollowUpRunDto,
  CreateMessageDto,
  ForkChatDto,
  ListChatsQueryDto,
  toChatListItemResponse,
  toChatMessageResponse,
  toChatResponse,
  UpdateChatDto,
} from './dto/chats.dto';
import { toChatLatestRunResponse } from './dto/latest-run.dto';
import {
  requestAbortSignal,
  writeWebResponse,
  type ChatStreamResponse,
} from './chat-stream-response';
import {
  CreateFileMessagePartDto,
  CreateTextMessagePartDto,
} from './dto/message-parts.dto';

/**
 * The follow-up request body as a discriminated union on `action`: each variant
 * declares only the fields its action accepts, so a schema-valid `continue`
 * never carries a model or an effort. A second action adds its variant to the
 * same `oneOf` and its own `mapping` entry.
 */
function followUpRunBodySchema() {
  return {
    oneOf: [{ $ref: getSchemaPath(ContinueFollowUpRunDto) }],
    discriminator: {
      propertyName: 'action',
      mapping: { continue: getSchemaPath(ContinueFollowUpRunDto) },
    },
  };
}

export type ChatsControllerService = Pick<
  ChatsService,
  | 'listChatsWithLastMessage'
  | 'searchChats'
  | 'getChatById'
  | 'getChatMessages'
  | 'updateChat'
  | 'deleteChat'
  | 'forkChat'
>;

@ApiTags('chats')
@ApiBearerAuth('bearer')
@ApiCookieAuth('cookie')
@Controller('api/v1/chats')
export class ChatsController {
  private readonly logger = new Logger(ChatsController.name);

  constructor(
    @Inject(ChatsService)
    private readonly chatsService: ChatsControllerService,
    @Inject(ChatLoopService)
    private readonly chatLoopService: Pick<
      ChatLoopService,
      'createMessageStream' | 'finalizeAcceptedRun'
    >,
    @Inject(TenantDbService)
    private readonly tenantDb: TenantRunner,
    @Inject(RunStreamBridgeService)
    private readonly bridge: RunStreamResponder,
    @Inject(FollowUpAdmissionService)
    private readonly followUpAdmission: Pick<
      FollowUpAdmissionService,
      'admitFollowUpRun'
    >,
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
  @ApiOperation({ operationId: 'resumeChatStream' })
  @ApiTags('streaming')
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
    @Res() response: ChatStreamResponse,
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
  @ApiOperation({ operationId: 'listChats' })
  @ApiOkResponse({ type: ChatListItemResponse, isArray: true })
  @ApiBadRequestResponse({ description: 'Malformed projectId (not a UUID)' })
  @ApiUnauthorizedResponse()
  async getChats(
    @CurrentUser() userId: string,
    @Query() query: ListChatsQueryDto,
  ): Promise<Array<ChatListItemResponse>> {
    const chats = await this.chatsService.listChatsWithLastMessage(userId, {
      projectId: query.projectId,
      archived: query.archived,
      pinned: query.pinned,
    });
    return chats.map(({ chat, lastMessage }) =>
      toChatListItemResponse(chat, lastMessage),
    );
  }

  // Declared BEFORE `@Get(':id')` so the static `/chats/search` path is matched
  // here and never captured by the `:id` param route (which would then reject
  // "search" via ParseUUIDPipe → 400). NestJS/Express match by declaration order.
  @Get('search')
  @ApiOperation({ operationId: 'searchChats' })
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
  @ApiOperation({ operationId: 'getChat' })
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

  // Owner history: checkpoint rows are included (with their boundary, summary
  // and absorbed-message count); public projections use a separate DTO.
  @Get(':id/messages')
  @ApiOperation({ operationId: 'getChatMessages' })
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
    @Query() query: OwnerChatMessagesQueryDto,
  ): Promise<ChatMessagesResponse> {
    const view = await this.chatsService.getChatMessages(id, userId, {
      limit: query.limit,
      beforeSeq: query.beforeSeq,
      targetSeq: query.targetSeq,
    });
    if (!view) {
      throw new NotFoundException(`Chat ${id} not found`);
    }

    return {
      messages: view.messages.map(toChatMessageResponse),
      latestRun: view.latestRun
        ? toChatLatestRunResponse(view.latestRun)
        : null,
    };
  }

  // Create-or-append (#86): posting the first message to a not-yet-existing chat
  // id creates the chat, then streams the reply. The client `:id` is routing and
  // idempotency only; the owner always comes from the session (@CurrentUser).
  // `POST /chats` creates a chat with its project and location instead. Model
  // selection is validated first, so unavailable models create nothing.
  @Post(':id/messages')
  @ApiOperation({ operationId: 'createChatMessage' })
  @ApiTags('streaming')
  @HttpCode(200)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: CreateMessageDto })
  @ApiExtraModels(CreateTextMessagePartDto, CreateFileMessagePartDto)
  @ApiOkResponse({
    description: 'AI SDK v5 UI-message stream (SSE)',
    content: {
      'text/event-stream': {
        schema: { type: 'string' },
      },
    },
  })
  @ApiBadRequestResponse({
    description:
      'Malformed chat id or invalid message body, including a file part ' +
      'naming media the sender does not own',
  })
  @ApiUnauthorizedResponse()
  @ApiResponse({
    status: 503,
    description: 'Model catalog is not configured correctly',
    type: ModelDomainErrorResponse,
  })
  @ApiUnprocessableEntityResponse({
    description:
      'Selected model is not available, or the requested effort is not one of ' +
      "that model's declared levels",
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
    @Res() response: ChatStreamResponse,
  ): Promise<void> {
    const abort = requestAbortSignal(response);

    try {
      const result = await this.chatLoopService.createMessageStream({
        chatId: id,
        userId,
        modelId: input.modelId,
        ...(input.effort !== undefined && { effort: input.effort }),
        ...(input.permissionMode !== undefined && {
          permissionMode: input.permissionMode,
        }),
        message: input.message,
        abortSignal: abort.signal,
      });

      await this.answerWithRunStream(response, abort.signal, result);
    } catch (error) {
      throwModelDomainError(error);
    } finally {
      abort.cleanup();
    }
  }

  // A follow-up Run acts on a turn that already has a Run (turn-actions D1):
  // Continue resumes the completed steps of a failed, cancelled, or expired
  // Run, and the answer is the same UI-message stream a chat send returns, so
  // the client renders the kept parts and the new parts in one assistant
  // message.
  @Post(':id/messages/:userMessageId/runs')
  @ApiOperation({ operationId: 'createChatFollowUpRun' })
  @ApiTags('streaming')
  @HttpCode(200)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'userMessageId', format: 'uuid' })
  @ApiExtraModels(ContinueFollowUpRunDto)
  @ApiBody({ schema: followUpRunBodySchema() })
  @ApiOkResponse({
    description: 'AI SDK v5 UI-message stream (SSE)',
    content: {
      'text/event-stream': {
        schema: { type: 'string' },
      },
    },
  })
  @ApiBadRequestResponse({
    description:
      'Malformed chat or message id, a missing body or action, an unknown ' +
      'action, or a model or an effort on a continue request',
  })
  @ApiUnauthorizedResponse()
  @ApiNotFoundResponse({
    description: 'Chat or message not found or not owned',
  })
  @ApiConflictResponse({
    description:
      'The message is not the latest turn, another run is already in flight ' +
      'for this chat, or the latest Run and its reply cannot be continued',
  })
  @ApiResponse({
    status: 503,
    description: 'Model catalog is not configured correctly',
    type: ModelDomainErrorResponse,
  })
  @ApiUnprocessableEntityResponse({
    description:
      'The Run model is no longer available, or the requested permission mode ' +
      'is disabled',
    type: ModelDomainErrorResponse,
  })
  async createFollowUpRun(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) chatId: string,
    @Param('userMessageId', ParseUUIDPipe) userMessageId: string,
    // A request with no body reaches the handler as `undefined`: the body is
    // required, so it is answered as the empty request it is, and the action
    // check refuses it as a 400.
    @Body() input: CreateFollowUpRunDto | undefined,
    @Res() response: ChatStreamResponse,
  ): Promise<void> {
    const abort = requestAbortSignal(response);
    try {
      const accepted = await this.followUpAdmission.admitFollowUpRun({
        chatId,
        userId,
        userMessageId,
        request: input ?? {},
      });
      const result = await this.chatLoopService.finalizeAcceptedRun({
        ...accepted,
        abortSignal: abort.signal,
      });
      await this.answerWithRunStream(response, abort.signal, result);
    } catch (error) {
      throwModelDomainError(error);
    } finally {
      abort.cleanup();
    }
  }

  /**
   * Write one accepted Run's UI-message stream, logging a model failure the
   * client cannot read. Shared by a chat send and a follow-up request so both
   * answer the same protocol.
   */
  private async answerWithRunStream(
    response: ChatStreamResponse,
    abortSignal: AbortSignal,
    result: ChatMessageStream,
  ): Promise<void> {
    const streamResponse = result.toUIMessageStreamResponse({
      onError: (error: unknown) => {
        this.logger.error(
          'Model stream failed',
          error instanceof Error ? error.stack : String(error),
        );
        return 'An error occurred.';
      },
    });
    await writeWebResponse(streamResponse, response, abortSignal);
  }

  @Patch(':id')
  @ApiOperation({ operationId: 'updateChat' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ChatResponse })
  @ApiBadRequestResponse({ description: 'Malformed chat id (not a UUID)' })
  @ApiNotFoundResponse({
    description:
      'Chat not found/not owned, or (when filing) projectId not found/not owned',
  })
  @ApiConflictResponse({
    description:
      'The chat is archived and the update does more than archive or unarchive it.',
  })
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
  // chat's messages, runs → run_events in one statement.
  @Delete(':id')
  @ApiOperation({ operationId: 'deleteChat' })
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
  @ApiOperation({ operationId: 'forkChat' })
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
