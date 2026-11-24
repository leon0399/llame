/**
 * The follow-up request body (`POST
 * /chats/:chatId/messages/:userMessageId/runs`), one variant per action: each
 * declares the fields its action accepts and nothing else, so the published
 * schema and the runtime agree on which body is a valid request.
 */

import {
  ApiProperty,
  ApiPropertyOptional,
  getSchemaPath,
} from '@nestjs/swagger';
import { IsIn, IsString, Matches, ValidateIf } from 'class-validator';

import {
  PERMISSION_MODES,
  type PermissionMode,
} from '../../tools/permissions/permission-mode';

/**
 * `POST /chats/:chatId/messages/:userMessageId/runs` body for `continue`: it
 * resumes the completed steps of a failed, cancelled, or expired Run and takes
 * the model and the effort from that Run, so the schema has no field to send
 * either. A body that names one is not this variant, and the global validation
 * pipe rejects the unknown property.
 */
export class ContinueFollowUpRunDto {
  @ApiProperty({
    enum: ['continue'],
    description:
      'Resume the completed steps of the latest Run and request its next step.',
  })
  @IsIn(['continue'])
  action!: 'continue';

  // ValidateIf (not IsOptional), for the reason `CreateMessageDto` states: an
  // explicit null is malformed, while absence is the only "not sent".
  @ApiPropertyOptional({
    enum: PERMISSION_MODES,
    description: 'Permission mode for this Run; omit for default.',
  })
  @ValidateIf((o: ContinueFollowUpRunDto) => o.permissionMode !== undefined)
  @IsIn(PERMISSION_MODES)
  permissionMode?: PermissionMode;
}

/**
 * `POST /chats/:chatId/messages/:userMessageId/runs` body for `regenerate`: it
 * discards the turn's answer and asks the model again from the user message, so
 * it may name the selector the new Run uses, and the effort and the permission
 * mode it should apply.
 */
export class RegenerateFollowUpRunDto {
  @ApiProperty({
    enum: ['regenerate'],
    description:
      "Discard the turn's answer and request a new one from the user message.",
  })
  @IsIn(['regenerate'])
  action!: 'regenerate';

  // Optional, unlike the chat-send selector at first glance: an omitted
  // selector resolves through the Chat's stored selection, then the configured
  // default — a Regenerate picks the answer apart, not the model.
  @ApiPropertyOptional({
    description:
      "`@role` or a model id; omit to use the Chat's stored selection",
    pattern: '\\S',
  })
  @ValidateIf((o: RegenerateFollowUpRunDto) => o.selector !== undefined)
  @IsString()
  @Matches(/\S/, { message: 'selector must not be blank' })
  selector?: string;

  @ApiPropertyOptional({
    pattern: '\\S',
    description:
      "Reasoning effort for the regenerated Run, from the selected model's " +
      'declared levels.',
  })
  @ValidateIf((o: RegenerateFollowUpRunDto) => o.effort !== undefined)
  @IsString()
  @Matches(/\S/, { message: 'effort must not be blank' })
  effort?: string;

  @ApiPropertyOptional({
    enum: PERMISSION_MODES,
    description: 'Permission mode for this Run; omit for default.',
  })
  @ValidateIf((o: RegenerateFollowUpRunDto) => o.permissionMode !== undefined)
  @IsIn(PERMISSION_MODES)
  permissionMode?: PermissionMode;
}

/**
 * Every follow-up request body, discriminated by `action`. Each variant
 * declares the fields its action accepts and nothing else.
 */
export type CreateFollowUpRunDto =
  | ContinueFollowUpRunDto
  | RegenerateFollowUpRunDto;

/**
 * The follow-up request body as a discriminated union on `action`: each variant
 * declares only the fields its action accepts, so a schema-valid `continue`
 * never carries a selector or an effort, and a schema-valid `regenerate` may
 * name a selector, an effort, and a mode. A further action adds its variant to
 * the same `oneOf` and its own `mapping` entry.
 */
export function followUpRunBodySchema() {
  return {
    oneOf: [
      { $ref: getSchemaPath(ContinueFollowUpRunDto) },
      { $ref: getSchemaPath(RegenerateFollowUpRunDto) },
    ],
    discriminator: {
      propertyName: 'action',
      mapping: {
        continue: getSchemaPath(ContinueFollowUpRunDto),
        regenerate: getSchemaPath(RegenerateFollowUpRunDto),
      },
    },
  };
}
