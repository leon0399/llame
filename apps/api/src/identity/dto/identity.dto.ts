import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

import {
  orgRole,
  type Membership,
  type OrgRole,
  type OrgUnit,
  type OrgUnitType,
} from '../../db/schema';

const ORG_UNIT_TYPES = [
  'organization',
  'group',
  'team',
  'department',
  'project',
] as const satisfies readonly OrgUnitType[];

/** Full SPEC §7.3 role vocabulary, for response payloads. */
const ORG_ROLES = orgRole.enumValues;

/**
 * Grantable/settable via HTTP (D3): every role EXCEPT `service_account` (no
 * HTTP surface for that yet — #160/channels). `owner` IS included — the
 * datastore (not this DTO) gates it to owner-tier callers via
 * `memberships_insert`/`_update`'s owner-tier branch; a non-owner caller
 * gets a 403 from RLS, not a DTO-level 400.
 */
const GRANTABLE_ROLES = ORG_ROLES.filter((role) => role !== 'service_account');

/** `POST /org-units` and `POST /org-units/:id/children` body. */
export class CreateOrgUnitDto {
  @ApiProperty({ minLength: 1, maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @Matches(/\S/, { message: 'name must not be blank' })
  name!: string;

  @ApiPropertyOptional({ enum: ORG_UNIT_TYPES })
  @IsOptional()
  @IsIn(ORG_UNIT_TYPES)
  type?: OrgUnitType;
}

/**
 * `POST /org-units/:id/memberships` body (D3 widened this from { admin, member }
 * to every non-service_account role, `owner` included — see `GRANTABLE_ROLES`).
 */
export class GrantMembershipDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  userId!: string;

  @ApiProperty({ enum: GRANTABLE_ROLES })
  @IsIn(GRANTABLE_ROLES)
  role!: (typeof GRANTABLE_ROLES)[number];
}

/** `PATCH /org-units/:id/memberships/:userId` body (D3 — same grantable set as POST). */
export class ChangeMembershipRoleDto {
  @ApiProperty({ enum: GRANTABLE_ROLES })
  @IsIn(GRANTABLE_ROLES)
  role!: (typeof GRANTABLE_ROLES)[number];
}

/**
 * `PATCH /org-units/:id` body (D5): rename, replace settings, and/or move —
 * all optional, only the fields present are applied.
 *
 * `parentId` distinguishes THREE states, not two: absent (no move), an
 * explicit `null` (move to root), and a unit id (move under that parent).
 * `ValidateIf` — not `IsOptional` — for `name`/`settings` too: `IsOptional`
 * would wave an explicit `null` through unvalidated (same reasoning as
 * `UpdateChatDto`), and neither field has a sensible null-means-something
 * meaning here (unlike `parentId`).
 */
export class UpdateOrgUnitDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 200 })
  @ValidateIf((o: UpdateOrgUnitDto) => o.name !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @Matches(/\S/, { message: 'name must not be blank' })
  name?: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description:
      'Opaque node-scoped settings (SPEC §7.2); replaces the whole object. Interpretation is the config resolver’s job (#46).',
  })
  @ValidateIf((o: UpdateOrgUnitDto) => o.settings !== undefined)
  @IsObject()
  settings?: Record<string, unknown>;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'Move under this parent id. Explicit null promotes the unit to root. Omit to leave the unit where it is.',
  })
  @ValidateIf(
    (o: UpdateOrgUnitDto) => o.parentId !== undefined && o.parentId !== null,
  )
  @IsUUID()
  parentId?: string | null;
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

  @ApiProperty({ type: 'object', additionalProperties: true })
  settings!: Record<string, unknown>;

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
    settings: unit.settings as Record<string, unknown>,
    createdAt: unit.createdAt,
  };
}

export class MembershipResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty({ format: 'uuid' })
  orgUnitId!: string;

  @ApiProperty({ enum: ORG_ROLES })
  role!: OrgRole;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
}

export function toMembershipResponse(
  membership: Membership,
): MembershipResponse {
  return {
    id: membership.id,
    userId: membership.userId,
    orgUnitId: membership.orgUnitId,
    role: membership.role,
    createdAt: membership.createdAt,
  };
}

/** `GET /org-units/:id/memberships/me` response — nearest-wins effective role. */
export class EffectiveRoleResponse {
  @ApiProperty({ enum: ORG_ROLES })
  role!: OrgRole;

  @ApiProperty({ format: 'uuid', description: 'The unit supplying the role.' })
  viaOrgUnitId!: string;

  @ApiProperty({
    description:
      'True when the role comes from an ancestor, not the unit itself.',
  })
  inherited!: boolean;
}
