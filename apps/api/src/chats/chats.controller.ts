import {
  Body,
  Controller,
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
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { MissingModelCredentialError } from '../models/model-client';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Request, Response as ExpressResponse } from 'express';
import { CurrentUser } from '../auth/auth-context';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { ChatLoopService } from './chat-loop.service';
import { ChatsService } from './chats.service';
import {
  ChatResponse,
  CreateMessageDto,
  CreateChatDto,
  toChatResponse,
  UpdateChatDto,
} from './dto/chats.dto';

@ApiTags('chats')
@ApiBearerAuth('bearer')
@ApiCookieAuth('cookie')
@UseGuards(SessionAuthGuard)
@Controller('api/v1/chats')
export class ChatsController {
  private readonly logger = new Logger(ChatsController.name);

  constructor(
    private readonly chatsService: ChatsService,
    private readonly chatLoopService: ChatLoopService,
  ) {}

  @Get()
  @ApiOkResponse({ type: ChatResponse, isArray: true })
  @ApiUnauthorizedResponse()
  async getChats(@CurrentUser() userId: string): Promise<ChatResponse[]> {
    const chats = await this.chatsService.getChatsByUserId(userId);
    return chats.map(toChatResponse);
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

  @Post()
  @ApiCreatedResponse({ type: ChatResponse })
  @ApiUnauthorizedResponse()
  async createChat(
    @CurrentUser() userId: string,
    @Body() input: CreateChatDto,
  ): Promise<ChatResponse> {
    const chat = await this.chatsService.createChat({
      ownerUserId: userId,
      title: input.title,
    });

    return toChatResponse(chat);
  }

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
    status: 402,
    description: 'No model credential configured for the user',
  })
  @ApiNotFoundResponse({ description: 'Chat not found or not owned' })
  @ApiConflictResponse({ description: 'Message turn already completed' })
  async createMessage(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: CreateMessageDto,
    @Req() request: Request,
    @Res() response: ExpressResponse,
  ): Promise<void> {
    const abort = requestAbortSignal(request, response);

    try {
      const result = await this.chatLoopService.createMessageStream({
        chatId: id,
        userId,
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
      // Map the domain credential error to HTTP here (the service stays HTTP-agnostic).
      if (error instanceof MissingModelCredentialError) {
        throw new HttpException(
          {
            statusCode: HttpStatus.PAYMENT_REQUIRED,
            error: 'Payment Required',
            message: 'No model credential configured.',
          },
          HttpStatus.PAYMENT_REQUIRED,
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
}

/**
 * Creates an abort signal tied to the request and response lifecycle.
 *
 * @returns The abort signal and a cleanup function that removes the registered listeners.
 */
function requestAbortSignal(
  request: Request,
  response: ExpressResponse,
): { signal: AbortSignal; cleanup: () => void } {
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
  // and does not fire reliably, so it is not used.)
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
    if (!abortSignal.aborted) {
      throw error;
    }
  }
}
