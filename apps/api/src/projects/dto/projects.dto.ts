import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { EXECUTOR_ID_MAX } from '../../common/dto/optional-field.decorators';
import type { Project } from '../../db/schema';

// Cap on an owner-authored project description. Enforced at the DTO rather
// than the column, so raising it is not a migration — same
// treatment as the 200-character name bound below and PERSONALIZATION_CAPS.
const DESCRIPTION_MAX = 1000;

// POST /api/v1/projects — a project starts with a name and, optionally, a
// description (folders-only, no membership/sharing fields yet).
// Matches(/\S/) — not IsNotEmpty, which waves whitespace-only strings through
// to a DB write (same guard as CreateTextMessagePartDto.text /
// CreateMessageDto.modelId).
export class CreateProjectDto {
  @ApiProperty({ minLength: 1, maxLength: 200 })
  @IsString()
  @Matches(/\S/, { message: 'name must not be blank' })
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({
    type: String,
    maxLength: DESCRIPTION_MAX,
    nullable: true,
    description: 'What this project is for. Omit or pass null for none.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(DESCRIPTION_MAX)
  description?: string | null;
}

// PATCH /api/v1/projects/:id — partial update. `name`, `description`, and
// `archived` are the mutable fields. ValidateIf (not IsOptional) — here and on
// `name`, unlike `description` below: IsOptional also waves an explicit `null`
// through, and `name` is a NOT NULL column, so an explicit null would otherwise
// reach the repository and fail as a DB constraint violation (500) instead of a
// clean 400. Only absence skips validation, mirroring UpdateChatDto.title.
export class UpdateProjectDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 200 })
  @ValidateIf((o: UpdateProjectDto) => o.name !== undefined)
  @IsString()
  @Matches(/\S/, { message: 'name must not be blank' })
  @MaxLength(200)
  name?: string;

  // Description — the owner's own prose about what the project is for. IsOptional (not ValidateIf, unlike `name` above): the
  // column is nullable, so an explicit `null` IS a legitimate value (clear it),
  // and IsOptional skips further validation for undefined AND null while
  // IsString/MaxLength still run for any other supplied value — the same
  // distinction as UpdateChatDto.projectId.
  @ApiPropertyOptional({
    type: String,
    maxLength: DESCRIPTION_MAX,
    nullable: true,
    description:
      'What this project is for. Pass null to clear it; omit to leave unchanged.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(DESCRIPTION_MAX)
  description?: string | null;

  // Archive (true) or unarchive (false) the project. Omit to leave unchanged.
  @ApiPropertyOptional({
    description:
      'Archive (true) or unarchive (false) the project. Omit to leave unchanged.',
  })
  @ValidateIf((o: UpdateProjectDto) => o.archived !== undefined)
  @IsBoolean()
  archived?: boolean;

  // The executor a chat start prefers when no link default names one. An
  // explicit null clears it; an omitted field leaves it unchanged. IsOptional
  // (not ValidateIf), because the column is nullable and null is the documented
  // way to clear — the same distinction as `description`.
  @ApiPropertyOptional({
    type: String,
    maxLength: EXECUTOR_ID_MAX,
    nullable: true,
    description:
      'Executor id a chat start on this project prefers. Pass null to clear it; omit to leave it unchanged.',
  })
  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: 'defaultExecutorId must not be blank' })
  @MaxLength(EXECUTOR_ID_MAX)
  defaultExecutorId?: string | null;
}

export class ProjectResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  ownerUserId!: string;

  @ApiProperty()
  name!: string;

  // Owner-authored description; null = none.
  @ApiProperty({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;

  // Archive state (chat-project-archive): set when the owner archives the
  // project; null = not archived.
  @ApiProperty({ type: Date, format: 'date-time', nullable: true })
  archivedAt!: Date | null;

  // The executor a chat start prefers; null = none.
  @ApiProperty({ type: String, nullable: true })
  defaultExecutorId!: string | null;
}

export function toProjectResponse(project: Project): ProjectResponse {
  return {
    id: project.id,
    ownerUserId: project.ownerUserId,
    name: project.name,
    description: project.description,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    archivedAt: project.archivedAt,
    defaultExecutorId: project.defaultExecutorId,
  };
}

// GET /api/v1/projects — optional collection filters (chat-project-archive).
export class ListProjectsQueryDto {
  // Archive filter. Absent ⇒ exclude archived (the overview default). `only` ⇒
  // archived only. `with` ⇒ both archived and non-archived.
  @ApiPropertyOptional({ enum: ['only', 'with'] })
  @IsOptional()
  @IsIn(['only', 'with'])
  archived?: 'only' | 'with';

  // Pin filter. Absent ⇒ `with` (both pinned and non-pinned). `only` ⇒ pinned
  // only. `exclude` ⇒ non-pinned only. Enforced via an EXISTS/NOT EXISTS check
  // on the caller's pins.
  @ApiPropertyOptional({ enum: ['only', 'with', 'exclude'] })
  @IsOptional()
  @IsIn(['only', 'with', 'exclude'])
  pinned?: 'only' | 'with' | 'exclude';
}
