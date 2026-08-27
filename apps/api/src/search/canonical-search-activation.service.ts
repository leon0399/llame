import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';

import {
  InstanceConfigService,
  type InstanceConfigReader,
} from '../instance-config/instance-config.service';
import { TenantDbService } from '../db/tenant-db.service';
import { CHUNKER_VERSION } from './chat/conversation-chunker';
import { assertDiscoveryFunctionProvisioned } from './discovery-provisioning';
import { getProjectionCoverageReport } from './operations/projection-coverage';
import type { ProjectionCoverage } from './operations/projection-coverage';

export const CANONICAL_PROJECTION_COVERAGE_FUNCTION =
  'llame_search_projection_coverage_v2';

/**
 * The trusted, process-local result of the canonical excerpt boot gate. The
 * value is deliberately not read from model input or mutable request state.
 */
export type CanonicalSearchActivation = {
  readonly canonicalModelExcerptsEnabled: boolean;
};

export function isProjectionCoverageReady(report: ProjectionCoverage): boolean {
  return (
    report.staleChatCount === 0 &&
    report.readyChatCount === report.chatCount &&
    report.completeDocumentCount === report.documentCount
  );
}

/**
 * Validates the opt-in canonical search cutover before Run consumers start.
 * `OnModuleInit` is intentional: Nest awaits module-init hooks before any
 * `onApplicationBootstrap` hook can register a Run consumer, so a true flag
 * cannot race an unvalidated capability. Disabled configuration does no DB
 * readiness work and leaves the legacy model preview path untouched.
 */
@Injectable()
export class CanonicalSearchActivationService
  implements OnModuleInit, CanonicalSearchActivation
{
  private enabled = false;

  constructor(
    @Inject(InstanceConfigService)
    private readonly instanceConfig: InstanceConfigReader,
    private readonly tenantDb: TenantDbService,
  ) {}

  get canonicalModelExcerptsEnabled(): boolean {
    return this.enabled;
  }

  async onModuleInit(): Promise<void> {
    if (!this.instanceConfig.config.search.chats.canonicalModelExcerpts) {
      return;
    }

    let report: ProjectionCoverage;
    try {
      await assertDiscoveryFunctionProvisioned(
        this.tenantDb,
        CANONICAL_PROJECTION_COVERAGE_FUNCTION,
      );
      report = await getProjectionCoverageReport(
        this.tenantDb,
        CHUNKER_VERSION,
      );
    } catch (error) {
      throw new Error(
        `canonical model excerpts cannot activate: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    if (!isProjectionCoverageReady(report)) {
      throw new Error(
        'canonical model excerpts cannot activate until projection coverage is complete: ' +
          `chats=${report.chatCount}, ready=${report.readyChatCount}, ` +
          `stale=${report.staleChatCount}, documents=${report.documentCount}, ` +
          `complete=${report.completeDocumentCount}`,
      );
    }

    this.enabled = true;
  }
}
