import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDefined,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  Validate,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';

import { isString } from '@workspace/runtime-safety';
import { KNOWLEDGE_SPACE_UNAVAILABLE } from '../knowledge-space.local-resolver';
import {
  isValidKnowledgeSpaceName,
  normalizeKnowledgeSpaceName,
} from '../knowledge-space-name';
import type { KnowledgeSpaceApiProjection } from '../knowledge-space.repository';
import {
  KNOWLEDGE_SPACE_DEFAULT_LIMIT,
  KNOWLEDGE_SPACE_MAX_LIMIT,
} from '../knowledge-space.service';

// The name rule as a schema pattern: after trimming, 1-100 code points with
// no control, format, line-separator, or paragraph-separator character. The
// surrounding whitespace the API trims is unbounded, so the length lives in the
// pattern rather than in maxLength. JSON Schema patterns have no Unicode
// property classes, so the BMP members of those categories are listed; the
// rule itself is `INVALID_NAME_CHARACTERS`.
const EXCLUDED = String.raw`\u0000-\u001F\u007F-\u009F\u00AD\u0600-\u0605\u061C\u06DD\u070F\u0890\u0891\u08E2\u180E\u200B-\u200F\u2028-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB`;
const NAME_PATTERN = String.raw`^\s*[^\s${EXCLUDED}](?:[^${EXCLUDED}]{0,98}[^\s${EXCLUDED}])?\s*$`;

@ValidatorConstraint({ name: 'knowledgeSpaceName', async: false })
class KnowledgeSpaceNameConstraint implements ValidatorConstraintInterface {
  validate(value: string): boolean {
    return isValidKnowledgeSpaceName(value);
  }

  defaultMessage(): string {
    return 'name must be 1-100 Unicode code points and cannot contain control, format, line-separator, or paragraph-separator characters';
  }
}

export class CreateKnowledgeSpaceDto {
  @ApiProperty({ pattern: NAME_PATTERN })
  @IsDefined()
  @IsString()
  @Transform(({ value }) => (isString(value) ? value.trim() : undefined))
  @Validate(KnowledgeSpaceNameConstraint)
  name!: string;
}

export class UpdateKnowledgeSpaceDto {
  @ApiProperty({ pattern: NAME_PATTERN })
  @IsDefined()
  @IsString()
  @Transform(({ value }) => (isString(value) ? value.trim() : undefined))
  @Validate(KnowledgeSpaceNameConstraint)
  name!: string;
}

export class ListKnowledgeSpacesQueryDto {
  @ApiPropertyOptional({
    type: 'integer',
    default: KNOWLEDGE_SPACE_DEFAULT_LIMIT,
    minimum: 1,
    maximum: KNOWLEDGE_SPACE_MAX_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(KNOWLEDGE_SPACE_MAX_LIMIT)
  limit?: number;

  @ApiPropertyOptional({
    pattern: '^[A-Za-z0-9_-]+$',
    description: 'Opaque base64url keyset cursor from the preceding page.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]+$/u)
  after?: string;
}

export class KnowledgeSpaceResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

export class KnowledgeSpaceCollectionResponse {
  @ApiProperty({ type: () => [KnowledgeSpaceResponse] })
  items!: Array<KnowledgeSpaceResponse>;

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;
}

export class KnowledgeSpaceUnavailableResponse {
  @ApiProperty()
  statusCode!: number;

  @ApiProperty()
  error!: string;

  @ApiProperty({ enum: [KNOWLEDGE_SPACE_UNAVAILABLE] })
  code!: typeof KNOWLEDGE_SPACE_UNAVAILABLE;

  @ApiProperty()
  message!: string;
}

export function toKnowledgeSpaceResponse(
  projection: KnowledgeSpaceApiProjection,
): KnowledgeSpaceResponse {
  return {
    id: projection.id,
    name: normalizeKnowledgeSpaceName(projection.name),
    createdAt: projection.createdAt,
    updatedAt: projection.updatedAt,
  };
}

export function toKnowledgeSpaceCollectionResponse(input: {
  items: Array<KnowledgeSpaceApiProjection>;
  nextCursor: string | null;
}): KnowledgeSpaceCollectionResponse {
  return {
    items: input.items.map(toKnowledgeSpaceResponse),
    nextCursor: input.nextCursor,
  };
}
