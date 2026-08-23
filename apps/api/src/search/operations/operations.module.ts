import { Module } from '@nestjs/common';

import { CoreInfraModule } from '../../core-infra.module';
import { QueueModule } from '../../queue/queue.module';
import { SearchEmbedDispatchService } from '../search-embed-dispatch.service';

/**
 * OperationsModule — the DI graph for the `search:*` operator commands
 * (chat-search-embeddings/operations, layer 7). Deliberately NOT
 * `SearchModule` or `WorkerModule`: importing either would instantiate
 * `SearchEmbedWorker`/`SearchReindexWorker`, and `NestFactory.
 * createApplicationContext` runs `onApplicationBootstrap` same as a normal
 * boot — under the default `all` worker profile those services would start
 * CONSUMING their queues and construct a real provider-credentialed embed
 * backend, turning `backfill`'s process into a worker and silently
 * defeating "backfill issues no provider requests" (design D14's whole
 * point). This module provides only what the commands need directly:
 * `CoreInfraModule` (config + DB), `QueueModule` (the `QUEUE` token), and
 * `SearchEmbedDispatchService` itself (constructor deps are only `QUEUE` +
 * `InstanceConfigService`, both already satisfied) — no embedding backend is
 * even constructible in this graph, so the "zero provider requests" property
 * is structural, not merely tested.
 */
@Module({
  imports: [CoreInfraModule, QueueModule],
  providers: [SearchEmbedDispatchService],
})
export class OperationsModule {}
