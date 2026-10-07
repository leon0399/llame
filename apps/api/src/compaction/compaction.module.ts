import { Module } from '@nestjs/common';
import { ModelsModule } from '../models/models.module';
import { CompactionService } from './compaction.service';

/**
 * CompactionModule (#57) — the summarization call behind the pre-step context
 * checkpoint (#268). The Run worker evaluates the trigger and owns the
 * publication transaction inside its own attempt, so this module supplies only
 * the one path that calls a model; it must stay importable without the chat
 * HTTP surface.
 */
@Module({
  imports: [ModelsModule],
  providers: [CompactionService],
  exports: [CompactionService],
})
export class CompactionModule {}
