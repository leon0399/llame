import { Module } from '@nestjs/common';
import { MemoryModule } from '../memory/memory.module';
import { ModelsModule } from '../models/models.module';
import { RecencyDigestModule } from '../chats/recency-digest.module';
import { CompactionService } from './compaction.service';

/**
 * CompactionModule (#57) — lineage-based conversation context compaction.
 * Post-turn work today (fired by the chat loop); rides into the durable-run
 * worker with the loop (#50), so it must stay importable without the chat
 * HTTP surface.
 */
@Module({
  imports: [ModelsModule, MemoryModule, RecencyDigestModule],
  providers: [CompactionService],
  exports: [CompactionService],
})
export class CompactionModule {}
