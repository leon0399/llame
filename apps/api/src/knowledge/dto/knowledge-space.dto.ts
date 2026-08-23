import { ApiProperty } from '@nestjs/swagger';

import { KNOWLEDGE_SPACE_UNAVAILABLE } from '../knowledge-space.local-resolver';
import type { KnowledgeSpaceLogicalProjection } from '../knowledge-space.repository';

export class KnowledgeSpaceResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;
}

export class KnowledgeSpaceUnavailableResponse {
  @ApiProperty()
  statusCode!: number;

  @ApiProperty()
  error!: string;

  @ApiProperty({ enum: [KNOWLEDGE_SPACE_UNAVAILABLE] })
  code!: typeof KNOWLEDGE_SPACE_UNAVAILABLE;

  @ApiProperty()
  message!: string;
}

export function toKnowledgeSpaceResponse(
  projection: KnowledgeSpaceLogicalProjection,
): KnowledgeSpaceResponse {
  return { id: projection.id };
}
