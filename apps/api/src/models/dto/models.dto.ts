import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import type {
  ModelInput,
  ModelPricingUsdPer1M,
  ModelSource,
  PublicModelCatalogEntry,
} from '../model-catalog';
import type { ModelRoleAvailability } from '../models.service';

export class ModelPricingResponse {
  @ApiPropertyOptional()
  input?: number;

  @ApiPropertyOptional()
  cachedInput?: number;

  @ApiPropertyOptional()
  output?: number;

  @ApiPropertyOptional({
    description:
      'Declared cache-write (cache-creation) rate. Absent means the operator ' +
      'declared none: cache-write tokens are then billed at `input`. Only the ' +
      'declared rate is published — never the resolved fallback.',
  })
  cacheWrite?: number;
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

  @ApiProperty({
    enum: ['text', 'image', 'pdf'],
    isArray: true,
    description:
      'Input modalities this model accepts, in the operator-declared order. ' +
      'Always present and always contains `text`; `["text"]` when the ' +
      'operator declared none. Never inferred from the model id or provider.',
  })
  input!: Array<ModelInput>;

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

export class ModelRoleCandidateResponse {
  @ApiProperty({
    description:
      'The candidate `models[].id`, exactly as a chat send names it.',
  })
  modelId!: string;

  @ApiPropertyOptional({
    description:
      'Effort the operator declared with this candidate. Absent when the ' +
      'candidate declares none; the model default then applies.',
  })
  effort?: string;

  @ApiProperty({
    description:
      'Whether this candidate bills per token (the `usage` billing mode). ' +
      'False for a `subscription` candidate and for a `free` one, whose ' +
      'declared price is notional.',
  })
  paid!: boolean;
}

export class ModelRoleResponse {
  @ApiProperty({
    description:
      'Role selector a client may send: `@` plus the role name. A role is ' +
      'an ordered fallback chain; the first candidate is its primary.',
    example: '@coding',
  })
  selector!: string;

  @ApiProperty({
    type: () => [ModelRoleCandidateResponse],
    description: 'Candidates in the order the operator declared them.',
  })
  candidates!: Array<ModelRoleCandidateResponse>;
}

export class ModelsResponse {
  @ApiProperty({
    description:
      'The configured default model selector: `@role` or a model id. A role ' +
      'resolves through `roles`; the first step of its chain is the model a ' +
      'client presents.',
  })
  defaultSelector!: string;

  @ApiProperty({ type: () => [AvailableModelResponse] })
  models!: Array<AvailableModelResponse>;

  @ApiProperty({
    type: () => [ModelRoleResponse],
    description: 'Configured model roles, in config order.',
  })
  roles!: Array<ModelRoleResponse>;
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

export function toModelRoleResponse(
  role: ModelRoleAvailability,
): ModelRoleResponse {
  return {
    selector: role.selector,
    // Copied, like every catalog array: the resolved config is a
    // process-lifetime singleton, so a response must not hand out its arrays.
    candidates: role.candidates.map((candidate) => {
      const response: ModelRoleCandidateResponse = {
        modelId: candidate.modelId,
        paid: candidate.paid,
      };

      if (candidate.effort !== undefined) response.effort = candidate.effort;

      return response;
    }),
  };
}

export function toAvailableModelResponse(
  model: PublicModelCatalogEntry,
): AvailableModelResponse {
  const response: AvailableModelResponse = {
    id: model.id,
    source: model.source,
    contextWindowTokens: model.contextWindowTokens,
    // Copied for the same singleton reason as `tags` and `reasoning` below.
    input: [...model.input],
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
