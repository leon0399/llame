import { Injectable } from '@nestjs/common';

import { loadInstanceConfig, resolveConfigPath } from './config-loader';
import type { LlameConfig } from './llame-config';
import { loadProductUserAgent } from './product-identity';

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
 * which aborts Nest bootstrap before the app starts serving requests. The
 * product identity is read the same way and under the same contract: the
 * API package manifest must be deployed beside `dist/`, and one that is
 * missing, unreadable, or version-less aborts bootstrap too.
 */
@Injectable()
export class InstanceConfigService {
  readonly configPath?: string;
  readonly config: LlameConfig;
  /**
   * llame's own identity (`llame/<version>`) for every language-model request
   * (design D6 of openspec/changes/opencode-go-provider), read once here so a
   * misdeployment fails boot rather than a request. Deliberately outside
   * `InstanceConfigReader`: it is not operator configuration, and the readers
   * that only need `config` stay unchanged.
   */
  readonly productUserAgent: string;

  constructor() {
    this.configPath = resolveConfigPath();
    this.config = loadInstanceConfig();
    this.productUserAgent = loadProductUserAgent();
  }
}
