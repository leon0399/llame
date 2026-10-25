import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

import {
  PROJECT_REPOSITORY_ISOLATIONS,
  type ProjectRepository,
  type ProjectRepositoryIsolation,
} from '../../db/schema';

// The project-scoped name of a linked repository. Same bound as a project name:
// it is owner-authored prose shown in the composer chip, never a path segment.
export const LINK_ALIAS_MAX = 200;

// POST /api/v1/projects/:id/repositories — link one catalog repository to the
// project. `alias` is the project's own label and defaults to the repository's
// display name; `isolation` defaults to `inherit`, and `isPrimary` to false.
export class CreateProjectRepositoryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  repositoryId!: string;

  @ApiPropertyOptional({
    minLength: 1,
    maxLength: LINK_ALIAS_MAX,
    description:
      "The project's own label for the repository. Defaults to the repository display name.",
  })
  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: 'alias must not be blank' })
  @MaxLength(LINK_ALIAS_MAX)
  alias?: string;

  @ApiPropertyOptional({
    description:
      'Make this the project primary link, clearing any previous one.',
  })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @ApiPropertyOptional({ enum: PROJECT_REPOSITORY_ISOLATIONS })
  @IsOptional()
  @IsIn([...PROJECT_REPOSITORY_ISOLATIONS])
  isolation?: ProjectRepositoryIsolation;
}

// PATCH /api/v1/projects/:id/repositories/:repositoryId — partial update of one
// link. Omitted fields stay untouched; the alias and the isolation are not
// nullable columns, so an explicit null is refused rather than stored.
export class UpdateProjectRepositoryDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: LINK_ALIAS_MAX })
  @ValidateIf((o: UpdateProjectRepositoryDto) => o.alias !== undefined)
  @IsString()
  @Matches(/\S/, { message: 'alias must not be blank' })
  @MaxLength(LINK_ALIAS_MAX)
  alias?: string;

  @ApiPropertyOptional({
    description:
      'True makes this the project primary link and clears the previous one; false clears this link.',
  })
  @ValidateIf((o: UpdateProjectRepositoryDto) => o.isPrimary !== undefined)
  @IsBoolean()
  isPrimary?: boolean;

  @ApiPropertyOptional({ enum: PROJECT_REPOSITORY_ISOLATIONS })
  @ValidateIf((o: UpdateProjectRepositoryDto) => o.isolation !== undefined)
  @IsIn([...PROJECT_REPOSITORY_ISOLATIONS])
  isolation?: ProjectRepositoryIsolation;
}

// One link as every route returns it: the project's own alias, the primary
// flag, and the isolation policy.
export class ProjectRepositoryLinkResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  ownerUserId!: string;

  @ApiProperty({ format: 'uuid' })
  projectId!: string;

  @ApiProperty({ format: 'uuid' })
  repositoryId!: string;

  @ApiProperty()
  alias!: string;

  @ApiProperty()
  isPrimary!: boolean;

  @ApiProperty({ enum: PROJECT_REPOSITORY_ISOLATIONS })
  isolation!: ProjectRepositoryIsolation;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

export function toProjectRepositoryLinkResponse(
  link: ProjectRepository,
): ProjectRepositoryLinkResponse {
  return {
    id: link.id,
    ownerUserId: link.ownerUserId,
    projectId: link.projectId,
    repositoryId: link.repositoryId,
    alias: link.alias,
    isPrimary: link.isPrimary,
    isolation: link.isolation,
    createdAt: link.createdAt,
    updatedAt: link.updatedAt,
  };
}
