/**
 * The Machines list (remote-machines spec "Authenticated users can see
 * Machines and their Workspace's Machine status"). Read-only, operator-wide,
 * and authenticated by the global session guard: no identity means the select
 * policy refuses and this endpoint has nothing to serve.
 *
 * Only present when the operator configured Machines at all — an instance
 * without the section answers 404, so no Machine surface exists for it.
 */

import { Controller, Get, NotFoundException } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/auth-context';

import { MachineResponse, toMachineResponse } from './dto/machines.dto';
import { MachineConnector } from './machine-connector.service';
import { MachinesService } from './machines.service';

@ApiTags('machines')
@ApiBearerAuth('bearer')
@ApiCookieAuth('cookie')
@Controller('api/v1/machines')
export class MachinesController {
  constructor(
    private readonly connector: MachineConnector,
    private readonly machines: MachinesService,
  ) {}

  @Get()
  @ApiOperation({
    operationId: 'listMachines',
    summary: 'List the configured Machines and their status',
  })
  @ApiOkResponse({ type: MachineResponse, isArray: true })
  @ApiUnauthorizedResponse()
  @ApiNotFoundResponse({ description: 'Machines are not configured.' })
  async list(@CurrentUser() userId: string): Promise<Array<MachineResponse>> {
    if (!this.connector.enabled()) throw new NotFoundException();
    const views = await this.machines.list(userId);
    return views.map(toMachineResponse);
  }
}
