import { Module } from '@nestjs/common';
import { TenantDbService } from '../db/tenant-db.service';
import { CompactionService } from './compaction.service';

/**
 * CompactionModule (#57) — lineage-based conversation context compaction.
 * Post-turn work today (fired by the chat loop); rides into the durable-run
 * worker with the loop (#50), so it must stay importable without the chat
 * HTTP surface.
 */
@Module({
  providers: [TenantDbService, CompactionService],
  exports: [CompactionService],
})
export class CompactionModule {}
