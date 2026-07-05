import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

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
