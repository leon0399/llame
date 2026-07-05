import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

import { MEMORY_CONTENT_MAX, type Memory } from '../../db/schema';
import { type MemorySource } from '../memories-repository';

/**
 * POST /api/v1/me/memories body. Content only — `source` is HARDCODED to
 * `'user'` server-side (the client can never set it, so agent-provenance can't
 * be spoofed; only `source='user'` memories are auto-injected into the prompt).
 */
export class CreateMemoryDto {
  @ApiProperty({ minLength: 1, maxLength: MEMORY_CONTENT_MAX })
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
