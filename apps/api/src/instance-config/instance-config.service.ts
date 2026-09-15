import { Injectable } from '@nestjs/common';

import { loadInstanceConfig, resolveConfigPath } from './config-loader';
import type { LlameConfig } from './llame-config';

/**
 * The only capability most callers need (#268) — narrower than the whole
 * service. Fake with a full `LlameConfig` value (spread `BUILT_IN_DEFAULTS`
 * and override), never a partial literal — `config`'s type doesn't shrink just
 * because the service type does. `configPath` is an execution-worker-only
 * detail used to resolve tool prompt overrides; it is optional on the narrow
 * test/config seam so API-only callers need not carry a host path.
 */
export type InstanceConfigReader = {
  readonly config: LlameConfig;
  readonly configPath?: string;
};

/**
 * InstanceConfigService — the single typed read surface for operator/system
 * settings (openspec/changes/instance-config; SPEC config-as-code). Loaded
 * once at module init (D6 restart-to-apply, no hot-reload); any load,
 * parse, schema, or interpolation failure throws out of the constructor,
 * which aborts Nest bootstrap before the app starts serving requests.
 */
@Injectable()
export class InstanceConfigService {
  readonly configPath?: string;
  readonly config: LlameConfig;

  constructor() {
    this.configPath = resolveConfigPath();
    this.config = loadInstanceConfig();
  }
}
