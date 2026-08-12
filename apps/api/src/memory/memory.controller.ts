import { Body, Controller, Get, Inject, Patch } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/auth-context';
import {
  MemoryResponse,
  toMemoryResponse,
  UpdateMemoryDto,
} from './dto/memory.dto';
import { type MemorySettingsUpdate } from './memory-repository';
import { MemoryService } from './memory.service';

type MemorySettingsApi = Pick<MemoryService, 'getForOwner' | 'updateForOwner'>;

// HTTP endpoints are safe to expose only because SessionAuthGuard derives the
// tenant identity from a verified session. The owner is ALWAYS
// `@CurrentUser()` — no route parameter, query, or body field can select a
// different user's settings.
@ApiTags('memory')
@ApiBearerAuth('bearer')
@ApiCookieAuth('cookie')
@Controller('api/v1/me/memory')
export class MemoryController {
  constructor(
    @Inject(MemoryService) private readonly memory: MemorySettingsApi,
  ) {}

  @Get()
  @ApiOkResponse({ type: MemoryResponse })
  @ApiUnauthorizedResponse()
  async getMemory(@CurrentUser() userId: string): Promise<MemoryResponse> {
    return toMemoryResponse(await this.memory.getForOwner(userId));
  }

  @Patch()
  @ApiOkResponse({ type: MemoryResponse })
  @ApiUnauthorizedResponse()
  async updateMemory(
    @CurrentUser() userId: string,
    @Body() input: UpdateMemoryDto,
  ): Promise<MemoryResponse> {
    // Conditional spread per field, not a spread of `input`: an unset DTO field
    // is an own `undefined` property because class fields are defined, so a
    // spread would overwrite absent keys instead of preserving PATCH semantics.
    const update: MemorySettingsUpdate = {
      // oxlint-disable-next-line unicorn/no-useless-spread -- keep the precedent's per-field PATCH guard; future fields compose here without ever spreading a DTO.
      ...(input.shareRecentChats !== undefined
        ? { shareRecentChats: input.shareRecentChats }
        : {}),
    };

    return toMemoryResponse(await this.memory.updateForOwner(userId, update));
  }
}
