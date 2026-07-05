import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

import { type OrgUnit, type OrgUnitType } from '../../db/schema';

const ORG_UNIT_TYPES = [
  'organization',
  'group',
  'team',
  'department',
  'project',
] as const satisfies readonly OrgUnitType[];

/** `POST /org-units` and `POST /org-units/:id/children` body. */
export class CreateOrgUnitDto {
  @ApiProperty({ minLength: 1, maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ enum: ORG_UNIT_TYPES })
  @IsOptional()
  @IsIn(ORG_UNIT_TYPES)
  type?: OrgUnitType;
}

/**
 * `POST /org-units/:id/memberships` body. The role enum is DELIBERATELY limited to
 * { admin, member } — `owner` is assigned only at unit creation, so this surface
 * can never mint or escalate to owner (the safe sidestep of the owner-tier gap).
 */
export class GrantMembershipDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  userId!: string;

  @ApiProperty({ enum: ['admin', 'member'] })
  @IsIn(['admin', 'member'])
  role!: 'admin' | 'member';
}

export class OrgUnitResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, nullable: true })
  parentId!: string | null;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: ORG_UNIT_TYPES })
  type!: OrgUnitType;

  @ApiProperty({ description: 'Materialized id-path (root/child/…).' })
  path!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
}

export function toOrgUnitResponse(unit: OrgUnit): OrgUnitResponse {
  return {
    id: unit.id,
    parentId: unit.parentId,
    name: unit.name,
    type: unit.type,
    path: unit.path,
    createdAt: unit.createdAt,
  };
}
