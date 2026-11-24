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
    description: `Share your other Chats' titles, activity dates, message counts, chat:// locators, canonical Workspace roots or unbound state, and bounded opening and latest visible-text excerpts with the model provider configured by the operator. \
The latest excerpt can include assistant text. In a multi-user instance, the provider may be a third party with no relationship to you. \
Enabling is retroactive over your existing eligible Chats. \
Disabling stops new baselines, refreshes, and notices, but existing baseline items continue to replay, including through compaction. \
Deleting a source Chat does not erase its disclosure from other Chats' persisted context items or historical receipts. Defaults to false.`,
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
