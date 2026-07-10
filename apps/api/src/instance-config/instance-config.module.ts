import { Global, Module } from '@nestjs/common';

import { InstanceConfigService } from './instance-config.service';

/**
 * InstanceConfigModule — the single provider of InstanceConfigService.
 * @Global, same rationale as DbModule: operator/system config is a
 * cross-cutting concern every feature module eventually reads (model/title
 * defaults, run timers, trust proxy), so it shouldn't be re-imported
 * everywhere it's injected.
 */
@Global()
@Module({
  providers: [InstanceConfigService],
  exports: [InstanceConfigService],
})
export class InstanceConfigModule {}
