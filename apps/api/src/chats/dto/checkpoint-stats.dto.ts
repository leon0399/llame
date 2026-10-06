import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  isNumber,
  isString,
  type UnknownRecord,
} from '@workspace/runtime-safety';

export class CheckpointStatsResponse {
  @ApiProperty({
    type: 'integer',
    nullable: true,
    description: "The checkpoint summarization call's input token count.",
  })
  beforeTokens!: number | null;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    description: "The checkpoint summarization call's output token count.",
  })
  afterTokens!: number | null;

  @ApiProperty({ type: String, nullable: true })
  modelId!: string | null;

  @ApiPropertyOptional({
    description: "The checkpoint summarization call's reasoning effort.",
  })
  effort?: string;
}

/** Derive owner-facing checkpoint stats from the row's stored usage record. */
export function toCheckpointStatsResponse(
  usage: UnknownRecord | null,
): CheckpointStatsResponse {
  const inputTokens = usage?.['inputTokens'];
  const outputTokens = usage?.['outputTokens'];
  const modelId = usage?.['modelId'];
  const effort = usage?.['effort'];

  return {
    beforeTokens: isNumber(inputTokens) ? inputTokens : null,
    afterTokens: isNumber(outputTokens) ? outputTokens : null,
    modelId: isString(modelId) ? modelId : null,
    ...(isString(effort) && { effort }),
  };
}
