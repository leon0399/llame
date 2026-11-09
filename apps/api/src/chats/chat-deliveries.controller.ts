import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCookieAuth,
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
import { ChatDeliveriesService } from './chat-deliveries.service';
import { throwModelDomainError } from './model-domain-error';
import {
  ChangeChatDeliveryDto,
  ChatDeliveriesResponse,
  ChatDeliveryResponse,
  toChatDeliveryResponse,
} from './dto/chat-deliveries.dto';

@ApiTags('chats')
@ApiBearerAuth('bearer')
@ApiCookieAuth('cookie')
@Controller('api/v1/chats/:chatId/deliveries')
export class ChatDeliveriesController {
  constructor(
    @Inject(ChatDeliveriesService)
    private readonly deliveries: Pick<
      ChatDeliveriesService,
      'listPending' | 'withdraw' | 'changeMode'
    >,
  ) {}

  @Get()
  @ApiOperation({ operationId: 'listChatDeliveries' })
  @ApiParam({ name: 'chatId', format: 'uuid' })
  @ApiOkResponse({
    type: ChatDeliveriesResponse,
    description: 'The pending items of the Chat, first to deliver first.',
  })
  @ApiBadRequestResponse({ description: 'Malformed chat id (not a UUID)' })
  @ApiNotFoundResponse({ description: 'Chat not found or not owned' })
  @ApiUnauthorizedResponse()
  async listChatDeliveries(
    @CurrentUser() userId: string,
    @Param('chatId', ParseUUIDPipe) chatId: string,
  ): Promise<ChatDeliveriesResponse> {
    const items = await this.deliveries.listPending(chatId, userId);
    return { items: items.map(toChatDeliveryResponse) };
  }

  @Delete(':deliveryId')
  @ApiOperation({ operationId: 'withdrawChatDelivery' })
  @ApiParam({ name: 'chatId', format: 'uuid' })
  @ApiParam({ name: 'deliveryId', format: 'uuid' })
  @ApiOkResponse({
    type: ChatDeliveryResponse,
    description: 'The withdrawn item, with the parts the owner can edit.',
  })
  @ApiBadRequestResponse({ description: 'Malformed chat or item id' })
  @ApiNotFoundResponse({
    description: 'Chat or item not found, or not owned',
  })
  @ApiConflictResponse({
    description: 'The item is no longer pending (delivered or withdrawn)',
  })
  @ApiUnauthorizedResponse()
  async withdrawChatDelivery(
    @CurrentUser() userId: string,
    @Param('chatId', ParseUUIDPipe) chatId: string,
    @Param('deliveryId', ParseUUIDPipe) deliveryId: string,
  ): Promise<ChatDeliveryResponse> {
    return toChatDeliveryResponse(
      await this.deliveries.withdraw(chatId, deliveryId, userId),
    );
  }

  @Patch(':deliveryId')
  @ApiOperation({ operationId: 'changeChatDelivery' })
  @ApiParam({ name: 'chatId', format: 'uuid' })
  @ApiParam({ name: 'deliveryId', format: 'uuid' })
  @ApiOkResponse({
    type: ChatDeliveryResponse,
    description:
      'The item after the change. With no live Run it is `delivered` and ' +
      'its Run has started.',
  })
  @ApiBadRequestResponse({
    description: 'Malformed id, or a mode that a change cannot set',
  })
  @ApiNotFoundResponse({
    description: 'Chat or item not found, or not owned',
  })
  @ApiConflictResponse({
    description: 'The item is no longer pending, or the Chat is archived',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'A paused item whose model or effort a send cannot use now; the item ' +
      'stays pending',
    type: ModelDomainErrorResponse,
  })
  @ApiUnauthorizedResponse()
  async changeChatDelivery(
    @CurrentUser() userId: string,
    @Param('chatId', ParseUUIDPipe) chatId: string,
    @Param('deliveryId', ParseUUIDPipe) deliveryId: string,
    @Body() input: ChangeChatDeliveryDto,
  ): Promise<ChatDeliveryResponse> {
    try {
      return toChatDeliveryResponse(
        await this.deliveries.changeMode(
          chatId,
          deliveryId,
          input.mode,
          userId,
        ),
      );
    } catch (error) {
      throwModelDomainError(error);
    }
  }
}
