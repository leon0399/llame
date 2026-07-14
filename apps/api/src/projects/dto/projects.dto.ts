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
import type { Project } from '../../db/schema';

// POST /api/v1/projects — a project starts with just a name (folders-only,
// no membership/sharing fields yet). Matches(/\S/) — not IsNotEmpty, which
// waves whitespace-only strings through to a DB write (same guard as
// CreateTextMessagePartDto.text / CreateMessageDto.modelId).
export class CreateProjectDto {
  @ApiProperty({ minLength: 1, maxLength: 200 })
  @IsString()
  @Matches(/\S/, { message: 'name must not be blank' })
  @MaxLength(200)
  name!: string;
}

// PATCH /api/v1/projects/:id — partial update. `name` is the only mutable
// field today. ValidateIf (not IsOptional): IsOptional also waves an explicit
// `null` through, and `name` is a NOT NULL column — an explicit null would
// otherwise reach the repository and fail as a DB constraint violation (500)
// instead of a clean 400. Only absence skips validation, mirroring
// UpdateChatDto.title.
export class UpdateProjectDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 200 })
  @ValidateIf((o: UpdateProjectDto) => o.name !== undefined)
  @IsString()
  @Matches(/\S/, { message: 'name must not be blank' })
  @MaxLength(200)
  name?: string;

  // Archive (true) or unarchive (false) the project. Omit to leave unchanged.
  @ApiPropertyOptional({
    description:
      'Archive (true) or unarchive (false) the project. Omit to leave unchanged.',
  })
  @IsOptional()
  @IsBoolean()
  archived?: boolean;
}

export class ProjectResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  ownerUserId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;

  // Archive state (chat-project-archive): set when the owner archives the
  // project; null = not archived.
  @ApiProperty({ type: Date, format: 'date-time', nullable: true })
  archivedAt!: Date | null;
}

export function toProjectResponse(project: Project): ProjectResponse {
  return {
    id: project.id,
    ownerUserId: project.ownerUserId,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    archivedAt: project.archivedAt,
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
