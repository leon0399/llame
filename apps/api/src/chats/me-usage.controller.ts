import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/auth-context';
import { TenantDbService } from '../db/tenant-db.service';
import { UsageRepository } from './usage-repository';
import { UsageQueryDto, UsageSummaryResponse } from './dto/usage.dto';

/**
 * Read-only BYOK spend view — aggregates the caller's own persisted per-turn
 * usage (owner-scoped). Cost is an ESTIMATE from a built-in price table (no
 * provider invoice under BYOK).
 */
@ApiTags('me')
@ApiBearerAuth('bearer')
@ApiCookieAuth('cookie')
@Controller('api/v1/me/usage')
export class MeUsageController {
  constructor(private readonly tenantDb: TenantDbService) {}

  @Get()
  @ApiOkResponse({ type: UsageSummaryResponse })
  @ApiUnauthorizedResponse()
  async summary(
    @CurrentUser() userId: string,
    @Query() query: UsageQueryDto,
  ): Promise<UsageSummaryResponse> {
    return this.tenantDb.runAs(userId, (tx) =>
      new UsageRepository(tx).summary(userId, query.days),
    );
  }
}
