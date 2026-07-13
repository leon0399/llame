import { Module } from '@nestjs/common';

import { QueueModule } from '../queue/queue.module';
import { SearchIndexService } from './search-index.service';
import { SearchReindexDispatchService } from './search-reindex-dispatch.service';
import { SearchReindexWorker } from './search-reindex.worker';

/**
 * SearchModule (#195) — the derived-projection maintenance side of chat search:
 * the reindex worker + 5-minute discovery sweep (SearchReindexWorker), the
 * rebuild-per-chat projection service (SearchIndexService), and the best-effort
 * enqueue seam the content-write paths call (SearchReindexDispatchService).
 *
 * A LEAF module: it imports only QueueModule (+ the global DbModule for
 * TenantDbService) and NOTHING corpus-owning (no ChatsModule / RunWorkerModule),
 * so ChatsModule and RunWorkerModule can both import it for the write hooks with
 * no dependency cycle. SearchIndexService constructs `ChatsRepository`/
 * `MessagesRepository` INLINE with the scoped `tx` (plain classes via `new`, not
 * injected providers), so it reuses their owner-scoped reads without a module-level
 * dependency or cycle. Retrieval itself is NOT here — it lives in
 * ChatsRepository.searchByOwner (one search path, tool-calling D7) and only consumes
 * the corpus-agnostic search/core builder.
 */
@Module({
  imports: [QueueModule],
  providers: [
    SearchIndexService,
    SearchReindexDispatchService,
    SearchReindexWorker,
  ],
  exports: [SearchIndexService, SearchReindexDispatchService],
})
export class SearchModule {}
