import { ApiProperty } from '@nestjs/swagger';

import { type RunConfigSnapshot } from '../effective-config';
import { type ConfigScopeRef } from '../merge';

export class ConfigScopeRefResponse {
  @ApiProperty({ enum: ['instance', 'org_unit', 'user', 'chat'] })
  scopeType!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Null for the env-derived instance layer',
  })
  scopeId!: string | null;

  @ApiProperty({
    description: 'Config row version consumed; 0 = no row (defaults)',
  })
  version!: number;
}

export class ConfigProvenanceEntryResponse extends ConfigScopeRefResponse {
  @ApiProperty({
    description: 'Dot-joined leaf path, e.g. run.maxOutputTokens',
  })
  path!: string;
}

/** Effective config + provenance (#46 “explain” response, SPEC §6.4). */
export class EffectiveConfigResponse {
  @ApiProperty({
    type: Object,
    description: 'The merged effective config document',
  })
  effective!: Record<string, unknown>;

  @ApiProperty({
    type: ConfigProvenanceEntryResponse,
    isArray: true,
    description: 'Which scope set each effective leaf value',
  })
  provenance!: ConfigProvenanceEntryResponse[];

  @ApiProperty({
    type: ConfigScopeRefResponse,
    isArray: true,
    description: 'Every layer consulted, in inheritance order',
  })
  layers!: ConfigScopeRefResponse[];

  @ApiProperty({ format: 'date-time' })
  computedAt!: string;
}

export function toEffectiveConfigResponse(
  snapshot: RunConfigSnapshot,
): EffectiveConfigResponse {
  return {
    effective: snapshot.effective,
    provenance: Object.entries(snapshot.provenance).map(([path, scope]) => ({
      path,
      ...toScopeRef(scope),
    })),
    layers: snapshot.layers.map(toScopeRef),
    computedAt: snapshot.computedAt,
  };
}

function toScopeRef(scope: ConfigScopeRef): ConfigScopeRefResponse {
  return {
    scopeType: scope.scopeType,
    scopeId: scope.scopeId,
    version: scope.version,
  };
}
