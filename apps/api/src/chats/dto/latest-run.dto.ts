import { ApiProperty } from '@nestjs/swagger';

import {
  followUpActions,
  runStatus,
  type FollowUpAction,
  type Run,
  type RunStatus,
} from '../../db/schema';
import {
  PERMISSION_MODES,
  type PermissionMode,
} from '../../tools/permissions/permission-mode';

/**
 * The Chat's newest Run, reported by its history read (turn-actions D12): the
 * Run the follow-up actions judge and the accepted settings it records.
 */
export class ChatLatestRunResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'The user message this Run executes.',
  })
  messageId!: string | null;

  @ApiProperty({ enum: [...runStatus.enumValues] })
  status!: RunStatus;

  @ApiProperty({
    type: String,
    nullable: true,
    enum: [...followUpActions],
    description:
      'The follow-up action that started this Run, or null for a chat send.',
  })
  followUpAction!: FollowUpAction | null;

  @ApiProperty()
  modelId!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The effort the Run executes with; null sends no effort.',
  })
  effort!: string | null;

  @ApiProperty({ enum: [...PERMISSION_MODES] })
  permissionMode!: PermissionMode;
}

export function toChatLatestRunResponse(run: Run): ChatLatestRunResponse {
  return {
    id: run.id,
    messageId: run.messageId,
    status: run.status,
    followUpAction: run.followUpAction,
    modelId: run.modelId,
    effort: run.effort,
    permissionMode: run.permissionMode,
  };
}
