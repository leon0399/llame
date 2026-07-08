import { Module } from '@nestjs/common';

import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';

/**
 * Identity module (#44, org-units change): org units, memberships, external
 * identities. The full org-unit + membership lifecycle is wired (D5) — CRUD
 * on units incl. move/rename/settings, roster, grant/role-change/revoke, and
 * the effective-role (`/me`) lookup. External identities still have no HTTP
 * surface (no consumer until channels, v0.9).
 * TenantDbService comes from the global DbModule (single provider instance).
 */
@Module({
  controllers: [IdentityController],
  providers: [IdentityService],
  exports: [IdentityService],
})
export class IdentityModule {}
