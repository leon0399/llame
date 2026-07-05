import { Module } from '@nestjs/common';

import { ProvidersController } from './providers.controller';
import { ProvidersService } from './providers.service';

/**
 * BYOK provider module (#18): provider accounts + the encrypted credential
 * vault. Secrets are sealed at the controller boundary and only ever
 * revealed inside the model-client factory.
 * TenantDbService comes from the global DbModule (single provider instance).
 */
@Module({
  controllers: [ProvidersController],
  providers: [ProvidersService],
  exports: [ProvidersService],
})
export class ProvidersModule {}
