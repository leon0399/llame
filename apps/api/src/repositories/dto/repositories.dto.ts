import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

import { type Repository, type RepositoryAlias } from '../../db/schema';
import { DISPLAY_NAME_MAX } from '../display-name';

// The remote cap: a clone URL longer than this is not a remote anyone types,
// and a bound here keeps a bad body from reaching normalization at all.
const REMOTE_MAX = 2048;

// POST /api/v1/repositories — a repository starts with a display name and,
// optionally, the remote it is known by. `Matches(/\S/)` is not IsNotEmpty,
// which waves whitespace-only strings through to a DB write. The one-segment
// rule itself is enforced in the service, so it answers 422 rather than the
// pipe's 400 (openspec `repositories`: "A display name cannot leave its
// segment").
export class CreateRepositoryDto {
  @ApiProperty({
    minLength: 1,
    maxLength: DISPLAY_NAME_MAX,
    pattern: '^[^/]*\\S[^/]*$',
    description: 'One path segment, without "/" or a NUL byte.',
  })
  @IsString()
  @Matches(/\S/, { message: 'displayName must not be blank' })
  @MaxLength(DISPLAY_NAME_MAX)
  displayName!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: REMOTE_MAX,
    description:
      'The origin remote. Stored normalized; omit for a repository whose clone has no origin.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(REMOTE_MAX)
  remote?: string | null;
}

// PATCH /api/v1/repositories/:id — rename, re-declare the remote, or clear it
// with an explicit null. Omitted fields stay untouched. ValidateIf (not
// IsOptional) on `displayName`: IsOptional also waves an explicit `null`
// through, and the display name is a NOT NULL column, so null would reach the
// service and fail on `.trim()` as a 500 instead of a clean 400 — the same
// distinction as `UpdateProjectDto.name`. `remote` keeps IsOptional, because an
// explicit null there is the documented way to clear it.
export class UpdateRepositoryDto {
  @ApiPropertyOptional({
    minLength: 1,
    maxLength: DISPLAY_NAME_MAX,
    pattern: '^[^/]*\\S[^/]*$',
  })
  @ValidateIf((o: UpdateRepositoryDto) => o.displayName !== undefined)
  @IsString()
  @Matches(/\S/, { message: 'displayName must not be blank' })
  @MaxLength(DISPLAY_NAME_MAX)
  displayName?: string;

  @ApiPropertyOptional({
    type: String,
    maxLength: REMOTE_MAX,
    nullable: true,
    description: 'Pass null to clear the canonical remote.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(REMOTE_MAX)
  remote?: string | null;
}

export class RepositoryResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  ownerUserId!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty({ type: String, nullable: true })
  canonicalRemote!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

export function toRepositoryResponse(
  repository: Repository,
): RepositoryResponse {
  return {
    id: repository.id,
    ownerUserId: repository.ownerUserId,
    displayName: repository.displayName,
    canonicalRemote: repository.canonicalRemote,
    createdAt: repository.createdAt,
    updatedAt: repository.updatedAt,
  };
}

// POST /api/v1/repositories/:id/aliases — one declared alternate remote.
export class CreateAliasDto {
  @ApiProperty({ maxLength: REMOTE_MAX, pattern: '\\S' })
  @IsString()
  @Matches(/\S/, { message: 'remote must not be blank' })
  @MaxLength(REMOTE_MAX)
  remote!: string;
}

export class RepositoryAliasResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  repositoryId!: string;

  @ApiProperty()
  canonicalAlias!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
}

export function toAliasResponse(
  alias: RepositoryAlias,
): RepositoryAliasResponse {
  return {
    id: alias.id,
    repositoryId: alias.repositoryId,
    canonicalAlias: alias.canonicalAlias,
    createdAt: alias.createdAt,
  };
}
