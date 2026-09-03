import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiCookieAuth,
  ApiExtraModels,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/auth-context';
import { type PinItemType } from '../db/schema';
import { PinsService } from './pins.service';
import {
  ChatPinnedItemResponse,
  PIN_ITEM_TYPES,
  PINNED_ITEM_RESPONSE_SCHEMA,
  PinnedItemResponse,
  ProjectPinnedItemResponse,
  ReorderPinsDto,
  toPinnedItemResponse,
} from './dto/pins.dto';

// The unified pin resource: one surface for every pinnable type, keyed by
// (itemType, itemId) in the path. Pins are per-user; identity comes only from
// the authenticated session (SessionAuthGuard), never from client input.
@ApiTags('pins')
@ApiBearerAuth('bearer')
@ApiCookieAuth('cookie')
@ApiExtraModels(ChatPinnedItemResponse, ProjectPinnedItemResponse)
@Controller('api/v1/pins')
export class PinsController {
  constructor(private readonly pinsService: PinsService) {}

  @Get()
  @ApiOperation({ operationId: 'listPins' })
  @ApiOkResponse({
    schema: { type: 'array', items: PINNED_ITEM_RESPONSE_SCHEMA },
  })
  @ApiUnauthorizedResponse()
  async listPins(
    @CurrentUser() userId: string,
  ): Promise<Array<PinnedItemResponse>> {
    const rows = await this.pinsService.listPins(userId);
    return rows.map(toPinnedItemResponse);
  }

  // Full-list reorder. Declared before `:itemType/:itemId` so `order` is not
  // parsed as an itemType.
  @Put('order')
  @ApiOperation({ operationId: 'reorderPins' })
  @ApiBody({ type: ReorderPinsDto })
  @ApiOkResponse({
    schema: { type: 'array', items: PINNED_ITEM_RESPONSE_SCHEMA },
  })
  @ApiBadRequestResponse({
    description:
      "Body is not exactly the caller's current pin set, or fails validation",
  })
  @ApiUnauthorizedResponse()
  async reorderPins(
    @CurrentUser() userId: string,
    @Body() body: ReorderPinsDto,
  ): Promise<Array<PinnedItemResponse>> {
    const rows = await this.pinsService.reorderPins(userId, body.items);
    return rows.map(toPinnedItemResponse);
  }

  // Idempotent pin. 200 (not 201): the operation may create nothing (re-pin).
  @Put(':itemType/:itemId')
  @ApiOperation({ operationId: 'pinItem' })
  @ApiParam({ name: 'itemType', enum: Object.values(PIN_ITEM_TYPES) })
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @ApiOkResponse({ schema: PINNED_ITEM_RESPONSE_SCHEMA })
  @ApiBadRequestResponse({
    description: 'Unknown itemType or malformed itemId (not a UUID)',
  })
  @ApiNotFoundResponse({
    description: 'The item does not exist or is not accessible',
  })
  @ApiUnauthorizedResponse()
  async pin(
    @CurrentUser() userId: string,
    @Param('itemType', new ParseEnumPipe(PIN_ITEM_TYPES))
    itemType: PinItemType,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ): Promise<PinnedItemResponse> {
    const row = await this.pinsService.pin(userId, itemType, itemId);
    return toPinnedItemResponse(row);
  }

  // Idempotent unpin.
  @Delete(':itemType/:itemId')
  @ApiOperation({ operationId: 'unpinItem' })
  @HttpCode(204)
  @ApiParam({ name: 'itemType', enum: Object.values(PIN_ITEM_TYPES) })
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({
    description: 'Unknown itemType or malformed itemId (not a UUID)',
  })
  @ApiUnauthorizedResponse()
  async unpin(
    @CurrentUser() userId: string,
    @Param('itemType', new ParseEnumPipe(PIN_ITEM_TYPES))
    itemType: PinItemType,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ): Promise<void> {
    await this.pinsService.unpin(userId, itemType, itemId);
  }
}
