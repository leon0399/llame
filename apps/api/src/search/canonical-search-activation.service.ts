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

export type CanonicalSearchCoverageGate = Pick<
  CanonicalSearchCoverageService,
  'assertReady'
>;

export function isProjectionCoverageReady(report: ProjectionCoverage): boolean {
  return (
    report.staleChatCount === 0 &&
    report.readyChatCount === report.chatCount &&
    report.completeDocumentCount === report.documentCount
  );
}

/**
 * Validates canonical projection coverage once per process graph. HTTP Run
 * admission and runs-consumer registration share this memoized gate.
 */
@Injectable()
export class CanonicalSearchCoverageService {
  private readiness?: Promise<void>;

  constructor(private readonly tenantDb: TenantDbService) {}

  assertReady(): Promise<void> {
    this.readiness ??= this.checkCoverage();
    return this.readiness;
  }

  private async checkCoverage(): Promise<void> {
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
        `canonical conversation search cannot start: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    if (!isProjectionCoverageReady(report)) {
      throw new Error(
        'canonical conversation search cannot start until projection coverage is complete: ' +
          `chats=${report.chatCount}, ready=${report.readyChatCount}, ` +
          `stale=${report.staleChatCount}, documents=${report.documentCount}, ` +
          `complete=${report.completeDocumentCount}`,
      );
    }
  }
}

/** HTTP-only gate. Worker graphs import SearchModule but do not accept Runs. */
@Injectable()
export class CanonicalSearchActivationService implements OnModuleInit {
  constructor(
    @Inject(InstanceConfigService)
    private readonly instanceConfig: InstanceConfigReader,
    @Inject(CanonicalSearchCoverageService)
    private readonly coverage: CanonicalSearchCoverageGate,
  ) {}

  async onModuleInit(): Promise<void> {
    if (
      !this.instanceConfig.config.tools.allowed.includes('search_conversations')
    ) {
      return;
    }
    await this.coverage.assertReady();
  }
}
