import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/auth-context';
import { TenantDbService } from '../db/tenant-db.service';
import {
  PROMPT_MAX_PER_USER,
  PromptsRepository,
  isPromptNameConflict,
} from './prompts-repository';
import {
  CreatePromptDto,
  PromptResponse,
  UpdatePromptDto,
  toPromptResponse,
} from './dto/prompts.dto';

/**
 * User-facing management of saved prompts — the caller's reusable `/<name>`
 * templates. Own-scope only (RLS `prompts_owner` scopes every op to the caller;
 * `user_id` is the seatbelt). A duplicate `/name` (per user) is a 409.
 */
@ApiTags('me')
@ApiBearerAuth('bearer')
@ApiCookieAuth('cookie')
@Controller('api/v1/me/prompts')
export class MePromptsController {
  constructor(private readonly tenantDb: TenantDbService) {}

  @Get()
  @ApiOkResponse({ type: [PromptResponse] })
  @ApiUnauthorizedResponse()
  async list(@CurrentUser() userId: string): Promise<PromptResponse[]> {
    const rows = await this.tenantDb.runAs(userId, (tx) =>
      new PromptsRepository(tx).list(userId),
    );
    return rows.map(toPromptResponse);
  }

  @Post()
  @ApiCreatedResponse({ type: PromptResponse })
  @ApiConflictResponse({
    description: 'Duplicate name, or at the per-user prompt cap',
  })
  @ApiUnauthorizedResponse()
  async create(
    @CurrentUser() userId: string,
    @Body() dto: CreatePromptDto,
  ): Promise<PromptResponse> {
    const content = dto.content.trim();
    try {
      const created = await this.tenantDb.runAs(userId, async (tx) => {
        const repo = new PromptsRepository(tx);
        // Serializes concurrent creates for this user so the cap check below
        // can't race with another in-flight create (would otherwise let
        // PROMPT_MAX_PER_USER be overshot under concurrent requests).
        await repo.lockUserForCreate(userId);
        if ((await repo.countByUser(userId)) >= PROMPT_MAX_PER_USER) {
          throw new ConflictException(
            `Prompt limit reached (${PROMPT_MAX_PER_USER}).`,
          );
        }
        return repo.create(userId, dto.name, content);
      });
      return toPromptResponse(created);
    } catch (error) {
      if (isPromptNameConflict(error)) {
        throw new ConflictException(
          `A prompt named "${dto.name}" already exists.`,
        );
      }
      throw error;
    }
  }

  @Patch(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: PromptResponse })
  @ApiConflictResponse({
    description: 'Rename collides with an existing prompt',
  })
  @ApiNotFoundResponse({ description: 'Unknown or cross-tenant prompt' })
  @ApiUnauthorizedResponse()
  async update(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePromptDto,
  ): Promise<PromptResponse> {
    const patch = {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.content !== undefined ? { content: dto.content.trim() } : {}),
    };
    try {
      const updated = await this.tenantDb.runAs(userId, (tx) =>
        new PromptsRepository(tx).update(id, userId, patch),
      );
      if (!updated) {
        throw new NotFoundException(`Prompt ${id} not found`);
      }
      return toPromptResponse(updated);
    } catch (error) {
      if (isPromptNameConflict(error)) {
        throw new ConflictException(
          `A prompt named "${dto.name}" already exists.`,
        );
      }
      throw error;
    }
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'Unknown or cross-tenant prompt' })
  @ApiUnauthorizedResponse()
  async remove(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    const deleted = await this.tenantDb.runAs(userId, (tx) =>
      new PromptsRepository(tx).delete(id, userId),
    );
    if (!deleted) {
      throw new NotFoundException(`Prompt ${id} not found`);
    }
  }
}
