import { ApiProperty } from '@nestjs/swagger';
import { isRecord, isString } from '@workspace/runtime-safety';

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

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The terminal message of a failed or expired Run, the same text its ' +
      'stream error frame carries; null for any other Run or none recorded.',
  })
  error!: string | null;
}

/** The message a failed or expired Run's stream sent in its `error` frame, or
 *  null: a cancelled Run's stream sends none, though the row records why. */
function runErrorMessage(run: Run): string | null {
  if (run.status !== 'failed' && run.status !== 'expired') return null;
  if (!isRecord(run.error)) return null;
  const message = run.error['message'];
  return isString(message) ? message : null;
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
    error: runErrorMessage(run),
  };
}
