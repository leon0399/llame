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
import { MEMORY_MAX_PER_USER, MemoriesRepository } from './memories-repository';
import {
  CreateMemoryDto,
  MemoryResponse,
  toMemoryResponse,
} from './dto/memories.dto';

/**
 * User-facing management of durable memories — the facts the assistant
 * remembers about the caller. A narrow, own-scope surface (RLS: `memories_owner`
 * scopes every op to the caller). `source` is server-set to `'user'` on create,
 * so a user curates the auto-injected set without being able to spoof agent
 * provenance. Distinct from the `remember` tool (agent write, operator-gated)
 * and `recall` (agent read).
 */
@ApiTags('me')
@ApiBearerAuth('bearer')
@ApiCookieAuth('cookie')
@Controller('api/v1/me/memories')
export class MeMemoriesController {
  constructor(private readonly tenantDb: TenantDbService) {}

  @Get()
  @ApiOkResponse({ type: [MemoryResponse] })
  @ApiUnauthorizedResponse()
  async list(@CurrentUser() userId: string): Promise<MemoryResponse[]> {
    const rows = await this.tenantDb.runAs(userId, (tx) =>
      new MemoriesRepository(tx).list(userId, MEMORY_MAX_PER_USER),
    );
    return rows.map(toMemoryResponse);
  }

  @Post()
  @ApiCreatedResponse({ type: MemoryResponse })
  @ApiConflictResponse({
    description:
      'At the per-user memory cap, or a duplicate of existing content',
  })
  @ApiUnauthorizedResponse()
  async create(
    @CurrentUser() userId: string,
    @Body() dto: CreateMemoryDto,
  ): Promise<MemoryResponse> {
    // dto.content is already trimmed by the DTO's @Transform (which runs
    // BEFORE @MinLength) — a whitespace-only body is rejected there with a
    // clean 400, never reaches this handler.
    const content = dto.content;
    // Cap + dedupe + insert in ONE own-scope tx so concurrent writes can't
    // overshoot the (soft) cap or both slip a duplicate past the check.
    const created = await this.tenantDb.runAs(userId, async (tx) => {
      const repo = new MemoriesRepository(tx);
      if ((await repo.countByUser(userId)) >= MEMORY_MAX_PER_USER) {
        throw new ConflictException(
          `Memory limit reached (${MEMORY_MAX_PER_USER}).`,
        );
      }
      if (await repo.existsByContent(userId, content)) {
        throw new ConflictException('You already saved this memory.');
      }
      return repo.create(userId, content, 'user');
    });
    return toMemoryResponse(created);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'Unknown or cross-tenant memory' })
  @ApiUnauthorizedResponse()
  async remove(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    const deleted = await this.tenantDb.runAs(userId, (tx) =>
      new MemoriesRepository(tx).delete(id, userId),
    );
    if (!deleted) {
      throw new NotFoundException(`Memory ${id} not found`);
    }
  }
}
