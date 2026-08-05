import { Injectable } from '@nestjs/common';

import { loadInstanceConfig } from './config-loader';
import type { LlameConfig } from './llame-config';

/**
 * The only capability most callers need (#268) — narrower than the whole
 * service. Fake with a full `LlameConfig` value (spread `BUILT_IN_DEFAULTS`
 * and override), never a partial literal — `config`'s type doesn't shrink
 * just because the service type does.
 */
export type InstanceConfigReader = Pick<InstanceConfigService, 'config'>;

/**
 * InstanceConfigService — the single typed read surface for operator/system
 * settings (openspec/changes/instance-config; SPEC config-as-code). Loaded
 * once at module init (D6 restart-to-apply, no hot-reload); any load,
 * parse, schema, or interpolation failure throws out of the constructor,
 * which aborts Nest bootstrap before the app starts serving requests.
 */
@Injectable()
export class InstanceConfigService {
  readonly config: LlameConfig;

  constructor() {
    this.config = loadInstanceConfig();
  }
}
