import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';

import { CurrentUser } from '../auth/auth-context';
import {
  KnowledgeSpaceUnavailableError,
  KNOWLEDGE_SPACE_UNAVAILABLE,
} from './knowledge-space.local-resolver';
import { KnowledgeSpaceCursorError } from './knowledge-space.cursor';
import {
  CreateKnowledgeSpaceDto,
  KnowledgeSpaceCollectionResponse,
  KnowledgeSpaceResponse,
  KnowledgeSpaceUnavailableResponse,
  ListKnowledgeSpacesQueryDto,
  toKnowledgeSpaceCollectionResponse,
  toKnowledgeSpaceResponse,
  UpdateKnowledgeSpaceDto,
} from './dto/knowledge-space.dto';
import {
  KnowledgeSpaceService,
  type KnowledgeSpaceManagement,
} from './knowledge-space.service';

type KnowledgeSpaceResponseWriter = Pick<Response, 'setHeader'>;

@ApiTags('knowledge')
@ApiBearerAuth('bearer')
@ApiCookieAuth('cookie')
@Controller('api/v1/knowledge-spaces')
export class KnowledgeSpaceController {
  constructor(
    @Inject(KnowledgeSpaceService)
    private readonly knowledgeSpace: KnowledgeSpaceManagement,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    operationId: 'createKnowledgeSpace',
    summary: 'Create a Knowledge Space for the current owner',
  })
  @ApiCreatedResponse({ type: KnowledgeSpaceResponse })
  @ApiBadRequestResponse()
  @ApiUnauthorizedResponse()
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    type: KnowledgeSpaceUnavailableResponse,
  })
  async createKnowledgeSpace(
    @CurrentUser() ownerUserId: string,
    @Body() input: CreateKnowledgeSpaceDto,
    @Res({ passthrough: true }) response: KnowledgeSpaceResponseWriter,
  ): Promise<KnowledgeSpaceResponse> {
    try {
      const space = await this.knowledgeSpace.provisionForOwner(
        ownerUserId,
        input,
      );
      response.setHeader('Location', `/api/v1/knowledge-spaces/${space.id}`);
      return toKnowledgeSpaceResponse(space);
    } catch (error) {
      throw mapProvisioningError(error);
    }
  }

  @Get()
  @ApiOperation({
    operationId: 'listKnowledgeSpaces',
    summary: 'List the current owner Knowledge Spaces',
  })
  @ApiOkResponse({ type: KnowledgeSpaceCollectionResponse })
  @ApiBadRequestResponse()
  @ApiUnauthorizedResponse()
  async listKnowledgeSpaces(
    @CurrentUser() ownerUserId: string,
    @Query() query: ListKnowledgeSpacesQueryDto,
  ): Promise<KnowledgeSpaceCollectionResponse> {
    try {
      return toKnowledgeSpaceCollectionResponse(
        await this.knowledgeSpace.listForOwner(ownerUserId, {
          limit: query.limit,
          after: query.after,
        }),
      );
    } catch (error) {
      if (error instanceof KnowledgeSpaceCursorError) {
        throw new BadRequestException('Invalid Knowledge Space cursor.');
      }
      throw error;
    }
  }

  @Get(':id')
  @ApiOperation({
    operationId: 'getKnowledgeSpace',
    summary: 'Get one current owner Knowledge Space',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: KnowledgeSpaceResponse })
  @ApiBadRequestResponse({ description: 'Malformed Knowledge Space id' })
  @ApiNotFoundResponse()
  @ApiUnauthorizedResponse()
  async getKnowledgeSpace(
    @CurrentUser() ownerUserId: string,
    @Param('id', ParseUUIDPipe) knowledgeSpaceId: string,
  ): Promise<KnowledgeSpaceResponse> {
    const space = await this.knowledgeSpace.getForOwner(
      ownerUserId,
      knowledgeSpaceId,
    );
    if (space === undefined) throw knowledgeSpaceNotFound();
    return toKnowledgeSpaceResponse(space);
  }

  @Patch(':id')
  @ApiOperation({
    operationId: 'renameKnowledgeSpace',
    summary: 'Rename one current owner Knowledge Space',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: KnowledgeSpaceResponse })
  @ApiBadRequestResponse({ description: 'Malformed id or name' })
  @ApiNotFoundResponse()
  @ApiUnauthorizedResponse()
  async renameKnowledgeSpace(
    @CurrentUser() ownerUserId: string,
    @Param('id', ParseUUIDPipe) knowledgeSpaceId: string,
    @Body() input: UpdateKnowledgeSpaceDto,
  ): Promise<KnowledgeSpaceResponse> {
    const space = await this.knowledgeSpace.renameForOwner(
      ownerUserId,
      knowledgeSpaceId,
      input,
    );
    if (space === undefined) throw knowledgeSpaceNotFound();
    return toKnowledgeSpaceResponse(space);
  }
}

function knowledgeSpaceNotFound(): NotFoundException {
  return new NotFoundException('Knowledge Space not found');
}

function mapProvisioningError(error: unknown): Error {
  if (!(error instanceof KnowledgeSpaceUnavailableError)) {
    return error instanceof Error
      ? error
      : new Error('Knowledge Space provisioning failed');
  }
  return new ServiceUnavailableException({
    statusCode: HttpStatus.SERVICE_UNAVAILABLE,
    error: 'Service Unavailable',
    code: KNOWLEDGE_SPACE_UNAVAILABLE,
    message: error.message,
  });
}
