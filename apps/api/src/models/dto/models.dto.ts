import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import type {
  ModelPricingUsdPer1M,
  ModelSource,
  PublicModelCatalogEntry,
} from '../model-catalog';

export class ModelPricingResponse {
  @ApiPropertyOptional()
  input?: number;

  @ApiPropertyOptional()
  cachedInput?: number;

  @ApiPropertyOptional()
  output?: number;
}

export class AvailableModelResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ['system'] })
  source!: ModelSource;

  @ApiPropertyOptional()
  name?: string;

  @ApiPropertyOptional()
  description?: string;

  @ApiPropertyOptional({ type: [String] })
  tags?: string[];

  @ApiPropertyOptional()
  icon?: string;

  @ApiProperty({ type: 'integer' })
  contextWindowTokens!: number;

  @ApiPropertyOptional({ type: () => ModelPricingResponse })
  pricingUsdPer1M?: ModelPricingUsdPer1M;

  @ApiPropertyOptional()
  knowledgeCutoff?: string;

  @ApiPropertyOptional()
  reasoning?: boolean;

  @ApiPropertyOptional()
  website?: string;

  @ApiPropertyOptional()
  apiDocs?: string;

  @ApiPropertyOptional()
  modelPage?: string;

  @ApiPropertyOptional()
  releasedAt?: string;
}

export class ModelsResponse {
  @ApiProperty()
  defaultModelId!: string;

  @ApiProperty({ type: () => [AvailableModelResponse] })
  models!: AvailableModelResponse[];
}

export class ModelDomainErrorResponse {
  @ApiProperty()
  statusCode!: number;

  @ApiProperty()
  error!: string;

  @ApiProperty()
  message!: string;

  @ApiProperty()
  code!: string;
}

export function toAvailableModelResponse(
  model: PublicModelCatalogEntry,
): AvailableModelResponse {
  return {
    id: model.id,
    source: model.source,
    ...(model.name !== undefined ? { name: model.name } : {}),
    ...(model.description !== undefined
      ? { description: model.description }
      : {}),
    ...(model.tags !== undefined ? { tags: [...model.tags] } : {}),
    ...(model.icon !== undefined ? { icon: model.icon } : {}),
    contextWindowTokens: model.contextWindowTokens,
    ...(model.pricingUsdPer1M !== undefined
      ? { pricingUsdPer1M: model.pricingUsdPer1M }
      : {}),
    ...(model.knowledgeCutoff !== undefined
      ? { knowledgeCutoff: model.knowledgeCutoff }
      : {}),
    ...(model.reasoning !== undefined ? { reasoning: model.reasoning } : {}),
    ...(model.website !== undefined ? { website: model.website } : {}),
    ...(model.apiDocs !== undefined ? { apiDocs: model.apiDocs } : {}),
    ...(model.modelPage !== undefined ? { modelPage: model.modelPage } : {}),
    ...(model.releasedAt !== undefined ? { releasedAt: model.releasedAt } : {}),
  };
}
