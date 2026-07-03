import { Module } from '@nestjs/common';

import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';

/**
 * Identity module (#44): org units, memberships, external identities. The admin
 * API slice (org-unit CRUD-lite + membership grant/revoke) is now wired; the
 * member roster + role-update flows remain deferred (recursion-safe RLS).
 * TenantDbService comes from the global DbModule (single provider instance).
 */
@Module({
  controllers: [IdentityController],
  providers: [IdentityService],
  exports: [IdentityService],
})
export class IdentityModule {}
