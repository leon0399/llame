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
  const response: AvailableModelResponse = {
    id: model.id,
    source: model.source,
    contextWindowTokens: model.contextWindowTokens,
  };
  if (model.name !== undefined) response.name = model.name;
  if (model.description !== undefined) response.description = model.description;
  if (model.tags !== undefined) response.tags = [...model.tags];
  if (model.icon !== undefined) response.icon = model.icon;
  if (model.pricingUsdPer1M !== undefined) {
    response.pricingUsdPer1M = model.pricingUsdPer1M;
  }
  if (model.knowledgeCutoff !== undefined) {
    response.knowledgeCutoff = model.knowledgeCutoff;
  }
  if (model.reasoning !== undefined) response.reasoning = model.reasoning;
  if (model.website !== undefined) response.website = model.website;
  if (model.apiDocs !== undefined) response.apiDocs = model.apiDocs;
  if (model.modelPage !== undefined) response.modelPage = model.modelPage;
  if (model.releasedAt !== undefined) response.releasedAt = model.releasedAt;
  return response;
}
