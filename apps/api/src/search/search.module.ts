import { Module } from '@nestjs/common';

import { QueueModule } from '../queue/queue.module';
import { CanonicalSearchCoverageService } from './canonical-search-activation.service';
import { ChatSearchQueryEmbedder } from './chat-search-query-embedder';
import { EmbeddingBindingBootCheckService } from './embedding-binding-boot-check.service';
import { SearchEmbedDispatchService } from './search-embed-dispatch.service';
import { SearchEmbedWorker } from './search-embed.worker';
import { SearchIndexService } from './search-index.service';
import { SearchReindexDispatchService } from './search-reindex-dispatch.service';
import { SearchReindexWorker } from './search-reindex.worker';

/**
 * SearchModule (#195) — the derived-projection maintenance side of chat search:
 * the reindex worker + 5-minute discovery sweep (SearchReindexWorker), the
 * rebuild-per-chat projection service (SearchIndexService), the best-effort
 * enqueue seam the content-write paths call (SearchReindexDispatchService),
 * the embedding-model binding-ledger boot check (chat-search-embeddings,
 * design D1 — EmbeddingBindingBootCheckService), and the embed worker + its
 * own enqueue seam (design D5/D14 — SearchEmbedWorker, SearchEmbedDispatchService).
 *
 * A LEAF module: it imports only QueueModule (+ the global DbModule for
 * TenantDbService and the global InstanceConfigModule for InstanceConfigService)
 * and NOTHING corpus-owning (no ChatsModule / RunWorkerModule), so ChatsModule
 * and RunWorkerModule can both import it for the write hooks with no dependency
 * cycle. SearchIndexService constructs `ChatsRepository`/`MessagesRepository`
 * INLINE with the scoped `tx` (plain classes via `new`, not injected providers),
 * so it reuses their owner-scoped reads without a module-level dependency or
 * cycle. Retrieval itself is NOT here — it lives in ChatsRepository.searchByOwner
 * (one search path, tool-calling D7) and only consumes the corpus-agnostic
 * search/core builder. SearchEmbedWorker builds its provider client directly
 * from `@ai-sdk/openai` (design D15), so this stays a leaf even with a
 * network-calling consumer added — no ModelsModule import.
 */
@Module({
  imports: [QueueModule],
  providers: [
    SearchIndexService,
    SearchReindexDispatchService,
    SearchReindexWorker,
    CanonicalSearchCoverageService,
    EmbeddingBindingBootCheckService,
    SearchEmbedDispatchService,
    SearchEmbedWorker,
    ChatSearchQueryEmbedder,
  ],
  exports: [
    SearchIndexService,
    SearchReindexDispatchService,
    SearchEmbedDispatchService,
    CanonicalSearchCoverageService,
    ChatSearchQueryEmbedder,
  ],
})
export class SearchModule {}
