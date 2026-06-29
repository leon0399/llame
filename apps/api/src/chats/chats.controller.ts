import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
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
  UpdateChatTitleDto,
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
  @ApiOkResponse({ type: ChatResponse })
  @ApiNotFoundResponse()
  @ApiUnauthorizedResponse()
  async getChatById(
    @CurrentUser() userId: string,
    @Param('id') id: string,
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

  @Put(':id/title')
  @ApiOkResponse({ type: ChatResponse })
  @ApiNotFoundResponse()
  @ApiUnauthorizedResponse()
  async updateChatTitle(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() input: UpdateChatTitleDto,
  ): Promise<ChatResponse> {
    const chat = await this.chatsService.updateChatTitle(
      id,
      userId,
      input.title,
    );
    if (!chat) {
      throw new NotFoundException(`Chat ${id} not found`);
    }

    return toChatResponse(chat);
  }
}
