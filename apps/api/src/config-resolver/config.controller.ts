import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/auth-context';
import { ChatsRepository } from '../chats/chats-repository';
import { TenantDbService } from '../db/tenant-db.service';
import { ConfigResolverService } from './config-resolver.service';
import {
  EffectiveConfigResponse,
  toEffectiveConfigResponse,
} from './dto/effective-config.dto';

/**
 * The “explain effective config” surface (#46, SPEC §6.4): what configuration
 * would a run created in this chat execute under, and which scope set each
 * value. Mounted under chats — the chat is the resolution context in v0.3.
 */
@ApiTags('config')
@ApiBearerAuth('bearer')
@ApiCookieAuth('cookie')
@Controller('api/v1/chats')
export class ConfigController {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly resolver: ConfigResolverService,
  ) {}

  @Get(':id/effective-config')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: EffectiveConfigResponse })
  @ApiNotFoundResponse({
    description: 'Unknown or cross-tenant chat (no existence leak)',
  })
  @ApiUnauthorizedResponse()
  async getEffectiveConfig(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EffectiveConfigResponse> {
    const snapshot = await this.tenantDb.runAs(userId, async (tx) => {
      const chat = await new ChatsRepository(tx).findById(id, userId);
      if (!chat) {
        return null;
      }
      return this.resolver.resolveForChatWithin(tx, { userId, chatId: id });
    });
    if (!snapshot) {
      throw new NotFoundException(`Chat ${id} not found`);
    }
    return toEffectiveConfigResponse(snapshot);
  }
}
