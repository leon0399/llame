import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
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
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { ChatsService } from './chats.service';
import {
  ChatResponse,
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
  constructor(private readonly chatsService: ChatsService) {}

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
