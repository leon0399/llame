import { Module } from '@nestjs/common';

import { PolicyService } from './policy.service';

/**
 * Policy engine module (#45): deny-overrides-allow evaluation with audited,
 * versioned decisions. Providers only — no HTTP surface; consumers are the
 * config resolver (#46) and the tool/connector gates of later milestones.
 * TenantDbService comes from the global DbModule (single provider instance).
 */
@Module({
  providers: [PolicyService],
  exports: [PolicyService],
})
export class PoliciesModule {}
