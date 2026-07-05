import { Module } from '@nestjs/common';

import { IdentityService } from './identity.service';

/**
 * Identity module (#44): org units, memberships, external identities.
 * Providers only — no controller until the admin API slice, so the model
 * ships with zero reachable surface (fail closed by construction).
 * TenantDbService comes from the global DbModule (single provider instance).
 */
@Module({
  providers: [IdentityService],
  exports: [IdentityService],
})
export class IdentityModule {}
