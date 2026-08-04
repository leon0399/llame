import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import type { Personalization } from '../../db/schema';
import { PERSONALIZATION_CAPS } from '../personalization.constants';

/**
 * PATCH /api/v1/me/personalization — partial update of the caller's own
 * profile.
 *
 * Every text field is nullable on purpose, and the two absence cases mean
 * different things: an OMITTED key leaves the stored value untouched, while an
 * explicit `null` clears it. `@IsOptional()` (not `ValidateIf`) is correct here
 * precisely because null IS a valid value for these columns — unlike
 * `UpdateProjectDto.name`, which is NOT NULL and must reject it.
 *
 * There is no `userId` field, and there must never be one: the owner comes from
 * the authenticated session. Accepting one from the body would recreate the #61
 * tenant-impersonation IDOR.
 */
export class UpdatePersonalizationDto {
  @ApiPropertyOptional({
    maxLength: PERSONALIZATION_CAPS.preferredName,
    nullable: true,
    description: 'What the assistant should call you. Null clears it.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(PERSONALIZATION_CAPS.preferredName)
  preferredName?: string | null;

  @ApiPropertyOptional({
    maxLength: PERSONALIZATION_CAPS.about,
    nullable: true,
    description:
      'Role, work context, and languages, as prose. Null clears it. Counts against every request for you, so a maxed-out value is a material share of a small model context window.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(PERSONALIZATION_CAPS.about)
  about?: string | null;

  @ApiPropertyOptional({
    maxLength: PERSONALIZATION_CAPS.responsePreferences,
    nullable: true,
    description:
      'How answers should be delivered. Null clears it. These are delivery preferences of bounded authority: they cannot grant tools, relax tool authorization, or override safety constraints.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(PERSONALIZATION_CAPS.responsePreferences)
  responsePreferences?: string | null;

  @ApiPropertyOptional({
    description:
      'Master switch over all per-user prompt context. Turning it off also stops account identity, not just authored text.',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    description:
      'Send your account display name and email address to the model provider the operator has configured — which in a multi-user instance may be a third party with no relationship to you. Defaults to false, and applies only where the configured prompt references those values.',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  shareAccountIdentity?: boolean;
}

/** Egress allowlist: stored fields and both toggles, nothing server-only. */
export class PersonalizationResponse {
  @ApiProperty({ type: String, nullable: true })
  preferredName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  about!: string | null;

  @ApiProperty({ type: String, nullable: true })
  responsePreferences!: string | null;

  @ApiProperty()
  enabled!: boolean;

  @ApiProperty()
  shareAccountIdentity!: boolean;
}

/**
 * An owner who has never written a profile gets the column defaults rather than
 * a 404: "no row" is a valid state meaning "nothing authored", and it must be
 * indistinguishable from an empty row — including here, so a client never has
 * to special-case first use.
 */
export function toPersonalizationResponse(
  personalization: Personalization | undefined,
): PersonalizationResponse {
  return {
    preferredName: personalization?.preferredName ?? null,
    about: personalization?.about ?? null,
    responsePreferences: personalization?.responsePreferences ?? null,
    enabled: personalization?.enabled ?? true,
    shareAccountIdentity: personalization?.shareAccountIdentity ?? false,
  };
}
