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
    @Inject(MemoryService)
    private readonly memory: MemorySettingsApi,
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
    // Built field by field, never by spreading `input`: an unset DTO field is
    // an own `undefined` property because class fields are defined, so
    // spreading the DTO would write undefined over every absent key and clear
    // settings the caller never mentioned.
    //
    // `personalization` expresses this as an array of conditional spreads
    // because it composes five such guards. One field needs only a
    // conditional, and reaching for the spread form here would mean
    // suppressing `unicorn/no-useless-spread` — the linter is right that a
    // lone spread into an object literal wraps nothing. A second setting turns
    // this back into the precedent's composition.
    const update: MemorySettingsUpdate =
      input.shareRecentChats === undefined
        ? {}
        : { shareRecentChats: input.shareRecentChats };

    return toMemoryResponse(await this.memory.updateForOwner(userId, update));
  }
}
