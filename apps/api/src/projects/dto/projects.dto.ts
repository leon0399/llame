import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
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
}

export function toProjectResponse(project: Project): ProjectResponse {
  return {
    id: project.id,
    ownerUserId: project.ownerUserId,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}
