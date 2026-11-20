import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

import { runStatus, type RunAwaiting, type RunStatus } from '../../db/schema';
import {
  toQuotaWaitResponse,
  QuotaWaitResponse,
} from '../../runs/dto/quota-wait.dto';

/**
 * Only `active` (non-terminal) runs are listed. Required — a missing/other value
 * is a 400, never a silent full history dump. `active` is the sole member today;
 * the enum leaves room to add filters without changing the shape.
 */
export class ActiveRunsQueryDto {
  @ApiProperty({ enum: ['active'] })
  @IsIn(['active'])
  status!: 'active';
}

/** One of the caller's in-flight runs (no `userId` — owner is implicit/self). */
export class ActiveRunResponse {
  @ApiProperty({ format: 'uuid' })
  runId!: string;

  @ApiProperty({ format: 'uuid' })
  chatId!: string;

  // Nullable: a chat's title is generated asynchronously (#78) and may still be
  // null when a run is active — see chats.title's own schema comment.
  @ApiProperty({ type: String, nullable: true })
  chatTitle!: string | null;

  @ApiProperty({ enum: runStatus.enumValues })
  status!: RunStatus;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: () => QuotaWaitResponse, nullable: true })
  quotaWait!: QuotaWaitResponse | null;
}

export function toActiveRunResponse(row: {
  id: string;
  chatId: string;
  chatTitle: string | null;
  status: RunStatus;
  createdAt: Date;
  awaiting: RunAwaiting | null;
}): ActiveRunResponse {
  return {
    runId: row.id,
    chatId: row.chatId,
    chatTitle: row.chatTitle,
    status: row.status,
    createdAt: row.createdAt,
    quotaWait: toQuotaWaitResponse(row.status, row.awaiting),
  };
}
