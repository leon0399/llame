import { ApiProperty } from '@nestjs/swagger';

import { type AvailableModel } from '../models.service';

/** One selectable model in the caller's available set (#76). */
export class AvailableModelResponse {
  @ApiProperty({ example: 'openai/gpt-5.4-mini' })
  id!: string;

  @ApiProperty({ description: 'Human label for the chat selector' })
  label!: string;

  @ApiProperty({ example: 'openrouter' })
  providerType!: string;

  @ApiProperty({ enum: ['byok', 'instance'] })
  source!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Owning provider account; null for the instance-env model',
  })
  providerAccountId!: string | null;
}

export function toAvailableModelResponse(
  model: AvailableModel,
): AvailableModelResponse {
  return {
    id: model.id,
    label: model.label,
    providerType: model.providerType,
    source: model.source,
    providerAccountId: model.providerAccountId,
  };
}
