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
  OptionalExecutorId,
  OptionalUuid,
} from '../../common/dto/optional-field.decorators';
import {
  PROJECT_REPOSITORY_ISOLATIONS,
  type ProjectRepository,
  type ProjectRepositoryDefault,
  type ProjectRepositoryIsolation,
} from '../../db/schema';
import {
  ISOLATION_DEFAULTS,
  ISOLATION_REASONS,
  type IsolationDefault,
  type IsolationReason,
} from '../start-location';

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

export class ProjectRepositoryDefaultResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  projectRepositoryId!: string;

  @ApiProperty()
  executorId!: string;

  @ApiProperty({ format: 'uuid' })
  checkoutId!: string;

  @ApiProperty({
    format: 'date-time',
    description: 'The time of the last write; the newest row wins.',
  })
  updatedAt!: Date;
}

export function toProjectRepositoryDefaultResponse(
  row: ProjectRepositoryDefault,
): ProjectRepositoryDefaultResponse {
  return {
    id: row.id,
    projectRepositoryId: row.projectRepositoryId,
    executorId: row.executorId,
    checkoutId: row.checkoutId,
    updatedAt: row.updatedAt,
  };
}

// One link as a write returns it. The read route extends it with the link's
// defaults, because a write never changes them and a `defaults: []` on an
// update would assert something false.
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

export class ProjectRepositoryLinkWithDefaultsResponse extends ProjectRepositoryLinkResponse {
  @ApiProperty({
    type: ProjectRepositoryDefaultResponse,
    isArray: true,
    description: 'Most recently written first.',
  })
  defaults!: Array<ProjectRepositoryDefaultResponse>;
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

export function toProjectRepositoryLinkWithDefaultsResponse(
  link: ProjectRepository,
  defaults: ReadonlyArray<ProjectRepositoryDefault>,
): ProjectRepositoryLinkWithDefaultsResponse {
  const base = toProjectRepositoryLinkResponse(link);
  return {
    id: base.id,
    ownerUserId: base.ownerUserId,
    projectId: base.projectId,
    repositoryId: base.repositoryId,
    alias: base.alias,
    isPrimary: base.isPrimary,
    isolation: base.isolation,
    createdAt: base.createdAt,
    updatedAt: base.updatedAt,
    defaults: defaults.map(toProjectRepositoryDefaultResponse),
  };
}

// GET /api/v1/projects/:id/start-location — the same three ids the create
// request takes, resolved in its order.
export class StartLocationQueryDto {
  @OptionalUuid()
  repositoryId?: string;

  @OptionalExecutorId()
  executorId?: string;

  @OptionalUuid()
  checkoutId?: string;
}

export class StartLocationResponse {
  @ApiProperty({ format: 'uuid' })
  projectId!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  repositoryId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  executorId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  checkoutId!: string | null;

  @ApiProperty({ enum: ISOLATION_DEFAULTS })
  isolation!: IsolationDefault;

  @ApiProperty({
    enum: ISOLATION_REASONS,
    description:
      'project_policy when the link policy decides, clone_in_use when another open chat holds the checkout, no_link when no link resolved.',
  })
  isolationReason!: IsolationReason;

  @ApiProperty({
    description:
      'How many open chats already bind the resolved checkout; zero unless the reason is clone_in_use.',
  })
  isolationChats!: number;
}
