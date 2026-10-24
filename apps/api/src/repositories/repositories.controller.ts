import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/auth-context';
import {
  CreateAliasDto,
  CreateRepositoryDto,
  RepositoryAliasResponse,
  RepositoryResponse,
  toAliasResponse,
  toRepositoryResponse,
  UpdateRepositoryDto,
} from './dto/repositories.dto';
import { RepositoryFailureResponse } from './dto/failure.dto';
import { RepositoriesService } from './repositories.service';

// The owner comes only from the verified session: no route parameter, query,
// or body field names a user, so a caller cannot target another owner's
// catalog. A foreign id is simply absent from this owner's rows.
@ApiTags('repositories')
@ApiBearerAuth('bearer')
@ApiCookieAuth('cookie')
@Controller('api/v1/repositories')
export class RepositoriesController {
  constructor(private readonly repositories: RepositoriesService) {}

  @Post()
  @ApiOperation({
    operationId: 'createRepository',
    summary: 'Create one repository record',
  })
  @ApiCreatedResponse({ type: RepositoryResponse })
  @ApiConflictResponse({ type: RepositoryFailureResponse })
  @ApiUnprocessableEntityResponse({ type: RepositoryFailureResponse })
  @ApiUnauthorizedResponse()
  async createRepository(
    @CurrentUser() userId: string,
    @Body() input: CreateRepositoryDto,
  ): Promise<RepositoryResponse> {
    return toRepositoryResponse(
      await this.repositories.createRepository(userId, input),
    );
  }

  @Get()
  @ApiOperation({
    operationId: 'listRepositories',
    summary: "List the owner's repositories",
  })
  @ApiOkResponse({ type: RepositoryResponse, isArray: true })
  @ApiUnauthorizedResponse()
  async listRepositories(
    @CurrentUser() userId: string,
  ): Promise<Array<RepositoryResponse>> {
    const list = await this.repositories.listRepositories(userId);
    return list.map(toRepositoryResponse);
  }

  @Patch(':id')
  @ApiOperation({
    operationId: 'updateRepository',
    summary: 'Rename a repository or re-declare its remote',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: RepositoryResponse })
  @ApiBadRequestResponse({ description: 'Malformed repository id' })
  @ApiNotFoundResponse({ type: RepositoryFailureResponse })
  @ApiConflictResponse({ type: RepositoryFailureResponse })
  @ApiUnprocessableEntityResponse({ type: RepositoryFailureResponse })
  @ApiUnauthorizedResponse()
  async updateRepository(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateRepositoryDto,
  ): Promise<RepositoryResponse> {
    return toRepositoryResponse(
      await this.repositories.updateRepository(userId, id, input),
    );
  }

  // Row-only deletion: the checkout rows and leases cascade, and every
  // directory on an executor stays where it is.
  @Delete(':id')
  @ApiOperation({
    operationId: 'deleteRepository',
    summary: 'Delete a repository record and its cascaded rows',
  })
  @HttpCode(204)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({ description: 'Malformed repository id' })
  @ApiNotFoundResponse({ type: RepositoryFailureResponse })
  @ApiUnauthorizedResponse()
  async deleteRepository(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.repositories.deleteRepository(userId, id);
  }

  @Post(':id/aliases')
  @ApiOperation({
    operationId: 'declareRepositoryAlias',
    summary: 'Declare an alternate remote of one repository',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiCreatedResponse({ type: RepositoryAliasResponse })
  @ApiBadRequestResponse({ description: 'Malformed repository id or remote' })
  @ApiNotFoundResponse({ type: RepositoryFailureResponse })
  @ApiConflictResponse({ type: RepositoryFailureResponse })
  @ApiUnprocessableEntityResponse({ type: RepositoryFailureResponse })
  @ApiUnauthorizedResponse()
  async declareAlias(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: CreateAliasDto,
  ): Promise<RepositoryAliasResponse> {
    return toAliasResponse(
      await this.repositories.declareAlias(userId, id, input.remote),
    );
  }
}
