import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOkResponse,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import {
  ModelDomainErrorResponse,
  ModelsResponse,
  toAvailableModelResponse,
} from './dto/models.dto';
import { ModelConfigurationError, ModelsService } from './models.service';

export type ModelsReader = Pick<ModelsService, 'getAvailableModels'>;

@ApiTags('models')
@ApiBearerAuth('bearer')
@ApiCookieAuth('cookie')
@Controller('api/v1/models')
export class ModelsController {
  constructor(
    @Inject(ModelsService)
    private readonly models: ModelsReader,
  ) {}

  @Get()
  @ApiOkResponse({ type: ModelsResponse })
  @ApiUnauthorizedResponse()
  @ApiResponse({
    status: 503,
    description: 'Model catalog is not configured correctly',
    type: ModelDomainErrorResponse,
  })
  listModels(): ModelsResponse {
    try {
      const response = this.models.getAvailableModels();
      return {
        defaultModelId: response.defaultModelId,
        models: response.models.map(toAvailableModelResponse),
      };
    } catch (error) {
      if (error instanceof ModelConfigurationError) {
        throw new HttpException(
          {
            statusCode: HttpStatus.SERVICE_UNAVAILABLE,
            error: 'Service Unavailable',
            message: error.message,
            code: error.code,
          },
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      throw error;
    }
  }
}
