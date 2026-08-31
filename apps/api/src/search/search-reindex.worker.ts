import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { TenantDbService } from '../db/tenant-db.service';
import {
  InstanceConfigService,
  type InstanceConfigReader,
} from '../instance-config/instance-config.service';
import { WorkerProfileService } from '../instance-config/worker-profile.service';
import { QUEUE, type Queue } from '../queue/queue';
import { CHUNKER_VERSION } from './chat/conversation-chunker';
import {
  SEARCH_REINDEX_QUEUE,
  SEARCH_SWEEP_BATCH,
  SEARCH_SWEEP_CRON,
  SEARCH_SWEEP_QUEUE,
  type SearchReindexJob,
} from './reindex-queues';
import { isFunctionOwnedByBypassRlsRole } from './discovery-provisioning';
import { findEmbeddingBinding } from './embedding-binding-ledger';
import { SearchEmbedDispatchService } from './search-embed-dispatch.service';
import { SearchReindexDispatchService } from './search-reindex-dispatch.service';
import { SearchIndexService } from './search-index.service';

/** One discovered chat identifier a sweep branch enqueues work for. */
type SweepRow = { chat_id: string; owner_user_id: string };

/**
 * Enqueue `rows` in bounded-parallel batches rather than one-at-a-time —
 * matters for the deploy-time backfill burst (up to SEARCH_SWEEP_BATCH chats
 * in one tick). Each chat is independent (distinct singletonKey), so ordering
 * across the batch carries no meaning.
 */
async function enqueueRowsBounded(
  rows: ReadonlyArray<SweepRow>,
  enqueueOne: (chatId: string, ownerUserId: string) => Promise<void>,
): Promise<void> {
  const CONCURRENCY = 20;
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    await Promise.all(
      rows
        .slice(i, i + CONCURRENCY)
        .map((row) => enqueueOne(row.chat_id, row.owner_user_id)),
    );
  }
}

/**
 * SearchReindexWorker (#195) — consumes the reindex queue (one chat per job) and
 * runs the 5-minute discovery sweep. Co-located in the API process for phase 1,
 * like RunsWorkerService; the dedicated worker entrypoint is #116.
 *
 * The queue carries ONE general per-chat "reindex chat" job; several equal
 * producers enqueue it (inline-finalize fallback, fork, this sweep) and the
 * consumers above do the actual processing. This worker's own sweep is a
 * DISCOVERY PRODUCER, not the freshness path (write hooks carry freshness):
 * it enumerates stale chats across all tenants via the locator-aware
 * `llame_search_projection_stale_chats_v2` SECURITY DEFINER function (BYPASSRLS —
 * the only way to see all tenants under FORCE RLS), which returns ONLY
 * identifiers, and enqueues a reindex job per chat — backfill for never-indexed
 * chats, locator repair, and chunker-version bump. Catching a lost fallback
 * enqueue via the stale predicate is a
 * last-resort backstop (defense-in-depth), not the sweep's named purpose.
 * The actual reindex of each chat then runs strictly inside that owner's
 * `runAs` scope.
 *
 * chat-search-embeddings design D5: the SAME sweep tick is also the embed
 * discovery producer — after the lexical branch above, a second branch reads
 * the embedding-backlog predicate (`llame_search_embedding_backlog`, the
 * STATIC never-attempted-only branch of coverage — design trap 5: unlike
 * `llame_search_embedding_coverage`, this one is servable by a partial index,
 * see the schema migration) and enqueues `search-embed` jobs for lagging
 * chats. Gated on `search.chats.embeddingModelId` being configured — off by
 * default, so an instance that never declares a model never even queries it.
 *
 * **D6's "bulk work is never automatic" gate.** The static branch alone
 * cannot distinguish ordinary incremental lag from the FIRST-ever backlog of
 * a freshly declared model or a corpus newly pointed at one — both look
 * identical (every document simply "never attempted"), and the latter is
 * bulk work a config edit must never auto-start. The binding ledger
 * (design D1, `embedding_model_bindings`) resolves this: its row for a key
 * is written only on that key's FIRST PERSISTED vector, never on
 * declaration, so the row's mere existence IS the "this model is already in
 * service" signal. No row → the sweep enqueues NOTHING for that model;
 * only the operator-invoked `backfill` command may start it. Row present →
 * outstanding documents are ordinary incremental lag, which this sweep
 * maintains automatically as D6 intends.
 */
@Injectable()
export class SearchReindexWorker implements OnApplicationBootstrap {
  private readonly logger = new Logger(SearchReindexWorker.name);

  constructor(
    @Inject(QUEUE)
    private readonly queue: Queue,
    private readonly tenantDb: TenantDbService,
    private readonly indexService: SearchIndexService,
    private readonly dispatch: SearchReindexDispatchService,
    private readonly embedDispatch: SearchEmbedDispatchService,
    private readonly workerProfile: WorkerProfileService,
    @Inject(InstanceConfigService)
    private readonly instanceConfig: InstanceConfigReader,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Worker-profile gate (durable-run-workers D2/D3): a process whose active
    // profile doesn't include `search-reindex` registers NOTHING for it — no
    // reindex consumer, no sweep consumer/schedule/backfill-enqueue. Content
    // writes still enqueue fine from any process — SearchReindexDispatchService
    // ensures its own queue independently on the enqueue side.
    const concurrency = this.workerProfile.concurrencyFor('search-reindex');
    if (concurrency === null) {
      return;
    }
    await this.assertDiscoveryProvisioned();
    await this.queue.ensureQueue(SEARCH_REINDEX_QUEUE);
    await this.queue.ensureQueue(SEARCH_SWEEP_QUEUE);
    // Log a failure with its stack before rethrowing, so a deterministic
    // reindex/sweep bug is visible in logs — not only as a silent dead-letter.
    // Rethrow preserves pg-boss's retry → dead-letter semantics.
    await this.queue.consume(
      SEARCH_REINDEX_QUEUE,
      (job) => this.handleReindexJob(job),
      { pollingIntervalSeconds: 1, concurrency },
    );
    // Sweep stays at the group's fixed internal concurrency (1) — it's a
    // `stately`-policy queue anyway (one queued + one running tick).
    await this.queue.consume(SEARCH_SWEEP_QUEUE, () => this.handleSweepTick(), {
      pollingIntervalSeconds: 5,
    });
    await this.queue.schedule(SEARCH_SWEEP_QUEUE, SEARCH_SWEEP_CRON, {});
    // Backfill promptly on deploy instead of waiting for the first cron tick.
    await this.queue.enqueue(SEARCH_SWEEP_QUEUE, {});
    this.logger.log(
      `Consuming '${SEARCH_REINDEX_QUEUE.name}' (concurrency ${concurrency}) + '${SEARCH_SWEEP_QUEUE.name}' (sweep '${SEARCH_SWEEP_CRON}')`,
    );
  }

  private async handleReindexJob(job: SearchReindexJob): Promise<void> {
    try {
      await this.indexService.reindexChat(job.chatId, job.ownerUserId);
      // chat-search-embeddings design D5: this is the second of the three
      // enqueue sites — the reindex worker itself, after its own rebuild
      // succeeds. Best-effort + off-by-default; see the dispatch service's
      // own contract.
      void this.embedDispatch.enqueueChatEmbed(job.chatId, job.ownerUserId);
    } catch (error) {
      this.logger.error(
        `Reindex failed for chat ${job.chatId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  private async handleSweepTick(): Promise<void> {
    try {
      await this.runSweep();
    } catch (error) {
      this.logger.error(
        'Search staleness sweep failed',
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }

  /**
   * Boot-time provisioning self-check (NON-FATAL) for BOTH cross-tenant
   * discovery functions this worker's sweep(s) depend on: the locator-aware
   * lexical staleness function `llame_search_projection_stale_chats_v2` (#609)
   * and the embedding
   * coverage function `llame_search_embedding_coverage` (chat-search-
   * embeddings, design D10 — schema-only in this layer; no embed worker
   * consumes it yet, but a mis-provisioned instance must be visible from the
   * moment the migration lands, not only once a later layer starts reading
   * it). Each must be owned by a BYPASSRLS role (`app_rls`) to see rows
   * across tenants under FORCE RLS; until `pnpm db:provision-rls` reassigns
   * it there from `app` (same lifecycle as `llame_role_on_unit_path` — see
   * AGENTS.md), it silently returns zero rows and cross-tenant discovery for
   * THAT function is disabled with no error anywhere else. This check makes
   * that failure mode visible, per function, independently.
   *
   * Non-circular: reads `pg_proc`/`pg_roles` catalog metadata, not tenant
   * data, so it never hits the RLS wall it's checking for.
   * Non-fatal by design: this is a backfill-only degradation (new activity
   * still indexes synchronously via the Tier 1 write hooks), so it must
   * NEVER throw out of onApplicationBootstrap or block queue/consumer setup
   * for the co-located api process — failures of the check itself are
   * caught and logged as a warning, never rethrown.
   */
  private async assertDiscoveryProvisioned(): Promise<void> {
    await this.assertFunctionOwnedByBypassRlsRole(
      'llame_search_projection_stale_chats_v2',
      "Search discovery function 'llame_search_projection_stale_chats_v2' is not owned by a BYPASSRLS role — cross-tenant backfill and locator repairs are DISABLED until 'pnpm db:provision-rls' runs. New activity still indexes synchronously (Tier 1); only dormant-chat backfill is deferred.",
    );
    await this.assertFunctionOwnedByBypassRlsRole(
      'llame_search_embedding_coverage',
      "Search embedding coverage function 'llame_search_embedding_coverage' is not owned by a BYPASSRLS role — cross-tenant embedding-lag discovery is DISABLED until 'pnpm db:provision-rls' runs. Existing lexical search and per-chat write-hook indexing are unaffected; only cross-tenant embedding backfill discovery is deferred.",
    );
    // chat-search-embeddings task 6.5/trap 5: the sweep's own incremental
    // embedding-backlog discovery function, distinct from the reporting-only
    // coverage function above.
    await this.assertFunctionOwnedByBypassRlsRole(
      'llame_search_embedding_backlog',
      "Search embedding backlog function 'llame_search_embedding_backlog' is not owned by a BYPASSRLS role — cross-tenant incremental embedding discovery is DISABLED until 'pnpm db:provision-rls' runs. Existing lexical search and per-chat write-hook indexing are unaffected; only cross-tenant embed-backlog discovery is deferred.",
    );
  }

  private async assertFunctionOwnedByBypassRlsRole(
    functionName: string,
    unprovisionedMessage: string,
  ): Promise<void> {
    try {
      const provisioned = await isFunctionOwnedByBypassRlsRole(
        this.tenantDb,
        functionName,
      );
      if (!provisioned) {
        this.logger.error(unprovisionedMessage);
      }
    } catch (error) {
      this.logger.warn(
        `Discovery provisioning self-check failed to run for '${functionName}': ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async runSweep(): Promise<void> {
    // runAsPublic sets the empty identity, but the discovery function is SECURITY
    // DEFINER (runs AS app_rls, BYPASSRLS) and does not filter by caller, so it
    // returns every stale chat regardless. Only identifiers cross this boundary.
    const stale = await this.tenantDb.runAsPublic((tx) =>
      tx.execute<SweepRow>(sql`
        SELECT chat_id, owner_user_id
        FROM llame_search_projection_stale_chats_v2(${CHUNKER_VERSION}, ${SEARCH_SWEEP_BATCH})
      `),
    );
    const rows = [...stale];
    await enqueueRowsBounded(rows, (chatId, ownerUserId) =>
      this.dispatch.enqueueChatReindex(chatId, ownerUserId),
    );
    if (rows.length > 0) {
      this.logger.log(`Sweep enqueued ${rows.length} chat reindex job(s)`);
    }
    await this.runEmbedBacklogSweep();
  }

  /**
   * chat-search-embeddings design D5/D6/D14: the embed side of the SAME
   * sweep tick. Off-by-default (no query at all) when the chats corpus has
   * no configured model. Reads ONLY the static never-attempted branch —
   * `llame_search_embedding_backlog`, not `llame_search_embedding_coverage`
   * — so this deliberately covers incremental lag only; a model change or
   * input-version bump is bulk work the explicit `backfill` command handles.
   *
   * Public (like `SearchIndexService.reindexChat`/`SearchEmbedWorker.embedChat`)
   * so integration tests can drive it directly, bypassing queue consumption.
   */
  async runEmbedBacklogSweep(): Promise<void> {
    const modelId = this.instanceConfig.config.search.chats.embeddingModelId;
    if (!modelId) {
      return;
    }
    // D6 gate: no ledger row means this model has never persisted a real
    // vector — a freshly declared model or a corpus newly pointed at one,
    // i.e. BULK work. The sweep must enqueue nothing for it; see the class
    // doc comment above for the full argument. `embedding_model_bindings`
    // has no RLS (instance-global operator state), so `runAsPublic` reads it
    // fine — this is not a cross-tenant discovery concern.
    const binding = await this.tenantDb.runAsPublic((tx) =>
      findEmbeddingBinding(tx, modelId),
    );
    if (!binding) {
      return;
    }
    const backlog = await this.tenantDb.runAsPublic((tx) =>
      tx.execute<SweepRow>(sql`
        SELECT chat_id, owner_user_id
        FROM llame_search_embedding_backlog(${SEARCH_SWEEP_BATCH})
      `),
    );
    const rows = [...backlog];
    await enqueueRowsBounded(rows, (chatId, ownerUserId) =>
      this.embedDispatch.enqueueChatEmbed(chatId, ownerUserId),
    );
    if (rows.length > 0) {
      this.logger.log(`Sweep enqueued ${rows.length} chat embed job(s)`);
    }
  }
}
