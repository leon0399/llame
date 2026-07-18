import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';

import {
  modelContextPromptSource,
  runStatus,
  type ModelContextSnapshot,
  type Run,
  type RunStatus,
} from '../../db/schema';

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

export class ContextReceiptToolResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty({ type: Object, additionalProperties: true })
  inputSchema!: Record<string, unknown>;
}

export class ContextReceiptResponse {
  @ApiProperty({
    description: 'Public llame model id selected for this run.',
  })
  modelId!: string;

  @ApiProperty({ enum: modelContextPromptSource.enumValues })
  promptSource!: (typeof modelContextPromptSource.enumValues)[number];

  @ApiProperty({
    description: 'Complete effective system prompt bound to this run.',
  })
  systemPrompt!: string;

  @ApiProperty({ type: () => [ContextReceiptToolResponse] })
  tools!: ContextReceiptToolResponse[];

  @ApiProperty()
  contentHash!: string;

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
    status: run.status,
    error: run.error ?? null,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  };
}

/** Explicit owner receipt allowlist: never serialize the raw run/snapshot. */
export function toContextReceiptResponse(
  run: Run,
  snapshot: ModelContextSnapshot,
): ContextReceiptResponse {
  return {
    modelId: run.modelId,
    promptSource: snapshot.source,
    systemPrompt: snapshot.systemPrompt,
    tools: snapshot.toolDeclarations.map(
      ({ id, description, inputSchema }) => ({
        id,
        description,
        inputSchema,
      }),
    ),
    contentHash: snapshot.contentHash,
    createdAt: snapshot.createdAt,
  };
}
