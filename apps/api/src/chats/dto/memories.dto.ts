import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

import { MEMORY_CONTENT_MAX, type Memory } from '../../db/schema';
import { type MemorySource } from '../memories-repository';

/** Trim a string value; anything else passes through for @IsString to reject. */
function trimIfString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/**
 * POST /api/v1/me/memories body. Content only — `source` is HARDCODED to
 * `'user'` server-side (the client can never set it, so agent-provenance can't
 * be spoofed; only `source='user'` memories are auto-injected into the prompt).
 *
 * `@Transform` trims BEFORE `@MinLength` runs (the global ValidationPipe's
 * `transform: true` applies class-transformer first) — otherwise a
 * whitespace-only body passes `@MinLength(1)` on the untrimmed value and
 * fails later at the DB CHECK constraint as an unhandled 500 instead of a
 * clean 400 here.
 */
export class CreateMemoryDto {
  @ApiProperty({ minLength: 1, maxLength: MEMORY_CONTENT_MAX })
  @Transform(({ value }) => trimIfString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(MEMORY_CONTENT_MAX)
  content!: string;
}

export class MemoryResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ maxLength: MEMORY_CONTENT_MAX })
  content!: string;

  @ApiProperty({
    enum: ['user', 'agent'],
    description:
      "Who created it: 'user' (typed in the management UI, auto-injected into " +
      "chats) or 'agent' (saved by the assistant, recall-only).",
  })
  source!: MemorySource;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

/** Egress allowlist — never spread a raw row. */
export function toMemoryResponse(memory: Memory): MemoryResponse {
  return {
    id: memory.id,
    content: memory.content,
    source: memory.source,
    createdAt: memory.createdAt.toISOString(),
  };
}
