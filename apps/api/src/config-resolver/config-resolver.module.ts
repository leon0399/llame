import { Module } from '@nestjs/common';

import { ConfigController } from './config.controller';
import { ConfigResolverService } from './config-resolver.service';
import { MeController } from './me.controller';

/**
 * Config resolver module (#46): layered effective-config resolution with
 * provenance, the per-run snapshot source, and the explain endpoint.
 * TenantDbService comes from the global DbModule (single provider instance).
 */
@Module({
  controllers: [ConfigController, MeController],
  providers: [ConfigResolverService],
  exports: [ConfigResolverService],
})
export class ConfigResolverModule {}
