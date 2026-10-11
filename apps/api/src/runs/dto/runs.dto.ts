import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';

import {
  modelContextPromptSource,
  runStatus,
  type Run,
  type RunStatus,
} from '../../db/schema';
import {
  PERMISSION_MODES,
  type PermissionMode,
} from '../../tools/permissions/permission-mode';

/** Query for the run-event replay cursor (SPEC §9.4). */
export class ListRunEventsQuery {
  @ApiPropertyOptional({
    name: 'after_sequence',
    description:
      'Replay strictly after this event sequence (the SSE `id:` of the last event seen).',
    type: Number,
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  after_sequence?: number;
}

/**
 * PATCH /runs/:id body (#48). Cancellation is the only client-writable state
 * transition; the enum widens if that ever changes (house rule: resource
 * PATCH, not RPC verb handles).
 */
export class UpdateRunDto {
  @ApiProperty({ enum: ['cancelled'] })
  @IsIn(['cancelled'])
  status!: 'cancelled';
}

export class RunResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  chatId!: string;

  @ApiProperty({ format: 'uuid', type: String, nullable: true })
  messageId!: string | null;

  @ApiProperty()
  modelId!: string;

  @ApiPropertyOptional({
    description:
      'Reasoning effort this run executed at, resolved when the run was ' +
      'accepted. Absent when the run carried none. An opaque provider token — ' +
      'a receipt of what ran, never recomputed from current configuration.',
  })
  effort?: string;

  @ApiProperty({
    enum: PERMISSION_MODES,
    description: 'Accepted permission mode for this run.',
  })
  permissionMode!: PermissionMode;

  @ApiProperty({ enum: runStatus.enumValues })
  status!: RunStatus;

  @ApiProperty({ type: Object, nullable: true })
  error!: unknown;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time', type: Date, nullable: true })
  startedAt!: Date | null;

  @ApiProperty({ format: 'date-time', type: Date, nullable: true })
  finishedAt!: Date | null;
}
/** A single system-prompt receipt for one execution attempt. */
export class AttemptReceiptResponse {
  @ApiProperty({ description: 'Attempt identity.' })
  attemptId!: string;

  @ApiProperty({ enum: modelContextPromptSource.enumValues })
  promptSource!: (typeof modelContextPromptSource.enumValues)[number];

  @ApiProperty({
    description: 'Complete effective system prompt rendered for this attempt.',
  })
  systemPrompt!: string;

  @ApiProperty({ description: 'Hash of the rendered system prompt.' })
  promptHash!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
}

/**
 * System-only receipt response for a run: resolution state plus an ordered
 * list of per-attempt receipts. No tool declarations, schemas, descriptions,
 * or availability manifests are exposed.
 */
export class ContextReceiptResponse {
  @ApiProperty({
    description: 'Public llame model id selected for this run.',
  })
  modelId!: string;

  @ApiPropertyOptional({
    description:
      'Reasoning effort this run executed at, resolved when the run was ' +
      'accepted. Absent when the run carried none.',
  })
  effort?: string;

  @ApiProperty({
    enum: PERMISSION_MODES,
    description: 'Accepted permission mode for this run.',
  })
  permissionMode!: PermissionMode;

  @ApiPropertyOptional({
    description: 'Active execution attempt identity, if any.',
  })
  activeAttemptId?: string;

  @ApiPropertyOptional({
    description:
      'Completed (winning) attempt identity, if the run completed successfully.',
  })
  completedAttemptId?: string;

  @ApiProperty({
    enum: ['pending', 'prepared', 'not_produced'],
    description:
      'Resolution state: pending (queued, no attempt prepared yet), ' +
      'prepared (at least one attempt has a receipt), or not_produced ' +
      '(terminal without any receipt).',
  })
  state!: 'pending' | 'prepared' | 'not_produced';

  @ApiProperty({
    type: () => [AttemptReceiptResponse],
    description:
      'Ordered list of system-prompt receipts, one per execution attempt ' +
      'that reached prompt preparation. Earliest first.',
  })
  receipts!: Array<AttemptReceiptResponse>;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
}

/** Explicit egress allowlist (mirror toPublicUser) — never return the raw row. */
export function toRunResponse(run: Run): RunResponse {
  return {
    id: run.id,
    chatId: run.chatId,
    messageId: run.messageId,
    modelId: run.modelId,
    permissionMode: run.permissionMode,
    ...(run.effort !== null && { effort: run.effort }),
    status: run.status,
    error: run.error,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  };
}

/** Maps a run and its attempt receipts to the owner-receipt egress shape. */
export function toContextReceiptResponse(
  run: Run,
  receipts: Array<{
    attemptId: string;
    source: (typeof modelContextPromptSource.enumValues)[number];
    systemPrompt: string;
    promptHash: string;
    createdAt: Date;
  }>,
): ContextReceiptResponse {
  const isTerminal = ['completed', 'failed', 'cancelled', 'expired'].includes(
    run.status,
  );
  const state =
    receipts.length > 0 ? 'prepared' : isTerminal ? 'not_produced' : 'pending';

  return {
    modelId: run.modelId,
    permissionMode: run.permissionMode,
    ...(run.effort !== null && { effort: run.effort }),
    ...(run.activeAttemptId !== null && {
      activeAttemptId: run.activeAttemptId,
    }),
    ...(run.completedAttemptId !== null && {
      completedAttemptId: run.completedAttemptId,
    }),
    state,
    receipts: receipts.map((r) => ({
      attemptId: r.attemptId,
      promptSource: r.source,
      systemPrompt: r.systemPrompt,
      promptHash: r.promptHash,
      createdAt: r.createdAt,
    })),
    createdAt: run.createdAt,
  };
}
