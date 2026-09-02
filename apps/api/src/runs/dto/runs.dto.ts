import {
  ApiExtraModels,
  ApiProperty,
  ApiPropertyOptional,
  getSchemaPath,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';

import {
  modelContextPromptSource,
  runStatus,
  type ModelContextSnapshot,
  type Run,
  type RunStatus,
} from '../../db/schema';
import {
  parseToolAvailabilityManifest,
  TOOL_UNAVAILABLE_REASONS,
  TOOL_UNAVAILABLE_REASON_LABELS,
  type ToolUnavailableReason,
} from '../../tools/turn-tool-catalog';
import { type JsonSchemaDocument } from '../../tools/types';

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
  inputSchema!: JsonSchemaDocument;
}

export class ContextReceiptAvailableToolResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ['available'] })
  state!: 'available';

  @ApiProperty()
  declarationHash!: string;

  @ApiProperty({ enum: ['available'] })
  label!: 'available';
}

export class ContextReceiptUnavailableToolResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ['unavailable'] })
  state!: 'unavailable';

  @ApiProperty({ enum: TOOL_UNAVAILABLE_REASONS })
  reason!: ToolUnavailableReason;

  @ApiProperty()
  label!: string;
}

export class ContextReceiptUnobservedAvailabilityResponse {
  @ApiProperty({ enum: [0] })
  version!: 0;

  @ApiProperty({ enum: ['unobserved'] })
  state!: 'unobserved';
}

export class ContextReceiptObservedAvailabilityResponse {
  @ApiProperty({ enum: [1] })
  version!: 1;

  @ApiProperty({
    type: 'array',
    items: {
      oneOf: [
        { $ref: getSchemaPath(ContextReceiptAvailableToolResponse) },
        { $ref: getSchemaPath(ContextReceiptUnavailableToolResponse) },
      ],
    },
  })
  entries!: Array<
    ContextReceiptAvailableToolResponse | ContextReceiptUnavailableToolResponse
  >;
}

export type ContextReceiptToolAvailabilityResponse =
  | ContextReceiptUnobservedAvailabilityResponse
  | ContextReceiptObservedAvailabilityResponse;

@ApiExtraModels(
  ContextReceiptAvailableToolResponse,
  ContextReceiptUnavailableToolResponse,
  ContextReceiptUnobservedAvailabilityResponse,
  ContextReceiptObservedAvailabilityResponse,
)
export class ContextReceiptResponse {
  @ApiProperty({
    description: 'Public llame model id selected for this run.',
  })
  modelId!: string;

  @ApiPropertyOptional({
    description:
      'Reasoning effort this run executed at, resolved when the run was ' +
      'accepted. Absent when the run carried none. An opaque provider token — ' +
      'a receipt of what ran, never recomputed from current configuration.',
  })
  effort?: string;

  @ApiProperty({ enum: modelContextPromptSource.enumValues })
  promptSource!: (typeof modelContextPromptSource.enumValues)[number];

  @ApiProperty({
    description: 'Complete effective system prompt bound to this run.',
  })
  systemPrompt!: string;

  @ApiProperty({ type: () => [ContextReceiptToolResponse] })
  tools!: Array<ContextReceiptToolResponse>;

  @ApiProperty()
  availabilityHash!: string;

  @ApiProperty({
    oneOf: [
      { $ref: getSchemaPath(ContextReceiptUnobservedAvailabilityResponse) },
      { $ref: getSchemaPath(ContextReceiptObservedAvailabilityResponse) },
    ],
  })
  toolAvailability!: ContextReceiptToolAvailabilityResponse;

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
    ...(run.effort !== null && { effort: run.effort }),
    status: run.status,
    error: run.error ?? null,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  };
}

/** Maps a parsed manifest to its owner-receipt egress shape. */
function toToolAvailabilityResponse(
  availability: ReturnType<typeof parseToolAvailabilityManifest>,
): ContextReceiptToolAvailabilityResponse {
  if (availability.version === 0) {
    return { version: 0, state: 'unobserved' };
  }
  return {
    version: 1,
    entries: availability.entries.map((entry) =>
      entry.state === 'available'
        ? {
            id: entry.id,
            state: 'available',
            declarationHash: entry.declarationHash,
            label: 'available',
          }
        : {
            id: entry.id,
            state: 'unavailable',
            reason: entry.reason,
            label: TOOL_UNAVAILABLE_REASON_LABELS[entry.reason],
          },
    ),
  };
}

/** Explicit owner receipt allowlist: never serialize the raw run/snapshot. */
export function toContextReceiptResponse(
  run: Run,
  snapshot: ModelContextSnapshot,
): ContextReceiptResponse {
  const availability = parseToolAvailabilityManifest(
    snapshot.toolAvailabilityManifest,
  );
  return {
    modelId: run.modelId,
    // Sourced from the run, like `modelId` above — disclosure only: it does
    // not participate in the snapshot's content or availability hashes.
    ...(run.effort !== null && { effort: run.effort }),
    promptSource: snapshot.source,
    systemPrompt: snapshot.systemPrompt,
    tools: snapshot.toolDeclarations.map(
      ({ id, description, inputSchema }) => ({
        id,
        description,
        inputSchema,
      }),
    ),
    availabilityHash: snapshot.availabilityHash,
    toolAvailability: toToolAvailabilityResponse(availability),
    contentHash: snapshot.contentHash,
    createdAt: snapshot.createdAt,
  };
}
