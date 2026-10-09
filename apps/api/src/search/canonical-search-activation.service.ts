import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
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
import { SearchReindexDispatchService } from './search-reindex-dispatch.service';

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

/** How long a gate waits for queued rebuilds to complete coverage, and how
 *  often it re-reads coverage meanwhile. */
export const COVERAGE_REPAIR_DEADLINE_MS = 120_000;
export const COVERAGE_REPAIR_POLL_MS = 1000;

/**
 * Validates canonical projection coverage once per process graph. HTTP Run
 * admission and runs-consumer registration share this memoized gate.
 *
 * A Chat whose Run was interrupted by a process stop is left with messages
 * newer than its projection. When coverage is incomplete the gate acts as one
 * more discovery producer: it enqueues the stale Chats on the coalesced
 * reindex queue, then waits for reindex workers to complete coverage. Callers
 * run it in onApplicationBootstrap, after a co-located reindex consumer has
 * registered; it fails closed when the deadline passes.
 */
@Injectable()
export class CanonicalSearchCoverageService {
  private readonly logger = new Logger(CanonicalSearchCoverageService.name);
  private readiness?: Promise<void>;

  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly reindexDispatch: SearchReindexDispatchService,
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
        await this.enqueueStaleChats();
        const deadline = Date.now() + COVERAGE_REPAIR_DEADLINE_MS;
        while (!isProjectionCoverageReady(report) && Date.now() < deadline) {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, COVERAGE_REPAIR_POLL_MS);
          });
          report = await getProjectionCoverageReport(
            this.tenantDb,
            CHUNKER_VERSION,
          );
        }
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

  private async enqueueStaleChats(): Promise<void> {
    // Same cross-tenant discovery function and batch as the sweep; only
    // identifiers cross it.
    const stale = [
      ...(await this.tenantDb.runAsPublic((tx) =>
        tx.execute<{ chat_id: string; owner_user_id: string }>(sql`
          SELECT chat_id, owner_user_id
          FROM llame_search_projection_stale_chats_v2(${CHUNKER_VERSION}, ${SEARCH_SWEEP_BATCH})
        `),
      )),
    ];
    for (const row of stale) {
      await this.reindexDispatch.enqueueChatReindex(
        row.chat_id,
        row.owner_user_id,
      );
    }
    this.logger.log(
      `Enqueued ${stale.length} stale chat reindex job(s); waiting for projection coverage`,
    );
  }
}

/** HTTP-only gate. Worker graphs import SearchModule but do not accept Runs.
 *  Bootstrap, not module init: AppModule bootstraps after SearchModule, so a
 *  co-located reindex consumer is already draining the queue it waits on. */
@Injectable()
export class CanonicalSearchActivationService
  implements OnApplicationBootstrap
{
  constructor(
    @Inject(InstanceConfigService)
    private readonly instanceConfig: InstanceConfigReader,
    @Inject(CanonicalSearchCoverageService)
    private readonly coverage: CanonicalSearchCoverageGate,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (
      !this.instanceConfig.config.tools.allowed.includes('search_conversations')
    ) {
      return;
    }
    await this.coverage.assertReady();
  }
}
