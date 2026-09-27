import { Controller, Get, Inject } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import {
  InstanceConfigService,
  type InstanceConfigReader,
} from '../instance-config/instance-config.service';
import { PermissionModesResponse } from './dto/permission-modes.dto';

@ApiTags('permission-modes')
@ApiBearerAuth('bearer')
@ApiCookieAuth('cookie')
@Controller('api/v1/permission-modes')
export class PermissionModesController {
  constructor(
    @Inject(InstanceConfigService)
    private readonly instanceConfig: InstanceConfigReader,
  ) {}

  @Get()
  @ApiOperation({ operationId: 'listPermissionModes' })
  @ApiOkResponse({ type: PermissionModesResponse })
  @ApiUnauthorizedResponse()
  listPermissionModes(): PermissionModesResponse {
    return {
      modes: this.instanceConfig.config.tools.permissionModes.map((value) => ({
        value,
      })),
    };
  }
}
