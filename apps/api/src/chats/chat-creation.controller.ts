import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/auth-context';
import { ModelDomainErrorResponse } from '../models/dto/models.dto';
import { ChatCreationService } from './chat-creation.service';
import {
  ChatCreationRecordResponse,
  CreateChatRequest,
  CreateChatResponse,
} from './dto/chat-creation.dto';
import {
  CreateFileMessagePartDto,
  CreateTextMessagePartDto,
} from './dto/message-parts.dto';
import { throwModelDomainError } from './model-domain-error';

/** The create request and its record, as the controller uses them. */
export type ChatCreationControllerService = Pick<
  ChatCreationService,
  'create' | 'getCreationRecord'
>;

/**
 * `POST /api/v1/chats` and the record it keeps (openspec `chat-start-location`).
 * Its own controller because it has its own service; the paths share the chats
 * prefix and cannot collide with `GET /chats/:id`.
 */
@ApiTags('chats')
@ApiBearerAuth('bearer')
@ApiCookieAuth('cookie')
@Controller('api/v1/chats')
export class ChatCreationController {
  constructor(
    @Inject(ChatCreationService)
    private readonly chatCreation: ChatCreationControllerService,
  ) {}

  // One create request files the chat, resolves its Workspace location,
  // authorizes the entry, creates an optional worktree, and starts the optional
  // first Run — in that order (openspec `chat-start-location`, design D9). It is
  // JSON, never a stream: the client resumes the Run from GET /chats/:id/stream.
  @Post()
  @ApiOperation({ operationId: 'createChat' })
  @ApiBody({ type: CreateChatRequest })
  @ApiExtraModels(CreateTextMessagePartDto, CreateFileMessagePartDto)
  @ApiCreatedResponse({ type: CreateChatResponse })
  @ApiBadRequestResponse({ description: 'Malformed request or body field' })
  @ApiNotFoundResponse({
    description: "A named project, repository, or checkout is not the caller's",
  })
  @ApiConflictResponse({
    description: 'The Chat holds a message, a Run, or another project',
  })
  @ApiUnprocessableEntityResponse({
    description: 'Unavailable model, mode, executor, or worktree argument',
    type: ModelDomainErrorResponse,
  })
  @ApiUnauthorizedResponse()
  async createChat(
    @CurrentUser() userId: string,
    @Body() input: CreateChatRequest,
  ): Promise<CreateChatResponse> {
    try {
      return await this.chatCreation.create(userId, input);
    } catch (error) {
      throwModelDomainError(error);
    }
  }

  // The owner-only record of every create and resend on this Chat: each
  // attempt's path decisions with their policy provenance. Another owner gets
  // 404 and learns no decision.
  @Get(':id/creation-record')
  @ApiOperation({ operationId: 'getChatCreationRecord' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ChatCreationRecordResponse })
  @ApiBadRequestResponse({ description: 'Malformed chat id (not a UUID)' })
  @ApiNotFoundResponse({ description: 'Chat not found or not owned' })
  @ApiUnauthorizedResponse()
  async getChatCreationRecord(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ChatCreationRecordResponse> {
    return this.chatCreation.getCreationRecord(userId, id);
  }
}
