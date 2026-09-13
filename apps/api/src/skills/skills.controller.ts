import { Controller, Get, Inject, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { SkillCatalog, type SkillCatalogPort } from './skill-catalog';
import {
  ListSkillsQueryDto,
  SkillCatalogCollectionResponse,
  SKILL_CATALOG_DEFAULT_LIMIT,
  toSkillCatalogCollection,
} from './dto/skill-catalog.dto';

/**
 * Owner-visible, read-only inspection of the operator's system skill catalog.
 * The catalog is instance-wide and identical for every authenticated owner, so
 * this surface takes no owner identity and exposes no mutation.
 */
@ApiTags('skills')
@ApiBearerAuth('bearer')
@ApiCookieAuth('cookie')
@Controller('api/v1/skills')
export class SkillsController {
  constructor(
    @Inject(SkillCatalog)
    private readonly catalog: SkillCatalogPort,
  ) {}

  @Get()
  @ApiOperation({
    operationId: 'listSkills',
    summary: 'Inspect the operator skill catalog',
  })
  @ApiOkResponse({ type: SkillCatalogCollectionResponse })
  @ApiUnauthorizedResponse()
  listSkills(
    @Query() query: ListSkillsQueryDto,
  ): SkillCatalogCollectionResponse {
    return toSkillCatalogCollection(this.catalog.getSnapshot(), {
      limit: query.limit ?? SKILL_CATALOG_DEFAULT_LIMIT,
      after: query.after,
    });
  }
}
