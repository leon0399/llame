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
import { RunsRepository } from '../runs/runs-repository';
import {
  ActiveRunResponse,
  ActiveRunsQueryDto,
  toActiveRunResponse,
} from './dto/active-runs.dto';

/**
 * The caller's in-flight runs — used by the client to RE-HYDRATE run-completion
 * notifications after a page reload (the in-memory tracker is wiped on reload),
 * so "send a message, walk away, get told when it's done" survives a refresh.
 * Owner-scoped (RLS `runs_owner` on user_id + explicit filter).
 */
@ApiTags('me')
@ApiBearerAuth('bearer')
@ApiCookieAuth('cookie')
@Controller('api/v1/me/runs')
export class MeRunsController {
  constructor(private readonly tenantDb: TenantDbService) {}

  @Get()
  @ApiOkResponse({ type: ActiveRunResponse, isArray: true })
  @ApiUnauthorizedResponse()
  async active(
    @CurrentUser() userId: string,
    @Query() query: ActiveRunsQueryDto,
  ): Promise<ActiveRunResponse[]> {
    void query.status; // validated to 'active'; the only supported filter today
    const rows = await this.tenantDb.runAs(userId, (tx) =>
      new RunsRepository(tx).findActiveByUser(userId),
    );
    return rows.map(toActiveRunResponse);
  }
}
