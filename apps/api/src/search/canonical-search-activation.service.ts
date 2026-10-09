import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import {
  InstanceConfigService,
  type InstanceConfigReader,
} from '../instance-config/instance-config.service';
import { TenantDbService } from '../db/tenant-db.service';
import { CHUNKER_VERSION } from './chat/conversation-chunker';
import { assertDiscoveryFunctionProvisioned } from './discovery-provisioning';
import { getProjectionCoverageReport } from './operations/projection-coverage';
import type { ProjectionCoverage } from './operations/projection-coverage';
import { SEARCH_SWEEP_BATCH } from './reindex-queues';
import { SearchIndexService } from './search-index.service';

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
 *
 * A Chat whose Run was interrupted by a process stop is left with messages
 * newer than its projection. The discovery sweep repairs that, but it
 * registers in onApplicationBootstrap, after this gate has already failed.
 * So the gate rebuilds one sweep batch of stale Chats itself before failing,
 * and still fails closed on anything that remains incomplete.
 */
@Injectable()
export class CanonicalSearchCoverageService {
  private readonly logger = new Logger(CanonicalSearchCoverageService.name);
  private readiness?: Promise<void>;

  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly searchIndex: SearchIndexService,
  ) {}

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
      if (!isProjectionCoverageReady(report)) {
        await this.repairStaleChats();
        report = await getProjectionCoverageReport(
          this.tenantDb,
          CHUNKER_VERSION,
        );
      }
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

  private async repairStaleChats(): Promise<void> {
    // Same cross-tenant discovery function and batch as the sweep; only
    // identifiers cross it, and each rebuild runs in its owner's scope.
    const stale = await this.tenantDb.runAsPublic((tx) =>
      tx.execute<{ chat_id: string; owner_user_id: string }>(sql`
        SELECT chat_id, owner_user_id
        FROM llame_search_projection_stale_chats_v2(${CHUNKER_VERSION}, ${SEARCH_SWEEP_BATCH})
      `),
    );
    let repaired = 0;
    for (const row of stale) {
      await this.searchIndex.reindexChat(row.chat_id, row.owner_user_id);
      repaired++;
    }
    this.logger.log(
      `Rebuilt ${repaired} stale chat projection(s) before the coverage check`,
    );
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
