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

export class EffortLevelResponse {
  @ApiProperty({
    description:
      'Opaque provider-native effort token. Matched byte-exactly on chat send; ' +
      'never a display string.',
  })
  value!: string;

  @ApiPropertyOptional({
    description:
      'Operator-authored display label. Absent when the config used a bare ' +
      'string. Never invented from `value`.',
  })
  label?: string;
}

export class ModelReasoningResponse {
  @ApiProperty({
    type: () => [EffortLevelResponse],
    description:
      'Effort levels this model accepts, in the order a client presents them. ' +
      'Each item has a `value` (opaque provider-native identifier) and an ' +
      'optional operator `label`. Derive no meaning or magnitude from either ' +
      'string, and do not assume a value means the same thing on another ' +
      'model. Order is the only scale.',
  })
  effortLevels!: Array<EffortLevelResponse>;

  @ApiProperty({
    description:
      'The level value applied when a chat send omits `effort`. Always one of ' +
      '`effortLevels[].value`.',
  })
  defaultEffort!: string;

  @ApiProperty({
    description:
      "Whether CHANGING effort between turns invalidates this model's " +
      'provider-side prompt cache — not whether effort does. Operator-declared, ' +
      'because the behavior is model-specific and partly undocumented. Advisory ' +
      'metadata for warning a user before a costly prefix re-read; it does not ' +
      'affect execution.',
  })
  cacheInvalidatedByEffortChange!: boolean;
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
  tags?: Array<string>;

  @ApiPropertyOptional()
  icon?: string;

  @ApiProperty({ type: 'integer' })
  contextWindowTokens!: number;

  @ApiPropertyOptional({ type: () => ModelPricingResponse })
  pricingUsdPer1M?: ModelPricingUsdPer1M;

  @ApiPropertyOptional()
  knowledgeCutoff?: string;

  @ApiPropertyOptional({
    type: () => ModelReasoningResponse,
    description:
      'Present only when the operator declared an effort vocabulary for this ' +
      'model. Absent means the model accepts no `effort` on a chat send.',
  })
  reasoning?: ModelReasoningResponse;

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
  models!: Array<AvailableModelResponse>;
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
  // Copied, like `tags` above: the catalog is a process-lifetime singleton, so
  // handing a response object the config's own array would let a later mutation
  // reach every subsequent caller.
  if (model.reasoning !== undefined) {
    response.reasoning = {
      ...model.reasoning,
      effortLevels: model.reasoning.effortLevels.map((level) => ({
        ...level,
      })),
    };
  }
  if (model.website !== undefined) response.website = model.website;
  if (model.apiDocs !== undefined) response.apiDocs = model.apiDocs;
  if (model.modelPage !== undefined) response.modelPage = model.modelPage;
  if (model.releasedAt !== undefined) response.releasedAt = model.releasedAt;
  return response;
}
