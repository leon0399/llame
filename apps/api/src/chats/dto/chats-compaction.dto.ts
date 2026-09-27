import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { Compaction } from '../../db/schema';
import { isNumber, isRecord, isString } from '@workspace/runtime-safety';
import type { TurnTelemetry } from '../turn-telemetry';

/**
 * Display-relevant subset of a compaction's `usage` (TurnTelemetry shape, the
 * SUMMARIZATION call's own token accounting — see turn-telemetry.ts) plus a
 * seq-derived message count. All fields are null-safe: older or seeded
 * compactions may carry no `usage` at all, or a partial shape, and the
 * absorbed-message count is independent of `usage` entirely (pure `uptoSeq`
 * arithmetic) so it can be present even when the rest is null. `beforeTokens`/
 * `afterTokens` are the summarization call's input/output token counts — the
 * size of what got absorbed vs. the size of the summary that replaced it, not
 * a literal "chat context size before/after" figure (that number isn't
 * persisted anywhere today).
 */
export class CompactionStatsResponse {
  @ApiProperty({
    type: 'integer',
    nullable: true,
    description:
      'Messages absorbed by this compaction (uptoSeq minus the previous ' +
      "compaction's uptoSeq, or uptoSeq itself for the first one).",
  })
  absorbedMessageCount!: number | null;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    description: "The summarization call's input token count.",
  })
  beforeTokens!: number | null;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    description: "The summarization call's output (summary) token count.",
  })
  afterTokens!: number | null;

  @ApiProperty({ type: String, nullable: true })
  modelId!: string | null;

  // Optional, not nullable — unlike the token counts beside it. The
  // reasoning-effort contract is absent-not-null on EVERY disclosure surface,
  // so a client reading a run, a receipt, and a compaction sees one shape for
  // one concept rather than three.
  @ApiPropertyOptional({
    description:
      'The effort this compaction call ran at — inherited from the run whose ' +
      'prompt prefix it reuses, so its cached prefix stays valid. Absent when ' +
      'that run carried none.',
  })
  effort?: string;
}

/**
 * The chat's LATEST compaction (#57) — embedded in `ChatMessagesResponse` (not
 * a separate endpoint, #136 read-side simplification) so the UI can mark where
 * older turns were folded into a summary for the model's context in the SAME
 * round trip as the messages themselves. `uptoSeq` is the boundary: messages
 * with `seq <= uptoSeq` are represented by the `summary`. Exposes only display
 * fields (no internal id/parentId).
 */
export class CompactionResponse {
  @ApiProperty({
    type: 'integer',
    format: 'int64',
    description: 'Messages with seq <= this were summarized for model context.',
  })
  uptoSeq!: number;

  @ApiProperty()
  summary!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: () => CompactionStatsResponse })
  stats!: CompactionStatsResponse;
}

export function toCompactionResponse(
  compaction: Compaction,
  absorbedMessageCount: number | null,
): CompactionResponse {
  // SAFETY: `usage` is untyped jsonb (no `.$type<>()` on the schema column) —
  // narrow defensively rather than trust the shape; a malformed/foreign value
  // degrades to "no stats" instead of throwing.
  const usage = isRecord(compaction.usage)
    ? (compaction.usage as Partial<TurnTelemetry>)
    : null;

  return {
    uptoSeq: compaction.uptoSeq,
    summary: compaction.summary,
    createdAt: compaction.createdAt,
    stats: {
      absorbedMessageCount,
      beforeTokens: isNumber(usage?.inputTokens) ? usage.inputTokens : null,
      afterTokens: isNumber(usage?.outputTokens) ? usage.outputTokens : null,
      modelId: isString(usage?.modelId) ? usage.modelId : null,
      ...(isString(usage?.effort) && { effort: usage.effort }),
    },
  };
}
