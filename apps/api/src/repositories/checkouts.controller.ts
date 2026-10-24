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
  Query,
} from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/auth-context';
import { CheckoutsService } from './checkouts.service';
import { WorktreeRemovalService } from './worktree-removal.service';
import {
  CheckoutResponse,
  CreateCheckoutDto,
  ListCheckoutsQueryDto,
  toCheckoutResponse,
  UpdateCheckoutDto,
} from './dto/checkouts.dto';
import { RepositoryFailureResponse } from './dto/failure.dto';

@ApiTags('checkouts')
@ApiBearerAuth('bearer')
@ApiCookieAuth('cookie')
@Controller('api/v1/checkouts')
export class CheckoutsController {
  constructor(
    private readonly checkouts: CheckoutsService,
    private readonly worktrees: WorktreeRemovalService,
  ) {}

  // The only route in this module that runs git, and therefore the only one
  // with the executor and host-access gates.
  @Post()
  @ApiOperation({
    operationId: 'registerCheckout',
    summary: 'Inspect a path and record it as a checkout',
  })
  @ApiCreatedResponse({ type: CheckoutResponse })
  @ApiBadRequestResponse({ description: 'Malformed body' })
  @ApiForbiddenResponse({ type: RepositoryFailureResponse })
  @ApiNotFoundResponse({ type: RepositoryFailureResponse })
  @ApiConflictResponse({ type: RepositoryFailureResponse })
  @ApiUnprocessableEntityResponse({ type: RepositoryFailureResponse })
  @ApiBadGatewayResponse({ type: RepositoryFailureResponse })
  @ApiServiceUnavailableResponse({ type: RepositoryFailureResponse })
  @ApiUnauthorizedResponse()
  async registerCheckout(
    @CurrentUser() userId: string,
    @Body() input: CreateCheckoutDto,
  ): Promise<CheckoutResponse> {
    return toCheckoutResponse(await this.checkouts.register(userId, input));
  }

  @Get()
  @ApiOperation({
    operationId: 'listCheckouts',
    summary: "List the owner's checkouts with their bound chats",
  })
  @ApiOkResponse({ type: CheckoutResponse, isArray: true })
  @ApiBadRequestResponse({ description: 'Malformed repositoryId' })
  @ApiUnauthorizedResponse()
  async listCheckouts(
    @CurrentUser() userId: string,
    @Query() query: ListCheckoutsQueryDto,
  ): Promise<Array<CheckoutResponse>> {
    const rows = await this.checkouts.listCheckouts(userId, query.repositoryId);
    return rows.map(toCheckoutResponse);
  }

  @Patch(':id')
  @ApiOperation({
    operationId: 'updateCheckout',
    summary: 'Set the worktree base of a main checkout',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: CheckoutResponse })
  @ApiBadRequestResponse({ description: 'Malformed checkout id or body' })
  @ApiNotFoundResponse({ type: RepositoryFailureResponse })
  @ApiUnprocessableEntityResponse({ type: RepositoryFailureResponse })
  @ApiUnauthorizedResponse()
  async updateCheckout(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateCheckoutDto,
  ): Promise<CheckoutResponse> {
    return toCheckoutResponse(
      await this.checkouts.setWorktreeBase(userId, id, input.worktreeBase),
    );
  }

  // Owner-initiated worktree removal: guarded on the executor (dirty,
  // unpushed, or unknown upstream refused), and the directory leaves only
  // after git removes it. The branch stays, so no commit is lost.
  @Delete(':id/worktree')
  @ApiOperation({
    operationId: 'removeCheckoutWorktree',
    summary: 'Remove a clean worktree directory, then its row',
  })
  @HttpCode(204)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({ description: 'Malformed checkout id' })
  @ApiNotFoundResponse({ type: RepositoryFailureResponse })
  @ApiForbiddenResponse({ type: RepositoryFailureResponse })
  @ApiConflictResponse({ type: RepositoryFailureResponse })
  @ApiUnprocessableEntityResponse({ type: RepositoryFailureResponse })
  @ApiBadGatewayResponse({ type: RepositoryFailureResponse })
  @ApiServiceUnavailableResponse({ type: RepositoryFailureResponse })
  @ApiUnauthorizedResponse()
  async removeCheckoutWorktree(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.worktrees.remove(userId, id);
  }

  // Row-only deletion: a chat keeps its stored Workspace path, and the next
  // Run attempt re-checks that binding as before. No directory is touched.
  @Delete(':id')
  @ApiOperation({
    operationId: 'deleteCheckout',
    summary: 'Delete a checkout record and its cascaded rows',
  })
  @HttpCode(204)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({ description: 'Malformed checkout id' })
  @ApiNotFoundResponse({ type: RepositoryFailureResponse })
  @ApiUnauthorizedResponse()
  async deleteCheckout(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.checkouts.deleteCheckout(userId, id);
  }
}
