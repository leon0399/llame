import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Put,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/auth-context';
import { isRecord } from '../unknown-record';
import {
  KNOWLEDGE_SPACE_UNAVAILABLE,
  KnowledgeSpaceUnavailableError,
} from './knowledge-space.local-resolver';
import {
  KnowledgeSpaceResponse,
  KnowledgeSpaceUnavailableResponse,
  toKnowledgeSpaceResponse,
} from './dto/knowledge-space.dto';
import {
  KnowledgeSpaceService,
  type KnowledgeSpaceProvisioner,
} from './knowledge-space.service';

type KnowledgeSpaceRequest = {
  body?: unknown;
};

@ApiTags('knowledge')
@ApiBearerAuth('bearer')
@ApiCookieAuth('cookie')
@Controller('api/v1/me/knowledge-space')
export class KnowledgeSpaceController {
  constructor(
    @Inject(KnowledgeSpaceService)
    private readonly knowledgeSpace: KnowledgeSpaceProvisioner,
  ) {}

  @Put()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'provisionKnowledgeSpace',
    summary: 'Provision the current owner Knowledge Space',
    description:
      'Creates or resolves the authenticated owner personal Knowledge Space and returns only its stable logical identifier.',
  })
  @ApiOkResponse({ type: KnowledgeSpaceResponse })
  @ApiBadRequestResponse()
  @ApiUnauthorizedResponse()
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    type: KnowledgeSpaceUnavailableResponse,
  })
  async putKnowledgeSpace(
    @CurrentUser() ownerUserId: string,
    @Req() request: KnowledgeSpaceRequest,
  ): Promise<KnowledgeSpaceResponse> {
    assertEmptyKnowledgeSpaceBody(request.body);
    try {
      return toKnowledgeSpaceResponse(
        await this.knowledgeSpace.provisionForOwner(ownerUserId),
      );
    } catch (error) {
      if (!(error instanceof KnowledgeSpaceUnavailableError)) throw error;
      throw new ServiceUnavailableException({
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        error: 'Service Unavailable',
        code: KNOWLEDGE_SPACE_UNAVAILABLE,
        message: error.message,
      });
    }
  }
}

function assertEmptyKnowledgeSpaceBody(
  body: KnowledgeSpaceRequest['body'],
): void {
  if (body === undefined) return;
  if (!isRecord(body)) {
    throw new BadRequestException('Request body must be empty.');
  }
  if (Object.keys(body).length > 0) {
    throw new BadRequestException('Request body must be empty.');
  }
}
