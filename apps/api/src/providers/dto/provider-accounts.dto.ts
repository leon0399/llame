import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';

import { type ProviderAccount, providerType } from '../../db/schema';

export class CreateProviderAccountDto {
  @ApiProperty({ enum: providerType.enumValues })
  @IsIn(providerType.enumValues)
  providerType!: (typeof providerType.enumValues)[number];

  @ApiProperty({ maxLength: 120, example: 'My OpenRouter' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  displayName!: string;

  /**
   * WRITE-ONLY (#18 acceptance: secrets never appear in responses, logs, or
   * OpenAPI examples). Encrypted at rest immediately; there is no read-back.
   */
  @ApiHideProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  apiKey!: string;

  @ApiProperty({
    required: false,
    example: 'https://openrouter.ai/api/v1',
    description: 'OpenAI-compatible base URL; empty = api.openai.com',
  })
  @IsOptional()
  @IsUrl({ require_tld: false, protocols: ['http', 'https'] })
  baseUrl?: string;

  @ApiProperty({ required: false, description: 'Preferred model id' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  defaultModel?: string;
}

/** Egress allowlist — no credential-derived data whatsoever. */
export class ProviderAccountResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: providerType.enumValues })
  providerType!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty()
  authMode!: string;

  @ApiProperty({ type: String, nullable: true })
  baseUrl!: string | null;

  @ApiProperty({ type: String, nullable: true })
  defaultModel!: string | null;

  @ApiProperty()
  enabled!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
}

export function toProviderAccountResponse(
  account: ProviderAccount,
): ProviderAccountResponse {
  return {
    id: account.id,
    providerType: account.providerType,
    displayName: account.displayName,
    authMode: account.authMode,
    baseUrl: account.baseUrl,
    defaultModel: account.defaultModel,
    enabled: account.enabled,
    createdAt: account.createdAt,
  };
}
