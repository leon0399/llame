import { Body, Controller, Get, Put } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/auth-context';
import { TenantDbService } from '../db/tenant-db.service';
import { ConfigsRepository } from './configs-repository';
import {
  InstructionsResponse,
  UpdateInstructionsDto,
} from './dto/instructions.dto';

/**
 * The caller's own settings that resolve through the config layer (#46). Today:
 * custom instructions (a user-scope config value merged into the chat system
 * prompt as a non-authoritative block). Deliberately a NARROW surface — it
 * writes only the `instructions` key, never arbitrary config, so a user can't
 * self-grant budget/tools through it (see `ConfigsRepository.setInstructions`).
 */
@ApiTags('me')
@ApiBearerAuth('bearer')
@ApiCookieAuth('cookie')
@Controller('api/v1/me')
export class MeController {
  constructor(private readonly tenantDb: TenantDbService) {}

  @Get('instructions')
  @ApiOkResponse({ type: InstructionsResponse })
  @ApiUnauthorizedResponse()
  async getInstructions(
    @CurrentUser() userId: string,
  ): Promise<InstructionsResponse> {
    const instructions = await this.tenantDb.runAs(userId, async (tx) => {
      const rows = await new ConfigsRepository(tx).findByScopes([
        { scopeType: 'user', scopeId: userId },
      ]);
      const config = rows[0]?.config;
      const value =
        config && typeof config === 'object'
          ? (config as Record<string, unknown>)['instructions']
          : undefined;
      return typeof value === 'string' ? value : '';
    });
    return { instructions };
  }

  @Put('instructions')
  @ApiOkResponse({ type: InstructionsResponse })
  @ApiUnauthorizedResponse()
  async setInstructions(
    @CurrentUser() userId: string,
    @Body() dto: UpdateInstructionsDto,
  ): Promise<InstructionsResponse> {
    const instructions = dto.instructions.trim();
    await this.tenantDb.runAs(userId, (tx) =>
      new ConfigsRepository(tx).setInstructions({
        scopeType: 'user',
        scopeId: userId,
        instructions,
      }),
    );
    return { instructions };
  }
}
