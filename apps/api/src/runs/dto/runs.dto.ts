import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';

import {
  modelContextPromptSource,
  runKinds,
  runStatus,
  type Run,
  type RunEvent,
  type RunKind,
  type RunStatus,
  type SystemPromptReceipt,
} from '../../db/schema';
import { eventPayloadString } from '../run-event-payload';
import {
  PERMISSION_MODES,
  type PermissionMode,
} from '../../tools/permissions/permission-mode';
import { toQuotaWaitResponse, QuotaWaitResponse } from './quota-wait.dto';
import { isTerminalRunStatus } from '../run-status';

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

  @ApiProperty({ enum: runKinds })
  kind!: RunKind;

  @ApiProperty({
    description:
      'The `@role` or model id the Run recorded when it was admitted.',
  })
  selector!: string;

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

  @ApiProperty({ type: () => QuotaWaitResponse, nullable: true })
  quotaWait!: QuotaWaitResponse | null;

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

  @ApiProperty({
    description:
      'Public llame model id this attempt requested, read from its ' +
      '`model.requested` event. A switch between attempts shows here even ' +
      "though the Run row only names its current segment's model. An attempt " +
      "without that event falls back to the Run's current model.",
  })
  modelId!: string;

  @ApiPropertyOptional({
    description:
      'Reasoning effort this attempt requested. Absent when the attempt ' +
      'carried none; an attempt without a `model.requested` event falls back ' +
      "to the Run's current effort with its model.",
  })
  effort?: string;

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
    description:
      "Public llame model id of the Run's current segment. Each attempt " +
      'receipt names the model that attempt requested.',
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
    kind: run.kind,
    selector: run.selector,
    modelId: run.modelId,
    permissionMode: run.permissionMode,
    ...(run.effort !== null && { effort: run.effort }),
    status: run.status,
    error: run.error,
    quotaWait: toQuotaWaitResponse(run.status, run.awaiting),
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  };
}

/** One attempt's requested model, read from its `model.requested` event. */
export type AttemptModelSelection = {
  attemptId: string;
  modelId: string;
  effort?: string;
};

/** Reads the model each attempt requested from its `model.requested` event
 *  (`{ modelId, effort?, attemptId }`). A malformed or legacy payload
 *  contributes nothing; the receipt then falls back to the Run's model and
 *  effort. */
export function attemptModelSelections(
  events: ReadonlyArray<Pick<RunEvent, 'payload'>>,
): Array<AttemptModelSelection> {
  return events.flatMap((event) => {
    const attemptId = eventPayloadString(event.payload, 'attemptId');
    const modelId = eventPayloadString(event.payload, 'modelId');
    const effort = eventPayloadString(event.payload, 'effort');

    if (attemptId === undefined || modelId === undefined) return [];

    return [{ attemptId, modelId, ...(effort !== undefined && { effort }) }];
  });
}

/** One stored system-prompt receipt as the receipt response reads it. */
type ReceiptRow = Pick<
  SystemPromptReceipt,
  'attemptId' | 'source' | 'systemPrompt' | 'promptHash' | 'createdAt'
>;

/** Maps a run, its attempt receipts, and each attempt's requested model to
 *  the owner-receipt egress shape. */
export function toContextReceiptResponse(
  run: Run,
  receipts: ReadonlyArray<ReceiptRow>,
  attemptSelections: ReadonlyArray<AttemptModelSelection>,
): ContextReceiptResponse {
  const isTerminal = isTerminalRunStatus(run.status);

  const state =
    receipts.length > 0 ? 'prepared' : isTerminal ? 'not_produced' : 'pending';

  const requestedByAttempt = new Map(
    attemptSelections.map((selection) => [selection.attemptId, selection]),
  );

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
    receipts: receipts.map((receipt) => {
      const requested = requestedByAttempt.get(receipt.attemptId);

      // A receipt published before its attempt's dispatch event has no
      // `model.requested` row yet: the Run's own pair is then the attempt's,
      // so a card never names one model with another attempt's effort.
      const modelId = requested?.modelId ?? run.modelId;

      const effort =
        requested === undefined ? (run.effort ?? undefined) : requested.effort;

      return {
        attemptId: receipt.attemptId,
        modelId,
        ...(effort !== undefined && { effort }),
        promptSource: receipt.source,
        systemPrompt: receipt.systemPrompt,
        promptHash: receipt.promptHash,
        createdAt: receipt.createdAt,
      };
    }),
    createdAt: run.createdAt,
  };
}
