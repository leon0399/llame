import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';

import { type Db, TenantDbService } from '../db/tenant-db.service';
import { searchChatDocuments } from '../db/schema/search';
import {
  InstanceConfigService,
  type InstanceConfigReader,
} from '../instance-config/instance-config.service';
import {
  type EmbeddingModelCatalogEntry,
  type ProviderConfig,
} from '../instance-config/llame-config';
import { WorkerProfileService } from '../instance-config/worker-profile.service';
import { QUEUE, type Queue } from '../queue/queue';
import {
  type EmbeddingBackend,
  type EmbeddingDocumentInput,
  type EmbeddingResult,
} from './core';
import {
  classifyEmbeddingFailure,
  createOpenAIEmbeddingBackend,
  type OpenAIEmbeddingBackendConfig,
} from './openai-embedding-backend';
import { SEARCH_EMBED_QUEUE } from './reindex-queues';
import { SearchEmbedDispatchService } from './search-embed-dispatch.service';

/**
 * Embedding input-shape version (chat-search-embeddings design D11): the
 * document's `content` verbatim, role labels included — never
 * `normalized_content` (that column is the lexical matcher's, NFKC-folded
 * and role-free; lowercasing removes signal a transformer encoder uses).
 * Bumping this enumerates a future input-derivation change (e.g. #518's
 * model-generated chunk context) as a full re-embed even though no
 * `content_hash` changed — see the schema's `embed_input_version` comment.
 */
export const EMBED_INPUT_VERSION = 1;

/**
 * A job processes at most this many batches before re-enqueuing itself for
 * remaining work (design D5 "page rather than load"), rather than draining an
 * arbitrarily large chat in one run — an unbounded job holds a worker slot
 * indefinitely and risks pg-boss's job-expiry killing it mid-run, losing the
 * batches it had not yet persisted. `stately` + `singletonKey` (the queue's
 * own definition) makes the self-re-enqueue safe: at most one pending and one
 * running job per chat regardless of how many times this fires.
 */
export const EMBED_MAX_BATCHES_PER_JOB = 20;

/** One row read from the outstanding-documents query — everything the embed
 *  call and the persist guard need, nothing more. */
type OutstandingRow = {
  id: string;
  content: string;
  contentHash: string;
  priorEmbedInputVersion: number | null;
};

/**
 * Resolves the declared embedding model + its `providers[]` connection into
 * the adapter's config shape — the same "reuse an existing `providers[]`
 * entry" pattern `models/model-client-factory.ts` uses for chat models
 * (design D15: SearchModule builds the backend directly, no ModelsModule
 * import). `model.provider` and `search.chats.embeddingModelId` are both
 * validated against their targets at config-load time
 * (`instance-config/config-loader.ts`), so the "not found" branches below are
 * defensive, not reachable through normal boot.
 */
export function resolveEmbeddingBackendConfig(
  model: EmbeddingModelCatalogEntry,
  providers: readonly ProviderConfig[],
): OpenAIEmbeddingBackendConfig {
  const provider = providers.find((p) => p.id === model.provider);
  if (!provider) {
    throw new Error(
      `embeddingModels[${model.id}].provider: "${model.provider}" is not defined in providers[] — cannot build the embed backend`,
    );
  }
  const config: OpenAIEmbeddingBackendConfig = {
    providerModelId: model.providerModelId,
    dimensions: model.dimensions,
    batchSize: model.batchSize,
  };
  if (provider.key !== null) config.credential = provider.key;
  if (provider.baseUrl !== null) config.baseUrl = provider.baseUrl;
  if (model.documentPrefix !== undefined) {
    config.documentPrefix = model.documentPrefix;
  }
  if (model.queryPrefix !== undefined) config.queryPrefix = model.queryPrefix;
  return config;
}

/**
 * Conditional persist of a successfully embedded document (design D7/D15).
 * WHERE guards on the exact (content_hash, embed_input_version) this row
 * carried at SELECT time: if a rebuild or a concurrent embed landed between
 * read and write, neither term still matches and the write is a silent
 * no-op — the row is picked up again by the next pass rather than
 * overwritten with a vector describing superseded content. `embed_input_version`
 * uses `IS NOT DISTINCT FROM` because it is nullable (never-attempted rows
 * read it as NULL).
 *
 * Writes EXACTLY the five embedding columns — trap 3/D15's "no feedback
 * loop": touching `updated_at`, `chats.updated_at`, or `search_chat_state`
 * would let the lexical staleness predicate re-flag the chat, triggering a
 * rebuild, which enqueues an embed, forever.
 */
async function persistEmbeddingSuccess(
  tx: Db,
  result: EmbeddingResult,
  priorEmbedInputVersion: number | null,
  modelKey: string,
  inputVersion: number,
): Promise<boolean> {
  // pgvector's text-input literal is a JSON-shaped array, e.g. "[0.1,0.2]" —
  // bound as text with an explicit ::vector cast (no native JS→vector type).
  const vectorLiteral = JSON.stringify(result.embedding);
  const updated = await tx.execute(sql`
    UPDATE search_chat_documents
    SET embedding = ${vectorLiteral}::vector,
        embedding_model_key = ${modelKey},
        embedded_content_hash = ${result.contentHash},
        embed_input_version = ${inputVersion},
        embedding_fail_reason = NULL
    WHERE id = ${result.documentId}
      AND content_hash = ${result.contentHash}
      AND embed_input_version IS NOT DISTINCT FROM ${priorEmbedInputVersion}
  `);
  return updated.count > 0;
}

/**
 * Conditional persist of a terminal failure (design D16 tombstone; trap 4).
 * Same WHERE guard as the success path — "nothing is written for
 * superseded content in any case" (task 6.9) applies to a failure write
 * exactly as it does to a success one.
 *
 * Stamps ALL FOUR attempt-metadata columns (model key, content hash, input
 * version, reason) in the SAME statement. The coverage predicate's
 * suppression comes entirely from the three `IS DISTINCT FROM` checks —
 * `embedding_fail_reason` contributes nothing to it — so a reason-only write
 * that left the other three NULL would leave `needs_embedding` true forever:
 * a permanently unembeddable document re-flagged as outstanding on every
 * sweep, retried until someone notices the provider bill, and never counted
 * as failed.
 */
async function persistEmbeddingFailure(
  tx: Db,
  row: OutstandingRow,
  modelKey: string,
  inputVersion: number,
  reason: string,
): Promise<boolean> {
  const updated = await tx.execute(sql`
    UPDATE search_chat_documents
    SET embedding = NULL,
        embedding_model_key = ${modelKey},
        embedded_content_hash = ${row.contentHash},
        embed_input_version = ${inputVersion},
        embedding_fail_reason = ${reason}
    WHERE id = ${row.id}
      AND content_hash = ${row.contentHash}
      AND embed_input_version IS NOT DISTINCT FROM ${row.priorEmbedInputVersion}
  `);
  return updated.count > 0;
}

/**
 * SearchEmbedWorker (chat-search-embeddings, design D5/D14/D15) — consumes
 * `SEARCH_EMBED_QUEUE`: for one chat per job, re-queries outstanding
 * documents a batch at a time, embeds them, and persists results
 * conditionally. Off-by-default (spec "the embedding layer is off by
 * default"): registers NOTHING unless `search.chats.embeddingModelId` is
 * configured. Additionally gated on `concurrencyFor('search-embed')` — a
 * SEPARATE worker group from `search-reindex` (design D14): network-bound
 * and latency-tolerant where reindexing is DB-bound and latency-sensitive,
 * and its concurrency is the operator's provider-spend/self-hosted-
 * saturation dial.
 *
 * `SearchModule` stays a leaf (design D15): the backend is built directly
 * from `@ai-sdk/openai`, exactly as `models/openai-model-client.ts` does —
 * no `ModelsModule` import, which would drag an HTTP controller into the
 * worker graph and risk a cycle back through `ChatsModule`/`RunWorkerModule`.
 */
@Injectable()
export class SearchEmbedWorker implements OnApplicationBootstrap {
  private readonly logger = new Logger(SearchEmbedWorker.name);

  constructor(
    @Inject(QUEUE)
    private readonly queue: Queue,
    private readonly tenantDb: TenantDbService,
    private readonly dispatch: SearchEmbedDispatchService,
    private readonly workerProfile: WorkerProfileService,
    @Inject(InstanceConfigService)
    private readonly instanceConfig: InstanceConfigReader,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const modelId = this.instanceConfig.config.search.chats.embeddingModelId;
    if (!modelId) {
      // Off-by-default: the whole layer is inert. No ensureQueue, no
      // consumer, no provider client — an instance that never declares a
      // corpus model never creates 'search-embed' at all.
      return;
    }

    // Design D14: a fourth worker group is a fourth way to silently run zero
    // consumers, mitigated in part by a loud boot log — an operator running a
    // configured instance on a profile that omits this group learns it here,
    // not by watching coverage never move.
    const concurrency = this.workerProfile.concurrencyFor('search-embed');
    if (concurrency === null) {
      this.logger.warn(
        `Embedding is configured (corpus model "${modelId}") but this process's active worker profile does not include 'search-embed' — no embed jobs are consumed here. Ensure some deployed process covers this group.`,
      );
      return;
    }

    const model = this.instanceConfig.config.embeddingModels.find(
      (candidate) => candidate.id === modelId,
    );
    if (!model) {
      // Unreachable while config-loader keeps `search.chats.embeddingModelId`
      // validated against `embeddingModels[].id` — defense-in-depth, not a
      // path this process exercises today.
      this.logger.error(
        `Embedding model "${modelId}" is not declared in embeddingModels[] — cannot start the embed consumer.`,
      );
      return;
    }
    const backend = createOpenAIEmbeddingBackend(
      resolveEmbeddingBackendConfig(
        model,
        this.instanceConfig.config.providers,
      ),
    );

    await this.queue.ensureQueue(SEARCH_EMBED_QUEUE);
    await this.queue.consume(
      SEARCH_EMBED_QUEUE,
      async (job) => {
        try {
          await this.embedChat(
            job.chatId,
            job.ownerUserId,
            model.id,
            backend,
            model.batchSize,
          );
        } catch (error) {
          this.logger.error(
            `Embedding failed for chat ${job.chatId}`,
            error instanceof Error ? error.stack : String(error),
          );
          throw error;
        }
      },
      { pollingIntervalSeconds: 1, concurrency },
    );
    this.logger.log(
      `Consuming '${SEARCH_EMBED_QUEUE.name}' (concurrency ${concurrency}, model "${modelId}")`,
    );
  }

  /**
   * Process one chat's embed job: up to `EMBED_MAX_BATCHES_PER_JOB` batches,
   * re-enqueuing itself when bounded work remains (design D5). Public (like
   * `SearchIndexService.reindexChat`) so integration tests can drive it
   * directly with a fake `EmbeddingBackend`, bypassing queue consumption.
   */
  async embedChat(
    chatId: string,
    ownerUserId: string,
    modelId: string,
    backend: EmbeddingBackend,
    batchSize: number,
  ): Promise<void> {
    for (let batch = 0; batch < EMBED_MAX_BATCHES_PER_JOB; batch++) {
      const { processedCount, hasMore } = await this.processBatch(
        chatId,
        ownerUserId,
        modelId,
        backend,
        batchSize,
      );
      // Nothing outstanding, or a stuck batch that made zero progress
      // (design trap: an unthrottled retry loop) — stop without
      // re-enqueueing. The 5-minute sweep is the natural backoff for a
      // stuck batch; a legitimately drained chat needs no further work at
      // all.
      if (processedCount === 0 || !hasMore) {
        return;
      }
    }
    // Bounded by MAX_BATCHES with work still outstanding — page, don't load
    // (design D5). Best-effort + coalesced by the dispatch service's own
    // contract, so this is safe even if a job for this chat is already
    // pending.
    void this.dispatch.enqueueChatEmbed(chatId, ownerUserId);
  }

  /**
   * One batch: re-query outstanding documents under `runAs(owner)`, close
   * the transaction, embed over the network with NO transaction open
   * (design D15 rule 1 — the embed's own persist takes a row-level lock a
   * concurrent rebuild wants, so holding it across a provider call would
   * block rebuilds directly), then persist conditionally in a short
   * transaction (READ COMMITTED — `runAs`'s default, matching D15 rule 3).
   */
  private async processBatch(
    chatId: string,
    ownerUserId: string,
    modelId: string,
    backend: EmbeddingBackend,
    batchSize: number,
  ): Promise<{ processedCount: number; hasMore: boolean }> {
    const outstanding = await this.tenantDb.runAs(ownerUserId, (tx) =>
      this.queryOutstandingBatch(tx, chatId, ownerUserId, modelId, batchSize),
    );
    if (outstanding.length === 0) {
      return { processedCount: 0, hasMore: false };
    }
    const hasMore = outstanding.length === batchSize;
    const byId = new Map(outstanding.map((row) => [row.id, row]));

    // Design D11: embed `content` verbatim — role labels, original casing,
    // never `normalized_content`.
    const documents: EmbeddingDocumentInput[] = outstanding.map((row) => ({
      documentId: row.id,
      contentHash: row.contentHash,
      content: row.content,
    }));

    let results: EmbeddingResult[];
    try {
      // Trap 6: exactly one persist-batch per embedDocuments call. The
      // adapter's own internal chunking already splits by the model's
      // batchSize; passing exactly one persist-batch (sized to the same
      // batchSize) makes that internal chunking a no-op, so a mid-call
      // failure loses only the batch not yet persisted rather than
      // re-embedding work that already succeeded within one call.
      results = await backend.embedDocuments(documents);
    } catch (error) {
      return this.handleBatchFailure(
        ownerUserId,
        chatId,
        outstanding,
        modelId,
        error,
        hasMore,
      );
    }

    let written = 0;
    await this.tenantDb.runAs(ownerUserId, async (tx) => {
      for (const result of results) {
        const row = byId.get(result.documentId);
        if (!row) continue; // defensive: embedDocuments only ever returns ids it was sent
        const wrote = await persistEmbeddingSuccess(
          tx,
          result,
          row.priorEmbedInputVersion,
          modelId,
          EMBED_INPUT_VERSION,
        );
        if (wrote) written += 1;
      }
    });

    if (written === 0) {
      // Design D7 "a malformed vector is rejected... the document remains
      // outstanding" — every document in this batch was either superseded
      // between read and write, or filtered by the adapter's own dimension/
      // finite-value validation with no throw. Either way, looping again
      // immediately would just re-request the SAME stuck batch — stop this
      // job without re-enqueueing; the sweep is the natural backoff.
      if (results.length < outstanding.length) {
        this.logger.warn(
          `Embed batch for chat ${chatId}: backend returned ${results.length}/${outstanding.length} vector(s) and none persisted — leaving the rest outstanding for the next sweep`,
        );
      }
      return { processedCount: 0, hasMore: false };
    }
    return { processedCount: written, hasMore };
  }

  private async handleBatchFailure(
    ownerUserId: string,
    chatId: string,
    outstanding: readonly OutstandingRow[],
    modelId: string,
    error: unknown,
    hasMore: boolean,
  ): Promise<{ processedCount: number; hasMore: boolean }> {
    const classified = classifyEmbeddingFailure(error);
    if (!classified.terminal) {
      // Transient: rethrow so the queue's own retry policy (retryLimit 5,
      // exponential backoff) governs — no progress recorded this pass.
      throw classified;
    }
    // Terminal (D16): tombstone every outstanding document in THIS batch
    // with the same failure reason — one call issued the whole batch, so
    // one terminal classification (e.g. a dimension misconfiguration or an
    // auth rejection) applies to all of it.
    let tombstoned = 0;
    await this.tenantDb.runAs(ownerUserId, async (tx) => {
      for (const row of outstanding) {
        const wrote = await persistEmbeddingFailure(
          tx,
          row,
          modelId,
          EMBED_INPUT_VERSION,
          classified.message,
        );
        if (wrote) tombstoned += 1;
      }
    });
    if (tombstoned === 0) {
      this.logger.warn(
        `Embed batch for chat ${chatId} tombstoned nothing after a terminal failure — every row was superseded between read and write`,
      );
      return { processedCount: 0, hasMore: false };
    }
    return { processedCount: tombstoned, hasMore };
  }

  private queryOutstandingBatch(
    tx: Db,
    chatId: string,
    ownerUserId: string,
    modelId: string,
    batchSize: number,
  ): Promise<OutstandingRow[]> {
    // Mirrors `llame_search_embedding_coverage`'s `needs_embedding`
    // predicate (design D10) — IS DISTINCT FROM throughout is load-bearing,
    // not stylistic: a never-attempted row has NULL embedding_model_key/
    // embed_input_version, and a plain `=` there would evaluate to NULL
    // rather than true, silently excluding it.
    return tx
      .select({
        id: searchChatDocuments.id,
        content: searchChatDocuments.content,
        contentHash: searchChatDocuments.contentHash,
        priorEmbedInputVersion: searchChatDocuments.embedInputVersion,
      })
      .from(searchChatDocuments)
      .where(
        and(
          eq(searchChatDocuments.chatId, chatId),
          eq(searchChatDocuments.ownerUserId, ownerUserId),
          sql`(
            embedding_model_key      IS DISTINCT FROM ${modelId}
            OR embedded_content_hash IS DISTINCT FROM content_hash
            OR embed_input_version   IS DISTINCT FROM ${EMBED_INPUT_VERSION}
            OR (embedding IS NULL AND embedding_fail_reason IS NULL)
          )`,
        ),
      )
      .limit(batchSize);
  }
}
