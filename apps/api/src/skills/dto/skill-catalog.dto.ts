import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import {
  compareSkillNames,
  type SkillCatalogEntry,
  type SkillCatalogSnapshot,
} from '../skill-catalog';

/** Entries per catalog page when the request omits `limit`. */
export const SKILL_CATALOG_DEFAULT_LIMIT = 100;
/** Largest catalog page a caller may request. */
export const SKILL_CATALOG_MAX_LIMIT = 200;

export class ListSkillsQueryDto {
  @ApiPropertyOptional({
    type: 'integer',
    default: SKILL_CATALOG_DEFAULT_LIMIT,
    minimum: 1,
    maximum: SKILL_CATALOG_MAX_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SKILL_CATALOG_MAX_LIMIT)
  limit?: number;

  @ApiPropertyOptional({
    description:
      'Name of the last entry from the preceding page; the response resumes after it.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  after?: string;
}

export class SkillCatalogEntryResponse {
  @ApiProperty()
  name!: string;

  @ApiProperty({ type: String, nullable: true })
  description!: string | null;

  @ApiProperty({
    description:
      'Whether the package may be selected proactively rather than only by explicit mention.',
  })
  proactive!: boolean;

  @ApiProperty({ type: String, nullable: true })
  sourceDirectory!: string | null;

  @ApiProperty({ type: String, nullable: true })
  skillDirectory!: string | null;

  @ApiProperty()
  available!: boolean;

  @ApiProperty({ type: [String] })
  diagnostics!: Array<string>;
}

export class SkillCatalogCollectionResponse {
  @ApiProperty({
    description:
      'False when discovery could not run to completion; items is then empty and diagnostics explains why.',
  })
  available!: boolean;

  @ApiProperty({ type: [String] })
  directories!: Array<string>;

  @ApiProperty({ type: [String] })
  diagnostics!: Array<string>;

  @ApiProperty()
  total!: number;

  @ApiProperty({ type: () => [SkillCatalogEntryResponse] })
  items!: Array<SkillCatalogEntryResponse>;

  @ApiProperty({ type: String, nullable: true })
  nextCursor!: string | null;
}

export function toSkillCatalogCollection(
  snapshot: SkillCatalogSnapshot,
  page: { readonly limit: number; readonly after?: string },
): SkillCatalogCollectionResponse {
  const after = page.after;
  const remaining =
    after === undefined
      ? snapshot.entries
      : snapshot.entries.filter(
          (entry) => compareSkillNames(entry.name, after) > 0,
        );
  const items = remaining.slice(0, page.limit);
  const hasMore = remaining.length > items.length;
  const lastItem = items.at(-1);

  return {
    available: snapshot.available,
    directories: [...snapshot.directories],
    diagnostics: [...snapshot.diagnostics],
    total: snapshot.entries.length,
    items: items.map(toSkillCatalogEntryResponse),
    nextCursor: hasMore && lastItem !== undefined ? lastItem.name : null,
  };
}

function toSkillCatalogEntryResponse(
  entry: SkillCatalogEntry,
): SkillCatalogEntryResponse {
  return {
    name: entry.name,
    description: entry.description,
    proactive: entry.proactive,
    sourceDirectory: entry.sourceDirectory,
    skillDirectory: entry.skillDirectory,
    available: entry.available,
    diagnostics: [...entry.diagnostics],
  };
}
