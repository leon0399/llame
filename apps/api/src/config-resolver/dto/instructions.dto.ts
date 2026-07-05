import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

import { INSTRUCTIONS_MAX } from '../effective-config';

/**
 * PUT /api/v1/me/instructions body. A single scalar field on purpose — the
 * write path (`ConfigsRepository.setInstructions`) can structurally only touch
 * the `instructions` key, and the global ValidationPipe (`whitelist: true`)
 * strips any other property, so this surface can never write arbitrary config.
 * Empty string clears the user's instructions.
 */
export class UpdateInstructionsDto {
  @ApiProperty({
    maxLength: INSTRUCTIONS_MAX,
    description:
      "The user's custom instructions — free text that shapes the assistant's " +
      'tone/style across their chats. Non-authoritative: cannot override safety, ' +
      'tool-permission, or tenancy rules. Empty string clears it.',
  })
  @IsString()
  @MaxLength(INSTRUCTIONS_MAX)
  instructions!: string;
}

export class InstructionsResponse {
  @ApiProperty({
    maxLength: INSTRUCTIONS_MAX,
    description: "The user's current custom instructions ('' if none set).",
  })
  instructions!: string;
}
