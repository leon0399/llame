import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, ValidateIf } from 'class-validator';

import { type ResolvedMemorySettings } from '../memory.service';

/**
 * PATCH /api/v1/me/memory — partial update of the caller's own memory settings.
 *
 * There is deliberately no `userId`: ownership comes only from the verified
 * session, so client input has no way to select another tenant's row.
 */
export class UpdateMemoryDto {
  @ApiPropertyOptional({
    description:
      "Share titles and opening excerpts from your other chats with the model provider configured by the operator, which on a multi-user instance may be a third party with no relationship to you. Enabling is retroactive over your whole existing corpus, including chats and opening excerpts created long before opt-in. Disabling is not retroactive: it stops new baselines, re-bakes, and appends, but chats with an existing baseline keep sending it. Deleting a chat is not erasure: its title and excerpt survive in other chats' already-bound prompts, persisted appends, and receipts already issued. Defaults to false.",
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  shareRecentChats?: boolean;
}

/** Egress allowlist: the owner-controlled setting and nothing server-only. */
export class MemoryResponse {
  @ApiProperty()
  shareRecentChats!: boolean;
}

export function toMemoryResponse(
  settings: ResolvedMemorySettings,
): MemoryResponse {
  return { shareRecentChats: settings.shareRecentChats };
}
