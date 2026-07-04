import { Global, Module } from '@nestjs/common';
import { TenantDbService } from './tenant-db.service';

/**
 * DbModule — the single provider of TenantDbService (the RLS-engaging DB
 * entry point). @Global because tenant-scoped DB access is a cross-cutting
 * concern consumed by every feature module; before this, five modules each
 * re-provided their own instance.
 */
@Global()
@Module({
  providers: [TenantDbService],
  exports: [TenantDbService],
})
export class DbModule {}
