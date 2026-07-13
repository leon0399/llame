import { Global, Module } from '@nestjs/common';

import { InstanceConfigService } from './instance-config.service';
import { WorkerProfileService } from './worker-profile.service';

/**
 * InstanceConfigModule — the single provider of InstanceConfigService and
 * WorkerProfileService (durable-run-workers D2/D4: the active worker
 * profile is resolved from InstanceConfigService's config + env, same
 * fail-at-boot posture). @Global, same rationale as DbModule: operator/
 * system config is a cross-cutting concern every feature module eventually
 * reads (model/title defaults, run timers, trust proxy, worker profile), so
 * it shouldn't be re-imported everywhere it's injected. Both entrypoints
 * (main.ts's AppModule, worker.ts's WorkerModule) import this module
 * directly since @Global scoping only applies within one application's own
 * module graph.
 */
@Global()
@Module({
  providers: [InstanceConfigService, WorkerProfileService],
  exports: [InstanceConfigService, WorkerProfileService],
})
export class InstanceConfigModule {}
