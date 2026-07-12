import {
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
  ApiCookieAuth,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/auth-context';
import { type PinItemType } from '../db/schema';
import { PinsService } from './pins.service';
import {
  PIN_ITEM_TYPES,
  PinnedItemResponse,
  toPinnedItemResponse,
} from './dto/pins.dto';

// The unified pin resource: one surface for every pinnable type, keyed by
// (itemType, itemId) in the path. Pins are per-user; identity comes only from
// the authenticated session (SessionAuthGuard), never from client input.
@ApiTags('pins')
@ApiBearerAuth('bearer')
@ApiCookieAuth('cookie')
@Controller('api/v1/pins')
export class PinsController {
  constructor(private readonly pinsService: PinsService) {}

  @Get()
  @ApiOkResponse({ type: PinnedItemResponse, isArray: true })
  @ApiUnauthorizedResponse()
  async listPins(@CurrentUser() userId: string): Promise<PinnedItemResponse[]> {
    const rows = await this.pinsService.listPins(userId);
    return rows.map(toPinnedItemResponse);
  }

  // Idempotent pin. 200 (not 201): the operation may create nothing (re-pin).
  @Put(':itemType/:itemId')
  @ApiParam({ name: 'itemType', enum: Object.values(PIN_ITEM_TYPES) })
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @ApiOkResponse({ type: PinnedItemResponse })
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
