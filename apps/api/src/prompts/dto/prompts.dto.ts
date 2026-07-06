import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

// Trims before length validation so a whitespace-only body (which would pass
// MinLength(1) untrimmed, then fail the DB CHECK as an empty string post-trim)
// is rejected as a clean 400 instead of surfacing as an unhandled 500.
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

import {
  PROMPT_CONTENT_MAX,
  PROMPT_NAME_MAX,
  type Prompt,
} from '../../db/schema';

// The slash trigger: a slug (no whitespace/slashes) so `/<name>` is exact.
const NAME_PATTERN = /^[A-Za-z0-9_-]+$/;
const NAME_MESSAGE =
  'name must be a slug: letters, digits, underscore or hyphen (no spaces)';

export class CreatePromptDto {
  @ApiProperty({ maxLength: PROMPT_NAME_MAX, pattern: NAME_PATTERN.source })
  @IsString()
  @Matches(NAME_PATTERN, { message: NAME_MESSAGE })
  @MaxLength(PROMPT_NAME_MAX)
  name!: string;

  @ApiProperty({ minLength: 1, maxLength: PROMPT_CONTENT_MAX })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(PROMPT_CONTENT_MAX)
  content!: string;
}

export class UpdatePromptDto {
  @ApiPropertyOptional({
    maxLength: PROMPT_NAME_MAX,
    pattern: NAME_PATTERN.source,
  })
  @IsOptional()
  @IsString()
  @Matches(NAME_PATTERN, { message: NAME_MESSAGE })
  @MaxLength(PROMPT_NAME_MAX)
  name?: string;

  @ApiPropertyOptional({ minLength: 1, maxLength: PROMPT_CONTENT_MAX })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(PROMPT_CONTENT_MAX)
  content?: string;
}

export class PromptResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ maxLength: PROMPT_NAME_MAX })
  name!: string;

  @ApiProperty({ maxLength: PROMPT_CONTENT_MAX })
  content!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

export function toPromptResponse(prompt: Prompt): PromptResponse {
  return {
    id: prompt.id,
    name: prompt.name,
    content: prompt.content,
    createdAt: prompt.createdAt,
    updatedAt: prompt.updatedAt,
  };
}
