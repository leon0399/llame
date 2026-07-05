import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/auth-context';
import { ModelsService } from './models.service';
import {
  AvailableModelResponse,
  toAvailableModelResponse,
} from './dto/models.dto';

/**
 * Model catalog (#76): the models available to the authenticated caller —
 * their enabled provider accounts' default models plus the instance-env
 * model. Scoped to the caller (never another user's providers), and the
 * exact set the chat loop validates a selection against.
 */
@ApiTags('models')
@ApiBearerAuth('bearer')
@ApiCookieAuth('cookie')
@Controller('api/v1/models')
export class ModelsController {
  constructor(private readonly models: ModelsService) {}

  @Get()
  @ApiOkResponse({ type: AvailableModelResponse, isArray: true })
  @ApiUnauthorizedResponse()
  async list(@CurrentUser() userId: string): Promise<AvailableModelResponse[]> {
    const models = await this.models.listAvailableModels(userId);
    return models.map(toAvailableModelResponse);
  }
}
